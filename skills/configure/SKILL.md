# Configure claude-contextus

Interactive configuration for source paths, retrieval settings, and plugin behavior.

## When to Use

- Initial setup after plugin installation
- Changing context/docs directory locations
- Enabling/disabling specific sources
- Tuning retrieval parameters (topK, similarity threshold)

## Usage

```bash
# Interactive configuration
/configure

# Discover nearby sources (parent/siblings)
/configure discover

# Set specific options
/configure context-path .context
/configure docs-path documentation
/configure top-k 10
/configure threshold 0.8
/configure enable user-docs
/configure disable project-docs

# Manage custom sources
/configure add-source ../​.claude/context --label parent
/configure add-source ~/​src/framework/.claude/context --label framework
/configure remove-source parent
/configure list-sources
```

## Configuration Options

### Source Paths

**Project-level:**
- `project-context-path` - Path to project context directory (default: `.claude/context`)
- `project-docs-path` - Path to project docs directory (default: `docs`)

**User-level:**
- `user-context-path` - Path to user context directory (default: `~/.claude/context`)
- `user-docs-path` - Path to user docs directory (default: `~/.claude/docs`)

### Source Toggle

- `enable <source>` - Enable a source (`project-context`, `project-docs`, `user-context`, `user-docs`)
- `disable <source>` - Disable a source

### Retrieval Settings

- `top-k <number>` - Number of results to return (default: 5)
- `threshold <0.0-1.0>` - Minimum similarity score (default: 0.7)
- `max-tokens <number>` - Maximum tokens to inject (default: 3000)
- `merge-strategy <strategy>` - How to merge results: `interleaved`, `prioritize-context`, `prioritize-docs`

### Embedding Settings

- `embedding-model <model>` - Transformer model to use (default: `Xenova/all-MiniLM-L6-v2`)
- `batch-size <number>` - Batch size for embedding (default: 32)

### Context Capture

- `context-capture <on|off>` - Enable/disable automatic context capture (default: on)
- `capture-mode <propose|auto>` - How to capture context:
  - `propose` (default) - Claude suggests with footer, you approve via `/create-context`
  - `auto` - Claude writes context automatically (more autonomous, less control)

### ChromaDB Location

- `chroma-mode <project|user>` - Where to store embeddings:
  - `project` (default) - `.claude/context-db/` (git-committable, team sharing)
  - `user` - `~/.claude/context-db/` (global, efficient for multiple projects)

Use `user` mode when:
- Working across 5+ interconnected projects
- Multiple projects reference same custom sources
- Want to avoid duplicate embeddings (saves disk space)
- Solo developer (not shareable with team)

### Other

- `auto-rebuild <on|off>` - Auto-rebuild embeddings on file changes (default: on)

## Examples

```bash
# Change project context location
/configure project-context-path context

# Disable user-level docs (work project only)
/configure disable user-docs

# Increase retrieval strictness
/configure threshold 0.85

# Get more results
/configure top-k 10

# Switch to global DB (power users with many projects)
/configure chroma-mode user

# Show current configuration
/configure show
```

## Custom Sources (Multi-Project)

### Auto-Discovery

```bash
/configure discover
```

Automatically scans for nearby context sources:
- **Parent directories** (up to 3 levels or git root)
- **Sibling directories** (same parent)
- **Common framework paths** (optional)

Example output:
```
🔍 Scanning for nearby context sources...

Found 3 context sources:

[1] Parent: ../​.claude/context
    87 files (framework patterns, team conventions)
    
[2] Sibling (backend): ../​backend/.claude/context  
    42 files (API patterns, database schemas)
    
[3] Sibling (frontend): ../​frontend/.claude/context
    31 files (UI patterns, component guidelines)

Enable which sources?
  [1-3] - specific numbers
  [all] - enable all
  [none] - skip

Your choice: 1,2

✓ Enabled parent: ../​.claude/context
✓ Enabled backend: ../​backend/.claude/context

Run /rebuild-embeddings to index new sources.
```

### Manual Management

```bash
# Add custom source
/configure add-source <path> --label <name>
/configure add-source ../​.claude/context --label parent
/configure add-source ~/​src/my-framework/.claude/context --label framework

# Remove custom source
/configure remove-source <label>
/configure remove-source parent

# List all sources (including custom)
/configure list-sources
```

Example list output:
```
Current sources:

✓ projectContext: .claude/context (64 files)
✓ projectDocs: docs (23 files)
✓ custom[parent]: ../​.claude/context (87 files)
✓ custom[backend]: ../​backend/.claude/context (42 files)
✗ userContext: ~/.claude/context (disabled)
✓ userDocs: ~/.claude/docs (8 files)

Total: 224 knowledge files
```

### Custom Source Behavior

- **Read:** All enabled custom sources searched for context
- **Write:** Custom sources are READ-ONLY
  - `/create-context` writes to project or user context only
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
  [ ] Project Context
  [ ] Project Docs
  [ ] User Context
  [ ] User Docs
  [ ] Retrieval Settings
  [ ] Show Current Config

→ (User selects Project Context)

→ Current path: .claude/context
  New path (or press enter to keep): context
  
→ Directory 'context' does not exist. Create it? (y/n)

→ ✓ Updated project context path to 'context'
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
      "projectContext": {
        "path": "context",  // Updated
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
- `/context-debug` - Verify configuration is working
