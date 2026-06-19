/**
 * Parse the "Context: used:" provenance footer from a response.
 *
 * Returns the list of pattern filenames the model self-reported using.
 * Empty array = footer absent or model said it used none.
 */

export interface FooterMatch {
  filename: string;
  score: number;
}

const FOOTER_RE = /Context: used:\s*(.+)/;
const ENTRY_RE = /([^\s(,]+(?:\s[^\s(,]+)*)\s*\((\d+\.\d+)\)/g;

export function parseUsedFooter(response: string): FooterMatch[] {
  const match = response.match(FOOTER_RE);
  if (!match) return [];

  const line = match[1];
  const results: FooterMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = ENTRY_RE.exec(line)) !== null) {
    results.push({ filename: m[1].trim(), score: parseFloat(m[2]) });
  }
  return results;
}
