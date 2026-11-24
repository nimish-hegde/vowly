import type { EvalCase, ExtractedQuote, TokenUsage } from './types.ts';

export type ProviderName = 'mock' | 'ollama' | 'gemini';

export interface ExtractResult {
  rawResponse: unknown;
  rawMessage: string;
  latencyMs: number;
  /** Latency of the final attempt + parsing, excluding prior failed attempts and retry waits. */
  latencyWithoutRetriesMs: number;
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
  readonly latencyWithoutRetriesMs: number;

  constructor(params: {
    message: string;
    kind: 'api_error' | 'parse_error';
    rawMessage: string;
    statusCode?: number;
    retryCount: number;
    latencyMs: number;
    latencyWithoutRetriesMs?: number;
  }) {
    super(params.message);
    this.name = 'ExtractionError';
    this.kind = params.kind;
    this.rawMessage = params.rawMessage;
    this.statusCode = params.statusCode;
    this.retryCount = params.retryCount;
    this.latencyMs = params.latencyMs;
    this.latencyWithoutRetriesMs = params.latencyWithoutRetriesMs ?? params.latencyMs;
  }
}

const SYSTEM_PROMPT = `You extract structured wedding vendor quote facts from raw messages (emails, WhatsApp, Instagram, notes).

Follow these rules strictly:
1. Return valid JSON only. Omit optional fields when not stated. Never output "undefined".
2. Always include the required arrays: "events", "lineItems", and "openQuestions" (use [] if none).
3. Classify vendor "category" by the vendor's commercial role and supporting evidence:
   - "venue": ONLY when there is explicit evidence that the vendor provides the physical event space (such as a hall, ballroom, banquet facility, convention centre, estate, hotel, room name, room rental, room capacity, parking, or in-house space). When the vendor is a confirmed venue, bundled food, dinner menus, appetizers, open bar, staffing, or extra surcharges still stay "venue" — food words alone do NOT make a venue a caterer.
   - "catering": ONLY when there is explicit evidence that the vendor is an independent food-and-beverage provider (such as "Catering"/"Caterers" in the vendor name, off-site catering, food delivery/chafing dishes, or catering at a separate named venue).
   - "photographer", "dj", "decor", "entertainment", "other": Use when the message clearly states that service.
   - "unknown": A dinner or reception package, per-person pricing, setup fee, or minimum guest count ALONE does NOT prove the vendor provides the physical event space or is an independent caterer. Whenever those cues appear without explicit venue-space evidence or independent-catering evidence (e.g., generic "Events" or "Hospitality" names), set "category" to "unknown" and add an "ambiguous_rule" open question asking the couple to confirm the vendor's role.
4. Never invent a price or currency:
   - If the message only uses "$" without explicitly stating CAD, CA$, USD, or US$, set "currency" to "UNKNOWN". Never guess currency from city names, taxes like HST, or venue names.
5. Extract EVERY distinct stated charge, surcharge, or additional cost:
   - Never drop a stated additional charge just because it has no numeric price or is mentioned inside a sentence about a menu item, package, setup, or condition.
   - Whenever a stated charge has no numeric price (e.g., "TBD", "costs extra", "extra charge", "additional fee", "priced separately", "pricing on request", or depends on setup/selection/distance), include it in "lineItems" with "pricingType": "unknown" and "amount": null.
   - Set "chargeType" on every line item:
     a) "mandatory": required base package, service, or stated extra fee. Keep "optionalAddon": false.
     b) "conditional": a stated charge whose cost depends on a choice, setup, location, or condition without explicit opt-in wording. Keep "optionalAddon": false.
     c) "optional": ONLY when the message uses explicit opt-in language (e.g., "optional", "upgrade available", "add-on if desired", "additional hours if needed"). Set "optionalAddon": true ONLY when "chargeType" is "optional".
   - Never mark a "mandatory" or "conditional" unpriced charge as "optional" or "optionalAddon": true.
   - Put deposits and payment schedules in "paymentTerms" ONLY. Never add a deposit as a separate price in "lineItems".
6. Conflicting prices for the SAME service (never double-count):
   - When two sources or documents state different prices for the same service or package (for example, an agreed DM/email price vs. a higher or lower PDF contract/brochure price), represent that service as ONE line item — NEVER two separate billable line items.
   - Set "amount" on that single line item to the earlier/agreed price, and record ALL conflicting candidate prices in "conflictingOptions" (each with its "sourceLabel", "pricingType", "amount", and verbatim "sourceExcerpt").
   - Add an actionable "conflict" entry in "openQuestions" naming both prices, the difference between them, and asking which price applies.
7. Classify staffing ratios and guest minimums accurately:
   - When a fee scales by guest count blocks (for example, "$495 each, up to 150 guests per staff member" or "$300 per staff member, 1 per 150 guests"), use "pricingType": "per_guest_ratio", set "amount" to the per-unit price, and set "ratioGuests" to the guest block size. Do NOT use "flat".
   - When a per-person rate has a guest minimum (e.g., "150-person minimum"), set "minGuests" on the line item and in "venueDetails.minGuests".
8. Classify "quoteKind":
   - Use "revision" whenever the message updates an earlier quote, negotiates a changed price or package, or notes a conflict with a printed brochure, draft contract, or earlier offer.
   - Use "initial" for a standalone first quote with no reference to prior terms.
9. Open questions — actionable only, never noisy:
   - Add an entry in "openQuestions" when:
     a) A "mandatory" or "conditional" charge has no price ("reason": "missing_price").
     b) Two sources or terms conflict ("reason": "conflict").
     c) A payment or booking deadline is relative to an event date that is NOT stated in the message (e.g., "due 30 days before the event" with no event date given) ("reason": "missing_date").
     d) Currency is "UNKNOWN" because only bare "$" appears without CAD/USD ("reason": "ambiguous_rule", asking to confirm currency).
     e) Vendor category is "unknown" ("reason": "ambiguous_rule", asking to confirm vendor category).
   - Do NOT invent unnecessary open questions for complete quotes that have explicit currency, explicit category, explicit prices, no conflicts, and no unresolved relative deadlines.
10. Source evidence:
    - Copy "sourceExcerpt" character-for-character from the raw message, including punctuation, for every line item, every conflicting option, and every open question.
11. Do not calculate totals or subtotals; only extract the stated inputs.`;

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
    category: {
      type: 'STRING',
      enum: [
        'venue',
        'photographer',
        'dj',
        'decor',
        'catering',
        'entertainment',
        'other',
        'unknown',
      ],
    },
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
          chargeType: { type: 'STRING', enum: ['mandatory', 'conditional', 'optional'] },
          optionalAddon: { type: 'BOOLEAN' },
          conflictingOptions: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              required: ['sourceLabel', 'pricingType', 'amount', 'sourceExcerpt'],
              properties: {
                sourceLabel: { type: 'STRING' },
                pricingType: {
                  type: 'STRING',
                  enum: ['flat', 'per_person', 'per_hour', 'per_guest_ratio', 'included', 'unknown'],
                },
                amount: { type: 'NUMBER' },
                sourceExcerpt: { type: 'STRING' },
              },
            },
          },
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

