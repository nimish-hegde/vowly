import assert from 'node:assert/strict';
import test from 'node:test';
import { gradeExtraction } from './eval.ts';
import type { EvalCase } from './types.ts';

const baseCase: EvalCase = {
  id: 'test-case',
  split: 'dev',
  description: 'Sample test case',
  rawMessage: 'Summit Hall: $55/person (180-person minimum). AV is $300. Security fee is TBD.',
  calcContext: { guestCount: 180 },
  expected: {
    category: 'venue',
    currency: 'UNKNOWN',
    quoteKind: 'initial',
    knownSubtotal: 10200,
    unknownItemLabels: ['security'],
    minOpenQuestions: 1,
  },
};

test('flags guessed currency as a release blocker', () => {
  const res = gradeExtraction(
    baseCase,
    {
      vendorName: 'Summit Hall',
      category: 'venue',
      events: ['Reception'],
      quoteKind: 'initial',
      currency: 'CAD',
      taxStatus: 'unknown',
      gratuityStatus: 'unknown',
      lineItems: [
        {
          label: 'Catering',
          pricingType: 'per_person',
          amount: 55,
          minGuests: 180,
          sourceExcerpt: '$55/person (180-person minimum)',
        },
        {
          label: 'Audio-visual fee',
          pricingType: 'flat',
          amount: 300,
          sourceExcerpt: 'AV is $300',
        },
        {
          label: 'Security fee',
          pricingType: 'unknown',
          amount: null,
          sourceExcerpt: 'Security fee is TBD',
        },
      ],
      openQuestions: [
        {
          question: 'Confirm security fee',
          reason: 'missing_price',
          sourceExcerpt: 'Security fee is TBD',
        },
      ],
    },
    100,
    0,
  );

  assert.equal(res.passed, false);
  assert.equal(res.unsupportedCurrencyAssumption, true);
  assert.ok(res.releaseBlockers.some((b) => b.includes('Unsupported currency assumption')));
});

test('does not crash when model omits required openQuestions array', () => {
  const res = gradeExtraction(
    baseCase,
    {
      vendorName: 'Summit Hall',
      category: 'venue',
      events: ['Reception'],
      quoteKind: 'initial',
      currency: 'UNKNOWN',
      taxStatus: 'unknown',
      gratuityStatus: 'unknown',
      lineItems: [],
    },
    100,
    0,
  );

  assert.equal(res.passed, false);
  assert.ok(res.schemaErrors.some((e) => e.includes('openQuestions')));
});

test('marks wrong subtotal as a critical financial error', () => {
  const res = gradeExtraction(
    baseCase,
    {
      vendorName: 'Summit Hall',
      category: 'venue',
      events: ['Reception'],
      quoteKind: 'initial',
      currency: 'UNKNOWN',
      taxStatus: 'unknown',
      gratuityStatus: 'unknown',
      lineItems: [
        {
          label: 'Catering',
          pricingType: 'per_person',
          amount: 55,
          minGuests: 180,
          sourceExcerpt: '$55/person (180-person minimum)',
        },
        {
          label: 'Security fee',
          pricingType: 'unknown',
          amount: null,
          sourceExcerpt: 'Security fee is TBD',
        },
      ],
      openQuestions: [
        {
          question: 'Confirm security fee',
          reason: 'missing_price',
          sourceExcerpt: 'Security fee is TBD',
        },
      ],
    },
    100,
    0,
  );

  assert.equal(res.passed, false);
  assert.equal(res.criticalFinancialError, true);
  assert.ok(res.releaseBlockers.some((b) => b.includes('Critical financial error')));
});
