/**
 * Chunker — split a markdown doc into embeddable chunks.
 *
 * v1 embeds whole documents (one row per file — see embed-contexts), so this is
 * NOT yet wired into the pipeline. It exists now as tested pure logic so v2 can
 * turn on chunking without re-deriving the boundary rules under time pressure
 * (IMPLEMENTATION_ESTIMATE "Chunker boundaries" unit-test line).
 *
 * Strategy, in order of preference:
 *   1. Header split — break on markdown headers (`#`..`######`); each section
 *      (header + its body, until the next header of equal/higher level) is a
 *      chunk. Headers are the author's own semantic boundaries.
 *   2. Token fallback — any section longer than `maxTokens` is hard-split into
 *      windows of ~maxTokens with `overlap` tokens carried between them, so a
 *      fact straddling a window boundary survives in at least one chunk.
 *
 * "Tokens" use the same ~4-chars/token estimate as the formatter (no tokenizer
 * dependency). Good enough for sizing; off by <10% on English prose.
 */

/** ~4 chars/token, matching lib/inject-format estimateTokens. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface Chunk {
  /** chunk text (header line included for header-split sections) */
  text: string;
  /** 0-based ordinal within the document */
  index: number;
  /** the nearest enclosing header text, '' for pre-header preamble */
  heading: string;
}

export interface ChunkOptions {
  /** target max tokens per chunk before the hard token-split kicks in */
  maxTokens: number;
  /** tokens of overlap carried between hard-split windows */
  overlap: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { maxTokens: 512, overlap: 64 };

interface Section {
  heading: string;
  body: string;
}

/** Split markdown into header-delimited sections (preamble before the first
 *  header becomes a leading section with an empty heading). */
function splitByHeaders(markdown: string): Section[] {
  const lines = markdown.split('\n');
  const sections: Section[] = [];
  let heading = '';
  let buf: string[] = [];

  const flush = () => {
    const body = buf.join('\n').trim();
    if (heading || body) sections.push({ heading, body });
    buf = [];
  };

  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line)) {
      flush();
      heading = line.replace(/^#{1,6}\s+/, '').trim();
    } else {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

/** Hard-split an over-long text into ~maxTokens windows with token overlap.
 *  Splits on whitespace so words aren't cut mid-token. */
function tokenSplit(text: string, maxTokens: number, overlap: number): string[] {
  if (estimateTokens(text) <= maxTokens) return [text];
  const maxChars = maxTokens * 4;
  const overlapChars = Math.min(overlap * 4, Math.floor(maxChars / 2));
  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    // Prefer breaking on whitespace within the window (don't cut a word).
    if (end < text.length) {
      const ws = text.lastIndexOf(' ', end);
      if (ws > start) end = ws;
    }
    out.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(end - overlapChars, start + 1);
  }
  return out.filter(Boolean);
}

/**
 * Chunk a markdown document. Header sections become chunks; any section over
 * `maxTokens` is further token-split with overlap. Returns at least one chunk
 * for any non-empty input; an empty/whitespace doc yields [].
 */
export function chunkMarkdown(
  markdown: string,
  opts: ChunkOptions = DEFAULT_CHUNK_OPTIONS
): Chunk[] {
  const chunks: Chunk[] = [];
  let index = 0;
  for (const section of splitByHeaders(markdown)) {
    // Re-attach the heading to its body so a chunk reads standalone.
    const full = section.heading ? `# ${section.heading}\n${section.body}`.trim() : section.body;
    if (!full.trim()) continue;
    for (const piece of tokenSplit(full, opts.maxTokens, opts.overlap)) {
      chunks.push({ text: piece, index: index++, heading: section.heading });
    }
  }
  return chunks;
}
