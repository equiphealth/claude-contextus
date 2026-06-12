---
name: evaluation-architecture
description: Calibration evaluation design - Stop hook + async worker with thinking blocks
metadata:
  type: decision
---

**Decision**: Use Stop hook + background worker for quality evaluation during calibration mode.

**Architecture**:
1. **Stop hook** (`hooks/stop-evaluation.js`) - non-blocking
   - Fires after each Claude response
   - Reads Stop payload: `user_message`, `assistant_message`, `preceding_reasoning` (thinking)
   - Retrieves injected patterns from session state
   - Writes evaluation job to queue (`.contextus/.eval-queue.jsonl`)
   - Exits immediately (zero latency impact)

2. **Evaluation worker** (`daemon/eval-worker.js`) - background process
   - Watches queue for new jobs
   - Calls evaluation model (Haiku/Ollama) with full context + thinking
   - Parses "number:rating" format responses
   - Logs calibration_eval events to usage.jsonl
   - Auto-disables after targetSamples (default: 100)

**Why thinking blocks are critical**: `preceding_reasoning` shows Claude's internal deliberation about injected context. If Claude explicitly says "I'll use pattern X," evaluation becomes trivial — just check if Claude mentioned using it. Makes even Ollama viable (task = "did Claude say they used this?" not "infer semantic relevance").

**Model choice**:
- **Haiku (default)**: $0.15 per 100 evals, proven reliable, structured output
- **Ollama (opt-in)**: Free, private, but only with hardware validation (M4 Pro 48GB ~1-2s, RTX 3060 ~1-2.5s)

**Quality ratings** (weighted):
- critical: 1.0 (essential to response)
- helpful: 0.7 (improved answer)
- mentioned: 0.3 (referenced but not central)
- unused: 0.0 (injected but irrelevant)

**Why async**: Stop hook is blocking, but we never want to delay Claude's response. Queue + worker = measurements happen invisibly in background.

**Validation needed**: Early POC should check if thinking blocks actually reference retrieved context patterns clearly.

**Related**: [[opus-metrics-critique]], [[injection-format]]
