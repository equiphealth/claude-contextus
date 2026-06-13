## Why Contextus Optimizes Meaning, Not Tokens

Contextus is built on a simple principle: **LLMs respond to meaning, not token count**.  
If two inputs contain the same semantic content — whether expressed in 50 tokens or 500 — the model’s output will be nearly identical. This means the real cost driver isn’t token length, but **the number of distinct facts** the model must consider.

### The Injection Floor: The Real Optimization Lever
The injection floor determines which facts are relevant enough to include. It controls:

- How many distinct facts enter the prompt  
- How much semantic variety the model sees  
- How much meaning the model must respond to  

This directly influences output token cost. More distinct facts → more reasoning → more output tokens.

### Irrelevant Facts Are Pure Cost
Irrelevant facts:
- Increase input tokens  
- Increase cognitive load  
- Cause weaker models to over‑explain or hallucinate  
- Add no semantic value  

Contextus filters them out before they ever reach the model.

### Model Quality Works in Your Favor
Different models react differently to irrelevant context:

**High‑quality models (Claude, GPT‑4‑class):**
- Ignore irrelevant facts  
- Stay on‑task  
- Don’t inflate output tokens  
- Are the most expensive to run  

**Lower‑quality models (7B–13B locals):**
- Overreact to irrelevant facts  
- Produce longer outputs  
- Sometimes hallucinate  
- Are extremely cheap or free to run  

This asymmetry means Contextus doesn’t need extreme tuning:
- Expensive models are robust  
- Cheap models are sensitive but cost almost nothing  

### Token Optimization Has Natural Limits
Optimizing input tokens is useful up to the point where meaning is preserved. Beyond that, shrinking tokens further doesn’t reduce output cost.

Contextus focuses on **semantic optimization**, not micro‑token optimization.

### Summary
- Meaning drives output, not token count  
- Irrelevant facts are pure cost  
- The injection floor is the primary optimization lever  
- High‑quality models ignore noise  
- Low‑quality models are cheap  
- Token compression hits diminishing returns  
- Contextus is naturally self‑balancing across model qualities  

This is why Contextus works out‑of‑the‑box without heavy configuration.

