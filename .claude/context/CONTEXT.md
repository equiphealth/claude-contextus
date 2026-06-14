# Contextus Context Index

This directory contains captured patterns, decisions, and implementation notes for the contextus project itself.

## Design

- [embedding-model-choice](design/embedding-model-choice.md) - Why nomic over MiniLM
- [daemon-architecture](design/daemon-architecture.md) - Persistent HTTP daemon rationale

## Implementation

- [eslint-rules](implementation/eslint-rules.md) - Linter configuration from automation project
- [promise-handling-rules](implementation/promise-handling-rules.md) - async/await enforcement
- [lancedb-api-surface](implementation/lancedb-api-surface.md) - Real @lancedb/lancedb v0.30 API vs DESIGN.md's Chroma sketch (verified)

## Decisions

- [proactive-ux-positioning](decisions/proactive-ux-positioning.md) - Killer feature is zero-query injection
- [storage-location](decisions/storage-location.md) - User-space DB, not git-committed
