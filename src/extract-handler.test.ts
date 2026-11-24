import assert from 'node:assert/strict';
import test from 'node:test';
import { handleExtractRequest } from './extract-handler.ts';
import { ExtractionError, type extractQuote } from './extractor.ts';
import { TelemetryTracker } from './telemetry.ts';

const rawMessage = 'Hall rental is $5,000 CAD flat.';

const goodQuote = {
  vendorName: 'Test Hall',
  category: 'venue',
  events: ['Reception'],
  quoteKind: 'initial',
  currency: 'CAD',
  taxStatus: 'unknown',
  gratuityStatus: 'unknown',
  lineItems: [
    { label: 'Hall rental', pricingType: 'flat', amount: 5000, sourceExcerpt: 'Hall rental is $5,000 CAD flat' },
  ],
  openQuestions: [],
};

function fakeExtract(rawResponse: unknown): typeof extractQuote {
  return async () => ({
    rawResponse,
    rawMessage,
    latencyMs: 40,
    retryCount: 0,
    provider: 'mock',
    model: 'mock',
  });
}

test('provider failures are recorded in UI telemetry with latency and retries', async () => {
  const telemetry = new TelemetryTracker();
  await handleExtractRequest(
    { rawMessage, guestCount: 100, sessionId: 'q-1', options: { provider: 'mock' } },
    telemetry,
    fakeExtract(goodQuote),
  );
  const failing: typeof extractQuote = async () => {
    throw new ExtractionError({
      message: 'Gemini request failed (503)',
      kind: 'api_error',
      rawMessage,
      statusCode: 503,
      retryCount: 3,
      latencyMs: 35000,
    });
  };
  const outcome = await handleExtractRequest(
    { rawMessage, guestCount: 100, sessionId: 'q-2', options: { provider: 'gemini' } },
    telemetry,
    failing,
  );
  assert.equal(outcome.status, 502);
  assert.equal(outcome.session, undefined);
  const summary = telemetry.getSummary();
  assert.equal(summary.extractionAttempts, 2);
  assert.equal(summary.extractionSuccessRate, 0.5);
});

test('source warnings are carried onto the review session', async () => {
  const telemetry = new TelemetryTracker();
  const hallucinated = structuredClone(goodQuote);
  hallucinated.lineItems.push({
    label: 'Cleaning fee',
    pricingType: 'flat',
    amount: 400,
    sourceExcerpt: 'Cleaning fee is $400',
  });
  const outcome = await handleExtractRequest(
    { rawMessage, guestCount: 100, sessionId: 'q-3', options: { provider: 'mock' } },
    telemetry,
    fakeExtract(hallucinated),
  );
  assert.equal(outcome.status, 200);
  assert.ok(outcome.session);
  assert.ok(outcome.session.sourceWarnings.length > 0);
  assert.equal(outcome.session.sourceWarningsAcknowledged, false);
});
