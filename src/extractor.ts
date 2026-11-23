import type { EvalCase, ExtractedQuote } from './types.ts';

export type ProviderName = 'mock' | 'ollama' | 'gemini';

export interface ExtractResult {
  quote: ExtractedQuote;
  latencyMs: number;
  provider: ProviderName;
  model: string;
}

const SYSTEM_PROMPT = `You extract structured wedding vendor quote facts from raw messages.
Return ONLY valid JSON matching this shape:
{
  "vendorName": string,
  "category": "venue" | "photographer" | "dj" | "decor" | "other",
  "events": string[],
  "quotedDate": string | undefined,
  "quoteKind": "initial" | "revision",
  "currency": "CAD" | "USD" | "UNKNOWN",
  "taxStatus": "included" | "excluded" | "unknown",
  "gratuityStatus": "included" | "excluded" | "unknown",
  "lineItems": [
    {
      "label": string,
      "pricingType": "flat" | "per_person" | "per_hour" | "per_guest_ratio" | "included" | "unknown",
      "amount": number | null,
      "minGuests": number | undefined,
      "ratioGuests": number | undefined,
      "hours": number | undefined,
      "optionalAddon": boolean | undefined,
      "sourceExcerpt": string
    }
  ],
  "venueDetails": { "roomName"?: string, "maxCapacity"?: number, "minGuests"?: number, "packageName"?: string, "dayOfWeek"?: string },
  "photographerDetails": { "hoursIncluded"?: number, "extraHourRate"?: number, "teamSize"?: number, "includesMiniShoot"?: boolean | "unknown" },
  "paymentTerms": { "depositAmount"?: number, "depositPercent"?: number, "methodRule": "cash_only" | "etransfer" | "card" | "any" | "unknown", "scheduleNotes"?: string },
  "openQuestions": [{ "question": string, "reason": "missing_price" | "conflict" | "ambiguous_rule" | "missing_date", "sourceExcerpt": string }]
}

Strict rules:
- Never invent a price. If a fee is TBD or says "extra charge" with no number, set pricingType to "unknown" and amount to null.
- Every lineItem and openQuestion MUST include a verbatim sourceExcerpt copied from the raw message.
- Do not calculate totals or subtotals; only extract the stated inputs.
- Mark optional upgrades (e.g., "+$4/person for lamb", "dry ice $300") with optionalAddon: true.`;

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
      throw new Error('Mock provider requires a mockLookup quote for offline testing.');
    }
    return {
      quote: options.mockLookup,
      latencyMs: Math.round(performance.now() - start),
      provider: 'mock',
      model: 'offline-mock',
    };
  }

  if (provider === 'ollama') {
    const model = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b';
    const baseUrl = process.env.OLLAMA_URL ?? 'http://localhost:11434';
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        system: SYSTEM_PROMPT,
        prompt: `Extract quote facts from this vendor message:\n\n${rawMessage}`,
        format: 'json',
        stream: false,
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama request failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as { response: string };
    const quote = JSON.parse(data.response) as ExtractedQuote;
    return {
      quote,
      latencyMs: Math.round(performance.now() - start),
      provider: 'ollama',
      model,
    };
  }

  // Gemini REST API
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required when EXTRACTOR_PROVIDER=gemini.');
  }
  const model = process.env.GEMINI_MODEL ?? 'gemini-3.8-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
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
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Gemini request failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini returned an empty response.');
  }
  const quote = JSON.parse(text) as ExtractedQuote;
  return {
    quote,
    latencyMs: Math.round(performance.now() - start),
    provider: 'gemini',
    model,
  };
}

export type MockQuoteMap = Record<string, ExtractedQuote>;

export function buildMockMap(cases: Array<EvalCase & { mockExtraction?: ExtractedQuote }>): MockQuoteMap {
  const map: MockQuoteMap = {};
  for (const c of cases) {
    if (c.mockExtraction) {
      map[c.id] = c.mockExtraction;
    }
  }
  return map;
}
