# Upgrade Guide: Existing Contextus Installations

For users already running contextus who need to upgrade to a newer version with breaking changes.

---

## Upgrading to v0.3.0 (Unified DB + Project Normalization)

**Release Date:** 2026-06-27  
**Breaking Changes:** Yes — requires corpus rebuild  
**Estimated Time:** 5-10 minutes per project

### What Changed

Two major architectural improvements:

1. **Unified Database** — All projects now share one LanceDB instance at `~/.contextus/data/contextus.lance` instead of per-project databases. Project isolation is via the `project` column (SHA256 hash).

2. **Project Identifier Normalization** — The daemon now accepts project identifiers in three forms (friendly name, hash, or path) and normalizes them consistently before DB operations.

**Why these are breaking:**
- Old per-project databases (e.g., `~/.contextus/data/automation/contextus.lance`) used project name for isolation
- New unified DB uses SHA256 hash of absolute path for isolation
- Registry may have corrupted entries from pre-normalization code

### Pre-Upgrade Checklist

- [ ] **Check your contextus version** — `git log --oneline | head -5` in the contextus repo
- [ ] **List your active projects** — Projects with embedded corpora in `~/.contextus/data/`
- [ ] **Backup if paranoid** — `cp -r ~/.contextus/data ~/.contextus/data.backup` (optional)
- [ ] **Pull latest code** — `cd ~/src/claude-contextus && git pull`
- [ ] **Install dependencies** — `pnpm install`

### Upgrade Steps

#### 1. Clear Old Data

Remove all old per-project databases and the corrupted registry:

```bash
# Stop the daemon first
kill $(cat ~/.contextus/runtime/daemon.pid 2>/dev/null)

# Remove old per-project databases
rm -rf ~/.contextus/data/*/contextus.lance 2>/dev/null

# Clear corrupted project registry
rm ~/.contextus/data/projects.json

# Keep usage ratings and other logs
# (usage-ratings.jsonl, .eval-queue.jsonl stay per-project)
```

**What this removes:**
- Per-project `contextus.lance` directories
- Corrupted `projects.json` registry
- Per-project metadata files

**What this keeps:**
- `.claude/context/` files (your source of truth)
- `usage-ratings.jsonl` (Phase 1 eval data)
- `.eval-queue.jsonl` (pending evals)
- Session state files

#### 2. Rebuild Each Project Corpus

For each project with contextus context:

```bash
# Navigate to the project
cd ~/your-project

# Run embed using tsx by path (NOT pnpm --prefix)
~/src/claude-contextus/node_modules/.bin/tsx \
  ~/src/claude-contextus/scripts/embed-contexts.ts
```

**Expected output:**
```
contextus embed
  sources:  projectContext(/path/to/.claude/context), projectDocs(/path/to/docs), userContext(~/.contextus/context)
  provider: ollama (nomic-embed-text, 768d)
  target:   /Users/you/.contextus/data

Embedding 894 chunks from 99 files…
  [progress counter]

✓ Embedded 894 chunks (99 files) into '/Users/you/.contextus/data'
  by source: projectContext=453, projectDocs=390, userContext=51
  by type:   decision=116, gotcha=47, project=26, reference=524, unknown=177, arch=4
```

**What to watch for:**
- Embedding provider matches your setup (ollama vs transformers)
- Chunk counts look reasonable for your corpus size
- No prefix↔type mismatch errors (those abort the build)

#### 3. Verify Each Project

After embedding, test retrieval:

```bash
# From the project directory
cd ~/your-project

# Search for a known pattern (use the new /search endpoint)
CONTEXTUS_ROOT=$(bash ~/.contextus/scripts/find-contextus-root.sh)
$CONTEXTUS_ROOT/node_modules/.bin/tsx \
  $CONTEXTUS_ROOT/scripts/cli/context-search.ts \
  "your test query" --scores --limit 5
```

**Expected behavior:**
- Returns results from YOUR project's patterns
- Scores appear in the 0.5-0.9 range for relevant queries
- Results show the correct `Type:` (decision, gotcha, reference, etc.)

**If you see wrong results:**
- Results from other projects → project hash mismatch
- No results → corpus not embedded or wrong project name
- Old patterns → stale cache (restart daemon)

#### 4. Restart the Daemon

```bash
# Kill old daemon (it's running pre-upgrade code)
kill $(cat ~/.contextus/runtime/daemon.pid 2>/dev/null)

# Start fresh daemon from contextus repo
cd ~/src/claude-contextus
node --import tsx daemon/server.ts &
disown

# Verify it started
sleep 2
curl -s http://127.0.0.1:37800/health | jq '.modelLoaded'
# Should return: true
```

### Testing the Upgrade

#### Test 1: Project-Scoped Search

```bash
# From contextus repo directory (NOT the target project)
cd ~/src/claude-contextus

# Search automation project by name
CONTEXTUS_ROOT=$(pwd)
$CONTEXTUS_ROOT/node_modules/.bin/tsx \
  $CONTEXTUS_ROOT/scripts/cli/context-search.ts \
  "logging" --project automation --scores --limit 3
```

