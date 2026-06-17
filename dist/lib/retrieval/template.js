/**
 * Injection template renderer — reads a user-editable template file and renders
 * retrieved patterns into it using mustache-style variable substitution.
 *
 * Template location (checked in order):
 *   1. <project>/.claude/contextus-template.md  (per-project, git-committed)
 *   2. ~/.contextus/template.md                 (user-global)
 *   3. built-in default (DEFAULT_TEMPLATE below)
 *
 * Supported syntax:
 *   {{variable}}                    — simple substitution
 *   {{#each patterns}}...{{/each}}  — loop over patterns array
 *   {{#variable}}...{{/variable}}   — conditional (render block only if truthy)
 */
import fs from 'fs';
import path from 'path';
import { expandHome } from '../config.js';
export const DEFAULT_TEMPLATE = `[contextus — {{count}} patterns]

{{#each patterns}}
---
**{{filename}}{{#heading}} › {{heading}}{{/heading}}** _{{type}}_

{{body}}
{{/each}}`;
export const TEMPLATE_FILENAME = 'contextus-template.md';
/**
 * Resolve the template string. Checks project-local, then user-global, then default.
 * Caches per cwd (invalidates if file mtime changes).
 */
const _cache = new Map();
export function loadTemplate(cwd) {
    const paths = [
        cwd ? path.join(cwd, '.claude', TEMPLATE_FILENAME) : null,
        path.join(expandHome('~/.contextus'), TEMPLATE_FILENAME),
    ].filter(Boolean);
    for (const p of paths) {
        try {
            const stat = fs.statSync(p);
            const cached = _cache.get(p);
            if (cached && cached.mtime === stat.mtimeMs)
                return cached.content;
            const content = fs.readFileSync(p, 'utf-8');
            _cache.set(p, { mtime: stat.mtimeMs, content });
            return content;
        }
        catch {
            continue;
        }
    }
    return DEFAULT_TEMPLATE;
}
/**
 * Render a template string with the given context. Minimal mustache-like engine:
 * no deps, no partials, just what we need.
 */
export function renderTemplate(template, ctx) {
    let result = template;
    // {{#each patterns}}...{{/each}}
    const eachRe = /\{\{#each patterns\}\}([\s\S]*?)\{\{\/each\}\}/g;
    result = result.replace(eachRe, (_, block) => {
        return ctx.patterns.map((p) => renderBlock(block, p)).join('\n');
    });
    // Top-level variables
    result = result.replace(/\{\{count\}\}/g, String(ctx.count));
    return result.trim();
}
/** Render a single pattern block with conditionals and variable substitution. */
function renderBlock(block, vars) {
    let result = block;
    // {{#variable}}...{{/variable}} conditionals
    result = result.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, content) => {
        const val = vars[key];
        return val ? renderVars(content, vars) : '';
    });
    // Variable substitution
    result = renderVars(result, vars);
    return result;
}
/** Replace {{variable}} placeholders with values. */
function renderVars(text, vars) {
    return text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        const val = vars[key];
        return val != null ? String(val) : '';
    });
}
/** Clear template cache (tests / after user edits). */
export function resetTemplateCache() {
    _cache.clear();
}
//# sourceMappingURL=template.js.map