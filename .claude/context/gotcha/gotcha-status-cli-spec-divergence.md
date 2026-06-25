---
name: status-cli-spec-divergence
description: Status CLI implementation missing growth tracking promised in skill spec
metadata:
  type: gotcha
  tags: [skills, cli, status, implementation-gap]
---

# Problem

The `/context-status` skill spec (SKILL.md) promises growth tracking:

```
Activity (last 30 days):
  📈 Growth: +12 context patterns, +5 docs
```

But the actual CLI implementation (`scripts/cli/status.ts`) doesn't implement this. It only queries the daemon's `/introspect` endpoint and displays corpus stats. There's no code to:
- Scan `.claude/context/` for files modified in last 30 days
- Scan `docs/` for files modified in last 30 days  
- Count and display them as "growth"

**Result**: The dashboard always shows growth as missing/zero, even when patterns are actively being added.

# Why It Happened

The unified CLI refactoring (2026-06-25) consolidated cost-report and status into one script. Growth tracking may have been lost during that refactor, or was never implemented (just documented in the spec as a future feature).

# Fix

Add filesystem scanning to `status.ts`:

```typescript
function calculateGrowth(projectPath: string, days: number = 30) {
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
  
  const contextDir = path.join(projectPath, '.claude', 'context');
  const docsDir = path.join(projectPath, 'docs');
  
  let newPatterns = 0;
  let newDocs = 0;
  
  // Scan .claude/context/ recursively
  if (fs.existsSync(contextDir)) {
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const stat = fs.statSync(fullPath);
          if (stat.mtimeMs > cutoff) newPatterns++;
        }
      }
    };
    walk(contextDir);
  }
  
  // Scan docs/ recursively
  if (fs.existsSync(docsDir)) {
    // Same walk logic
  }
  
  return { newPatterns, newDocs };
}
```

Then call it in `printDashboard()` and display the results.

# Detection

Run `/context-status` and look for the Growth line — if it's missing or shows 0 when you know patterns were recently added, this is the cause.
