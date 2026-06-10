# Configure claude-contextus

Interactive configuration for source paths, retrieval settings, and plugin behavior.

## When to Use

- Initial setup after plugin installation
- Changing memory/docs directory locations
- Enabling/disabling specific sources
- Tuning retrieval parameters (topK, similarity threshold)

## Usage

```bash
# Interactive configuration
/configure

# Discover nearby sources (parent/siblings)
/configure discover

# Set specific options
/configure memory-path .memory
/configure docs-path documentation
/configure top-k 10
/configure threshold 0.8
/configure enable user-docs
/configure disable project-docs

# Manage custom sources
/configure add-source ../​.claude/memory --label parent
/configure add-source ~/​src/framework/.claude/memory --label framework
/configure remove-source parent
/configure list-sources
```

## Configuration Options

### Source Paths

**Project-level:**
- `project-memory-path` - Path to project memory directory (default: `.claude/memory`)
- `project-docs-path` - Path to project docs directory (default: `docs`)

**User-level:**
- `user-memory-path` - Path to user memory directory (default: `~/.claude/memory`)
- `user-docs-path` - Path to user docs directory (default: `~/.claude/docs`)

### Source Toggle

- `enable <source>` - Enable a source (`project-memory`, `project-docs`, `user-memory`, `user-docs`)
- `disable <source>` - Disable a source

### Retrieval Settings

- `top-k <number>` - Number of results to return (default: 5)
- `threshold <0.0-1.0>` - Minimum similarity score (default: 0.7)
- `max-tokens <number>` - Maximum tokens to inject (default: 3000)
- `merge-strategy <strategy>` - How to merge results: `interleaved`, `prioritize-memory`, `prioritize-docs`

### Embedding Settings

- `embedding-model <model>` - Transformer model to use (default: `Xenova/all-MiniLM-L6-v2`)
- `batch-size <number>` - Batch size for embedding (default: 32)

### Memory Capture

- `memory-capture <on|off>` - Enable/disable automatic memory capture (default: on)
- `capture-mode <propose|auto>` - How to capture memories:
  - `propose` (default) - Claude suggests with footer, you approve via `/create-memory`
  - `auto` - Claude writes memories automatically (more autonomous, less control)

### Other

- `auto-rebuild <on|off>` - Auto-rebuild embeddings on file changes (default: on)

## Examples

```bash
# Change project memory location
/configure project-memory-path memory

# Disable user-level docs (work project only)
/configure disable user-docs

# Increase retrieval strictness
/configure threshold 0.85

# Get more results
/configure top-k 10

# Show current configuration
/configure show
```

## Custom Sources (Multi-Project)

### Auto-Discovery

```bash
/configure discover
```

Automatically scans for nearby memory sources:
- **Parent directories** (up to 3 levels or git root)
- **Sibling directories** (same parent)
- **Common framework paths** (optional)

Example output:
```
🔍 Scanning for nearby memory sources...

Found 3 memory sources:

[1] Parent: ../​.claude/memory
    87 files (framework patterns, team conventions)
    
[2] Sibling (backend): ../​backend/.claude/memory  
    42 files (API patterns, database schemas)
    
[3] Sibling (frontend): ../​frontend/.claude/memory
    31 files (UI patterns, component guidelines)

Enable which sources?
  [1-3] - specific numbers
  [all] - enable all
  [none] - skip

Your choice: 1,2

✓ Enabled parent: ../​.claude/memory
✓ Enabled backend: ../​backend/.claude/memory

Run /rebuild-embeddings to index new sources.
```

### Manual Management

```bash
# Add custom source
/configure add-source <path> --label <name>
/configure add-source ../​.claude/memory --label parent
/configure add-source ~/​src/my-framework/.claude/memory --label framework

# Remove custom source
/configure remove-source <label>
/configure remove-source parent

# List all sources (including custom)
/configure list-sources
```

Example list output:
```
Current sources:

✓ projectMemory: .claude/memory (64 files)
✓ projectDocs: docs (23 files)
✓ custom[parent]: ../​.claude/memory (87 files)
✓ custom[backend]: ../​backend/.claude/memory (42 files)
✗ userMemory: ~/.claude/memory (disabled)
✓ userDocs: ~/.claude/docs (8 files)

Total: 224 knowledge files
```

### Custom Source Behavior

- **Read:** All enabled custom sources searched for context
- **Write:** Custom sources are READ-ONLY
  - `/create-memory` writes to project or user memory only
  - To edit parent patterns, navigate to parent directory
- **Discovery:** First-run auto-detects parent if found
- **Configuration:** Stored in `.claude/settings.json` under `sources.custom[]`

## Output

Displays current configuration and confirms changes. Also validates paths exist and suggests creating missing directories.

## Implementation Notes

**For skill implementation:**

1. Parse command arguments
2. If no args, enter interactive mode (ask questions)
3. Validate values (paths exist, thresholds 0-1, etc.)
4. Update `.claude/settings.json` under `claudeContextus` key
5. Show confirmation with before/after values
6. Suggest running `/rebuild-embeddings` if paths changed

**Interactive Mode Flow:**

```
/configure

→ Which source would you like to configure?
  [ ] Project Memory
  [ ] Project Docs
  [ ] User Memory
  [ ] User Docs
  [ ] Retrieval Settings
  [ ] Show Current Config

→ (User selects Project Memory)

→ Current path: .claude/memory
  New path (or press enter to keep): memory
  
→ Directory 'memory' does not exist. Create it? (y/n)

→ ✓ Updated project memory path to 'memory'
  Run /rebuild-embeddings to re-index with new path.
```

**Config File Location:**

Updates `.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "claude-contextus": true
  },
  "claudeContextus": {
    "sources": {
      "projectMemory": {
        "path": "memory",  // Updated
        "enabled": true
      }
    },
    "retrieval": {
      "topK": 10,          // Updated
      "threshold": 0.85    // Updated
    }
  }
}
```

## Related Skills

- `/rebuild-embeddings` - Rebuild after path changes
- `/debug-memory` - Verify configuration is working
