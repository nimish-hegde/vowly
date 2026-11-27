import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateQuoteTotal } from './calculator.ts';
import {
  buildOllamaRequestBody,
  ExtractionError,
  extractQuote,
  normalizeProviderResponse,
  OLLAMA_RESPONSE_SCHEMA,
} from './extractor.ts';
import type { ExtractedQuote } from './types.ts';

test('buildOllamaRequestBody supplies complete output contract and JSON schema', () => {
  const body = buildOllamaRequestBody('qwen2.5:7b', 'Sample venue quote');

  assert.equal(body.model, 'qwen2.5:7b');
  assert.equal(body.stream, false);
  assert.deepEqual(body.format, OLLAMA_RESPONSE_SCHEMA);

  const required = body.format.required;
  for (const field of [
    'vendorName',
    'category',
    'events',
    'quoteKind',
    'currency',
    'taxStatus',
    'gratuityStatus',
    'lineItems',
    'openQuestions',
  ]) {
    assert.ok(required.includes(field as (typeof required)[number]), `missing required field ${field}`);
    assert.ok(body.system.includes(field), `system prompt missing ${field}`);
  }
});

test('extractQuote sends structured schema to Ollama and parses response', async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | undefined;

  const sampleQuote = {
    vendorName: 'Juniper Hall',
    category: 'venue',
    events: ['Reception'],
    quoteKind: 'initial',
    currency: 'CAD',
    taxStatus: 'unknown',
    gratuityStatus: 'unknown',
    lineItems: [],
    openQuestions: [],
  };

  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ response: JSON.stringify(sampleQuote) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const res = await extractQuote('Juniper Hall CAD quote', { provider: 'ollama' });
    assert.equal(res.provider, 'ollama');
    assert.deepEqual(res.rawResponse, sampleQuote);
    assert.deepEqual(capturedBody?.format, OLLAMA_RESPONSE_SCHEMA);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('extractQuote preserves Gemini responseSchema and throws parse_error on malformed HTTP 200 JSON', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  let capturedBody: Record<string, unknown> | undefined;

  process.env.GEMINI_API_KEY = 'test-key';
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{bad json' }] } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => extractQuote('Juniper Hall CAD quote', { provider: 'gemini' }),
      (err: unknown) => {
        assert.ok(err instanceof ExtractionError);
        assert.equal(err.kind, 'parse_error');
        return true;
      },
    );
    const genConfig = capturedBody?.generationConfig as Record<string, unknown> | undefined;
    assert.equal(genConfig?.responseMimeType, 'application/json');
    assert.ok(genConfig?.responseSchema);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});

test('Ollama and Gemini schemas include conflictingOptions, chargeType, and unknown category', () => {
  const categories = OLLAMA_RESPONSE_SCHEMA.properties.category.enum;
  assert.ok(categories.includes('unknown'));
  const lineProps = OLLAMA_RESPONSE_SCHEMA.properties.lineItems.items.properties;
  assert.ok('chargeType' in lineProps);
  assert.ok('conflictingOptions' in lineProps);
});

test('Gemini schema requires nullable taxPercent, gratuityPercent, and gratuityBasis without breaking normalization', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  let capturedSchema: { required?: string[]; properties?: Record<string, { nullable?: boolean }> } | undefined;

  process.env.GEMINI_API_KEY = 'test-key';
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      generationConfig?: { responseSchema?: typeof capturedSchema };
    };
    capturedSchema = body.generationConfig?.responseSchema;
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    vendorName: 'Test Photo',
                    category: 'photographer',
                    events: ['Wedding'],
                    quoteKind: 'initial',
                    currency: 'USD',
                    taxStatus: 'excluded',
                    taxPercent: null,
                    gratuityStatus: 'unknown',
                    gratuityPercent: null,
                    gratuityBasis: null,
                    packages: [],
                    lineItems: [],
                    paymentTerms: { methodRule: 'unknown' },
                    openQuestions: [],
                  }),
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    const res = await extractQuote('Test Photo $2,000 USD plus tax', { provider: 'gemini' });
    assert.ok(capturedSchema?.required?.includes('taxPercent'));
    assert.ok(capturedSchema?.required?.includes('gratuityPercent'));
    assert.ok(capturedSchema?.required?.includes('gratuityBasis'));
    assert.equal(capturedSchema?.properties?.taxPercent?.nullable, true);
    assert.equal(capturedSchema?.properties?.gratuityPercent?.nullable, true);
    assert.equal(capturedSchema?.properties?.gratuityBasis?.nullable, true);

    const parsed = res.rawResponse as Record<string, unknown>;
    assert.equal(parsed.taxPercent, null);
    assert.equal(parsed.gratuityPercent, null);
    assert.equal(parsed.gratuityBasis, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});

