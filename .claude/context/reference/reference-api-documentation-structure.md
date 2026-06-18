---
name: api-documentation-structure
description: How API documentation is structured and maintained for the contextus daemon HTTP endpoints
metadata:
  type: reference
  tags: [documentation, api, daemon, maintenance]
---

# API Documentation Structure

**Location:** `docs/API.md` is the comprehensive HTTP API reference for the contextus daemon.

## Per-Endpoint Structure

Each endpoint section includes:
- **Purpose** — What it does and when to use it
- **Request parameters** — Query params or JSON body schema
- **Response schemas** — With realistic example JSON
- **Behavior details** — Side effects, state changes, logging
- **Used by** — Which hooks, skills, or tools call this endpoint

## Additional Sections

Beyond endpoint definitions:
- **Architecture overview** — Daemon lifecycle, runtime files, project isolation
- **Error handling philosophy** — "Never block a prompt" degradation strategy
- **Auto-recovery** — How the daemon recovers from provider failures
- **Configuration** — 3-tier merge, hot-reload behavior
- **Logging** — What gets logged where
- **Security** — Localhost-only, no auth model
- **Performance** — Typical latency expectations
- **Testing examples** — curl commands for manual testing

## Sync Points (Update Together)

When adding/changing an endpoint, update all four:

1. **Implementation** — `daemon/server.ts` endpoint handler
2. **Header comment** — `daemon/server.ts` lines 13-19 (endpoint list + link to API.md)
3. **FEATURES.md** — `docs/FEATURES.md` "Endpoints" section (one-liner + link)
4. **API.md** — `docs/API.md` full endpoint documentation

The `docs/DOCS.md` index already points to API.md (no per-endpoint update needed).

## Markdown Over Swagger

**Decision:** Use markdown API docs instead of OpenAPI/Swagger because:

- **No external consumers** — All API calls are hooks/skills in the same codebase (tightly coupled)
- **Narrative strength** — Markdown captures philosophy, troubleshooting, "why" that OpenAPI can't
- **No tooling overhead** — OpenAPI requires swagger-ui, validators, or codegen for 7 simple endpoints
- **Alignment** — Project values "file-based everything, no framework dependencies"

**Exception:** Consider OpenAPI later if:
- API grows to 20+ endpoints (maintenance burden flips)
- Public-facing tooling needs machine-readable spec
- Need contract validation in CI

Even then, prefer OpenAPI for **validation only** (no runtime UI hosting).

## Testing Without Swagger UI

For interactive testing without Swagger overhead:

1. **VSCode REST Client** — `.http` files with "Send Request" button (zero deps)
2. **curl examples** — Already in API.md (copy/paste to terminal)
3. **Postman collection** — Export/share if collaborating with non-devs

Swagger UI is overkill when the API consumer is yourself via localhost.

## Why This Pattern

- **Single source** — API.md is canonical; code comments point to it
- **Discoverable** — Listed in DOCS.md index, linked from FEATURES.md
- **Complete** — Captures "how to use" and "why it works this way"
- **Low friction** — No build step, no spec validation, just edit markdown
