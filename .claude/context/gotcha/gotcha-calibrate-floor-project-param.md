---
name: calibrate-floor-project-param
description: Floor calibration --project flag expects project name substring, not projectId hash
metadata:
  type: gotcha
  tags: [calibration, floor-replay, transcripts, project-scoping]
---

# Problem

When running floor calibration, passing the **projectId hash** fails with:
```
No Claude Code transcripts found for "8fa4d8ac62c3" under ~/.claude/projects/.
```

Even though the hash is correct and used everywhere else (introspect, query endpoints).

## Why It Fails

The `transcriptDir()` function (in `lib/calibration/floor-replay.ts`) looks for transcript directories by **path-based slug**, not by projectId hash:

```typescript
// Transcript directories are named: -Users-Anthony-Dawson-src-claude-contextus
// NOT: 8fa4d8ac62c3

const slugs = fs.readdirSync('~/.claude/projects/');
const exact = slugs.find((s) => s.endsWith(`-${project}`));
const loose = slugs.find((s) => s.includes(project));
```

It searches for a directory slug **containing** the `project` parameter as a substring.

## Solution

**Pass the project name, not the hash:**

```bash
# ❌ WRONG (uses hash)
~/contextus/node_modules/.bin/tsx ~/contextus/scripts/calibrate-floor.ts \
  --project 8fa4d8ac62c3

# ✅ RIGHT (uses name)
~/contextus/node_modules/.bin/tsx ~/contextus/scripts/calibrate-floor.ts \
  --project claude-contextus
```

The substring match will find `-Users-Anthony-Dawson-src-claude-contextus`.

## Why the Mismatch?

- **Daemon endpoints** (`/query`, `/introspect`) use **projectId hash** for DB scoping
- **Transcript directories** are named by **filesystem path slug** for human readability
- Floor calibration bridges the two: it needs transcripts (path-based) to calibrate the floor for a corpus (hash-based)

The `--project` parameter is specifically for **transcript lookup**, not DB scoping, so it follows the transcript naming convention.

## Auto-Detection Alternative

If you run the script **from the project directory**, it auto-computes the hash from `cwd` and uses that as the fallback:

```bash
cd ~/src/claude-contextus
~/contextus/node_modules/.bin/tsx ~/contextus/scripts/calibrate-floor.ts
# Auto-detects: hash from cwd, matches transcript dir via loose substring
```

But this still relies on substring matching, so it works because `claude-contextus` appears in the slug.

## Related

- `lib/calibration/floor-replay.ts` line ~40: `transcriptDir()` implementation
- Transcript directories: `~/.claude/projects/-Users-...-{project-name}/`
- Project registry uses hash: `~/.contextus/data/projects.json`
- This naming split is a known quirk; a unified project→transcript resolver would fix it

## Detection

If you see "No Claude Code transcripts found for [12-char hash]", you passed the hash instead of the name.

Check what transcript directories exist:
```bash
ls ~/.claude/projects/ | grep -i <your-project>
```

Then pass the **last segment** of that directory name as `--project`.
