                          ┌──────────────────────────────────────────┐
                          │              Developer Input              │
                          │     (prompts, edits, commands, files)    │
                          └──────────────────────────────────────────┘
                                              │
                                              ▼
                          ┌──────────────────────────────────────────┐
                          │        Claude Code Cognition Loop        │
                          │  (reasoning, planning, tool invocation)  │
                          └──────────────────────────────────────────┘
                                              │
                                 Injected by Contextus
                                              │
                                              ▼
        ┌──────────────────────────────────────────────────────────────────────────┐
        │                                CONTEXTUS                                 │
        │                     Semantic Governance & Calibration                     │
        ├──────────────────────────────────────────────────────────────────────────┤
        │  ┌──────────────────────────┐   ┌──────────────────────────────────────┐ │
        │  │  Warm Daemon             │   │  Calibration Floor                   │ │
        │  │  - monitors changes      │   │  - semantic dedupe                   │ │
        │  │  - detects new context   │   │  - novelty scoring                   │ │
        │  │  - tracks intent shifts  │   │  - compression & pruning             │ │
        │  └──────────────────────────┘   └──────────────────────────────────────┘ │
        │                 │                               │                        │
        │                 ▼                               ▼                        │
        │  ┌──────────────────────────┐   ┌──────────────────────────────────────┐ │
        │  │  Provenance Engine       │   │  Context Composer                    │ │
        │  │  - source tracking       │   │  - merges semantic layers            │ │
        │  │  - justification footer  │   │  - builds injection package          │ │
        │  └──────────────────────────┘   └──────────────────────────────────────┘ │
        │                 │                               │                        │
        │                 └───────────────┬───────────────┘                        │
        │                                 ▼                                        │
        │                ┌──────────────────────────────────────────┐               │
        │                │        Context Saving Pipeline            │               │
        │                │  - persists new semantic state            │               │
        │                │  - updates long‑term context store        │               │
        │                │  - maintains evolving project memory      │               │
        │                └──────────────────────────────────────────┘               │
        └──────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
                          ┌──────────────────────────────────────────┐
                          │     Injected Context Package → Claude    │
                          │  (meaning-layer, rules, patterns, state) │
                          └──────────────────────────────────────────┘
                                              │
                                              ▼
                          ┌──────────────────────────────────────────┐
                          │      Claude Executes With Context        │
                          │   (codegen, refactors, reasoning, etc.)  │
                          └──────────────────────────────────────────┘

