import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import type { BenchmarkCase } from './generate-multimodal-holdout.ts';
import { gradeBenchmarkCase, isExcerptGroundedInSource } from './run-model-benchmark.ts';

const cases = JSON.parse(
  readFileSync(resolve('eval-data/held-out-v3-multimodal/cases.json'), 'utf8'),
) as BenchmarkCase[];

function getCase(id: string): BenchmarkCase {
  const found = cases.find((c) => c.id === id);
  assert.ok(found, `Case ${id} not found`);
  return found;
}

test('Codex P1: wrong taxPercent or gratuityPercent fails endToEndPassed and flags criticalFinancialError', () => {
  const t01 = getCase('T01');
  const bad = structuredClone(t01.mockExtraction);
  bad.taxPercent = 99;
  bad.gratuityPercent = 99;

  const result = gradeBenchmarkCase(t01, bad, 100, 100, 0, undefined, 1);
  assert.equal(result.endToEndPassed, false);
  assert.equal(result.criticalFinancialError, true);
  assert.ok(result.releaseBlockers.some((b) => b.includes('taxPercent')));
  assert.ok(result.releaseBlockers.some((b) => b.includes('gratuityPercent')));
});

test('Codex P1: wrong gratuityBasis fails endToEndPassed and flags criticalFinancialError', () => {
  const t03 = getCase('T03');
  const bad = structuredClone(t03.mockExtraction);
  bad.gratuityBasis = 'entire_subtotal'; // expected food_subtotal

  const result = gradeBenchmarkCase(t03, bad, 100, 100, 0, undefined, 1);
  assert.equal(result.endToEndPassed, false);
  assert.equal(result.criticalFinancialError, true);
  assert.ok(result.releaseBlockers.some((b) => b.includes('gratuityBasis')));
});

test('Codex P2: fabricated price in image/PDF sourceExcerpt fails multimodal grounding', () => {
  const i01 = getCase('I01');
  const bad = structuredClone(i01.mockExtraction);
  bad.lineItems[0]!.sourceExcerpt = 'Classic Wedding Buffet & Bar Package: $99 CAD per person';

  assert.equal(
    isExcerptGroundedInSource(bad.lineItems[0]!.sourceExcerpt, i01.documentText),
    false,
  );
  const result = gradeBenchmarkCase(i01, bad, 100, 100, 0, undefined, 1);
  assert.equal(result.groundingVerifiedExcerpts, 0);
  assert.equal(result.groundingTotalExcerpts, 1);
});

test('Codex P2: grounding requires local span co-occurrence rather than document-wide bag of words', () => {
  const source = [
    'Royal Package $58 CAD / person',
    'Minimum guarantee: 150 guests',
    '- 3 Passed Appetizers',
    '- 4 Main Entrees + Naan & Rice',
    'In-House AV & Projector Package - $800 CAD flat.',
    'All packages subject to 13% HST.',
  ].join('\n');

  assert.equal(isExcerptGroundedInSource('Royal Package $58 CAD / person', source), true);
  // Fabricated hybrid mixing Royal Package with $800 from a distant line must fail
  assert.equal(isExcerptGroundedInSource('Royal Package $800 CAD / person', source), false);
  // Digit substring must not false-match ("5" must not match "150" or "58")
  assert.equal(isExcerptGroundedInSource('Minimum guarantee: 5 guests', source), false);
});
