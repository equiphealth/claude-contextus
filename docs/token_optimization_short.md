## Contextus Meaning‑Layer Architecture (Diagram)

+-------------------------------------------------------------+
|                     CONTEXTUS PIPELINE                      |
+-------------------------------------------------------------+

        ┌──────────────────────────────┐
        │  User Query                  │
        └───────────────┬─────────────┘
                        │
                        ▼
        ┌──────────────────────────────┐
        │  Semantic Retrieval           │
        │  (vector search, chunking)    │
        └───────────────┬─────────────┘
                        │
                        ▼
        ┌──────────────────────────────┐
        │  Relevance Scoring            │
        │  (meaning > tokens)           │
        └───────────────┬─────────────┘
                        │
                        ▼
        ┌──────────────────────────────┐
        │  Injection Floor              │
        │  - Filters irrelevant facts   │
        │  - Limits distinct facts      │
        │  - Controls semantic density  │
        └───────────────┬─────────────┘
                        │
                        ▼
        ┌──────────────────────────────┐
        │  Context Budgeting            │
        │  (token-aware, not token-led) │
        └───────────────┬─────────────┘
                        │
                        ▼
        ┌──────────────────────────────┐
        │  Final Prompt                 │
        │  (meaning-rich, noise-free)   │
        └───────────────┬─────────────┘
                        │
                        ▼
        ┌──────────────────────────────┐
        │  Model Output                 │
        │  (driven by meaning, not size)│
        └──────────────────────────────┘

## Why This Architecture Works

### 1. Meaning, Not Tokens
LLMs respond to semantic content.  
Token length is just the carrier.

### 2. The Injection Floor Controls Cost
More distinct facts → more reasoning → more output tokens.  
The floor limits semantic variety, not token length.

### 3. Irrelevant Facts Never Enter
They add cost without adding meaning.

### 4. Model Quality Asymmetry Helps You
- Expensive models ignore irrelevant facts  
- Cheap models overreact but cost almost nothing  

### 5. Natural Diminishing Returns
Once meaning is preserved, further token shrinking doesn’t matter.

This is why Contextus works across local 7B models and frontier models without special tuning.