export const OLLAMA_RESPONSE_SCHEMA = {
  type: 'object',
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
    vendorName: { type: 'string' },
    category: {
      type: 'string',
      enum: [
        'venue',
        'photographer',
        'dj',
        'decor',
        'catering',
        'entertainment',
        'other',
        'unknown',
      ],
    },
    events: { type: 'array', items: { type: 'string' } },
    quotedDate: { type: 'string' },
    quoteKind: { type: 'string', enum: ['initial', 'revision'] },
    currency: { type: 'string', enum: ['CAD', 'USD', 'UNKNOWN'] },
    taxStatus: { type: 'string', enum: ['included', 'excluded', 'unknown'] },
    gratuityStatus: { type: 'string', enum: ['included', 'excluded', 'unknown'] },
    lineItems: {
      type: 'array',
      items: {
        type: 'object',
        required: ['label', 'pricingType', 'amount', 'sourceExcerpt'],
        properties: {
          label: { type: 'string' },
          pricingType: {
            type: 'string',
            enum: ['flat', 'per_person', 'per_hour', 'per_guest_ratio', 'included', 'unknown'],
          },
          amount: { type: ['number', 'null'] },
          minGuests: { type: 'number' },
          ratioGuests: { type: 'number' },
          hours: { type: 'number' },
          chargeType: { type: 'string', enum: ['mandatory', 'conditional', 'optional'] },
          optionalAddon: { type: 'boolean' },
          conflictingOptions: {
            type: 'array',
            items: {
              type: 'object',
              required: ['sourceLabel', 'pricingType', 'amount', 'sourceExcerpt'],
              properties: {
                sourceLabel: { type: 'string' },
                pricingType: {
                  type: 'string',
                  enum: ['flat', 'per_person', 'per_hour', 'per_guest_ratio', 'included', 'unknown'],
                },
                amount: { type: 'number' },
                sourceExcerpt: { type: 'string' },
              },
            },
          },
          sourceExcerpt: { type: 'string' },
        },
      },
    },
    venueDetails: {
      type: 'object',
      properties: {
        roomName: { type: 'string' },
        maxCapacity: { type: 'number' },
        minGuests: { type: 'number' },
        packageName: { type: 'string' },
        dayOfWeek: { type: 'string' },
      },
    },
    photographerDetails: {
      type: 'object',
      properties: {
        hoursIncluded: { type: 'number' },
        extraHourRate: { type: 'number' },
        teamSize: { type: 'number' },
        includesMiniShoot: { type: 'string', enum: ['yes', 'no', 'unknown'] },
      },
    },
    paymentTerms: {
      type: 'object',
      required: ['methodRule'],
      properties: {
        depositAmount: { type: 'number' },
        depositPercent: { type: 'number' },
        methodRule: {
          type: 'string',
          enum: ['cash_only', 'etransfer', 'card', 'any', 'unknown'],
        },
        scheduleNotes: { type: 'string' },
      },
    },
    openQuestions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['question', 'reason', 'sourceExcerpt'],
        properties: {
          question: { type: 'string' },
          reason: {
            type: 'string',
            enum: ['missing_price', 'conflict', 'ambiguous_rule', 'missing_date'],
          },
          sourceExcerpt: { type: 'string' },
        },
      },
    },
  },
} as const;

