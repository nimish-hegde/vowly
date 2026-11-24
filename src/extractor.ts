import type { EvalCase, ExtractedQuote, TokenUsage } from './types.ts';

export type ProviderName = 'mock' | 'ollama' | 'gemini';

export interface ExtractResult {
  rawResponse: unknown;
  rawMessage: string;
  latencyMs: number;
  retryCount: number;
  provider: ProviderName;
  model: string;
  resolvedModelVersion?: string;
  tokenUsage?: TokenUsage;
}

export class ExtractionError extends Error {
  readonly kind: 'api_error' | 'parse_error';
  readonly rawMessage: string;
  readonly statusCode?: number;
  readonly retryCount: number;
  readonly latencyMs: number;

  constructor(params: {
    message: string;
    kind: 'api_error' | 'parse_error';
    rawMessage: string;
    statusCode?: number;
    retryCount: number;
    latencyMs: number;
  }) {
    super(params.message);
    this.name = 'ExtractionError';
    this.kind = params.kind;
    this.rawMessage = params.rawMessage;
    this.statusCode = params.statusCode;
    this.retryCount = params.retryCount;
    this.latencyMs = params.latencyMs;
  }
}

const SYSTEM_PROMPT = `You extract structured wedding vendor quote facts from raw messages (emails, WhatsApp, Instagram, notes).

Follow these rules strictly:
1. Return valid JSON only. Omit optional fields when not stated. Never output "undefined".
2. Always include the required arrays: "events", "lineItems", and "openQuestions" (use [] if none).
3. Never invent a price or currency:
   - If the message only uses "$" without explicitly stating CAD, CA$, USD, or US$, set "currency" to "UNKNOWN". Never guess currency from city names, taxes like HST, or venue names.
   - If a charge says TBD, "extra charge", or "pricing on request" with no number, include it in "lineItems" with "pricingType": "unknown" and "amount": null, and add a matching entry in "openQuestions".
4. Classify staffing ratios and conditional pricing accurately:
   - When a fee scales by guest count blocks (for example, "$495 each, up to 150 guests per bartender" or "$300 per bartender, 1 per 150 guests"), use "pricingType": "per_guest_ratio", set "amount" to the per-unit price, and set "ratioGuests" to the guest block size (e.g., 150). Do NOT use "flat".
   - When a per-person rate has a guest minimum (e.g., "150-person minimum"), set "minGuests" on the line item and in "venueDetails.minGuests".
5. Separate required charges from optional upgrades and deposits:
   - Only set "optionalAddon": true when the message explicitly says the item is optional or an upgrade (e.g., "Optional lamb upgrade +$4/person", "Additional hours are $300/hr"). Never mark a required TBD fee as optional.
   - Put deposits and payment schedules in "paymentTerms" ONLY. Never add a deposit as a separate price in "lineItems".
6. Classify "quoteKind":
   - Use "revision" whenever the message updates an earlier quote, negotiates a changed price or package, or notes a conflict with a printed brochure or earlier offer.
   - Use "initial" for a standalone first quote with no reference to prior terms.
7. Source evidence:
   - Copy "sourceExcerpt" character-for-character from the raw message, including punctuation, for every line item and every open question.
8. Do not calculate totals or subtotals; only extract the stated inputs.`;

