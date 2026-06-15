# Integration tests

Tests here touch **real I/O** — they create a LanceDB table on disk (in a temp
`HOME`), unlike the pure-logic suite in `tests/*.test.ts` which loads no DB and no
model (`<5s`, deterministic).

**The boundary is deliberate.** The fast suite (`pnpm test`) globs `tests/*.test.ts`
only — a single-level glob, so it never picks these up. Run these explicitly:

```bash
pnpm test:integration   # just these
pnpm test:all           # pure-logic + integration
```

**Rules for tests in this dir:**
- Isolate state: `mkdtempSync` + override `process.env.HOME` so `resolveDBPath`
  writes into a throwaway dir (see the verify-lance pattern). Never touch the real
  `~/.contextus/`.
- LanceDB writes are OK (fast). **No embedding-model load** — that's the line even
  integration tests hold; mock/handcraft vectors instead (CI has no Ollama; see the
  `ci-embedding-test-removal` decision).
- Clean up temp dirs in a `finally`/`after` hook.