test('normalizeProviderResponse preserves multi-package explicit null overrides and folds single-package tax/gratuity safely', () => {
  const multiPkg = normalizeProviderResponse({
    taxStatus: 'excluded',
    taxPercent: 13,
    gratuityStatus: 'excluded',
    gratuityPercent: 15,
    gratuityBasis: 'entire_subtotal',
    packages: [
      {
        id: 'tier-a',
        name: 'Tier A',
        pricingType: 'flat',
        amount: 4000,
        taxStatus: 'included',
        taxPercent: null,
        gratuityStatus: 'excluded',
        gratuityPercent: null,
        gratuityBasis: null,
        sourceExcerpt: 'Tier A $4,000',
      },
      {
        id: 'tier-b',
        name: 'Tier B',
        pricingType: 'flat',
        amount: 5500,
        sourceExcerpt: 'Tier B $5,500',
      },
    ],
    lineItems: [],
  }) as { packages: Array<Record<string, unknown>> };

  // Multi-package explicit null overrides MUST remain untouched
  assert.equal(multiPkg.packages[0]?.taxStatus, 'included');
  assert.equal(multiPkg.packages[0]?.taxPercent, null);
  assert.equal(multiPkg.packages[0]?.gratuityPercent, null);
  assert.equal(multiPkg.packages[0]?.gratuityBasis, undefined);

  // Single-package folding propagates tax/gratuity only when top-level was unset/unknown
  const singlePkg = normalizeProviderResponse({
    taxStatus: 'unknown',
    taxPercent: null,
    gratuityStatus: 'unknown',
    gratuityPercent: null,
    gratuityBasis: null,
    packages: [
      {
        id: 'only-pkg',
        name: 'Solo Banquet',
        pricingType: 'per_person',
        amount: 80,
        taxStatus: 'excluded',
        taxPercent: 13,
        gratuityStatus: 'excluded',
        gratuityPercent: 16,
        gratuityBasis: 'food_subtotal',
        sourceExcerpt: 'Solo Banquet $80/pp',
      },
    ],
    lineItems: [],
  }) as Record<string, unknown>;

  assert.equal(singlePkg.taxStatus, 'excluded');
  assert.equal(singlePkg.taxPercent, 13);
  assert.equal(singlePkg.gratuityStatus, 'excluded');
  assert.equal(singlePkg.gratuityPercent, 16);
  assert.equal(singlePkg.gratuityBasis, 'food_subtotal');

  // Mismatched provisional pricingType on a cross-model price conflict aligns to its matching option
  const conflictFixed = normalizeProviderResponse({
    lineItems: [
      {
        label: 'Reception catering',
        pricingType: 'per_person',
        amount: 2400,
        conflictingOptions: [
          { sourceLabel: 'Text', pricingType: 'flat', amount: 2400, sourceExcerpt: '$2,400 flat' },
          { sourceLabel: 'Email', pricingType: 'per_person', amount: 42, sourceExcerpt: '$42 per person' },
        ],
        sourceExcerpt: '$2,400 flat',
      },
    ],
  }) as { lineItems: Array<Record<string, unknown>> };
  assert.equal(conflictFixed.lineItems[0]?.pricingType, 'flat');
});

test('Codex P1: folding a single package preserves explicit unknown gratuityBasis and blocks completion', () => {
  const folded = normalizeProviderResponse({
    vendorName: 'Solo Hall',
    category: 'venue',
    events: ['Reception'],
    quoteKind: 'initial',
    currency: 'CAD',
    taxStatus: 'unknown',
    taxPercent: null,
    gratuityStatus: 'unknown',
    gratuityPercent: null,
    gratuityBasis: null,
    packages: [
      {
        id: 'solo',
        name: 'Solo Package',
        pricingType: 'flat',
        amount: 1000,
        gratuityStatus: 'excluded',
        gratuityPercent: 15,
        gratuityBasis: 'unknown',
        inclusions: [],
        sourceExcerpt: 'Solo Package $1,000 plus 15% gratuity',
      },
    ],
    lineItems: [],
    paymentTerms: { methodRule: 'unknown' },
    openQuestions: [],
  }) as ExtractedQuote;

  assert.equal(folded.gratuityStatus, 'excluded');
  assert.equal(folded.gratuityPercent, 15);
  assert.equal(folded.gratuityBasis, 'unknown');

  const calc = calculateQuoteTotal(folded);
  assert.equal(calc.knownSubtotal, 1000);
  assert.equal(calc.gratuityAmount, null);
  assert.equal(calc.gratuityUnresolved, true);
  assert.equal(calc.isEstimateComplete, false);
});