const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  required: [
    'vendorName',
    'category',
    'events',
    'quoteKind',
    'currency',
    'taxStatus',
    'gratuityStatus',
    'lineItems',
    'openQuestions',
  ],
  properties: {
    vendorName: { type: 'STRING' },
    category: { type: 'STRING', enum: ['venue', 'photographer', 'dj', 'decor', 'other'] },
    events: { type: 'ARRAY', items: { type: 'STRING' } },
    quotedDate: { type: 'STRING' },
    quoteKind: { type: 'STRING', enum: ['initial', 'revision'] },
    currency: { type: 'STRING', enum: ['CAD', 'USD', 'UNKNOWN'] },
    taxStatus: { type: 'STRING', enum: ['included', 'excluded', 'unknown'] },
    gratuityStatus: { type: 'STRING', enum: ['included', 'excluded', 'unknown'] },
    lineItems: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['label', 'pricingType', 'amount', 'sourceExcerpt'],
        properties: {
          label: { type: 'STRING' },
          pricingType: {
            type: 'STRING',
            enum: ['flat', 'per_person', 'per_hour', 'per_guest_ratio', 'included', 'unknown'],
          },
          amount: { type: 'NUMBER', nullable: true },
          minGuests: { type: 'NUMBER' },
          ratioGuests: { type: 'NUMBER' },
          hours: { type: 'NUMBER' },
          optionalAddon: { type: 'BOOLEAN' },
          sourceExcerpt: { type: 'STRING' },
        },
      },
    },
    venueDetails: {
      type: 'OBJECT',
      properties: {
        roomName: { type: 'STRING' },
        maxCapacity: { type: 'NUMBER' },
        minGuests: { type: 'NUMBER' },
        packageName: { type: 'STRING' },
        dayOfWeek: { type: 'STRING' },
      },
    },
    photographerDetails: {
      type: 'OBJECT',
      properties: {
        hoursIncluded: { type: 'NUMBER' },
        extraHourRate: { type: 'NUMBER' },
        teamSize: { type: 'NUMBER' },
        includesMiniShoot: { type: 'STRING', enum: ['yes', 'no', 'unknown'] },
      },
    },
    paymentTerms: {
      type: 'OBJECT',
      required: ['methodRule'],
      properties: {
        depositAmount: { type: 'NUMBER' },
        depositPercent: { type: 'NUMBER' },
        methodRule: {
          type: 'STRING',
          enum: ['cash_only', 'etransfer', 'card', 'any', 'unknown'],
        },
        scheduleNotes: { type: 'STRING' },
      },
    },
    openQuestions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['question', 'reason', 'sourceExcerpt'],
        properties: {
          question: { type: 'STRING' },
          reason: {
            type: 'STRING',
            enum: ['missing_price', 'conflict', 'ambiguous_rule', 'missing_date'],
          },
          sourceExcerpt: { type: 'STRING' },
        },
      },
    },
  },
} as const;

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const RETRY_DELAYS_MS = [5_000, 10_000, 20_000];
const REQUEST_TIMEOUT_MS = 30_000;

function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 30_000);
  }
  const dateMs = Date.parse(headerValue);
  if (!Number.isNaN(dateMs)) {
    return Math.min(Math.max(dateMs - Date.now(), 0), 30_000);
  }
  return null;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  rawMessage: string,
): Promise<{ response: Response; retryCount: number }> {
  const start = performance.now();
  let retryCount = 0;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const canRetry = attempt < RETRY_DELAYS_MS.length;
      if (!canRetry) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new ExtractionError({
          message: `Network or timeout error after ${retryCount} retries: ${msg}`,
          kind: 'api_error',
          rawMessage,
          retryCount,
          latencyMs: Math.round(performance.now() - start),
        });
      }
      retryCount++;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      continue;
    }

    if (response.ok) {
      return { response, retryCount };
    }

    const body = await response.text();
    const canRetry = RETRYABLE_STATUSES.has(response.status) && attempt < RETRY_DELAYS_MS.length;
    if (!canRetry) {
      throw new ExtractionError({
        message: `HTTP ${response.status}: ${body.slice(0, 300)}`,
        kind: 'api_error',
        rawMessage,
        statusCode: response.status,
        retryCount,
        latencyMs: Math.round(performance.now() - start),
      });
    }

    retryCount++;
    const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
    const delayMs = retryAfterMs ?? RETRY_DELAYS_MS[attempt]!;
    await new Promise((r) => setTimeout(r, delayMs));
  }

  throw new ExtractionError({
    message: 'Request failed after maximum retries',
    kind: 'api_error',
    rawMessage,
    retryCount,
    latencyMs: Math.round(performance.now() - start),
  });
}

function normalizeProviderResponse(parsed: unknown): unknown {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return parsed;
  }
  const obj = parsed as Record<string, unknown>;
  if (
    typeof obj.photographerDetails === 'object' &&
    obj.photographerDetails !== null &&
    !Array.isArray(obj.photographerDetails)
  ) {
    const pd = obj.photographerDetails as Record<string, unknown>;
    if (pd.includesMiniShoot === 'yes') pd.includesMiniShoot = true;
    else if (pd.includesMiniShoot === 'no') pd.includesMiniShoot = false;
  }
  return obj;
}