**Expected:** Returns automation's logging patterns, not contextus's.

#### Test 2: Live Session Injection

```bash
# Open a session in one of your projects
cd ~/your-project
claude

# Ask a question that should match a known pattern
"How do I handle X?"
```

**Check:**
- Thinking block mentions injected context
- Response references specific patterns
- Footer shows `Context: used: <pattern> (<score>)`

#### Test 3: Cross-Project Search (if using workspaces)

If you have linked projects in `~/.contextus/workspaces/`:

```bash
# Search should find patterns from workspace siblings
cd ~/project-a
# Ask about something documented in project-b's context
```

**Expected:** Retrieval includes patterns from both project-a and project-b.

### Rollback Plan

If upgrade fails or breaks your workflow:

```bash
# Restore backup (if you made one)
rm -rf ~/.contextus/data
mv ~/.contextus/data.backup ~/.contextus/data

# Checkout previous version
cd ~/src/claude-contextus
git log --oneline | head -10  # find the commit before upgrade
git checkout <previous-commit>

# Rebuild deps
pnpm install

# Restart daemon
kill $(cat ~/.contextus/runtime/daemon.pid 2>/dev/null)
node --import tsx daemon/server.ts &
```

### Common Issues

#### Issue: "No results found" when searching

**Cause:** Project not embedded or wrong project identifier.

**Fix:**
```bash
# Check if project hash exists in unified DB
cd ~/your-project
PROJECT_HASH=$(echo -n $(pwd) | sha256sum | cut -c1-12)
echo "Your project hash: $PROJECT_HASH"

# Check LanceDB has your project's rows
~/src/claude-contextus/node_modules/.bin/tsx <<EOF
import { openTable } from './lib/storage/lance-client.js';
const table = await openTable();
const count = await table.query()
  .where("project = '$PROJECT_HASH'")
  .limit(1)
  .toArray();
console.log('Rows for this project:', count.length > 0 ? 'Found' : 'None');
EOF
```

If no rows found → re-run embed from that project.

#### Issue: Search returns patterns from wrong project

**Cause:** Corrupted registry or wrong cwd during search.

**Fix:**
```bash
# Clear registry and re-register via search
rm ~/.contextus/data/projects.json

# Search using full path (forces correct registration)
cd ~/your-project
PROJECT_PATH=$(pwd)
~/src/claude-contextus/node_modules/.bin/tsx \
  ~/src/claude-contextus/scripts/cli/context-search.ts \
  "test" --project "$PROJECT_PATH"
```

#### Issue: Daemon logs "project=automation" instead of hash

**Diagnosis:** This is normal — `projectLabel` (for logging) uses the friendly name, but `projectId` (for DB queries) uses the hash. Check that results are correct, not the log format.

**Verify:** Search should return correct results even if logs show the friendly name.

#### Issue: "Model not loaded" or provider errors

**Cause:** Daemon needs to warm up after restart.

**Fix:**
```bash
# Check health
curl -s http://127.0.0.1:37800/health | jq

# If warmupError is set:
# - Ollama: check `ollama list` has nomic-embed-text
# - Transformers: check ~/.cache/huggingface has model files
# - Both: restart daemon after fixing provider
```

### Performance Notes

**Unified DB benefits:**
- Faster workspace queries (single DB instead of opening N tables)
- Reduced disk usage (deduplicated user-context rows)
- Simpler backup (one `~/.contextus/data` directory)

**Expected corpus sizes:**
- Small project (<50 patterns): ~2MB
- Medium project (100-200 patterns): ~5-10MB
- Large project (500+ patterns): ~20-30MB
- Plus shared `contextus.lance` overhead: ~1-2MB per project

### What's Next

After successful upgrade:

1. **Verify all projects** — Test retrieval in each active project
2. **Update bookmarks** — If you had aliases pointing to old paths
3. **Re-run calibration** — `/context-calibrate --floor` per project (floor tuning resets)
4. **Check usage stats** — `/context-stats` to see if Phase 1 eval data survived

### Related

- [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) — Migrating from memory/ to context/
- [dev/UNIFIED_DB_DESIGN.md](dev/UNIFIED_DB_DESIGN.md) — Why we unified the DB
- [quick-start.md](quick-start.md) — Basic setup if starting fresh

---

## Upgrading to Future Versions

Check the release notes in `docs/dev/V2_ROADMAP.md` and git commit history for breaking changes. Not all releases require corpus rebuilds — only those affecting:

- Embedding provider changes (model switch, dimension change)
- DB schema changes (new required columns, type changes)
- Project scoping changes (like this release)

For non-breaking updates:
```bash
cd ~/src/claude-contextus
git pull
pnpm install
# Restart daemon
kill $(cat ~/.contextus/runtime/daemon.pid 2>/dev/null)
node --import tsx daemon/server.ts &
```
