---
name: changelog-heading-format
description: CHANGELOG.md version headings must use ## [X.Y.Z] format — release workflow grep depends on it
metadata:
  type: gotcha
  tags: [release, changelog, ci]
---

# CHANGELOG heading format

The release workflow (`.github/workflows/release.yml`) extracts a version's section from CHANGELOG.md using:

```bash
grep -q "## \[${VERSION}\]" CHANGELOG.md
sed -n "/^## \[${VERSION}\]/,/^## \[/p" CHANGELOG.md
```

This only matches headings formatted exactly as:

```markdown
## [0.6.0] - 2026-06-19
```

Variants that **will not match** (and silently fall back to commit list):
- `## v0.6.0` — missing brackets
- `## 0.6.0` — missing brackets
- `## [v0.6.0]` — extra `v` prefix inside brackets
- `### [0.6.0]` — wrong heading level

Convention: always use `## [MAJOR.MINOR.PATCH]` optionally followed by ` - YYYY-MM-DD`.
