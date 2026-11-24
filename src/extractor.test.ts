import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOllamaRequestBody,
  ExtractionError,
  extractQuote,
  OLLAMA_RESPONSE_SCHEMA,
} from './extractor.ts';

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
