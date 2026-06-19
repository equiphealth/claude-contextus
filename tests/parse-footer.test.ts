import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseUsedFooter } from '../lib/calibration/parse-footer.js';

describe('parseUsedFooter', () => {
  it('parses a single pattern', () => {
    const result = parseUsedFooter('Some response text.\n\nContext: used: calibration.md (0.74)');
    assert.deepEqual(result, [{ filename: 'calibration.md', score: 0.74 }]);
  });

  it('parses multiple patterns', () => {
    const result = parseUsedFooter(
      'Answer here.\n\nContext: used: quick-start.md (0.76), decisions/decision-injection-format.md (0.79)'
    );
    assert.deepEqual(result, [
      { filename: 'quick-start.md', score: 0.76 },
      { filename: 'decisions/decision-injection-format.md', score: 0.79 }
    ]);
  });

  it('returns empty for no footer', () => {
    const result = parseUsedFooter('Just a normal response with no footer.');
    assert.deepEqual(result, []);
  });

  it('returns empty for omitted footer (model used none)', () => {
    const result = parseUsedFooter('Response about sourdough.\n\nNo context was relevant here.');
    assert.deepEqual(result, []);
  });

  it('handles filenames with slashes', () => {
    const result = parseUsedFooter(
      'Done.\n\nContext: used: implementation/implementation-novelty-tracking.md (0.75)'
    );
    assert.deepEqual(result, [
      { filename: 'implementation/implementation-novelty-tracking.md', score: 0.75 }
    ]);
  });

  it('handles footer mid-text (not just at end)', () => {
    const result = parseUsedFooter(
      'Main answer.\n\nContext: used: foo.md (0.80)\n\nContext: propose: some-topic'
    );
    assert.deepEqual(result, [{ filename: 'foo.md', score: 0.8 }]);
  });

  it('handles three-decimal scores', () => {
    const result = parseUsedFooter('Ok.\n\nContext: used: bar.md (0.123)');
    assert.deepEqual(result, [{ filename: 'bar.md', score: 0.123 }]);
  });
});
