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
 * @param {string} dbPath - Path to ChromaDB directory (default: .claude/memory-db)
 * @returns {Promise<ChromaClient>}
 */
export async function getClient(dbPath = '.claude/memory-db') {
  if (!_client) {
    // Ensure directory exists
    fs.mkdirSync(dbPath, { recursive: true });

    _client = new ChromaClient({
      path: path.resolve(dbPath)
    });
  }
  return _client;
}

/**
 * Get or create the memory collection
 *
 * @param {string} collectionName - Collection name (default: project-basename)
 * @param {string} dbPath - Path to ChromaDB directory
 * @returns {Promise<Collection>}
 */
export async function getCollection(collectionName = null, dbPath = '.claude/memory-db') {
  if (!_collection) {
    const client = await getClient(dbPath);

    // Default collection name: project directory basename
    if (!collectionName) {
      collectionName = `manual-memory-${path.basename(process.cwd())}`;
    }

    // Get or create collection
    try {
      _collection = await client.getCollection({ name: collectionName });
    } catch (error) {
      // Collection doesn't exist, create it
      _collection = await client.createCollection({
        name: collectionName,
        metadata: {
          description: 'Project memory patterns and context',
          created_at: new Date().toISOString()
        }
      });
    }
  }
  return _collection;
}

/**
 * Add or update a memory in the collection
 *
 * @param {Object} memory - Memory object
 * @param {string} memory.id - Unique ID (usually file path)
 * @param {string} memory.content - Memory content (markdown)
 * @param {number[]} memory.embedding - Embedding vector
 * @param {Object} memory.metadata - Metadata (category, type, etc.)
 * @returns {Promise<void>}
 */
export async function upsertMemory({ id, content, embedding, metadata }) {
  const collection = await getCollection();

  await collection.upsert({
    ids: [id],
    embeddings: [embedding],
    documents: [content],
    metadatas: [{ ...metadata, updated_at: new Date().toISOString() }]
  });
}

/**
 * Batch upsert multiple memories (more efficient)
 *
 * @param {Array<Object>} memories - Array of memory objects
 * @returns {Promise<void>}
 */
export async function upsertMemories(memories) {
  if (memories.length === 0) return;

  const collection = await getCollection();

  await collection.upsert({
    ids: memories.map(m => m.id),
    embeddings: memories.map(m => m.embedding),
    documents: memories.map(m => m.content),
    metadatas: memories.map(m => ({ ...m.metadata, updated_at: new Date().toISOString() }))
  });
}

/**
 * Query memories by semantic similarity
 *
 * @param {number[]} queryEmbedding - Query embedding vector
 * @param {number} topK - Number of results to return
 * @param {Object} filter - Optional metadata filter
 * @returns {Promise<Array>} Matched memories with similarity scores
 */
export async function queryMemories(queryEmbedding, topK = 5, filter = null) {
  const collection = await getCollection();

  const results = await collection.query({
    queryEmbeddings: [queryEmbedding],
    nResults: topK,
    where: filter
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
      similarity: 1 - results.distances[0][i]  // Convert distance to similarity
    });
  }

  return matches;
}

/**
 * Delete a memory by ID
 *
 * @param {string} id - Memory ID
 * @returns {Promise<void>}
 */
export async function deleteMemory(id) {
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
    metadata: collection.metadata
  };
}

/**
 * Delete all memories (use with caution!)
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
 * import { upsertMemory, queryMemories, getStats } from './chroma-client.js';
 * import { embedText } from './embedder.js';
 *
 * // Add a memory
 * const embedding = await embedText("Use Logger helper for logging");
 * await upsertMemory({
 *   id: "framework/feedback_logger.md",
 *   content: "Always use Logger helper...",
 *   embedding,
 *   metadata: { category: "framework", type: "feedback" }
 * });
 *
 * // Query memories
 * const queryEmb = await embedText("How do I log errors?");
 * const matches = await queryMemories(queryEmb, 5);
 * console.log(matches); // Top 5 similar memories
 *
 * // Get stats
 * const stats = await getStats();
 * console.log(stats); // { name: "...", count: 64, ... }
 */
