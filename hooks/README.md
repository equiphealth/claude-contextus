# Contextus Hooks

## Stop Hook: Context Usage Evaluation

The Stop hook evaluates whether injected context patterns were actually used in Claude's response. Runs only during calibration mode.

### Setup

1. **Install hook** in `.claude/settings.json`:

```json
{
  "hooks": {
    "Code": {
      "Stop": "node /path/to/claude-contextus/hooks/stop-evaluation.js"
    }
  }
}
```

2. **Start evaluation worker**:

```bash
# Background process (recommended)
node daemon/eval-worker.js &

# Or as systemd service
sudo cp services/contextus-eval-worker.service /etc/systemd/system/
sudo systemctl enable contextus-eval-worker
sudo systemctl start contextus-eval-worker
```

3. **Start calibration**:

```bash
/context-calibrate --start
```

### How It Works

**Stop Hook (non-blocking):**
- Fires after each Claude response
- Checks if calibration mode active
- Writes evaluation job to queue (`.contextus/.eval-queue.jsonl`)
- Exits immediately (no delay to user)

**Evaluation Worker (background):**
- Watches queue for new jobs
- Calls evaluation model (Haiku/Ollama) asynchronously
- Logs calibration_eval events
- Auto-disables after targetSamples reached

**Key Design**: Stop hook never blocks Claude's response. Evaluation happens in the background, so calibration adds zero latency to the user experience.

### Configuration

`~/.contextus/config.json`:

```json
{
  "calibration": {
    "evaluateUsage": false,
    "targetSamples": 100,
    "startedAt": null,
    "completedAt": null
  },
  "models": {
    "evaluation": {
      "provider": "anthropic",
      "model": "claude-haiku-4"
    }
  }
}
```

### Validation

Check evaluation worker is running:

```bash
# Should show eval-worker.js process
ps aux | grep eval-worker

# Check queue (should be empty if worker is processing)
cat ~/.contextus/.eval-queue.jsonl

# Check logs for calibration_eval events
tail ~/.contextus/logs/usage.jsonl | grep calibration_eval
```

### Troubleshooting

**Stop hook not firing:**
- Check `.claude/settings.json` hook path is correct
- Ensure stop-evaluation.js is executable: `chmod +x hooks/stop-evaluation.js`
- Check Claude Code logs for hook errors

**Worker not processing:**
- Ensure worker is running: `ps aux | grep eval-worker`
- Check worker logs: `journalctl -u contextus-eval-worker -f`
- Verify ANTHROPIC_API_KEY or Ollama endpoint configured

**Calibration stuck:**
- Check sample count: `cat ~/.contextus/config.json | grep -A5 calibration`
- If stuck, manually disable: edit config.json, set `evaluateUsage: false`
