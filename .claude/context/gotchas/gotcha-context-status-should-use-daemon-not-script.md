---
name: context-status-should-use-daemon-not-script
description: context-status skill runs scripts/cli/status.ts directly and reimplements the project hash instead of calling /introspect
metadata:
  type: gotcha
  tags: ["context-status", "daemon", "introspect", "project-hash"]
---

# Gotcha: context-status skill bypasses the daemon, breaks on consumer repos

**Symptom**: `/context-status` was unreliable when run against a linked/consumer repo. Working around it required manually computing the project hash in a Node one-liner (`crypto.createHash("sha256").update(absPath).digest("hex").slice(0,12)`) to pass to `/introspect` by hand.

**Root cause**: the skill's documented implementation (`skills/context-status/reference.md:217-228`) does not call the daemon HTTP API — it shells out to `npx tsx scripts/cli/status.ts` directly. That script depends on contextus's own dev toolchain (`tsx`, its `node_modules`) being resolvable from the invoking cwd/plugin-root, which isn't guaranteed for a consumer project. It also reimplements the project-hash formula inline (`scripts/cli/status.ts:320`) instead of importing the canonical `projectHash()` export from `lib/config.ts:686-695`.

**Why this is avoidable**: the daemon's `/introspect` endpoint (`daemon/server.ts:1511-1531`) resolves its `project` param via `resolveProjectId()` (`lib/workspace.ts:282-298`), which already accepts a hash, a project name, OR an absolute path — no pre-computed hash is required. `/query`'s handler shows the intended pattern: pass `cwd`, let the daemon hash it server-side (`daemon/server.ts:237`: `cwd ? projectHash(cwd) : undefined`).

**Other reimplementations of the same hash formula** (should all just import `projectHash()`): `scripts/cli/status.ts:320`, `scripts/tag-context.ts:92`, `scripts/cli/context-stats.ts:67`.

**Fix tracked**: https://github.com/equiphealth/claude-contextus/issues/69 — migrate `/context-status` to call `/introspect` directly with `cwd`/absolute path instead of shelling out to the script.