export async function extractQuote(
  rawMessage: string,
  options: { provider?: ProviderName; mockLookup?: ExtractedQuote } = {},
): Promise<ExtractResult> {
  const provider =
    options.provider ??
    (process.env.EXTRACTOR_PROVIDER as ProviderName | undefined) ??
    (process.env.GEMINI_API_KEY ? 'gemini' : 'mock');

  const start = performance.now();

  if (provider === 'mock') {
    if (!options.mockLookup) {
      throw new ExtractionError({
        message: 'Mock provider requires a mockLookup quote for offline testing.',
        kind: 'api_error',
        rawMessage,
        retryCount: 0,
        latencyMs: 0,
      });
    }
    return {
      rawResponse: options.mockLookup,
      rawMessage,
      latencyMs: Math.round(performance.now() - start),
      retryCount: 0,
      provider: 'mock',
      model: 'offline-mock',
      resolvedModelVersion: 'offline-mock',
    };
  }

  if (provider === 'ollama') {
    const model = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b';
    const baseUrl = process.env.OLLAMA_URL ?? 'http://localhost:11434';
    const { response, retryCount } = await fetchWithRetry(
      `${baseUrl}/api/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          system: SYSTEM_PROMPT,
          prompt: `Extract quote facts from this vendor message:\n\n${rawMessage}`,
          format: 'json',
          stream: false,
        }),
      },
      rawMessage,
    );

    const data = (await response.json()) as { response?: string };
    try {
      const parsed = JSON.parse(data.response ?? '');
      return {
        rawResponse: normalizeProviderResponse(parsed),
        rawMessage,
        latencyMs: Math.round(performance.now() - start),
        retryCount,
        provider: 'ollama',
        model,
        resolvedModelVersion: model,
      };
    } catch (err) {
      throw new ExtractionError({
        message: `Failed to parse Ollama JSON: ${err instanceof Error ? err.message : String(err)}`,
        kind: 'parse_error',
        rawMessage,
        retryCount,
        latencyMs: Math.round(performance.now() - start),
      });
    }
  }

  // Gemini REST API with native responseSchema
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ExtractionError({
      message: 'GEMINI_API_KEY is required when EXTRACTOR_PROVIDER=gemini.',
      kind: 'api_error',
      rawMessage,
      retryCount: 0,
      latencyMs: 0,
    });
  }

  const model = process.env.GEMINI_MODEL ?? 'gemini-flash-lite-latest';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const { response, retryCount } = await fetchWithRetry(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            role: 'user',
            parts: [{ text: `Extract quote facts from this vendor message:\n\n${rawMessage}` }],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: GEMINI_RESPONSE_SCHEMA,
        },
      }),
    },
    rawMessage,
  );

  const data = (await response.json()) as {
    modelVersion?: string;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new ExtractionError({
      message: 'Gemini returned an empty response.',
      kind: 'parse_error',
      rawMessage,
      retryCount,
      latencyMs: Math.round(performance.now() - start),
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ExtractionError({
      message: `Failed to parse Gemini JSON: ${err instanceof Error ? err.message : String(err)}`,
      kind: 'parse_error',
      rawMessage,
      retryCount,
      latencyMs: Math.round(performance.now() - start),
    });
  }

  const tokenUsage: TokenUsage | undefined = data.usageMetadata
    ? {
        promptTokens: data.usageMetadata.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata.candidatesTokenCount ?? 0,
        totalTokens: data.usageMetadata.totalTokenCount ?? 0,
      }
    : undefined;

  return {
    rawResponse: normalizeProviderResponse(parsed),
    rawMessage,
    latencyMs: Math.round(performance.now() - start),
    retryCount,
    provider: 'gemini',
    model,
    resolvedModelVersion: data.modelVersion ?? model,
    tokenUsage,
  };
}

export type MockQuoteMap = Record<string, ExtractedQuote>;

export function buildMockMap(
  cases: Array<EvalCase & { mockExtraction?: ExtractedQuote }>,
): MockQuoteMap {
  const map: MockQuoteMap = {};
  for (const c of cases) {
    if (c.mockExtraction) {
      map[c.id] = c.mockExtraction;
    }
  }
  return map;
}
