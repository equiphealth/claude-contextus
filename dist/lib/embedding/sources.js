/**
 * Source resolution — turn plugin.json `config.sources` into loadable corpora.
 *
 * v1 originally embedded ONLY `.claude/context/`, even though plugin.json lists
 * multiple enabled sources (projectDocs = `docs/`, userMemory, userDocs). This
 * resolves every ENABLED source to an absolute dir + its exclude globs, and loads
 * each file tagged with its source name so the re-ranker's SOURCE_WEIGHTS engage.
 *
 * STALENESS / NOISE CAVEAT (user-flagged): docs are noisier and stale faster than
 * hand-curated context — they're long-form prose written for humans, and v1 embeds
 * them WHOLE (one vector per file; chunking is v2), so the model truncates a long
 * doc to its context window and only the head is represented. Two guards already
 * cover this: SOURCE_WEIGHTS down-ranks `projectDocs`/`userDocs` below curated
 * context, and freshnessDecay fades stale rows. Incremental re-embed on edit only
 * watches `.claude/context/`; doc sources refresh on a full `pnpm run embed`. Treat
 * docs as a supporting signal, not a primary one, until v2 chunking lands.
 */
import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { expandHome } from '../config.js';
import { loadContext } from './context-loader.js';
/**
 * Map a plugin.json source entry to the SOURCE_WEIGHTS key the re-ranker uses.
 * The config keys (`projectMemory`) predate the rename to `projectContext`; both
 * are present in SOURCE_WEIGHTS, but we normalize a project memory/context source
 * to `projectContext` so the curated-context weight (1.0) applies.
 */
function sourceWeightKey(configKey) {
    if (configKey === 'projectMemory')
        return 'projectContext';
    if (configKey === 'userMemory')
        return 'userContext';
    return configKey;
}
/**
 * Resolve every enabled source from plugin.json `config.sources` to a loadable
 * dir. Skips disabled sources and ones whose directory doesn't exist (a user
 * without `~/.claude/docs` just doesn't get that pack — not an error).
 */
export function resolveSources(pluginConfig) {
    const sources = (pluginConfig.sources ?? {});
    const out = [];
    for (const [key, s] of Object.entries(sources)) {
        if (!s || s.enabled === false || !s.path)
            continue;
        const dir = path.resolve(expandHome(s.path));
        if (!fs.existsSync(dir))
            continue;
        const exclude = s.exclude ?? ['**/CONTEXT.md', '**/DOCS.md', '**/README.md'];
        out.push({ name: sourceWeightKey(key), dir, exclude });
    }
    return out;
}
/** Load every markdown file in a source dir, tagged with the source name. */
export async function loadSource(src) {
    // cwd-relative glob, not an absolute pattern: an absolute pattern matches the
    // `ignore` globs against absolute paths, so `**/CONTEXT.md` fails to exclude a
    // root-level index file (same bug that gave reconcile a phantom "new" file).
    // Anchor each exclude with a bare-basename variant so root-level indexes drop.
    const ignore = src.exclude.flatMap((g) => (g.startsWith('**/') ? [g, g.slice(3)] : [g]));
    const rel = await glob('**/*.md', { cwd: src.dir, ignore });
    return rel
        .sort()
        .map((f) => ({ context: loadContext(path.join(src.dir, f), src.dir), source: src.name }));
}
/**
 * Load all enabled sources. Dedups by source-qualified id (a file can't appear
 * twice within one source). Returns the sourced contexts in source order.
 */
export async function loadAllSources(sources) {
    const out = [];
    for (const src of sources) {
        out.push(...(await loadSource(src)));
    }
    return out;
}
//# sourceMappingURL=sources.js.map