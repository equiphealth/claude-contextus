# Migrations Registry

Each entry describes a breaking change that requires data/config migration when
upgrading from a version below the entry's `version` to one at or above it.

The upgrade skill reads this file, compares the user's `~/.contextus/version.json`
against the current `package.json` version, and runs only the migrations in between.

## Format

Each migration is an H2 with the version it was introduced in, a description of
what changed, and a `steps` section with the concrete actions the upgrade skill
should perform.

---

## 0.13.0 — Token Overflow Protection (Statusline Bridge)

**What changed:**
- New `capacityProtection` config section controls graduated injection throttling
- Query hook now reads `~/.contextus/runtime/<session>.context-stats.json` and passes stats to daemon
- Daemon checks `contextStats.used_percentage` before embedding/injection
- Session-start hook cleans stale stats files (>24h)
- Statusline script patched to write stats file on every render

**Why breaking:**
- Without the statusline bridge patch, overflow protection is inactive (feature degrades gracefully, but users expect it after upgrade)
- The `install-statusline-bridge.sh` script must be run once to enable the feature

**Detection:**
- `~/.claude/statusline-command.sh` exists but does NOT contain "contextus: token overflow protection bridge"
- `~/.contextus/runtime/` directory doesn't have `.context-stats.json` files being written

**Steps:**
1. Install the statusline bridge:
   ```bash
   bash ~/src/claude-contextus/scripts/install-statusline-bridge.sh
   ```
2. Verify bridge is active (send a message, then check):
   ```bash
   cat ~/.contextus/runtime/$CLAUDE_CODE_SESSION_ID.context-stats.json
   ```

**Scripts:**
- `scripts/install-statusline-bridge.sh` — idempotent patch installer

**Rollback:**
Remove the bridge block from `~/.claude/statusline-command.sh` (look for the `# contextus: token overflow protection bridge` marker and delete through the closing `fi`). Feature silently disables.

---

## 0.12.0 — Unified Database & Project Normalization

**What changed:**
- Single shared LanceDB at `~/.contextus/data/contextus.lance` replaces per-project DBs
- Every row has a `project` column (SHA256 hash of absolute path, not project name)
- Project identifiers (name/hash/path) normalized to canonical hash before DB operations
- Project registry at `~/.contextus/data/projects.json` enables name → hash resolution
- `linkedProjects` config replaced by workspace files (`~/.contextus/workspaces/`)
- New `/search` endpoint for floor-free corpus queries (used by `/context-search`)

**Why breaking:**
- Old DBs used project name (e.g., "automation") for isolation
- New DB uses SHA256 hash (e.g., "e70f0dcf1fbd") for isolation
- Pre-normalization code may have corrupted the registry with wrong paths

**Detection:**
- Per-project DB dirs exist at `~/.contextus/data/<name>/contextus.lance/`
- Corrupted `projects.json` (entries pointing to wrong paths)
- Old queries return empty results (project name not found in new DB)

**Steps:**
1. Stop the daemon (holds memoized connection to old DB path)
2. Delete old per-project DB directories (`rm -rf ~/.contextus/data/*/contextus.lance`)
3. Delete corrupted registry (`rm ~/.contextus/data/projects.json`)
4. Keep usage logs (usage-ratings.jsonl, .eval-queue.jsonl remain per-project)
5. Re-embed each project from its directory:
   ```bash
   cd ~/your-project
   ~/src/claude-contextus/node_modules/.bin/tsx \
     ~/src/claude-contextus/scripts/embed-contexts.ts
   ```
6. Verify with `/context-search` using project name or hash
7. Restart daemon to load new code

**Scripts:**
- Manual re-embed (no automated script yet — see UPGRADE_GUIDE.md)
- `/context-search` to verify after migration

**Rollback:**
Restore backup of `~/.contextus/data/`, checkout previous version, restart daemon.

---

<!-- TEMPLATE for future migrations:

## X.Y.Z — Short Title

**What changed:**
- Bullet list of breaking changes

**Detection:**
- How to tell if this migration is needed

**Steps:**
1. Ordered actions to perform

**Scripts:**
- Commands that implement the steps

**Rollback:** How to undo if needed (or "not applicable").

-->
