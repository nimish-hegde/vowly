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

test('Codex P1: package-level taxPercent and gratuityPercent overrides fail endToEndPassed and flag criticalFinancialError', () => {
  const t02 = getCase('T02');
  const bad = structuredClone(t02.mockExtraction);
  bad.packages![0]!.taxPercent = 99;
  bad.packages![0]!.gratuityPercent = 99;

  const result = gradeBenchmarkCase(t02, bad, 100, 100, 0, undefined, 1);
  assert.equal(result.endToEndPassed, false);
  assert.equal(result.criticalFinancialError, true);
  assert.ok(result.aiExtractionErrorsRequiringCorrection >= 2);
  assert.ok(result.releaseBlockers.some((b) => b.includes('Silver Package') && b.includes('taxPercent')));
  assert.ok(result.releaseBlockers.some((b) => b.includes('Silver Package') && b.includes('gratuityPercent')));
});

test('Codex P2: partial decimal matches ($85 vs $85.50, 5% vs 15.5%) fail financial-token grounding', () => {
  assert.equal(
    isExcerptGroundedInSource('Package $85 CAD per person', 'Package $85.50 CAD per person'),
    false,
  );
  assert.equal(
    isExcerptGroundedInSource('Service charge 5% applies', 'Service charge 15.5% applies'),
    false,
  );
  assert.equal(
    isExcerptGroundedInSource('Package $85.50 CAD per person', 'Package $85.50 CAD per person'),
    true,
  );
});

test('Codex P2: omitting an expected mandatory TBD fee (T08 rigging fee) flags criticalFinancialError and releaseBlockers', () => {
  const t08 = getCase('T08');
  const bad = structuredClone(t08.mockExtraction);
  bad.lineItems = bad.lineItems.filter((li) => !li.label.toLowerCase().includes('rigging'));

  const result = gradeBenchmarkCase(t08, bad, 100, 100, 0, undefined, 1);
  assert.equal(result.endToEndPassed, false);
  assert.equal(result.criticalFinancialError, true);
  assert.equal(result.missedChargesCount, 1);
  assert.ok(result.releaseBlockers.some((b) => b.includes('rigging')));
});

test('Issue #21: unresolved price conflict with higher provisional candidate passes when both options and exact discrepancy are preserved', () => {
  const t07 = getCase('T07');
  const higherProvisional = structuredClone(t07.mockExtraction);
  higherProvisional.lineItems[0]!.pricingType = 'per_person';
  higherProvisional.lineItems[0]!.amount = 45;
  higherProvisional.lineItems[0]!.sourceExcerpt = 'Marriott reception dinner buffet: $45 per person';

  const result = gradeBenchmarkCase(t07, higherProvisional, 100, 100, 0, undefined, 1);
  assert.equal(result.endToEndPassed, true);
  assert.equal(result.criticalFinancialError, false);
  assert.equal(result.inventedChargesCount, 0);

  // Double-counting or dropping conflictingOptions must still fail critically
  const undetected = structuredClone(higherProvisional);
  delete undetected.lineItems[0]!.conflictingOptions;
  const badResult = gradeBenchmarkCase(t07, undetected, 100, 100, 0, undefined, 1);
  assert.equal(badResult.endToEndPassed, false);
  assert.equal(badResult.criticalFinancialError, true);

  // Codex P2: retaining lower provisional candidate ($1,800) while adding a spurious $2,700 fee
  // equal to the discrepancy must FAIL critically and count as an invented charge
  const spuriousExtra = structuredClone(t07.mockExtraction);
  spuriousExtra.lineItems.push({
    label: 'Spurious extra catering fee',
    pricingType: 'flat',
    amount: 2700,
    chargeType: 'mandatory',
    sourceExcerpt: 'Marriott reception dinner buffet: $45 per person',
  });
  const spuriousResult = gradeBenchmarkCase(t07, spuriousExtra, 100, 100, 0, undefined, 1);
  assert.equal(spuriousResult.endToEndPassed, false);
  assert.equal(spuriousResult.criticalFinancialError, true);
  assert.equal(spuriousResult.inventedChargesCount, 1);

  // Codex P2: preceding optional item must NOT break higher-provisional conflict line lookup
  const optionalBeforeHigher = structuredClone(higherProvisional);
  optionalBeforeHigher.lineItems.unshift({
    label: 'Optional tasting',
    pricingType: 'flat',
    amount: 200,
    chargeType: 'optional',
    optionalAddon: true,
    sourceExcerpt: 'catering is $1,800 flat for the evening.',
  });
  const optResult = gradeBenchmarkCase(t07, optionalBeforeHigher, 100, 100, 0, undefined, 1);
  assert.equal(optResult.endToEndPassed, true);
  assert.equal(optResult.criticalFinancialError, false);
});
