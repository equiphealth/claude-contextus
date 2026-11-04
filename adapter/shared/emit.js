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
const TRUNC_MARKER = '\n[contextus: truncated at host ceiling]';

export function cutAtLine(text, cap) {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= cap) return { text, cut: false };
  // Reserve the marker's bytes first: the result must fit cap INCLUDING it.
  const markerBytes = Buffer.byteLength(TRUNC_MARKER, 'utf8');
  const buf = Buffer.from(text, 'utf8').subarray(0, Math.max(0, cap - markerBytes));
  const cut = new TextDecoder('utf-8').decode(buf, { stream: true });
  const at = cut.lastIndexOf('\n');
  const kept = at > 0 ? cut.slice(0, at) : cut;
  return { text: kept + TRUNC_MARKER, cut: true };
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
  const sys = systemMessage
    ? truncateChars(String(systemMessage), SYSTEM_MESSAGE_CHARS)
    : undefined;
  const buildWire = (m) => {
    const o = { hookSpecificOutput: { hookEventName, additionalContext: m } };
    if (sys !== undefined) o.systemMessage = sys;
    return JSON.stringify(o) + '\n';
  };
  // Fit the WIRE bytes (payload + JSON envelope + systemMessage + newline),
  // not just the payload — a cap-sized block still overflows the host's
  // stdout limit once serialized.
  const fitWire = (m) => {
    let cur = m;
    // Re-measure after each cut: JSON escaping can expand the payload, so a
    // single pass can undershoot on quote-heavy text. Converges in practice
    // on the first retry; bounded regardless.
    for (let i = 0; i < 3; i++) {
      const wire = buildWire(cur);
      if (Buffer.byteLength(wire, 'utf8') <= STDOUT_CEILING) return wire;
      const over = Buffer.byteLength(wire, 'utf8') - STDOUT_CEILING;
      cur = cutAtLine(cur, Math.max(0, Buffer.byteLength(cur, 'utf8') - over)).text;
    }
    return buildWire(cutAtLine(cur, 0).text);
  };
  let merged = block + foot;
  if (Buffer.byteLength(buildWire(merged), 'utf8') > STDOUT_CEILING && foot) {
    console.error('[contextus] merged block over host ceiling: dropping adapter footer');
    merged = block;
  }
  if (Buffer.byteLength(buildWire(merged), 'utf8') > STDOUT_CEILING) {
    console.error('[contextus] DEFECT: daemon block exceeds host ceiling — line-cutting');
  }
  const wire = fitWire(merged);
  process.stdout.write(wire);
}

/** Explicit no-op output: valid empty object, never an error, never applied. */
export function emitEmpty() {
  process.stdout.write('{}\n');
}
