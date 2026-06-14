/**
 * Novelty signal — what has contextus recently injected for a project?
 *
 * Phase-3 capture (awareness-hook) needs to tell Claude: "when you propose a new
 * context file, here's what you ALREADY have patterns on — only propose if the
 * insight is genuinely new." That hint is the set of recently-injected pattern
 * filenames for the project, held in daemon memory (the daemon is the only
 * long-lived process that sees every injection).
 *
 * In-memory by design: this is a soft, session-scoped hint, not durable state. A
 * daemon restart resetting it is fine — the footer just won't list prior patterns
 * until the next injection. Bounded ring per project so memory can't grow without
 * limit on a long-lived shared daemon.
 *
 * recordInjection() is called by /query after a successful inject; noveltyFor()
 * is read by /novelty for the awareness hook. Pure module state — unit-testable
 * without the daemon.
 */

/** Max distinct recent patterns remembered per project. */
export const NOVELTY_WINDOW = 12;

/** project → recent injected pattern names, most-recent-LAST. */
const _recent = new Map<string, string[]>();

/**
 * Record that `patterns` were injected for `project`. De-dupes (a re-injected
 * pattern moves to most-recent) and trims to NOVELTY_WINDOW.
 */
export function recordInjection(project: string, patterns: string[]): void {
  if (patterns.length === 0) return;
  const cur = _recent.get(project) ?? [];
  // Drop any existing occurrences, then append (so repeats float to the end).
  const next = cur.filter((p) => !patterns.includes(p));
  next.push(...patterns);
  _recent.set(project, next.slice(-NOVELTY_WINDOW));
}

/** The recently-injected pattern names for a project (oldest→newest), or []. */
export function noveltyFor(project: string): string[] {
  return _recent.get(project) ?? [];
}

/** Reset all novelty state (tests / daemon restart). */
export function resetNovelty(): void {
  _recent.clear();
}
