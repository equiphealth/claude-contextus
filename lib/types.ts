/**
 * Type definitions for claude-contextus
 */

/**
 * Memory frontmatter structure
 */
export interface MemoryFrontmatter {
  name: string;
  description: string;
  type: 'feedback' | 'reference' | 'decision' | 'project';
  category?: string;
  tags?: string[];
  [key: string]: unknown;
}

/**
 * Loaded memory object
 */
export interface Memory {
  /** Relative path from memory dir (used as ID) */
  id: string;
  /** Absolute file path */
  path: string;
  /** Relative path from memory dir */
  relativePath: string;
  /** Memory name from frontmatter */
  name: string;
  /** Description from frontmatter */
  description: string;
  /** Type from frontmatter */
  type: string;
  /** Category extracted from path */
  category: string;
  /** Markdown content (without frontmatter) */
  content: string;
  /** Parsed frontmatter */
  frontmatter: MemoryFrontmatter;
  /** File modification time (milliseconds since epoch) */
  mtime: number;
  /** File size in bytes */
  size: number;
}

/**
 * Memory with embedding
 */
export interface EmbeddedMemory extends Memory {
  /** Embedding vector */
  embedding: number[];
}

/**
 * Memory query result
 */
export interface MemoryMatch {
  /** Memory ID */
  id: string;
  /** Memory content */
  document: string;
  /** Memory metadata */
  metadata: Record<string, unknown>;
  /** Distance score (lower = more similar) */
  distance: number;
  /** Similarity score (higher = more similar, 0-1) */
  similarity: number;
}

/**
 * Changes detected in memory files
 */
export interface MemoryChanges {
  /** Whether rebuild is needed */
  needsRebuild: boolean;
  /** Modified memories */
  changed: Memory[];
  /** New memories */
  added: Memory[];
  /** Removed memory IDs */
  removed: string[];
  /** Total current memories */
  total: number;
}

/**
 * Memory validation result
 */
export interface ValidationResult {
  /** Whether memory is valid */
  valid: boolean;
  /** Validation error messages */
  errors: string[];
}

/**
 * ChromaDB collection stats
 */
export interface CollectionStats {
  /** Collection name */
  name: string;
  /** Number of documents */
  count: number;
  /** Collection metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Knowledge source configuration
 */
export interface SourceConfig {
  /** Source type */
  type: 'memory' | 'doc';
  /** Path to source directory */
  path: string;
  /** Whether this source is enabled */
  enabled: boolean;
  /** Index file name (e.g., MEMORY.md, DOCS.md) */
  indexFile?: string;
  /** File patterns to include (glob) */
  include?: string[];
  /** File patterns to exclude (glob) */
  exclude?: string[];
}

/**
 * Plugin configuration
 */
export interface ContextusConfig {
  /** Whether plugin is enabled */
  enabled: boolean;
  /** Knowledge sources (memories, docs) */
  sources: {
    memory: SourceConfig;
    docs: SourceConfig;
  };
  /** ChromaDB settings */
  chroma: {
    /** Mode: 'file' for local, 'server' for remote */
    mode: 'file' | 'server';
    /** Path to ChromaDB directory (file mode) */
    path: string;
    /** Server host (server mode) */
    host?: string;
    /** Server port (server mode) */
    port?: number;
  };
  /** Embedding settings */
  embedding: {
    /** Model name */
    model: string;
    /** Batch size for embedding */
    batchSize: number;
  };
  /** Retrieval settings */
  retrieval: {
    /** Number of results to return (total across all sources) */
    topK: number;
    /** Minimum similarity threshold (0-1) */
    similarityThreshold: number;
    /** Maximum tokens to inject */
    maxTokens: number;
    /** How to merge results from multiple sources */
    mergeStrategy: 'interleaved' | 'prioritize-memory' | 'prioritize-docs';
  };
  /** Auto-rebuild embeddings on file changes */
  autoRebuild: boolean;
  /** Enable memory awareness prompt */
  memoryAwareness: boolean;
}

/**
 * Query hook input (from UserPromptSubmit)
 */
export interface QueryHookInput {
  /** User prompt */
  prompt: string;
  /** Optional context from previous turns */
  context?: string;
  /** Project directory */
  cwd?: string;
}

/**
 * Query hook output
 */
export interface QueryHookOutput {
  /** Whether to continue normal processing */
  continue: boolean;
  /** Output to inject into context */
  hookSpecificOutput?: {
    additionalContext: string;
  };
}
