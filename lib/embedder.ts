/**
 * Embedder - Handles text embedding using local transformer models
 *
 * Uses @xenova/transformers to run models locally in Node.js
 * No API keys or external services required
 */

import { pipeline } from '@xenova/transformers';

let _embedder = null;

/**
 * Get or create the embedding pipeline
 *
 * Models are downloaded once and cached in ~/.cache/huggingface/
 * Subsequent runs are instant (no download)
 *
 * @returns {Promise<Function>} Embedding function
 */
export async function getEmbedder() {
  if (!_embedder) {
    console.log('Loading embedding model (one-time download)...');
    _embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true, // Use quantized model for speed
      progress_callback: (progress) => {
        if (progress.status === 'downloading') {
          const pct = Math.round((progress.loaded / progress.total) * 100);
          process.stdout.write(`\rDownloading model: ${pct}%`);
        }
      },
    });
    console.log('\nModel loaded!');
  }
  return _embedder;
}

/**
 * Embed a single text string
 *
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} Embedding vector (384 dimensions)
 */
export async function embedText(text) {
  const embedder = await getEmbedder();

  // Generate embedding with mean pooling and normalization
  const output = await embedder(text, {
    pooling: 'mean',
    normalize: true,
  });

  // Convert tensor to plain array
  return Array.from(output.data);
}

/**
 * Embed multiple texts in batch (more efficient)
 *
 * @param {string[]} texts - Array of texts to embed
 * @param {number} batchSize - Batch size (default: 32)
 * @returns {Promise<number[][]>} Array of embedding vectors
 */
export async function embedBatch(texts, batchSize = 32) {
  const embeddings = [];

  // Ensure embedder is loaded before batch processing
  await getEmbedder();

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    // Process batch in parallel
    const batchEmbeddings = await Promise.all(batch.map((text) => embedText(text)));

    embeddings.push(...batchEmbeddings);

    // Progress indicator
    const progress = Math.min(i + batchSize, texts.length);
    process.stdout.write(`\rEmbedding: ${progress}/${texts.length}`);
  }

  console.log(); // newline after progress
  return embeddings;
}

/**
 * Compare similarity between two embedding vectors
 * Uses cosine similarity (dot product of normalized vectors)
 *
 * @param {number[]} embedding1 - First embedding
 * @param {number[]} embedding2 - Second embedding
 * @returns {number} Similarity score (0-1, higher = more similar)
 */
export function cosineSimilarity(embedding1, embedding2) {
  if (embedding1.length !== embedding2.length) {
    throw new Error('Embeddings must have same dimension');
  }

  // Since embeddings are already normalized, dot product = cosine similarity
  let dotProduct = 0;
  for (let i = 0; i < embedding1.length; i++) {
    dotProduct += embedding1[i] * embedding2[i];
  }

  return dotProduct;
}

/*
 * Example usage:
 *
 * import { embedText, embedBatch, cosineSimilarity } from './embedder.js';
 *
 * // Single text
 * const embedding = await embedText("How do I log errors in tests?");
 * console.log(embedding.length); // 384
 *
 * // Batch
 * const texts = ["text 1", "text 2", "text 3"];
 * const embeddings = await embedBatch(texts);
 *
 * // Compare similarity
 * const similarity = cosineSimilarity(embeddings[0], embeddings[1]);
 * console.log(similarity); // 0.85
 */
