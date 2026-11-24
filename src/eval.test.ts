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

test('keeps API availability, schema validity, extraction accuracy, end-to-end success, and no-retry latency distinct', () => {
  const passScore = gradeExtraction(
    {
      ...baseCase,
      expected: { ...baseCase.expected, currency: 'CAD', unknownItemLabels: [], minOpenQuestions: 0 },
      rawMessage: 'Summit Hall (CAD): $55/person (180-person minimum). AV is $300.',
    },
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
          label: 'AV',
          pricingType: 'flat',
          amount: 300,
          sourceExcerpt: 'AV is $300',
        },
      ],
      openQuestions: [],
    },
    6200,
    1,
    undefined,
    1100,
  );
  const apiOutage = scoreExtractionError(
    baseCase,
    new ExtractionError({
      message: 'HTTP 503: Unavailable',
      kind: 'api_error',
      rawMessage: baseCase.rawMessage,
      statusCode: 503,
      retryCount: 3,
      latencyMs: 36000,
      latencyWithoutRetriesMs: 900,
    }),
  );

  const summary = summarizeScores([passScore, apiOutage]);
  assert.equal(summary.apiAvailabilityRate, 0.5); // 1/2 API responses
  assert.equal(summary.schemaValidityRate, 1); // 1/1 completed responses valid
  assert.equal(summary.extractionAccuracyRate, 1); // 1/1 completed responses accurate
  assert.equal(summary.endToEndSuccessRate, 0.5); // 1/2 overall
  assert.equal(summary.avgLatency, 21100); // (6200 + 36000) / 2 incl. retries
  assert.equal(summary.avgLatencyWithoutRetries, 1100); // completed response excl. retries
});

test('grades expectedPriceConflictDiscrepancy strictly without loosening subtotal check', () => {
  const conflictEvalCase: EvalCase = {
    id: 'conflict-check',
    split: 'dev',
    description: 'Conflicting DM vs contract',
    rawMessage: 'Studio (CAD): DM agreed to $3,200 flat, PDF contract says $3,600.',
    expected: {
      category: 'photographer',
      currency: 'CAD',
      quoteKind: 'revision',
      knownSubtotal: 3200,
      unknownItemLabels: [],
      minOpenQuestions: 1,
      expectedPriceConflictDiscrepancy: 400,
    },
  };

  const doubleCounted = gradeExtraction(
    conflictEvalCase,
    {
      vendorName: 'Studio',
      category: 'photographer',
      events: ['Wedding'],
      quoteKind: 'revision',
      currency: 'CAD',
      taxStatus: 'unknown',
      gratuityStatus: 'unknown',
      lineItems: [
        { label: 'DM rate', pricingType: 'flat', amount: 3200, sourceExcerpt: 'DM agreed to $3,200 flat' },
        { label: 'Contract rate', pricingType: 'flat', amount: 3600, sourceExcerpt: 'PDF contract says $3,600' },
      ],
      openQuestions: [
        { question: 'Which price applies?', reason: 'conflict', sourceExcerpt: 'PDF contract says $3,600' },
      ],
    },
    500,
    0,
  );
  assert.equal(doubleCounted.passed, false);
  assert.equal(doubleCounted.criticalFinancialError, true);

  const properConflict = gradeExtraction(
    conflictEvalCase,
    {
      vendorName: 'Studio',
      category: 'photographer',
      events: ['Wedding'],
      quoteKind: 'revision',
      currency: 'CAD',
      taxStatus: 'unknown',
      gratuityStatus: 'unknown',
      lineItems: [
        {
          label: 'Wedding photography',
          pricingType: 'flat',
          amount: 3200,
          chargeType: 'mandatory',
          conflictingOptions: [
            { sourceLabel: 'DM', pricingType: 'flat', amount: 3200, sourceExcerpt: 'DM agreed to $3,200 flat' },
            { sourceLabel: 'Contract', pricingType: 'flat', amount: 3600, sourceExcerpt: 'PDF contract says $3,600' },
          ],
          sourceExcerpt: 'DM agreed to $3,200 flat',
        },
      ],
      openQuestions: [
        { question: 'Which price applies ($400 difference)?', reason: 'conflict', sourceExcerpt: 'PDF contract says $3,600' },
      ],
    },
    500,
    0,
  );
  assert.equal(properConflict.passed, true);
});
