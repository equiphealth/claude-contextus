/**
 * CLAUDE.md stanza management (pure logic) — the marked, idempotent block that
 * /contextus-setup writes into a project's CLAUDE.md.
 *
 * FIRM CONSTRAINT (first-run-onboarding memory): a hook must NEVER auto-edit
 * CLAUDE.md — it's an outward-facing file the user owns. Only /contextus-setup
 * touches it, and only inside a fenced block:
 *
 *   <!-- contextus:start -->
 *   …stanza…
 *   <!-- contextus:end -->
 *
 * Re-running setup must UPDATE the block in place, never append a duplicate. That
 * idempotency is the whole reason this is a marked block and not a blind append,
 * so the upsert is pure + unit-tested here, independent of file I/O (which lives
 * in scripts/contextus-setup.ts).
 *
 * The stanza's purpose: tell a fresh Claude instance that context is injected in
 * this project and that new patterns can be proposed via the awareness footer —
 * making the Phase-3 awareness loop legible rather than mysterious.
 */
export const STANZA_START = '<!-- contextus:start -->';
export const STANZA_END = '<!-- contextus:end -->';
/** The canonical stanza body (between the markers). Versioned for future edits. */
export const STANZA_BODY = `## Context (claude-contextus)

This project uses [claude-contextus](https://github.com/anthonypdawson/claude-contextus):
relevant patterns from \`.claude/context/\` are **retrieved and injected automatically**
on each prompt — you don't need to search for them. Injected blocks are tagged
\`[contextus — …]\`.

When you discover a durable pattern, decision, or gotcha worth keeping, you'll see
an awareness footer inviting you to propose it; new context files live under
\`.claude/context/<category>/\` and are embedded automatically when edited.`;
/** A complete marked stanza block (markers + body). */
export function renderStanza(body = STANZA_BODY) {
    return `${STANZA_START}\n${body}\n${STANZA_END}`;
}
/** Does the text already contain a contextus stanza? */
export function hasStanza(text) {
    return text.includes(STANZA_START);
}
/**
 * Upsert the stanza into CLAUDE.md content, idempotently.
 *  - No existing block → append the stanza (with a separating blank line).
 *  - Existing block     → replace it in place (markers included), preserving
 *    everything around it. Re-running never duplicates.
 * Returns the new content and whether anything changed (an identical stanza is a
 * no-op, so a third run reports changed:false).
 */
export function upsertStanza(content, body = STANZA_BODY) {
    const block = renderStanza(body);
    const startIdx = content.indexOf(STANZA_START);
    if (startIdx === -1) {
        // No block yet — append. Keep one blank line of separation; handle an empty
        // or whitespace-only file cleanly.
        const base = content.replace(/\s+$/, '');
        const next = base.length ? `${base}\n\n${block}\n` : `${block}\n`;
        return { content: next, changed: true };
    }
    const endMarker = content.indexOf(STANZA_END, startIdx);
    // Malformed (start without end) → treat the rest of the file as the block and
    // replace from start onward, so we self-heal rather than nest a second block.
    const endIdx = endMarker === -1 ? content.length : endMarker + STANZA_END.length;
    const before = content.slice(0, startIdx);
    const after = content.slice(endIdx);
    const next = before + block + after;
    return { content: next, changed: next !== content };
}
//# sourceMappingURL=claude-md-stanza.js.map