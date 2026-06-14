---
name: embedding-download-risk
description: Transformers.js default needs HF downloads, which corporate proxies/Cloudflare Gateway block — threatens the plugin's out-of-box install for any gated network
metadata:
  type: project
---

**Risk**: contextus's documented default embedding provider is **Transformers.js**, which downloads the nomic model (~138MB) from Hugging Face on first run. **Corporate networks frequently block this.** Confirmed on the build machine (2026-06-14): a Cloudflare Gateway returns an HTML block page instead of the ONNX weights — HF resolve URLs *and* the hf-mirror.com fallback both blocked. A separate, earlier hurdle on the same network: a self-signed corporate root in the TLS chain, which Node rejects unless `NODE_EXTRA_CA_CERTS` points at the system keychain export (curl uses its own bundle, so curl "working" doesn't mean Node will).

**Why it matters for the plugin (not just this machine)**: the original assumption was "users run Transformers.js, it just works." For anyone behind a corporate proxy / SSE / Zscaler / Cloudflare Gateway, the *default* path fails at first embed with an opaque `fetch failed` or a JSON-parse error on a block page. That's a broken out-of-box experience for exactly the enterprise users most likely to adopt a context tool.

**What we did in Phase 1**: flipped the *deployed* `plugin.json` to `provider: ollama` (same nomic model, 768-dim, over localhost — bypasses HF entirely). DESIGN.md already lists Ollama as a first-class provider, so it's within the envelope. The **code default stays `transformers`**; provider is recorded in the LanceDB sidecar so the daemon validates build-vs-query consistency. See [[BUILD_LOG Phase 1]].

**Solution shipped (2026-06-14, post-Phase-1)** — `lib/model-resolver.ts` + `scripts/fetch-model.ts` make model sourcing config-driven, so a blocked HF download is a config choice, not a dead end. Four escape hatches, all driven by `config.embedding.transformers`:
1. **Bundle / `localModelPath`** — `pnpm fetch-model --out ./models` on an unblocked network produces a portable bundle (transformers.js layout `<dir>/<modelId>/<files>`); point `localModelPath` at it → loads fully offline. Only option that covers air-gapped. The bulletproof default-capable path.
2. **Cache-seed / `cacheDir`** — seed the transformers.js FS cache from any machine that can reach HF.
3. **Mirror / `remoteHost`** — point at an internal Artifactory/Nexus that mirrors HF (most enterprises that block HF directly run one). NOTE: public mirrors like hf-mirror.com were *also* blocked on the build network.
4. **`NODE_EXTRA_CA_CERTS`** — for the TLS-interception hurdle (separate from and prior to the CDN block).

**Pre-flight is wired**: `preflightTransformers()` runs on `warmup()` (transformers provider only) — checks bundle, then reachability (catches block-page-as-200-HTML), and on failure throws `modelUnavailableError` listing all four fixes instead of an opaque `fetch failed`. Verified against the live blocked network: probe returns unreachable, preflight throws the actionable error. The lazy `getPipeline()` load also maps fetch/JSON/cert errors to the same message.

**Constraint discovered**: the corporate **npm registry (CodeArtifact) is also gated** — `pnpm add` 401s on an expired token — so the proxy-via-`undici` option (Node 22 `fetch` doesn't expose `ProxyAgent` without the `undici` package) can't be added right now. Deferred; the four hatches above need no new dependency (built-in `fetch` only). VPN-at-network-layer would let plain `fetch` reach HF without app-level proxy code anyway.

**Open product decisions still live (revisit before release)**:
- **Should Ollama be the recommended default**, with Transformers.js (+ bundle) as the offline/no-daemon option? Ollama needs a separate install but sidesteps the most common failure with zero config.
- **Ship a vendored model** in the published plugin vs. require `fetch-model` post-install? Trades package size (~140MB) for guaranteed out-of-box success.

**Related**: [[ollama-model-quality]] (different concern — that's the *eval* model, this is the *embedding* model), [[design-scoping-v1-v2]]
