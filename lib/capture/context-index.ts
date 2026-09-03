/**
 * CONTEXT.md/DOCS.md index line upsert (pure logic) — used by the daemon's
 * /capture endpoint so re-capturing an existing slug UPDATES its index line
 * instead of appending a second copy.
 *
 * The match key is the markdown link target `](relPath)`, not the slug or
 * description — this is the same convention /delete's index-removal logic
 * uses (daemon/server.ts, handleDelete), so upsert and removal agree on what
 * "the same entry" means.
 */

/**
 * Upsert a single index line into index file content, keyed by the link
 * target `](relPath)`. Collapses ALL matching lines into one (at the
 * position of the first match) rather than just replacing the first —
 * self-healing for an index that already has duplicate entries. If no line
 * matches, appends a new one.
 *
 * Pure string transform — no file I/O, so this is unit-testable without a
 * filesystem. Caller does the read/write.
 */
export function upsertIndexEntry(
  existingContent: string,
  relPath: string,
  entryLine: string
): string {
  const linkTarget = `](${relPath})`;
  const lines = existingContent.split('\n');
  const matchIndices = lines.reduce<number[]>((acc, line, i) => {
    if (line.includes(linkTarget)) acc.push(i);
    return acc;
  }, []);

  if (matchIndices.length > 0) {
    const [first, ...rest] = matchIndices;
    const restSet = new Set(rest);
    const result = lines
      .map((line, i) => (i === first ? entryLine : line))
      .filter((_, i) => !restSet.has(i));
    return result.join('\n');
  }

  // No existing entry — append. Preserve a single trailing newline convention:
  // if content already ends with '\n' (or is empty), don't add an extra blank
  // line before the new entry.
  const sep = existingContent.endsWith('\n') || existingContent === '' ? '' : '\n';
  return `${existingContent}${sep}${entryLine}\n`;
}
