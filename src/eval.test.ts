import assert from 'node:assert/strict';
import test from 'node:test';
import { gradeExtraction, scoreExtractionError, summarizeScores } from './eval.ts';
import { ExtractionError } from './extractor.ts';
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

test('does not crash or count a financial error when model omits openQuestions', () => {
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
          label: 'AV fee',
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
    },
    100,
    0,
  );

  assert.equal(res.passed, false);
  assert.ok(res.schemaErrors.some((e) => e.includes('openQuestions')));
  assert.equal(res.criticalFinancialError, false);
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

test('classifies parse_error separately from api_error in summary metrics', () => {
  const parseErr = new ExtractionError({
    message: 'Failed to parse Gemini JSON: Unexpected token',
    kind: 'parse_error',
    rawMessage: baseCase.rawMessage,
    retryCount: 0,
    latencyMs: 420,
  });
  const apiErr = new ExtractionError({
    message: 'HTTP 503: Service Unavailable',
    kind: 'api_error',
    rawMessage: baseCase.rawMessage,
    statusCode: 503,
    retryCount: 3,
    latencyMs: 35000,
  });

  const parseScore = scoreExtractionError(baseCase, parseErr);
  const apiScore = scoreExtractionError(baseCase, apiErr);

  assert.equal(parseScore.apiError, undefined);
  assert.ok(parseScore.parseError?.includes('Failed to parse Gemini JSON'));
  assert.equal(parseScore.schemaErrors.length, 1);

  assert.ok(apiScore.apiError?.includes('HTTP 503'));
  assert.equal(apiScore.parseError, undefined);

  const summary = summarizeScores([parseScore, apiScore]);
  assert.equal(summary.total, 2);
  assert.equal(summary.apiErrors, 1);
  assert.equal(summary.parseErrors, 1);
  assert.equal(summary.completed, 1);
  assert.equal(summary.schemaCompliant, 0);
  assert.equal(summary.financialErrors, 0);
});
