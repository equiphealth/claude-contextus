/**
 * Context Loader - Read and parse context pattern markdown files
 */

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import matter from 'gray-matter';

/**
 * Load all context files from a context directory
 *
 * @param {string} contextDir - Context directory path (e.g., .claude/context)
 * @returns {Promise<Array>} Array of context objects
 */
export async function loadContexts(contextDir: string) {
  // Find all .md files except index files and README.md
  const pattern = path.join(contextDir, '**', '*.md');
  const files = await glob(pattern, {
    ignore: ['**/CONTEXT.md', '**/README.md'],
  });

  const contexts = [];

  for (const filePath of files) {
    try {
      const context = await loadContext(filePath, contextDir);
      contexts.push(context);
    } catch (error) {
      console.error(`Error loading ${filePath}:`, error.message);
    }
  }

  return contexts;
}

/**
 * Load a single context file
 *
 * @param {string} filePath - Absolute file path
 * @param {string} contextDir - Context directory path
 * @returns {Promise<Object>} Context object
 */
export async function loadContext(filePath: string, contextDir: string) {
  const fileContent = fs.readFileSync(filePath, 'utf8');
  const { data: frontmatter, content } = matter(fileContent);

  // Get relative path for ID
  const relativePath = path.relative(contextDir, filePath);

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
    size: stats.size,
  };
}

/**
 * Check if context files have changed since embeddings were created
 *
 * @param {Array} embeddedContexts - Previously embedded contexts with mtimes
 * @param {string} contextDir - Context directory path
 * @returns {Promise<Object>} { needsRebuild, changed, added, removed }
 */
export async function checkForChanges(embeddedContexts: any[], contextDir: string) {
  const currentContexts = await loadContexts(contextDir);

  const embeddedMap = new Map(embeddedContexts.map((c) => [c.id, c.mtime]));
  const currentMap = new Map(currentContexts.map((c) => [c.id, c.mtime]));

  const changed = [];
  const added = [];
  const removed = [];

  // Check for changes and additions
  for (const context of currentContexts) {
    if (!embeddedMap.has(context.id)) {
      added.push(context);
    } else if (embeddedMap.get(context.id) !== context.mtime) {
      changed.push(context);
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
    total: currentContexts.length,
  };
}

/**
 * Validate context frontmatter
 *
 * @param {Object} context - Context object
 * @returns {Object} { valid: boolean, errors: string[] }
 */
export function validateContext(context: any) {
  const errors = [];

  // Required fields
  if (!context.frontmatter.name) {
    errors.push('Missing required field: name');
  }
  if (!context.frontmatter.description) {
    errors.push('Missing required field: description');
  }
  if (!context.frontmatter.type) {
    errors.push('Missing required field: type');
  }

  // Valid types
  const validTypes = ['feedback', 'reference', 'decision', 'project'];
  if (context.frontmatter.type && !validTypes.includes(context.frontmatter.type)) {
    errors.push(
      `Invalid type: ${context.frontmatter.type}. Must be one of: ${validTypes.join(', ')}`
    );
  }

  // Name format (kebab-case recommended)
  if (context.frontmatter.name && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(context.frontmatter.name)) {
    errors.push('Name should be kebab-case (lowercase, hyphens only)');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/*
 * Example usage:
 *
 * import { loadContexts, loadContext, checkForChanges, validateContext } from './context-loader.js';
 *
 * // Load all contexts
 * const contexts = await loadContexts('.claude/context');
 * console.log(contexts.length); // 64
 *
 * // Load single context
 * const context = await loadContext('.claude/context/sdk/feedback_example.md', '.claude/context');
 * console.log(context.name, context.category); // "sdk-example", "sdk"
 *
 * // Check for changes
 * const changes = await checkForChanges(previousContexts, '.claude/context');
 * if (changes.needsRebuild) {
 *   console.log(`${changes.added.length} added, ${changes.changed.length} changed`);
 * }
 *
 * // Validate context
 * const validation = validateContext(context);
 * if (!validation.valid) {
 *   console.error('Invalid context:', validation.errors);
 * }
 */
