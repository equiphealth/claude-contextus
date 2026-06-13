/**
 * POC: Markdown ingestion to LanceDB with Transformers.js embeddings
 *
 * Tests the full pipeline:
 * 1. Scan .claude/context/ for markdown files
 * 2. Generate embeddings via Transformers.js (nomic-embed-text-v1.5)
 * 3. Store in LanceDB (file-based, embedded)
 * 4. Query test to verify retrieval
 *
 * Run: npx tsx poc/ingest-test.ts [path]
 *
 * Examples:
 *   npx tsx poc/ingest-test.ts
 *   npx tsx poc/ingest-test.ts "/path/to/automation/.claude/memory/[star][star]/[star].md"
 *
 * Dependencies: pnpm add @lancedb/lancedb glob @xenova/transformers
 */

import * as lancedb from '@lancedb/lancedb';
import fs from 'fs';
import { glob } from 'glob';

const OLLAMA_API = 'http://localhost:11434/api/embeddings';
const EMBEDDING_MODEL = 'nomic-embed-text';

async function generateEmbedding(text: string): Promise<number[]> {
  // Truncate if too long (nomic-embed-text has 8192 token context ~2000 chars safe)
  const MAX_CHARS = 2000;
  const truncated = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;

  const response = await fetch(OLLAMA_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      prompt: truncated
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama embedding failed: ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  return data.embedding;
}

async function main() {
  // Allow specifying custom path via CLI arg
  const customPath = process.argv[2];
  const scanPath = customPath || '.claude/context/**/*.md';

  console.log('🔍 Scanning for markdown files...');
  console.log(`   Path: ${scanPath}`);

  // 1. Scan for markdown files
  const files = await glob(scanPath);
  console.log(`✓ Found ${files.length} markdown files`);

  if (files.length === 0) {
    console.log('⚠️  No files found.');
    console.log('\nUsage:');
    console.log('  npx tsx poc/ingest-test.ts [path]');
    console.log('\nExamples:');
    console.log('  npx tsx poc/ingest-test.ts                              # Default: .claude/context/');
    console.log('  npx tsx poc/ingest-test.ts ".claude/memory/**/*.md"     # Test on memories');
    console.log('  npx tsx poc/ingest-test.ts "docs/**/*.md"               # Test on docs');
    return;
  }

  // 2. Initialize LanceDB (embedded, file-based)
  console.log('\n📦 Initializing LanceDB (file-based)...');
  const db = await lancedb.connect('./.lancedb-poc');

  // Drop table if exists (fresh start for POC)
  const tableNames = await db.tableNames();
  if (tableNames.includes('contextus_test')) {
    await db.dropTable('contextus_test');
  }

  console.log('✓ Connected to LanceDB');

  // 3. Ingest each file
  console.log('\n📝 Ingesting files...');
  const records = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');

    // For POC: use whole file, no chunking
    // Opus suggested splitting by headers, but memories are typically small enough
    // that chunking doesn't provide much benefit. Validate this assumption first.

    console.log(`  • ${file} (${content.length} chars)`);

    const embedding = await generateEmbedding(content);

    records.push({
      id: file,
      vector: embedding,
      document: content,  // Vector Inspector expects 'document' field
      content: content,   // Keep for compatibility
      filename: file,
      size: content.length,
      ingested_at: new Date().toISOString()
    });
  }

  // Create table with all records
  const table = await db.createTable('contextus_test', records);
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
    const results = await table
      .search(queryEmbedding)
      .limit(3)
      .execute();

    if (results.length === 0) {
      console.log('    No results');
      continue;
    }

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const distance = result._distance;
      const similarity = 1 - distance; // Convert distance to similarity

      console.log(`    ${i + 1}. ${result.filename} (similarity: ${similarity.toFixed(3)})`);
    }
  }

  console.log('\n✅ POC complete!');
  console.log('\nNext steps:');
  console.log('  - Validate similarity scores make sense');
  console.log('  - Test chunking if files are large (>1000 tokens)');
  console.log('  - Measure embedding generation time');
}

main().catch(console.error);
