# Ollama Install Integration Design

**Issue:** #24  
**Status:** Design  
**Priority:** High (blocks first-time setup)

## Problem

Setup wizard assumes Ollama is already installed. When it's not, the flow dead-ends:
1. Setup detects `localhost:11434` unreachable
2. Tells user to run `ollama serve`
3. User doesn't have the binary → stuck

For someone who's never heard of Ollama, this is a showstopper.

## Goals

1. **Detect** whether Ollama binary exists (not just service reachable)
2. **Offer installation** via platform-appropriate method
3. **Execute install** (where safe/possible) or guide manual install
4. **Verify** installation succeeded before continuing
5. **Fall back** to transformers.js if install fails/declined

## Design

### Detection Flow

```typescript
type OllamaState = 
  | { status: 'installed-running' }     // binary exists + service reachable
  | { status: 'installed-stopped' }     // binary exists + service down
  | { status: 'not-installed' }         // binary not found
  | { status: 'unreachable' }           // network issue / unusual port

async function detectOllama(): Promise<OllamaState> {
  // Check if binary exists
  const hasBinary = await commandExists('ollama');
  
  // Check if service responds
  const serviceUp = await fetch('http://localhost:11434/api/version')
    .then(() => true)
    .catch(() => false);
  
  if (hasBinary && serviceUp) return { status: 'installed-running' };
  if (hasBinary && !serviceUp) return { status: 'installed-stopped' };
  if (!hasBinary) return { status: 'not-installed' };
  return { status: 'unreachable' };
}
```

### Platform Detection

```typescript
type Platform = 'macos' | 'linux' | 'windows' | 'unknown';

function detectPlatform(): Platform {
  switch (process.platform) {
    case 'darwin': return 'macos';
    case 'linux': return 'linux';
    case 'win32': return 'windows';
    default: return 'unknown';
  }
}

async function hasHomebrew(): Promise<boolean> {
  // macOS only
  return commandExists('brew');
}
```

### Quick Track Flow

**State: `not-installed`**

```
Ollama isn't installed (needed for embeddings).

  [1] Install automatically (macOS/Linux)
  [2] Show me how to install manually
  [3] Use Transformers.js instead (~100MB download)
  [4] Skip embedding for now
```

**If [1]:**
- **macOS + Homebrew**: `brew install ollama` → wait → verify
- **macOS - Homebrew**: Show manual download link
- **Linux**: `curl -fsSL https://ollama.com/install.sh | sh` → wait → verify
- **Windows**: No auto-install, show download link

**If [2]:**
```
Visit https://ollama.com/download to install Ollama.

  macOS:    Download .dmg and drag to Applications
  Linux:    curl -fsSL https://ollama.com/install.sh | sh
  Windows:  Download .exe installer

Press Enter when installation is complete...
```
→ Re-check binary → continue

**If [3]:**
Set `embedding.provider: "transformers"` in config, skip Ollama entirely

**If [4]:**
Pass `--no-embed` to setup script

### Power User Track Flow

**P2: Embedding Provider (line 206-226 in SKILL.md)**

**State: `not-installed`**

```
Embedding provider — how patterns are vectorized for search.

  [1] Ollama (recommended) — local, private, ~100-400ms per embed
      Status: NOT INSTALLED
      
      Install Ollama now?
        [a] Auto-install (brew install ollama)  [if macOS+brew]
        [a] Auto-install (official script)       [if Linux]
        [b] Manual — show download instructions
        [c] Skip — I'll install later

  [2] Transformers.js — in-process ONNX, no external service
      Downloads ~100MB model on first run
```

If [1a]: execute install → wait → verify → continue to model pull
If [1b]: show instructions → wait for Enter → verify → continue
If [1c]: continue setup with provider=ollama but skip embed
If [2]: set provider=transformers, skip Ollama

**State: `installed-stopped`**

```
Ollama is installed but not running.

  Start it now?
    [1] Yes — ollama serve (background)
    [2] I'll start it manually
```

### Installation Commands

```typescript
interface InstallCommand {
  description: string;
  command: string;
  verifyDelay: number; // ms to wait before verifying
  requiresRoot?: boolean;
}

const INSTALL_COMMANDS: Record<Platform, InstallCommand | null> = {
  macos: {
    description: 'Installing Ollama via Homebrew...',
    command: 'brew install ollama',
    verifyDelay: 5000,
    requiresRoot: false,
  },
  linux: {
    description: 'Installing Ollama via official script...',
    command: 'curl -fsSL https://ollama.com/install.sh | sh',
    verifyDelay: 10000,
    requiresRoot: true, // May prompt for sudo
  },
  windows: null, // No CLI install option
  unknown: null,
};
```

### Model Selection & Pull After Install

If Ollama was just installed, the model **won't** be pre-pulled. Present model options:

#### Quick Track: Auto-select Default
```
Ollama installed! Now pulling embedding model...

  Using: nomic-embed-text (274MB, recommended)
  
  This is one-time setup (model is cached locally).
  [Progress bar or "...downloading"]
```

#### Power User Track: Choose Model
```
Ollama installed! Choose embedding model:

  [1] nomic-embed-text (274MB) — recommended, best quality/speed balance
  [2] mxbai-embed-large (670MB) — higher quality, slower
  [3] all-minilm (45MB) — tiny, fast, lower quality
  
Which model? [1]
```

Pull the selected model:
```bash
ollama pull ${selectedModel}
```

Check if pull succeeded:
```bash
ollama list | grep ${selectedModel}
```

If fails, offer retry or transformers.js fallback.

**Store selection** in `.claude/contextus.jsonc`:
```jsonc
{
  "embedding": {
    "provider": "ollama",
    "ollamaModel": "nomic-embed-text"
  }
}
```

