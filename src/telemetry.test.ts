import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateExtractionCostUsd, getModelPricingRates, TelemetryTracker } from './telemetry.ts';

test('TelemetryTracker summarizes extraction and review metrics accurately', () => {
  const tracker = new TelemetryTracker();

  tracker.recordExtraction({
    provider: 'gemini',
    model: 'gemini-flash-lite-latest',
    success: true,
    latencyMs: 1200,
    retryCount: 0,
    tokenUsage: { promptTokens: 500, outputTokens: 200, totalTokens: 700 },
    unresolvedQuestions: 2,
  });

  tracker.recordExtraction({
    provider: 'gemini',
    model: 'gemini-flash-lite-latest',
    success: false,
    latencyMs: 3600,
    retryCount: 1,
    unresolvedQuestions: 0,
    errorKind: 'api_error',
  });

  tracker.recordReviewDecision({
    quoteId: 'q-1',
    decision: 'approved',
    correctionsByField: { amount: 2, currency: 1 },
    unresolvedQuestionsRemaining: 1,
  });

  tracker.recordReviewDecision({
    quoteId: 'q-2',
    decision: 'dismissed',
    correctionsByField: { amount: 1 },
    unresolvedQuestionsRemaining: 0,
  });

  const summary = tracker.getSummary();
  assert.equal(summary.extractionAttempts, 2);
  assert.equal(summary.extractionSuccesses, 1);
  assert.equal(summary.extractionSuccessRate, 0.5);
  assert.equal(summary.avgLatencyMs, 2400);
  assert.equal(summary.totalRetries, 1);
  assert.equal(summary.promptTokens, 500);
  assert.equal(summary.outputTokens, 200);
  assert.equal(summary.totalTokens, 700);
  assert.equal(
    summary.estimatedCostUsd,
    estimateExtractionCostUsd({ promptTokens: 500, outputTokens: 200, totalTokens: 700 }),
  );
  assert.deepEqual(summary.correctionsByField, { amount: 3, currency: 1 });
  assert.equal(summary.totalCorrections, 4);
  assert.equal(summary.unresolvedQuestions, 1);
  assert.equal(summary.quotesReviewed, 2);
  assert.equal(summary.quotesApproved, 1);
  assert.equal(summary.quoteApprovalRate, 0.5);
});

test('unresolvedQuestions includes pending quotes even after another quote is approved', () => {
  const tracker = new TelemetryTracker();

  // Extract and approve q-1 with 0 open questions
  tracker.recordExtraction({
    quoteId: 'q-1',
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    success: true,
    latencyMs: 900,
    retryCount: 0,
    unresolvedQuestions: 0,
  });
  tracker.recordReviewDecision({
    quoteId: 'q-1',
    decision: 'approved',
    correctionsByField: {},
    unresolvedQuestionsRemaining: 0,
  });

  // Extract q-2 (still pending review) with 3 open questions
  tracker.recordExtraction({
    quoteId: 'q-2',
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    success: true,
    latencyMs: 1100,
    retryCount: 0,
    unresolvedQuestions: 3,
  });
  assert.equal(tracker.getSummary().unresolvedQuestions, 3);

  // Resolving 1 question on pending q-2 updates the total to 2
  tracker.updateUnresolvedQuestions('q-2', 2);
  assert.equal(tracker.getSummary().unresolvedQuestions, 2);
});

test('getModelPricingRates and estimateExtractionCostUsd match benchmark paid rates', () => {
  assert.deepEqual(getModelPricingRates('gemini-3.5-flash-lite'), {
    inputUsdPerMillion: 0.3,
    outputUsdPerMillion: 2.5,
  });
  assert.deepEqual(getModelPricingRates('gemini-flash-lite-latest'), {
    inputUsdPerMillion: 0.3,
    outputUsdPerMillion: 2.5,
  });
  assert.deepEqual(getModelPricingRates('gemini-3.8-flash'), {
    inputUsdPerMillion: 0.75,
    outputUsdPerMillion: 3.75,
    note: 'promotional pricing',
  });
  assert.deepEqual(getModelPricingRates('gemini-4-hydrogen'), {
    inputUsdPerMillion: 1.5,
    outputUsdPerMillion: 7.5,
  });
  assert.deepEqual(getModelPricingRates('gemini-4-neon'), {
    inputUsdPerMillion: 3.0,
    outputUsdPerMillion: 15.0,
  });

  const usage = { promptTokens: 1_000_000, outputTokens: 1_000_000, totalTokens: 2_000_000 };
  assert.equal(estimateExtractionCostUsd(usage, 'gemini-3.5-flash-lite'), 2.8);
  assert.equal(estimateExtractionCostUsd(usage, 'gemini-3.8-flash'), 4.5);
  assert.equal(estimateExtractionCostUsd(usage, 'gemini-4-hydrogen'), 9.0);
  assert.equal(estimateExtractionCostUsd(usage, 'gemini-4-neon'), 18.0);
});
