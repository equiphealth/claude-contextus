/**
 * Closed-schema Muse hook output emitter (Muse support, Phase 1).
 *
 * Plain ESM JavaScript (NOT TypeScript): adapter hooks run as
 * `node <plugin>/adapter/*.js` with no build step, so this cannot import .ts.
 * Mirrors the byte contract of `truncateUtf8Bytes` in daemon/server.ts — both
 * sides count UTF-8 bytes, never characters, against the 16384-byte stdout
 * ceiling. A process killed for `output_too_large` delivers nothing, so every
 * emitter here truncates defensively well inside the cap.
 */

/** One byte inside the Muse 16384-byte hook stdout kill line. */
export const STDOUT_CEILING = 16383;
/** systemMessage is kept whole only up to 1000 chars (docs). */
export const SYSTEM_MESSAGE_CHARS = 1000;

/** Byte-accurate UTF-8 truncation that never splits a multi-byte sequence. */
export function truncateUtf8Bytes(s, maxBytes) {
  if (Buffer.byteLength(s, 'utf8') <= maxBytes) return s;
  return new TextDecoder('utf-8').decode(Buffer.from(s, 'utf8').subarray(0, maxBytes), {
    stream: true
  });
}

/** Character-boundary truncation for the 1000-char systemMessage cap. */
export function truncateChars(s, maxChars) {
  const chars = [...s];
  return chars.length <= maxChars ? s : chars.slice(0, maxChars).join('');
}

/** Context injection output — the only shape that carries additionalContext. */
export function emitContext({ hookEventName, additionalContext, systemMessage }) {
  const out = {
    hookSpecificOutput: {
      hookEventName,
      additionalContext: truncateUtf8Bytes(String(additionalContext ?? ''), STDOUT_CEILING)
    }
  };
  if (systemMessage) out.systemMessage = truncateChars(String(systemMessage), SYSTEM_MESSAGE_CHARS);
  process.stdout.write(JSON.stringify(out) + '\n');
}

/** User-visible announcement with no model-context effect. */
export function emitSystemMessage(text) {
  process.stdout.write(
    JSON.stringify({ systemMessage: truncateChars(String(text ?? ''), SYSTEM_MESSAGE_CHARS) }) +
      '\n'
  );
}

/**
 * Cut text at the last newline within the cap — never mid-line — and mark it.
 * Absolute backstop only: the daemon seam guarantees its block already fits,
 * so reaching this means the seam was bypassed. The mark names what happened.
 */
export function cutAtLine(text, cap) {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= cap) return { text, cut: false };
  const buf = Buffer.from(text, 'utf8').subarray(0, cap);
  const cut = new TextDecoder('utf-8').decode(buf, { stream: true });
  const at = cut.lastIndexOf('\n');
  const kept = at > 0 ? cut.slice(0, at) : cut;
  return { text: kept + '\n[contextus: truncated at host ceiling]', cut: true };
}

/**
 * Emit a merged injection: the daemon block (already fit to the ceiling by
 * the seam) plus the adapter-appended footer.
 *
 * Divergence-proof by construction: the daemon block is never re-cut here.
 * If the merged text exceeds the ceiling, the adapter drops its own footer
 * first (advisory, recoverable from prompts/) and notes the drop on stderr.
 * Only if the daemon block alone still exceeds — seam bypass — does the
 * line-boundary backstop fire, and that path is a defect, not a mode.
 */
export function emitMerged({ hookEventName, daemonBlock, footer, systemMessage }) {
  const block = String(daemonBlock ?? '');
  const foot = footer ? `\n\n${footer}` : '';
  let merged = block + foot;
  if (Buffer.byteLength(merged, 'utf8') > STDOUT_CEILING && foot) {
    console.error('[contextus] merged block over host ceiling: dropping adapter footer');
    merged = block;
  }
  if (Buffer.byteLength(merged, 'utf8') > STDOUT_CEILING) {
    console.error('[contextus] DEFECT: daemon block exceeds host ceiling — line-cutting');
    merged = cutAtLine(merged, STDOUT_CEILING).text;
  }
  const out = {
    hookSpecificOutput: { hookEventName, additionalContext: merged }
  };
  if (systemMessage) out.systemMessage = truncateChars(String(systemMessage), SYSTEM_MESSAGE_CHARS);
  process.stdout.write(JSON.stringify(out) + '\n');
}

/** Explicit no-op output: valid empty object, never an error, never applied. */
export function emitEmpty() {
  process.stdout.write('{}\n');
}