## Implementation Plan

### Phase 1: Detection (script)
**File:** `scripts/setup-detect.ts`
- Add `ollamaState` to detection output
- Return `{ status, hasBinary, serviceReachable, platform, hasHomebrew }`

### Phase 2: Install Flow (skill)
**File:** `skills/contextus-setup/SKILL.md`

**Quick Track (lines 102-114):**
- Branch on `ollamaState === 'not-installed'`
- Present options [1-4]
- Execute install if auto-install chosen
- Verify → model pull → continue

**Power User Track (lines 206-226):**
- Show status (`NOT INSTALLED` vs `INSTALLED, NOT RUNNING`)
- Offer install/start options
- Same install execution as quick track

### Phase 3: Install Execution (helper script)
**New file:** `scripts/install-ollama.ts`

```typescript
export async function installOllama(
  platform: Platform,
  onProgress: (msg: string) => void
): Promise<{ success: boolean; error?: string }> {
  const cmd = INSTALL_COMMANDS[platform];
  if (!cmd) return { success: false, error: 'No auto-install for this platform' };
  
  onProgress(cmd.description);
  
  try {
    // Execute install command
    await exec(cmd.command);
    
    // Wait for install to complete
    await sleep(cmd.verifyDelay);
    
    // Verify binary exists
    if (!(await commandExists('ollama'))) {
      return { success: false, error: 'Install completed but binary not found' };
    }
    
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
```

### Phase 4: Model Pull (helper script)
**New file:** `scripts/pull-ollama-model.ts`

```typescript
export const OLLAMA_MODELS = [
  { 
    name: 'nomic-embed-text', 
    size: '274MB', 
    description: 'recommended, best quality/speed balance',
    default: true 
  },
  { 
    name: 'mxbai-embed-large', 
    size: '670MB', 
    description: 'higher quality, slower' 
  },
  { 
    name: 'all-minilm', 
    size: '45MB', 
    description: 'tiny, fast, lower quality' 
  },
] as const;

export async function pullModel(
  model: string,
  onProgress: (msg: string) => void
): Promise<{ success: boolean; error?: string }> {
  try {
    onProgress(`Pulling ${model}...`);
    await exec(`ollama pull ${model}`);
    
    // Verify model was pulled
    const { stdout } = await exec('ollama list');
    if (!stdout.includes(model)) {
      return { success: false, error: 'Model pull completed but not in list' };
    }
    
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
```

## Edge Cases

### 1. Homebrew not installed (macOS)
**Behavior:** Fall back to manual install instructions
**Message:** "Homebrew not found. Install from brew.sh or choose manual install."

### 2. Install command fails (network / permissions)
**Behavior:** Show error, offer manual install or transformers.js
**Message:** "Auto-install failed: {error}. Try manual install or use Transformers.js?"

### 3. Model pull fails after successful install
**Behavior:** Offer retry or use transformers.js
**Message:** "Ollama installed but model pull failed. Retry or switch to Transformers.js?"

### 4. User declines install but continues
**Behavior:** Set config `embedding.provider: "ollama"` but skip actual embedding (`--no-embed`)
**Warning:** "Setup complete, but embedding is disabled. Run /rebuild-embeddings after installing Ollama."

### 5. Ollama installed but on non-standard port
**Behavior:** Offer to configure custom endpoint
**Message:** "Ollama found but not at :11434. Configure custom endpoint in .claude/contextus.jsonc"

## Testing Plan

### Manual Test Cases
1. **macOS + Homebrew + no Ollama**: auto-install works
2. **macOS - Homebrew + no Ollama**: manual instructions clear
3. **Linux + no Ollama**: official script works
4. **Windows + no Ollama**: manual instructions clear
5. **Ollama installed but stopped**: start-service flow works
6. **Ollama installed + running**: skip to model pull
7. **Network down during install**: error handled gracefully
8. **User cancels mid-install**: cleanup + clear state

### Automated Tests (Phase 5)
Mock `commandExists` and `exec` to test all branches without actual installs.

## Security Considerations

### Running Shell Scripts
- **Linux official script** (`curl | sh`) — widely used, vetted by Ollama team
- **Risk:** Supply chain attack if ollama.com compromised
- **Mitigation:** User explicitly chooses this option, show full URL before executing
- **Alternative:** Suggest package manager install (apt/yum) if available

### Sudo Prompts
- Linux install **may** prompt for sudo (depends on install location)
- Claude Code runs the command, user's terminal shows the sudo prompt
- **Document this** in the prompt: "May ask for password to install system-wide"

## Open Questions

1. **Should we check for Ollama Desktop.app separately?** (macOS)
   - Binary might not be in PATH but app is installed
   - Resolution: Check both, offer to add to PATH

2. **What if brew install takes >2 minutes?**
   - Show progress dots? Streaming output?
   - Resolution: Timeout after 5 min, offer manual install

3. **Should we auto-start `ollama serve` after install?**
   - Pro: Seamless UX
   - Con: Background process user didn't explicitly start
   - Resolution: Ask "Start Ollama now? [Y/n]"

## Related Work

- **Existing:** `phase/phase-setup-wizard-ollama-flow.md` (original outline)
- **Existing:** `skills/contextus-setup/SKILL.md` (needs updates at lines 102-114, 206-226)
- **Existing:** `scripts/setup-detect.ts` (needs `ollamaState` addition)
- **New:** `scripts/install-ollama.ts` (Phase 3)
- **New:** `scripts/pull-ollama-model.ts` (Phase 4)

## Success Metrics

- **Before:** User drops off when setup says "start ollama serve" and they don't have it
- **After:** User goes from "never heard of Ollama" → working embeddings in <5 minutes
- **Target:** 90% of new users complete setup without leaving Claude Code
