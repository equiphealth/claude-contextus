# Contextus Documentation

**Using contextus?** Start here. **Building/contributing to it?** See
[dev/README.md](dev/README.md).

---

## For users

- **[quick-start.md](quick-start.md)** — Zero to your first auto-injected context in ~5
  minutes. Install, set up a project, see retrieval work, verify it.
- **[usage.md](usage.md)** — Day-to-day: creating context, reading injections,
  understanding sources, maintenance.
- **[calibration.md](calibration.md)** — Tuning the injection floor to your corpus, the
  usage-eval refinement loop, and the per-project config tiers.
- **[API.md](API.md)** — Complete HTTP API reference for the contextus daemon (endpoints,
  parameters, responses, error handling).
- **[MIGRATION_GUIDE.md](MIGRATION_GUIDE.md)** — Moving from an older `.claude/memory/` +
  hooks system to contextus.

---

## For contributors

Design specs, build history, roadmap, and AI design reviews live under
**[dev/](dev/)** — see **[dev/README.md](dev/README.md)** for the index. This split
keeps the user docs above uncluttered: `docs/` is for *using* contextus, `docs/dev/` is
for *building* it.
- [long-running-turn-capture](long-running-turn-capture.md) — Exploration: improving context/doc capture during long implementation sessions
