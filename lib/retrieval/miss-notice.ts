/**
 * Retrieval-miss notice builder — generates targeted capture prompts when a query
 * nearly matched but didn't clear the injection floor. This replaces the passive
 * "propose something if you notice it's new" approach with evidence-driven prompting:
 * Claude sees *what* was almost found and at *what confidence*, enabling either a
 * specific capture proposal or a question to the user about missing context.
 */

/**
 * Build the notice injected on a near-miss (best score > 0.25 but < floor).
 * Returns empty string for non-near-misses (bare misses with no data).
 */
export function buildRetrievalMissNotice(
  bestScore: number,
  floor: number,
  nearTopics: string[]
): string {
  const topicList = nearTopics.length > 0 ? nearTopics.join(', ') : 'unknown';
  const gap = ((floor - bestScore) * 100).toFixed(0);
  return (
    `[contextus — retrieval gap detected]\n` +
    `Your prompt nearly matched existing context but fell short of the injection threshold ` +
    `(best: ${bestScore.toFixed(2)}, floor: ${floor}, gap: ${gap}%). ` +
    `Nearest topics: ${topicList}.\n\n` +
    `This means either:\n` +
    `1. The knowledge exists but the context file doesn't cover this angle well enough\n` +
    `2. This is a genuinely new topic that should be captured\n\n` +
    `ACTION: If your response surfaces reusable knowledge (a decision, gotcha, pattern, or workflow), ` +
    `end it with "Context: propose: <topic-name>" and use /create-context if accepted. ` +
    `If you need context that should exist but doesn't, ask the user: ` +
    `"Should we capture [topic] as a context pattern for future sessions?"\n\n` +
    `Reminder: injection only fires once per turn, keyed to this prompt. If this task ` +
    `later drifts into a subtopic this prompt didn't hint at, don't wait for another ` +
    `automatic injection — run /context-search "<query>" yourself.`
  );
}

/**
 * Determine whether a no-inject event qualifies as a "near miss" worth surfacing.
 * Requirements: score above noise floor (0.625 = unrelated but not pure random)
 * and at least one dropped candidate.
 */
export function isNearMiss(bestScore: number, droppedCount: number): boolean {
  return bestScore > 0.625 && droppedCount > 0;
}

/**
 * Extract human-readable topic names from floor-dropped pattern filenames.
 * Strips extensions and converts dashes/underscores to spaces.
 */
export function extractNearTopics(
  floorDropped: Array<{ pattern: string; similarity: number }>
): string[] {
  return floorDropped
    .slice(0, 3)
    .map((d) => d.pattern.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '));
}