export function buildOllamaRequestBody(model: string, rawMessage: string) {
  return {
    model,
    system: `${SYSTEM_PROMPT}\n\nReturn a JSON object conforming exactly to this JSON Schema:\n${JSON.stringify(OLLAMA_RESPONSE_SCHEMA)}`,
    prompt: `Extract quote facts from this vendor message:\n\n${rawMessage}`,
    format: OLLAMA_RESPONSE_SCHEMA,
    stream: false,
  };
}

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

export interface RetryInfo {
  attempt: number;
  maxRetries: number;
  statusCode?: number;
  delayMs: number;
  reason: string;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  rawMessage: string,
  onRetry?: (info: RetryInfo) => void,
): Promise<{ response: Response; retryCount: number; finalAttemptStart: number }> {
  const start = performance.now();
  let retryCount = 0;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const attemptStart = performance.now();
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
        const now = performance.now();
        throw new ExtractionError({
          message: `Network or timeout error after ${retryCount} retries: ${msg}`,
          kind: 'api_error',
          rawMessage,
          retryCount,
          latencyMs: Math.round(now - start),
          latencyWithoutRetriesMs: Math.round(now - attemptStart),
        });
      }
      retryCount++;
      const delayMs = RETRY_DELAYS_MS[attempt]!;
      onRetry?.({
        attempt: retryCount,
        maxRetries: RETRY_DELAYS_MS.length,
        delayMs,
        reason: err instanceof Error ? err.message : 'network error',
      });
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }

    if (response.ok) {
      return { response, retryCount, finalAttemptStart: attemptStart };
    }

    const body = await response.text();
    const canRetry = RETRYABLE_STATUSES.has(response.status) && attempt < RETRY_DELAYS_MS.length;
    if (!canRetry) {
      const now = performance.now();
      throw new ExtractionError({
        message: `HTTP ${response.status}: ${body.slice(0, 300)}`,
        kind: 'api_error',
        rawMessage,
        statusCode: response.status,
        retryCount,
        latencyMs: Math.round(now - start),
        latencyWithoutRetriesMs: Math.round(now - attemptStart),
      });
    }

    retryCount++;
    const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
    const delayMs = retryAfterMs ?? RETRY_DELAYS_MS[attempt]!;
    onRetry?.({
      attempt: retryCount,
      maxRetries: RETRY_DELAYS_MS.length,
      statusCode: response.status,
      delayMs,
      reason: `HTTP ${response.status}`,
    });
    await new Promise((r) => setTimeout(r, delayMs));
  }

  throw new ExtractionError({
    message: 'Request failed after maximum retries',
    kind: 'api_error',
    rawMessage,
    retryCount,
    latencyMs: Math.round(performance.now() - start),
    latencyWithoutRetriesMs: 0,
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
  options: {
    provider?: ProviderName;
    mockLookup?: ExtractedQuote;
    onRetry?: (info: RetryInfo) => void;
  } = {},
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
        latencyWithoutRetriesMs: 0,
      });
    }
    const elapsed = Math.round(performance.now() - start);
    return {
      rawResponse: options.mockLookup,
      rawMessage,
      latencyMs: elapsed,
      latencyWithoutRetriesMs: elapsed,
      retryCount: 0,
      provider: 'mock',
      model: 'offline-mock',
      resolvedModelVersion: 'offline-mock',
    };
  }

  if (provider === 'ollama') {
    const model = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b';
    const baseUrl = process.env.OLLAMA_URL ?? 'http://localhost:11434';
    const { response, retryCount, finalAttemptStart } = await fetchWithRetry(
      `${baseUrl}/api/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildOllamaRequestBody(model, rawMessage)),
      },
      rawMessage,
      options.onRetry,
    );

    const data = (await response.json()) as { response?: string };
    try {
      const parsed = JSON.parse(data.response ?? '');
      const now = performance.now();
      return {
        rawResponse: normalizeProviderResponse(parsed),
        rawMessage,
        latencyMs: Math.round(now - start),
        latencyWithoutRetriesMs: Math.round(now - finalAttemptStart),
        retryCount,
        provider: 'ollama',
        model,
        resolvedModelVersion: model,
      };
    } catch (err) {
      const now = performance.now();
      throw new ExtractionError({
        message: `Failed to parse Ollama JSON: ${err instanceof Error ? err.message : String(err)}`,
        kind: 'parse_error',
        rawMessage,
        retryCount,
        latencyMs: Math.round(now - start),
        latencyWithoutRetriesMs: Math.round(now - finalAttemptStart),
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
      latencyWithoutRetriesMs: 0,
    });
  }

  const model = process.env.GEMINI_MODEL ?? 'gemini-flash-lite-latest';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const { response, retryCount, finalAttemptStart } = await fetchWithRetry(
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
    options.onRetry,
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
    const now = performance.now();
    throw new ExtractionError({
      message: 'Gemini returned an empty response.',
      kind: 'parse_error',
      rawMessage,
      retryCount,
      latencyMs: Math.round(now - start),
      latencyWithoutRetriesMs: Math.round(now - finalAttemptStart),
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const now = performance.now();
    throw new ExtractionError({
      message: `Failed to parse Gemini JSON: ${err instanceof Error ? err.message : String(err)}`,
      kind: 'parse_error',
      rawMessage,
      retryCount,
      latencyMs: Math.round(now - start),
      latencyWithoutRetriesMs: Math.round(now - finalAttemptStart),
    });
  }

  const tokenUsage: TokenUsage | undefined = data.usageMetadata
    ? {
        promptTokens: data.usageMetadata.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata.candidatesTokenCount ?? 0,
        totalTokens: data.usageMetadata.totalTokenCount ?? 0,
      }
    : undefined;

  const now = performance.now();
  return {
    rawResponse: normalizeProviderResponse(parsed),
    rawMessage,
    latencyMs: Math.round(now - start),
    latencyWithoutRetriesMs: Math.round(now - finalAttemptStart),
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
