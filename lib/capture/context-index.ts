/**
 * CONTEXT.md/DOCS.md index line upsert (pure logic) — used by the daemon's
 * /capture endpoint so re-capturing an existing slug UPDATES its index line
 * in place instead of appending a second copy.
 *
 * ROOT CAUSE (observed live, automation repo, 2026-09-03): /capture is
 * documented to OVERWRITE an existing slug's file on re-capture, but the
 * index-file write was a blind `fs.appendFileSync` with no check for an
 * existing entry. Every re-capture of the same slug left the OLD index line
 * behind and appended a new one — producing scattered, non-adjacent
 * duplicate entries for the same file after repeated re-captures over time
 * (2-3 copies of the same entry observed, not clustered — consistent with
 * separate re-capture events, not a single generation bug).
 *
 * The match key is the markdown link target `](relPath)`, not the slug or
 * description — this is the same convention /delete's index-removal logic
 * already uses (daemon/server.ts, handleDelete), so upsert and removal agree
 * on what "the same entry" means.
 */

/**
 * Upsert a single index line into index file content, keyed by the link
 * target `](relPath)`. If a line linking to `relPath` already exists,
 * replace it in place (preserving position). Otherwise append a new line.
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
  const matchIdx = lines.findIndex((line) => line.includes(linkTarget));

  if (matchIdx !== -1) {
    lines[matchIdx] = entryLine;
    return lines.join('\n');
  }

  // No existing entry — append. Preserve a single trailing newline convention:
  // if content already ends with '\n' (or is empty), don't add an extra blank
  // line before the new entry.
  const sep = existingContent.endsWith('\n') || existingContent === '' ? '' : '\n';
  return `${existingContent}${sep}${entryLine}\n`;
}
