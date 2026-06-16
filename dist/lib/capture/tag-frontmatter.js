/**
 * Tag frontmatter writer (pure logic) — add tags to a context file's frontmatter
 * without disturbing anything else.
 *
 * The migration deliberately never fabricated tags (memory-to-context-migration),
 * so 13 of the migrated files are tagless. Tags are inert until v2 CAE consumes
 * them, but there was no PATH to backfill them — this is that path's risky core:
 * merging tags into existing frontmatter idempotently. The judgment of WHICH tags
 * is Claude's (the /tag-context skill); this just writes them safely.
 *
 * Idempotent + structure-preserving: merges into the nested `metadata.tags` (the
 * target schema) when metadata exists, else top-level `tags`; dedups; never
 * reorders or drops other keys; a no-op when every tag is already present.
 */
import matter from 'gray-matter';
/** Normalize a frontmatter tags value (list | csv | absent) to string[]. */
function readTags(raw) {
    if (Array.isArray(raw))
        return raw.map((t) => String(t).trim()).filter(Boolean);
    if (typeof raw === 'string')
        return raw
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
    return [];
}
/**
 * Merge `newTags` into a markdown file's frontmatter. Writes to `metadata.tags`
 * if the file already uses nested metadata (the target schema), otherwise to a
 * top-level `tags` key. Existing tags are preserved; duplicates are folded.
 */
export function addTags(rawFile, newTags) {
    const parsed = matter(rawFile);
    // gray-matter memoizes parse results by content string and returns the SAME
    // `data` object on repeat calls — mutating it in place would leak across calls
    // (and corrupt other callers/tests). Deep-clone before touching it.
    const data = structuredClone(parsed.data);
    const clean = newTags.map((t) => t.trim()).filter(Boolean);
    const usesMetadata = data.metadata != null && typeof data.metadata === 'object';
    const existing = usesMetadata
        ? readTags(data.metadata.tags)
        : readTags(data.tags);
    const merged = [...existing];
    const added = [];
    for (const t of clean) {
        if (!merged.includes(t)) {
            merged.push(t);
            added.push(t);
        }
    }
    if (added.length === 0)
        return { content: rawFile, added: [], changed: false };
    if (usesMetadata) {
        data.metadata.tags = merged;
    }
    else {
        data.tags = merged;
    }
    // gray-matter's stringify re-emits frontmatter + body; we keep the original body.
    const content = matter.stringify(parsed.content, data);
    return { content, added, changed: true };
}
//# sourceMappingURL=tag-frontmatter.js.map