# GitHub Actions Workflows

## CI Workflow (`ci.yml`)

Runs on every PR and push to main.

**Jobs:**

1. **Lint & Type Check**
   - ESLint on `lib/`, `scripts/`, `daemon/`
   - TypeScript type check (`tsc --noEmit`)
   - Prettier format check

2. **Test**
   - Runs `pnpm test` (Node test runner)
   - Currently validates type definitions and imports

3. **Build Verification**
   - `pnpm build` produces `dist/` output
   - Verifies compiled files exist

4. **Embedding Smoke Test**
   - Installs Ollama in CI
   - Pulls `nomic-embed-text` model
   - Embeds `.claude/context/` corpus (if exists)
   - Validates embedding pipeline works end-to-end

**Requirements:**
- pnpm 9+
- Node 20+

---

## Release Workflow (`release.yml`)

Triggers on version tags (`v*.*.*`).

**Jobs:**

1. **Create Release**
   - Runs full CI suite (lint, type-check, test, build)
   - Generates changelog from commits since last tag
   - Creates GitHub Release with:
     - Version name
     - Auto-generated changelog
     - Compiled `dist/` files attached

2. **Publish to npm**
   - Runs after release creation
   - Publishes package to npm registry
   - Requires `NPM_TOKEN` secret

**Usage:**

```bash
# Bump version
npm version patch  # or minor, major

# Push tag
git push origin v0.1.1

# GitHub Actions handles the rest
```

---

## Setup Required

### For Release Workflow

1. **Add npm token** (if publishing to npm):
   ```
   Settings → Secrets → Actions → New repository secret
   Name: NPM_TOKEN
   Value: <your npm token>
   ```

   Get token from: https://www.npmjs.com/settings/tokens

2. **Permissions** (already configured in workflow):
   - `contents: write` for creating releases
   - Workflow has this via `permissions` key

### For Embedding Smoke Test

No setup needed — Ollama installs automatically in CI.

**Note:** This job can be slow (~3-5 min) due to model download. Consider:
- Making it optional (manual trigger)
- Caching Ollama models between runs
- Only running on release, not every PR

---

## Workflow Status Badges

Add to main README.md:

```markdown
[![CI](https://github.com/yourusername/claude-contextus/actions/workflows/ci.yml/badge.svg)](https://github.com/yourusername/claude-contextus/actions/workflows/ci.yml)
[![Release](https://github.com/yourusername/claude-contextus/actions/workflows/release.yml/badge.svg)](https://github.com/yourusername/claude-contextus/actions/workflows/release.yml)
```

---

## Optimizations (Optional)

### Cache Ollama models
Add to embedding-smoke-test job:

```yaml
- name: Cache Ollama models
  uses: actions/cache@v4
  with:
    path: ~/.ollama
    key: ollama-nomic-${{ runner.os }}
```

### Run embedding test only on release
Change `embedding-smoke-test` to only run on tags:

```yaml
embedding-smoke-test:
  if: startsWith(github.ref, 'refs/tags/v')
```

### Matrix testing (multiple Node versions)
```yaml
strategy:
  matrix:
    node-version: [18, 20, 22]
```
