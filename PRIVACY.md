# Privacy Policy

**Last updated: June 18, 2026**

## Summary

contextus does not collect, transmit, or store any user data externally. All data remains local on your machine.

## Data Storage

All contextus data is stored locally:

- **Context patterns**: Stored in `.claude/context/` within your project directory
- **Embeddings**: Stored in `~/.contextus/data/` on your local machine
- **Logs**: Stored in `~/.contextus/logs/` on your local machine
- **Configuration**: Stored in project `.claude/contextus.jsonc` and `~/.contextus/data/<project>/config.json`

These files never leave your machine unless you explicitly commit them to version control or share them.

## Processing

- **Daemon**: Runs locally on `localhost:37800` — no external network access
- **Embedding models**: 
  - **Ollama** (recommended): Runs locally, no external API calls
  - **Transformers.js**: Runs in-process, no external API calls after initial model download from Hugging Face
- **Query expansion** (optional feature):
  - **Local**: Uses Ollama (qwen2.5:3b) by default — no external calls
  - **Fallback**: AWS Bedrock (Haiku) if configured — uses your AWS credentials and is governed by AWS's privacy policy

## What We Don't Do

- ❌ No telemetry or usage analytics
- ❌ No crash reporting
- ❌ No external API calls (except optional AWS Bedrock if you configure it)
- ❌ No tracking
- ❌ No data collection of any kind

## Third-Party Services (Optional)

If you enable AWS Bedrock integration for query expansion:

- Query expansion prompts are sent to AWS Bedrock using your AWS credentials
- This is entirely optional and disabled by default
- Data handling is governed by [AWS's privacy policy](https://aws.amazon.com/privacy/)

## Source Code

contextus is open source. You can audit exactly what it does:

- **GitHub**: [https://github.com/equiphealth/claude-contextus](https://github.com/equiphealth/claude-contextus)

## Contact

Questions about privacy? Open an issue on GitHub: [https://github.com/equiphealth/claude-contextus/issues](https://github.com/equiphealth/claude-contextus/issues)
