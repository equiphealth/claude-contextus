---
name: setup-wizard-ollama-flow
description: Setup wizard Ollama install flow: detect failure, link to download, wait for install, pull model from menu, start server
metadata:
  type: phase
---

## Setup Wizard: Ollama-Assisted Install Flow

Triggered when transformers.js fails (HF blocked or other network issue).

### Step 1: Detect and Explain
"Embedding provider needs a local model server. Ollama is free, lightweight, and runs entirely on your machine."

### Step 2: Guide Install
- macOS: "Download from https://ollama.com/download — install and open it"
- Linux: curl -fsSL https://ollama.com/install.sh | sh
- Show platform-appropriate instructions
- "Press Enter when Ollama is installed..."

### Step 3: Verify Install
- Check `which ollama` or try `ollama list`
- If not found, retry prompt with troubleshooting
- If found but not running, start it: `ollama serve` (background)

### Step 4: Model Selection
Present a curated list:
- nomic-embed-text (274MB) — recommended, best balance of quality/size
- mxbai-embed-large (670MB) — higher quality, slower
- all-minilm (45MB) — tiny, fast, lower quality

Default: nomic-embed-text (pre-selected, just confirm)

### Step 5: Pull Model
- Run `ollama pull <model>` with progress indication
- Show download progress (ollama outputs this natively)
- Verify with a test embedding

### Step 6: Configure
- Write provider config to .claude/contextus.jsonc
- Set endpoint, model name, dimensions
- Run initial embed

### UX Principle
The user makes ONE decision (which model, with a sensible default). Everything else is automated or guided with a single confirmation. They never type an endpoint URL or dimension count.
