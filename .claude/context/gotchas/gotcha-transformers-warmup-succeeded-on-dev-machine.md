---
name: transformers-warmup-succeeded-on-dev-machine
description: >-
  fetch-model succeeded on this dev machine 2026-10-23, contradicting
  plugin.jsonc comment that corporate Cloudflare Gateway blocks all HF downloads
metadata:
  type: gotcha
  tags:
    - embedding
    - transformers
    - huggingface
    - network
---

## What happened

Ran `pnpm fetch-model --out ./models` on this dev machine (2026-10-23) purely to test whether transformers.js could warm up `nomic-ai/nomic-embed-text-v1.5` end-to-end (both config.json AND the actual CDN-hosted weights file). It succeeded cleanly: downloaded ~140MB and verified a correct 768-dim output. No config or DB changes were made (fetch-model writes to a standalone `--out` dir, independent of the live `embedding.provider` setting) — scratch dir was deleted afterward.

## Why this matters

`plugin.jsonc:67-69` carries a comment asserting the shipped default is `ollama` *because* "the corporate Cloudflare Gateway blocks Hugging Face model downloads." That did not reproduce on this machine/network today. Combined with the empirically-confirmed CDN-split finding (see [[tradeoff-embedding-provider-deployment]] and GH issue #106 — the actual weights redirect to a separate `*.cdn.hf.co` host, distinct from `huggingface.co` itself), this suggests the block is not a blanket, permanent, org-wide rule — it may be host/location/time-dependent, or may have been loosened since the comment was written.

## Implication

Do not treat the "HF is blocked" comment in plugin.jsonc as a stable fact to design around. Before asserting a network constraint drives a config decision, verify it live (e.g. `pnpm fetch-model`) rather than trusting a comment that may be stale. If maintainers want `ollama` to stay the shipped default regardless, the comment should say why independent of a network claim that may no longer hold (e.g. "works universally without any download at all" rather than "HF is blocked").

