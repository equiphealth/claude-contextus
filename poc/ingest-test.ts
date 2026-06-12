/**
 * POC: Markdown ingestion to ChromaDB with Transformers.js embeddings
 *
 * Tests the full pipeline:
 * 1. Scan .claude/context/ for markdown files
 * 2. Generate embeddings via Transformers.js (nomic-embed-text-v1.5)
 * 3. Store in ChromaDB collection
 * 4. Query test to verify retrieval
 *
 * Run: npx tsx poc/ingest-test.ts
 *
 * Dependencies: npm install chromadb glob @xenova/transformers
 */

import { ChromaClient } from 'chromadb';
import fs from 'fs';
import { glob } from 'glob';
import { pipeline } from '@xenova/transformers';

const EMBEDDING_MODEL = 'nomic-ai/nomic-embed-text-v1.5';

// Initialize embedding pipeline once
let embedder: any = null;

async function initEmbedder() {
  if (!embedder) {
    console.log('⏳ Loading embedding model (first run may download ~500MB)...');
    embedder = await pipeline('feature-extraction', EMBEDDING_MODEL);
    console.log('✓ Model loaded');
  }
  return embedder;
}

async function generateEmbedding(text: string): Promise<number[]> {
  const pipe = await initEmbedder();
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

async function main() {
  console.log('🔍 Scanning for markdown files...');

  // 1. Scan for markdown files
  const files = await glob('.claude/context/**/*.md');
  console.log(`✓ Found ${files.length} markdown files`);

  if (files.length === 0) {
    console.log('⚠️  No files found. Create some .md files in .claude/context/ first.');
    return;
  }

  // 2. Initialize ChromaDB
  console.log('\n📦 Connecting to ChromaDB...');
  const client = new ChromaClient();

  // Delete collection if exists (fresh start for POC)
  try {
    await client.deleteCollection({ name: 'contextus-test' });
  } catch (e) {
    // Collection doesn't exist, that's fine
  }

  const collection = await client.createCollection({
    name: 'contextus-test',
    metadata: {
      embedding_model: EMBEDDING_MODEL,
      embedding_source: 'transformers.js'
    }
  });
  console.log('✓ Created collection "contextus-test"');

  // 3. Ingest each file
  console.log('\n📝 Ingesting files...');
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');

    // For POC: use whole file, no chunking
    // Opus suggested splitting by headers, but memories are typically small enough
    // that chunking doesn't provide much benefit. Validate this assumption first.

    console.log(`  • ${file} (${content.length} chars)`);

    const embedding = await generateEmbedding(content);

    await collection.add({
      ids: [file],
      embeddings: [embedding],
      documents: [content],
      metadatas: [{
        filename: file,
        size: content.length,
        ingested_at: new Date().toISOString()
      }]
    });
  }

  console.log(`✓ Ingested ${files.length} files`);

  // 4. Query test
  console.log('\n🔎 Running query test...');
  const testQueries = [
    'error handling',
    'testing patterns',
    'authentication'
  ];

  for (const query of testQueries) {
    console.log(`\n  Query: "${query}"`);

    const queryEmbedding = await generateEmbedding(query);
    const results = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: 3
    });

    if (results.ids[0].length === 0) {
      console.log('    No results');
      continue;
    }

    // ChromaDB returns results as nested arrays
    for (let i = 0; i < results.ids[0].length; i++) {
      const id = results.ids[0][i];
      const distance = results.distances?.[0][i] ?? 0;
      const similarity = 1 - distance; // Convert distance to similarity

      console.log(`    ${i + 1}. ${id} (similarity: ${similarity.toFixed(3)})`);
    }
  }

  console.log('\n✅ POC complete!');
  console.log('\nNext steps:');
  console.log('  - Validate similarity scores make sense');
  console.log('  - Test chunking if files are large (>1000 tokens)');
  console.log('  - Measure embedding generation time');
}

main().catch(console.error);
