# GitHub Actions Setup Guide

## Quick Start

The workflows are ready to run — just push to GitHub. No manual setup required for basic CI.

## What Runs Automatically

### On every PR and push to `main`:
- ✅ ESLint + TypeScript type checking
- ✅ Prettier format validation
- ✅ Test suite (8 test files)
- ✅ Build verification
- ✅ Embedding smoke test (Ollama auto-installs)

### On version tags (`v*.*.*`):
- ✅ Full CI suite
- ✅ GitHub Release creation with changelog
- 🔒 npm publish (requires token — see below)

---

## Optional Setup

### 1. Enable npm Publishing (for releases)

**Only needed if you want automatic npm releases.**

1. Get npm token:
   - Go to https://www.npmjs.com/settings/tokens
   - Create "Automation" token
   - Copy the token

2. Add to GitHub:
   - Go to repo Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `NPM_TOKEN`
   - Value: paste token
   - Click "Add secret"

3. Update `package.json` repository URL:
   ```json
   "repository": {
     "type": "git",
     "url": "https://github.com/anthonypdawson/claude-contextus.git"
   }
   ```

**If you don't want npm publishing:** Delete or comment out the `publish-npm` job in `.github/workflows/release.yml`.

---

### 2. Add Status Badges to README

Add these to the top of `README.md`:

```markdown
[![CI](https://github.com/anthonypdawson/claude-contextus/actions/workflows/ci.yml/badge.svg)](https://github.com/anthonypdawson/claude-contextus/actions/workflows/ci.yml)
[![Release](https://github.com/anthonypdawson/claude-contextus/actions/workflows/release.yml/badge.svg)](https://github.com/anthonypdawson/claude-contextus/actions/workflows/release.yml)
```

---

### 3. Speed Up CI (Optional)

The embedding smoke test can be slow (~3-5 min) because it downloads Ollama + nomic model.

**Option A: Cache Ollama models**

Add this to the `embedding-smoke-test` job in `ci.yml`:

```yaml
- name: Cache Ollama models
  uses: actions/cache@v4
  with:
    path: ~/.ollama
    key: ollama-nomic-${{ runner.os }}
    restore-keys: |
      ollama-nomic-
```

**Option B: Run only on releases**

Change the job condition in `ci.yml`:

```yaml
embedding-smoke-test:
  if: github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v')
```

This skips the smoke test on PRs, only runs on main branch and releases.

---

## Creating a Release

**Step 1: Bump version**
```bash
# Choose one:
npm version patch   # 0.1.0 → 0.1.1 (bug fixes)
npm version minor   # 0.1.0 → 0.2.0 (new features)
npm version major   # 0.1.0 → 1.0.0 (breaking changes)
```

This updates `package.json` and creates a git tag.

**Step 2: Push tag**
```bash
git push origin main --tags
# or just: git push --follow-tags
```

**Step 3: Wait for GitHub Actions**
- Go to Actions tab in GitHub
- Watch the `Release` workflow run
- When complete, check Releases page for new release

**Manual release (without npm):**
```bash
git tag v0.1.1
git push origin v0.1.1
```

---

## Troubleshooting

### CI fails on first run

**Problem:** "Resource not accessible by integration" when creating release

**Fix:** Enable workflow permissions:
1. Settings → Actions → General
2. Workflow permissions → select "Read and write permissions"
3. Save

---

### Embedding smoke test times out

**Problem:** Ollama model download exceeds job timeout

**Fix:** Either:
- Increase job timeout: `timeout-minutes: 15`
- Or disable: comment out `embedding-smoke-test` job

---

### Tests fail in CI but pass locally

**Common causes:**
1. Missing `pnpm-lock.yaml` — run `pnpm install` locally and commit the lockfile
2. Node version mismatch — CI uses Node 20, check `package.json` engines
3. Environment differences — check for hardcoded paths in tests

---

## Workflow Files

- `.github/workflows/ci.yml` — Pull request / main branch checks
- `.github/workflows/release.yml` — Version tag releases
- `.github/workflows/README.md` — Workflow documentation

---

## What's NOT Automated (Yet)

These require manual action:

- Corpus updates (`.claude/context/` files) — commit like any code
- Embedding generation — each dev runs `pnpm run embed` locally
- Calibration results — run `/context-calibrate` manually
- Daemon startup — happens per-session, not in CI

CI validates the *code*, not the *runtime state*.
