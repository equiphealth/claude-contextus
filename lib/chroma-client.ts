/**
 * Chroma Client - File-based ChromaDB interface
 *
 * Manages embeddings in a local, git-committable ChromaDB instance
 */

import { ChromaClient } from 'chromadb';
import path from 'path';
import fs from 'fs';

let _client = null;
let _collection = null;

/**
 * Get or create ChromaDB client (file-based)
 *
 * @param {string} dbPath - Path to ChromaDB directory (default: .claude/context-db)
 * @returns {Promise<ChromaClient>}
 */
export async function getClient(dbPath = '.claude/context-db') {
  if (!_client) {
    // Ensure directory exists
    fs.mkdirSync(dbPath, { recursive: true });

    _client = new ChromaClient({
      path: path.resolve(dbPath),
    });
  }
  return _client;
}

/**
 * Get or create the context collection
 *
 * @param {string} collectionName - Collection name (default: project-basename)
 * @param {string} dbPath - Path to ChromaDB directory
 * @returns {Promise<Collection>}
 */
export async function getCollection(collectionName = null, dbPath = '.claude/context-db') {
  if (!_collection) {
    const client = await getClient(dbPath);

    // Default collection name: project directory basename
    if (!collectionName) {
      collectionName = `contextus-${path.basename(process.cwd())}`;
    }

    // Get or create collection
    try {
      _collection = await client.getCollection({ name: collectionName });
    } catch (error) {
      // Collection doesn't exist, create it
      _collection = await client.createCollection({
        name: collectionName,
        metadata: {
          description: 'Project context patterns and knowledge',
          created_at: new Date().toISOString(),
        },
      });
    }
  }
  return _collection;
}

/**
 * Add or update a context in the collection
 *
 * @param {Object} context - Context object
 * @param {string} context.id - Unique ID (usually file path)
 * @param {string} context.content - Context content (markdown)
 * @param {number[]} context.embedding - Embedding vector
 * @param {Object} context.metadata - Metadata (category, type, etc.)
 * @returns {Promise<void>}
 */
export async function upsertContext({ id, content, embedding, metadata }) {
  const collection = await getCollection();

  await collection.upsert({
    ids: [id],
    embeddings: [embedding],
    documents: [content],
    metadatas: [{ ...metadata, updated_at: new Date().toISOString() }],
  });
}

/**
 * Batch upsert multiple contexts (more efficient)
 *
 * @param {Array<Object>} contexts - Array of context objects
 * @returns {Promise<void>}
 */
export async function upsertContexts(contexts) {
  if (contexts.length === 0) return;

  const collection = await getCollection();

  await collection.upsert({
    ids: contexts.map((c) => c.id),
    embeddings: contexts.map((c) => c.embedding),
    documents: contexts.map((c) => c.content),
    metadatas: contexts.map((c) => ({ ...c.metadata, updated_at: new Date().toISOString() })),
  });
}

/**
 * Query contexts by semantic similarity
 *
 * @param {number[]} queryEmbedding - Query embedding vector
 * @param {number} topK - Number of results to return
 * @param {Object} filter - Optional metadata filter
 * @returns {Promise<Array>} Matched contexts with similarity scores
 */
export async function queryContexts(queryEmbedding, topK = 5, filter = null) {
  const collection = await getCollection();

  const results = await collection.query({
    queryEmbeddings: [queryEmbedding],
    nResults: topK,
    where: filter,
  });

  // Format results
  if (!results.ids || results.ids.length === 0 || results.ids[0].length === 0) {
    return [];
  }

  const matches = [];
  for (let i = 0; i < results.ids[0].length; i++) {
    matches.push({
      id: results.ids[0][i],
      document: results.documents[0][i],
      metadata: results.metadatas[0][i],
      distance: results.distances[0][i],
      similarity: 1 - results.distances[0][i], // Convert distance to similarity
    });
  }

  return matches;
}

/**
 * Delete a context by ID
 *
 * @param {string} id - Context ID
 * @returns {Promise<void>}
 */
export async function deleteContext(id) {
  const collection = await getCollection();
  await collection.delete({ ids: [id] });
}

/**
 * Get collection stats
 *
 * @returns {Promise<Object>} Collection statistics
 */
export async function getStats() {
  const collection = await getCollection();
  const count = await collection.count();

  return {
    name: collection.name,
    count,
    metadata: collection.metadata,
  };
}

/**
 * Delete all contexts (use with caution!)
 *
 * @returns {Promise<void>}
 */
export async function clearCollection() {
  const collection = await getCollection();
  const allIds = await collection.get();
  if (allIds.ids.length > 0) {
    await collection.delete({ ids: allIds.ids });
  }
}

/*
 * Example usage:
 *
 * import { upsertContext, queryContexts, getStats } from './chroma-client.js';
 * import { embedText } from './embedder.js';
 *
 * // Add a context
 * const embedding = await embedText("Use Logger helper for logging");
 * await upsertContext({
 *   id: "framework/feedback_logger.md",
 *   content: "Always use Logger helper...",
 *   embedding,
 *   metadata: { category: "framework", type: "feedback" }
 * });
 *
 * // Query contexts
 * const queryEmb = await embedText("How do I log errors?");
 * const matches = await queryContexts(queryEmb, 5);
 * console.log(matches); // Top 5 similar contexts
 *
 * // Get stats
 * const stats = await getStats();
 * console.log(stats); // { name: "...", count: 64, ... }
 */
