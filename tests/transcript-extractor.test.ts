/**
 * Transcript extractor unit tests — response parsing, confidence filtering,
 * category validation, slug normalization.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// We test the parsing logic by importing the module and calling internals.
// Since parseExtractionResponse is not exported, we test via the patterns
// that extractFromWindow would validate. We'll import the module and
// access VALID_CATEGORIES indirectly via valid/invalid category tests.

// Inline the parsing logic for testability (mirrors extractor.ts:166-199)
const VALID_CATEGORIES = [
  'decision',
  'gotcha',
  'reference',
  'implementation',
  'tradeoff',
  'arch',
  'api',
  'phase',
  'project',
  'schema',
  'security',
  'perf'
];

interface ParsedPattern {
  category: string;
  slug: string;
  description: string;
  body: string;
  confidence: number;
  sourceTurns: number[];
}

function parseExtractionResponse(response: string, confidenceThreshold: number): ParsedPattern[] {
  const jsonMatch = response.match(/\{[\s\S]*"patterns"[\s\S]*\}/);
  if (!jsonMatch) return [];

  let parsed: { patterns?: Array<Record<string, unknown>> };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed.patterns)) return [];

  return parsed.patterns
    .filter((p) => {
      if (typeof p.confidence !== 'number' || p.confidence < confidenceThreshold) return false;
      if (typeof p.category !== 'string' || !VALID_CATEGORIES.includes(p.category)) return false;
      if (typeof p.slug !== 'string' || !p.slug) return false;
      if (typeof p.description !== 'string' || !p.description) return false;
      if (typeof p.body !== 'string' || !p.body) return false;
      return true;
    })
    .map((p) => ({
      category: p.category as string,
      slug: (p.slug as string).slice(0, 50),
      description: p.description as string,
      body: p.body as string,
      confidence: p.confidence as number,
      sourceTurns: Array.isArray(p.source_turns) ? (p.source_turns as number[]) : []
    }));
}

// --- parseExtractionResponse ---

test('parseExtractionResponse: extracts valid patterns from clean JSON', () => {
  const response = JSON.stringify({
    patterns: [
      {
        category: 'decision',
        slug: 'use-pnpm',
        description: 'Project uses pnpm as package manager',
        body: 'Use pnpm for consistency. npm causes lockfile drift.',
        confidence: 0.85,
        source_turns: [0, 1]
      }
    ]
  });

  const patterns = parseExtractionResponse(response, 0.6);
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].category, 'decision');
  assert.equal(patterns[0].slug, 'use-pnpm');
  assert.deepEqual(patterns[0].sourceTurns, [0, 1]);
});

test('parseExtractionResponse: filters below confidence threshold', () => {
  const response = JSON.stringify({
    patterns: [
      {
        category: 'gotcha',
        slug: 'low-conf',
        description: 'Uncertain',
        body: 'Maybe',
        confidence: 0.4,
        source_turns: []
      },
      {
        category: 'gotcha',
        slug: 'high-conf',
        description: 'Certain',
        body: 'Definitely',
        confidence: 0.8,
        source_turns: []
      }
    ]
  });

  const patterns = parseExtractionResponse(response, 0.6);
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].slug, 'high-conf');
});

test('parseExtractionResponse: rejects invalid categories', () => {
  const response = JSON.stringify({
    patterns: [
      {
        category: 'pattern',
        slug: 'bad-cat',
        description: 'Invalid',
        body: 'Nope',
        confidence: 0.9,
        source_turns: []
      },
      {
        category: 'feedback',
        slug: 'also-bad',
        description: 'Banned',
        body: 'Nope',
        confidence: 0.9,
        source_turns: []
      },
      {
        category: 'implementation',
        slug: 'good-cat',
        description: 'Valid',
        body: 'Yes',
        confidence: 0.9,
        source_turns: []
      }
    ]
  });

  const patterns = parseExtractionResponse(response, 0.6);
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].slug, 'good-cat');
});

test('parseExtractionResponse: handles JSON in markdown code block', () => {
  const response = `Here are the patterns I found:

\`\`\`json
{
  "patterns": [
    {
      "category": "arch",
      "slug": "event-driven",
      "description": "System uses event-driven architecture",
      "body": "All inter-service communication goes through the event bus.",
      "confidence": 0.75,
      "source_turns": [2]
    }
  ]
}
\`\`\`

That's all I found.`;

  const patterns = parseExtractionResponse(response, 0.6);
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].category, 'arch');
});

test('parseExtractionResponse: returns empty for garbage input', () => {
  assert.deepEqual(parseExtractionResponse('not json at all', 0.6), []);
  assert.deepEqual(parseExtractionResponse('{"no_patterns": true}', 0.6), []);
  assert.deepEqual(parseExtractionResponse('', 0.6), []);
});

test('parseExtractionResponse: truncates slug to 50 chars', () => {
  const response = JSON.stringify({
    patterns: [
      {
        category: 'reference',
        slug: 'this-is-a-very-long-slug-that-exceeds-the-fifty-character-limit-significantly',
        description: 'Test',
        body: 'Test body',
        confidence: 0.9,
        source_turns: []
      }
    ]
  });

  const patterns = parseExtractionResponse(response, 0.6);
  assert.equal(patterns.length, 1);
  assert.ok(patterns[0].slug.length <= 50);
});

test('parseExtractionResponse: handles missing source_turns gracefully', () => {
  const response = JSON.stringify({
    patterns: [
      {
        category: 'gotcha',
        slug: 'no-source',
        description: 'No turns',
        body: 'Body',
        confidence: 0.9
      }
    ]
  });

  const patterns = parseExtractionResponse(response, 0.6);
  assert.equal(patterns.length, 1);
  assert.deepEqual(patterns[0].sourceTurns, []);
});

test('parseExtractionResponse: empty patterns array returns empty', () => {
  const response = JSON.stringify({ patterns: [] });
  const patterns = parseExtractionResponse(response, 0.6);
  assert.equal(patterns.length, 0);
});

test('parseExtractionResponse: rejects patterns with missing fields', () => {
  const response = JSON.stringify({
    patterns: [
      { category: 'decision', slug: 'no-desc', body: 'Has body', confidence: 0.9 },
      { category: 'decision', description: 'No slug', body: 'Has body', confidence: 0.9 },
      { category: 'decision', slug: 'no-body', description: 'Has desc', confidence: 0.9 }
    ]
  });

  const patterns = parseExtractionResponse(response, 0.6);
  assert.equal(patterns.length, 0);
});
