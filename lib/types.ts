/**
 * Type definitions for claude-contextus
 */

/**
 * Context frontmatter structure
 */
export interface ContextFrontmatter {
  name: string;
  description: string;
  type: 'reference' | 'decision' | 'project' | 'gotcha' | 'tradeoff' | 'arch' | 'api' | 'phase' | 'schema' | 'security' | 'perf' | 'implementation';
  category?: string;
  tags?: string[];
  [key: string]: unknown;
}

/**
 * Loaded context pattern object
 */
export interface Context {
  /** Relative path from context dir (used as ID) */
  id: string;
  /** Absolute file path */
  path: string;
  /** Relative path from context dir */
  relativePath: string;
  /** Context name from frontmatter */
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
  frontmatter: ContextFrontmatter;
  /** File modification time (milliseconds since epoch) */
  mtime: number;
  /** File size in bytes */
  size: number;
}

/**
 * Context with embedding
 */
export interface EmbeddedContext extends Context {
  /** Embedding vector */
  embedding: number[];
}

/**
 * Context query result
 */
export interface ContextMatch {
  /** Context ID */
  id: string;
  /** Context content */
  document: string;
  /** Context metadata */
  metadata: Record<string, unknown>;
  /** Distance score (lower = more similar) */
  distance: number;
  /** Similarity score (higher = more similar, 0-1) */
  similarity: number;
}

/**
 * Changes detected in context files
 */
export interface ContextChanges {
  /** Whether rebuild is needed */
  needsRebuild: boolean;
  /** Modified contexts */
  changed: Context[];
  /** New contexts */
  added: Context[];
  /** Removed context IDs */
  removed: string[];
  /** Total current contexts */
  total: number;
}

/**
 * Context validation result
 */
export interface ValidationResult {
  /** Whether context is valid */
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
  type: 'context' | 'doc';
  /** Scope: project or user (global) */
  scope: 'project' | 'user';
  /** Path to source directory (can use ~/ for user home) */
  path: string;
  /** Whether this source is enabled */
  enabled: boolean;
  /** Index file name (e.g., CONTEXT.md, DOCS.md) */
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
  /** Knowledge sources (contexts, docs, both project and user-level) */
  sources: {
    projectContext: SourceConfig;
    projectDocs: SourceConfig;
    userContext: SourceConfig;
    userDocs: SourceConfig;
    /** Additional custom sources (e.g., parent repo, sibling projects) */
    custom?: SourceConfig[];
  };
  /** ChromaDB settings */
  chroma: {
    /** Storage mode */
    mode: 'file' | 'server';
    /** Path to ChromaDB directory (file mode, uses {project-name} placeholder) */
    path?: string;
    /** Server host (server mode) */
    host?: string;
    /** Server port (server mode) */
    port?: number;
    /** Collection name pattern (server mode, uses {project-name} placeholder) */
    collection?: string;
    /** Optional project ID override for name collisions */
    projectId?: string;
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
    mergeStrategy: 'interleaved' | 'prioritize-context' | 'prioritize-docs';
  };
  /** Auto-rebuild embeddings on file changes */
  autoRebuild: boolean;
  /** Context capture mode (for claude-mem compatibility) */
  contextCapture: {
    /** Enable context capture prompts */
    enabled: boolean;
    /** Capture mode: 'propose' = suggest with footer, 'auto' = write automatically */
    mode: 'propose' | 'auto';
  };
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
