/**
 * Memory Loader - Read and parse memory markdown files
 */

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import matter from 'gray-matter';

/**
 * Load all memory files from .claude/memory/
 *
 * @param {string} memoryDir - Memory directory path (default: .claude/memory)
 * @returns {Promise<Array>} Array of memory objects
 */
export async function loadMemories(memoryDir = '.claude/memory') {
  // Find all .md files except MEMORY.md and README.md
  const pattern = path.join(memoryDir, '**', '*.md');
  const files = await glob(pattern, {
    ignore: ['**/MEMORY.md', '**/README.md']
  });

  const memories = [];

  for (const filePath of files) {
    try {
      const memory = await loadMemory(filePath, memoryDir);
      memories.push(memory);
    } catch (error) {
      console.error(`Error loading ${filePath}:`, error.message);
    }
  }

  return memories;
}

/**
 * Load a single memory file
 *
 * @param {string} filePath - Absolute file path
 * @param {string} memoryDir - Memory directory path
 * @returns {Promise<Object>} Memory object
 */
export async function loadMemory(filePath, memoryDir = '.claude/memory') {
  const fileContent = fs.readFileSync(filePath, 'utf8');
  const { data: frontmatter, content } = matter(fileContent);

  // Get relative path for ID
  const relativePath = path.relative(memoryDir, filePath);

  // Extract category from path (e.g., "sdk", "testing", "framework")
  const category = path.dirname(relativePath).split(path.sep)[0] || 'general';

  // Get file stats
  const stats = fs.statSync(filePath);

  return {
    id: relativePath,
    path: filePath,
    relativePath,
    name: frontmatter.name || path.basename(filePath, '.md'),
    description: frontmatter.description || '',
    type: frontmatter.type || 'unknown',
    category,
    content,
    frontmatter,
    mtime: stats.mtimeMs,
    size: stats.size
  };
}

/**
 * Check if memory files have changed since embeddings were created
 *
 * @param {Array} embeddedMemories - Previously embedded memories with mtimes
 * @param {string} memoryDir - Memory directory path
 * @returns {Promise<Object>} { needsRebuild, changed, added, removed }
 */
export async function checkForChanges(embeddedMemories, memoryDir = '.claude/memory') {
  const currentMemories = await loadMemories(memoryDir);

  const embeddedMap = new Map(embeddedMemories.map(m => [m.id, m.mtime]));
  const currentMap = new Map(currentMemories.map(m => [m.id, m.mtime]));

  const changed = [];
  const added = [];
  const removed = [];

  // Check for changes and additions
  for (const memory of currentMemories) {
    if (!embeddedMap.has(memory.id)) {
      added.push(memory);
    } else if (embeddedMap.get(memory.id) !== memory.mtime) {
      changed.push(memory);
    }
  }

  // Check for removals
  for (const id of embeddedMap.keys()) {
    if (!currentMap.has(id)) {
      removed.push(id);
    }
  }

  const needsRebuild = added.length > 0 || changed.length > 0 || removed.length > 0;

  return {
    needsRebuild,
    changed,
    added,
    removed,
    total: currentMemories.length
  };
}

/**
 * Validate memory frontmatter
 *
 * @param {Object} memory - Memory object
 * @returns {Object} { valid: boolean, errors: string[] }
 */
export function validateMemory(memory) {
  const errors = [];

  // Required fields
  if (!memory.frontmatter.name) {
    errors.push('Missing required field: name');
  }
  if (!memory.frontmatter.description) {
    errors.push('Missing required field: description');
  }
  if (!memory.frontmatter.type) {
    errors.push('Missing required field: type');
  }

  // Valid types
  const validTypes = ['feedback', 'reference', 'decision', 'project'];
  if (memory.frontmatter.type && !validTypes.includes(memory.frontmatter.type)) {
    errors.push(`Invalid type: ${memory.frontmatter.type}. Must be one of: ${validTypes.join(', ')}`);
  }

  // Name format (kebab-case recommended)
  if (memory.frontmatter.name && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(memory.frontmatter.name)) {
    errors.push('Name should be kebab-case (lowercase, hyphens only)');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/*
 * Example usage:
 *
 * import { loadMemories, loadMemory, checkForChanges, validateMemory } from './memory-loader.js';
 *
 * // Load all memories
 * const memories = await loadMemories();
 * console.log(memories.length); // 64
 *
 * // Load single memory
 * const memory = await loadMemory('.claude/memory/sdk/feedback_example.md');
 * console.log(memory.name, memory.category); // "sdk-example", "sdk"
 *
 * // Check for changes
 * const changes = await checkForChanges(previousMemories);
 * if (changes.needsRebuild) {
 *   console.log(`${changes.added.length} added, ${changes.changed.length} changed`);
 * }
 *
 * // Validate memory
 * const validation = validateMemory(memory);
 * if (!validation.valid) {
 *   console.error('Invalid memory:', validation.errors);
 * }
 */
