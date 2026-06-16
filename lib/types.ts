/**
 * Shared type definitions for claude-contextus.
 *
 * NOTE: The authoritative runtime config interface is in lib/config.ts
 * (ContextusConfig). The types here are for the daemon HTTP API and
 * embedding pipeline interfaces that don't belong in a single module.
 */

/** LanceDB table stats (from introspection). */
export interface CorpusStats {
  chunks: number;
  byType: Record<string, number>;
  withHits: number;
  totalHits: number;
  topHits: { id: string; hits: number }[];
}

/** A single row in the LanceDB corpus table. */
export interface ContextRow {
  id: string;
  filename: string;
  document: string;
  type: string;
  tags: string[];
  source: string;
  heading: string;
  chunkIndex: number;
  contentHash: string;
  embeddedAt: string;
  vector: number[];
}

/** Query hook input (from UserPromptSubmit). */
export interface QueryHookInput {
  prompt: string;
  context?: string;
  cwd?: string;
}

/** Query hook output (returned to Claude Code). */
export interface QueryHookOutput {
  continue: boolean;
  hookSpecificOutput?: {
    additionalContext: string;
  };
}

/** Daemon /health response. */
export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  uptime: number;
  modelLoaded: boolean;
  embeddingModel: string;
}

/** Daemon /query request body. */
export interface QueryRequest {
  project: string;
  prompt: string;
  cwd?: string;
}

/** Knowledge source configuration (from plugin.json config.sources). */
export interface SourceConfig {
  type?: string;
  path?: string;
  enabled?: boolean;
  indexFile?: string;
  exclude?: string[];
}
