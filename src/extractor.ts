import type { EvalCase, ExtractedQuote, ExtractionAttachment, TokenUsage } from './types.ts';

export type ProviderName = 'mock' | 'ollama' | 'gemini';

export const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB per file

export function estimateBase64ByteLength(base64Data: string): number {
  const cleaned = base64Data.replace(/\s+/g, '');
  const padding = cleaned.endsWith('==') ? 2 : cleaned.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((cleaned.length * 3) / 4) - padding);
}

export function validateAttachments(attachments: ExtractionAttachment[] | undefined): string[] {
  if (!attachments || attachments.length === 0) return [];
  const errors: string[] = [];
  if (attachments.length > 3) {
    errors.push('At most 3 attachments can be analyzed in a single quote import.');
  }
  attachments.forEach((att, idx) => {
    const label = att.fileName ? `"${att.fileName}"` : `attachment #${idx + 1}`;
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(att.mimeType)) {
      errors.push(
        `Unsupported file format for ${label} (${att.mimeType}). Upload PNG, JPEG, WebP, GIF, or PDF.`,
      );
    }
    if (!att.base64Data || typeof att.base64Data !== 'string') {
      errors.push(`File ${label} is empty.`);
    } else {
      const sizeBytes = estimateBase64ByteLength(att.base64Data);
      if (sizeBytes === 0) {
        errors.push(`File ${label} is empty.`);
      } else if (sizeBytes > MAX_ATTACHMENT_BYTES) {
        errors.push(`File ${label} exceeds the 10 MB size limit.`);
      }
    }
  });
  return errors;
}

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

const SYSTEM_PROMPT = `You extract structured wedding vendor quote facts from raw messages (emails, WhatsApp, Instagram, notes) and uploaded quote documents (screenshots, images, PDFs).

Follow these rules strictly:
1. Return valid JSON only. Omit optional fields when not stated. Never output "undefined".
2. Always include the required arrays: "events", "packages", "lineItems", and "openQuestions" (use [] if none).
3. Never invent vendor identity or location:
   - If the vendor name is NOT stated in the source, set "vendorName": null. Do NOT invent a placeholder name or use an uploaded filename as the vendor name.
   - Only set "vendorLocation" or "vendorContact" if explicitly stated in the source.
4. Classify vendor "category" by the vendor's commercial role and supporting evidence:
   - "venue": ONLY when there is explicit evidence that the vendor provides the physical event space or banquet facility (such as a hall, ballroom, banquet hall/facility, banquet package, convention centre, manor, estate, hotel, pavilion, room name, room/space rental, room capacity / maximum capacity, parking/valet/freight access, or in-house space). When the vendor is a confirmed venue, bundled food, dinner menus, appetizers, open bar, staffing, or extra surcharges still stay "venue" — food words alone do NOT make a venue a caterer.
   - "catering": ONLY when there is explicit evidence that the vendor is an independent food-and-beverage provider (such as "Catering"/"Caterers" in the vendor name, off-site catering, food delivery/chafing dishes/warming setup, or catering at a separate named venue).
   - "photographer", "dj", "decor", "entertainment", "other": Use when the message clearly states that service.
   - "unknown": Generic "Events", "Hospitality", or "Hospitality & Events" vendor names offering an evening/reception/dinner package, per-person pricing, dinner service, glassware, linens, setup fee, minimum guest count, or an "on-site coordinator" ALONE (without explicit physical-space cues like hall, ballroom, room rental, or max capacity, and without independent-caterer cues) do NOT prove whether the vendor owns a physical venue space or provides external catering/coordination. Set "category" to "unknown" and add an "ambiguous_rule" open question (with a verbatim "sourceExcerpt") asking the couple to confirm the vendor's role.
5. Extract explicitly stated tax & gratuity rates/bases accurately — NEVER fabricate unstated values:
   - If the source only uses "$" without explicitly stating CAD, CA$, USD, or US$, set "currency" to "UNKNOWN". Never guess currency from city names, taxes like HST, or venue names.
   - Never infer tax treatment from payment method (for example, cash does NOT imply tax-free).
   - Scan the ENTIRE source — including headers, footers, fine print, shared-terms notes, and secondary pages of PDFs — for explicitly stated tax rates (e.g., "13% HST" -> "taxStatus": "excluded", "taxPercent": 13), gratuity/service-charge rates (e.g., "15% service charge" -> "gratuityStatus": "excluded", "gratuityPercent": 15; "18% gratuity" -> "gratuityPercent": 18), and gratuity bases ("on food subtotal" / "on food only" -> "food_subtotal"; "on entire subtotal" / "on total subtotal" / "on all charges" -> "entire_subtotal").
   - Although "taxPercent", "gratuityPercent", and "gratuityBasis" are required keys, you MUST output null whenever a rate or basis is NOT explicitly stated — NEVER guess 13, 15, or any regional default:
     a) Tax never mentioned at all -> "taxStatus": "unknown", "taxPercent": null.
     b) Tax stated as extra with NO numeric rate (e.g., "plus tax", "plus applicable local tax", "plus HST" with no percent) -> "taxStatus": "excluded", "taxPercent": null.
     c) Tax stated as included with no separate percent -> "taxStatus": "included", "taxPercent": null.
     d) Gratuity / service charge never mentioned -> "gratuityStatus": "unknown", "gratuityPercent": null, "gratuityBasis": null.
     e) Gratuity / service charge stated as extra with NO percentage (e.g., "plus gratuity") -> "gratuityStatus": "excluded", "gratuityPercent": null, "gratuityBasis": "unknown" (or the stated basis), and add a "missing_price" open question asking for the gratuity percentage.
     f) Gratuity percentage stated with NO basis wording -> set "gratuityBasis": "unknown".
   - Package-specific tax/gratuity overrides: When a multi-package quote states a package-specific tax or gratuity override (different from the quote-level default, including explicitly no gratuity or tax included), set those override fields on that "packages[]" entry. When tax/gratuity applies uniformly to all packages (e.g., in a shared footer), populate the top-level fields and do NOT invent contradictory package-level overrides.
   - Keep taxes (HST/GST/PST), gratuities, AND percentage service charges (e.g., "plus 15% service charge", "10% gratuity") ONLY in top-level (or package-level) tax/gratuity fields. NEVER also add them as a separate "lineItems" entry.
6. Extract EVERY distinct stated charge, surcharge, third-party fee, or additional cost:
   - Never drop a stated additional charge just because it has no numeric price or is mentioned inside a sentence about a menu item, package, setup, or condition.
   - Whenever a stated charge has no numeric price (e.g., "TBD", "costs extra", "extra charge", "additional fee", "priced separately", "pricing on request", or depends on setup/selection/distance), include it in "lineItems" with "pricingType": "unknown" and "amount": null.
   - Reserve "pricingType": "percentage" in "lineItems" ONLY for separate non-tax, non-gratuity percentage fees (e.g., card processing fee), setting "amount" and "percentageRate" to the numeric percent and setting "percentageBasis". Do NOT use "percentage" for HST or percentage gratuity/service charges.
   - Mark "isFoodItem": true on food/banquet/catering menu line items when a food-only gratuity or service charge applies.
   - Mark "isThirdParty": true (and "thirdPartyProvider" if named) when a charge is provided by a third-party or preferred external supplier (e.g., third-party AV).
   - Set "chargeType" on every line item:
     a) "mandatory": required base package, service, or stated extra fee. Keep "optionalAddon": false.
     b) "conditional": a stated charge whose cost depends on a choice, setup, location, or condition without explicit opt-in wording. Keep "optionalAddon": false.
     c) "optional": ONLY when the message uses explicit opt-in language (e.g., "optional", "upgrade available", "add-on if desired", "additional hours if needed"). Set "optionalAddon": true ONLY when "chargeType" is "optional".
   - Never mark a "mandatory" or "conditional" unpriced charge as "optional" or "optionalAddon": true.
   - Always populate "paymentTerms" with "methodRule" ("cash_only", "etransfer", "card", "any", or "unknown" if unstated), plus any stated "depositAmount", "depositPercent", "scheduleNotes", and "milestones" (with "relativeDaysBeforeEvent" and "relativeDeadlineText"). Never add a deposit as a separate price in "lineItems".
7. Negotiated prices vs. genuine price conflicts (CRITICAL):
   - EXPLICIT NEGOTIATED PRICE: When a vendor states their normal/standard price alongside an explicitly discounted or negotiated price for the couple (e.g., "I normally charge $1,000, but I can do $900 for your engagement"), set "amount" to the active negotiated price (900) and "originalAmount" to the normal price (1000). Omit "originalAmount" when no separate original price was quoted. Do NOT populate "conflictingOptions" and do NOT create a conflict open question.
   - GENUINE PRICE CONFLICT (REQUIRES EXPLICIT HUMAN RESOLUTION): When two sources, channels, or dated messages (for example, an Instagram DM and an email, or an email and a PDF/contract/invoice) state different prices OR different pricing models (such as flat vs. per-person or per-hour) for the SAME service without the vendor explicitly stating that the newer message supersedes, updates, or replaces the earlier offer, NEVER silently resolve the conflict, NEVER treat either offer as authoritative, and NEVER emit two separate billable line items. Represent that service as ONE line item with ALL conflicting candidates recorded in "conflictingOptions" (each with its own "sourceLabel", "pricingType", "amount", and verbatim "sourceExcerpt"), and add a "conflict" entry in "openQuestions" so the couple must explicitly resolve it before approval. Always keep each candidate's "pricingType" paired with its own "amount" (never mix a flat dollar amount with "per_person") on both the line item and every entry in "conflictingOptions".
8. Classify mutually exclusive packages, extra-guest tiers, staffing ratios, guest minimums, overtime hours, structured inclusions, and delivery terms accurately:
   - MUTUALLY EXCLUSIVE PACKAGES / TIERS: When a vendor brochure, menu, or message presents TWO OR MORE alternative base packages/tiers for the couple to choose between (for example, "Royal Package $55/person, min 150 guests" vs. "Imperial Package $65/person, min 100 guests", or Silver / Gold / Platinum tiers), populate "packages" with one object per tier (each having "id", "name", "pricingType", "amount", "minGuests", "includedGuests", "extraGuestRate", "inclusions", "sourceExcerpt", and any package-specific "taxStatus"/"taxPercent", "gratuityStatus"/"gratuityPercent", or "deliveryTerms"). Put any package-specific fee in "lineItems" with "packageId" set to that tier's "id", and keep shared charges in "lineItems" without "packageId". Do NOT put mutually exclusive package tiers into "lineItems" and NEVER sum alternative packages together. Leave "selectedPackageId" null unless the couple explicitly confirmed one package. For single-package quotes, set "packages": [] and put the single package in "lineItems" as usual.
   - EXTRA-GUEST PRICING VS. REPEATED PER-PERSON RATES: If a per-person package already states "$55/person (min 150 guests)" and simply restates "$55/person for additional guests", do NOT emit a duplicate second "$55/person" line item. Use "pricingType": "per_extra_guest" with "guestThreshold" (or "extraGuestRate" on a flat package with "includedGuests") ONLY when an incremental rate applies strictly to guests ABOVE an included threshold (e.g., "$8,250 flat up to 150 guests, $55 per extra guest above 150") or when the per-guest rate above a threshold differs from the base rate.
   - CONDITIONAL OVERTIME / ADDITIONAL HOURS: When a quote includes a base coverage duration (e.g., "$900 for 5 hours") and also lists an additional/overtime hourly rate (e.g., "$250 per additional hour"), extract the additional hourly rate with "pricingType": "per_hour", "chargeType": "conditional", and OMIT "hours" (do NOT set "hours": 1 unless the couple explicitly requested 1 overtime hour).
   - When a fee scales by guest count blocks (for example, "$250 each, 1 required per 75 guests" or "$495 each, up to 150 guests per bartender"), use "pricingType": "per_guest_ratio", set "amount" to the per-unit price, set "ratioGuests" to the guest block size, and set "unitLabel" (e.g., "bartender"). Do NOT use "flat".
   - When a per-person rate has a guest minimum (e.g., "150-person minimum"), set "minGuests" on the line item (or package) and in "venueDetails.minGuests". NEVER copy "maxCapacity" (e.g., "max 190 guests", "fits up to 200") into "minGuests". Only set "minGuests" when the source explicitly states a minimum guest count or minimum guarantee.
   - Preserve structured "inclusions" with plain-language "name", optional "quantity", "unit", "durationHours", and "sourceExcerpt" where stated (e.g., 4 appetizers, 3 main dishes, 6 hours of photography, online gallery). Never output internal schema or snake_case tokens (such as "photography_coverage", "deliverables", or "included") in "name" or "unit". When a team member or service has its own coverage duration (e.g., "Second photographer for 5 hours"), set "name": "Second photographer", "quantity": 1, "unit": "photographer", and "durationHours": 5.
   - Extract delivery timelines, sneak-peek windows, gallery/USB delivery formats, print rights, and RAW file policies into "deliveryTerms". Also preserve "exclusions", "restrictions", and "serviceDurationHours" when stated.
9. Classify "quoteKind":
   - Use "revision" ONLY when (a) the vendor explicitly states they are revising, updating, lowering, or superseding an earlier quote, OR (b) a formal contract, invoice, or printed brochure conflicts with an earlier quote.
   - If the source does NOT mention a contract, invoice, printed brochure, or explicit revision/update wording — including a standalone first quote or forwarding two conflicting initial messages/proposals (e.g., DM/text + email proposal) with different dates — you MUST set "quoteKind": "initial".
10. Open questions — actionable only, never noisy:
    - Always add an entry in "openQuestions" whenever ANY of these holds:
      a) A "mandatory" or "conditional" charge has no price, or gratuity is excluded/extra with no stated percentage ("reason": "missing_price").
      b) Two sources or terms conflict ("reason": "conflict").
      c) A payment or booking deadline is relative to an event date that is NOT stated in the message (e.g., "due 30 days before the event" or "7 days before the wedding" with no event date given) ("reason": "missing_date").
      d) Currency is "UNKNOWN" because only bare "$" appears without CAD/USD ("reason": "ambiguous_rule", asking to confirm currency).
      e) Vendor category is "unknown" ("reason": "ambiguous_rule", asking to confirm vendor category).
    - Do NOT invent unnecessary open questions for complete quotes.
11. Source evidence:
    - For pasted text, copy "sourceExcerpt" character-for-character from the raw message, including punctuation, for every line item, every conflicting option, and every open question. For conflict open questions, copy ONE verbatim snippet from the raw message (such as one of the conflicting price phrases) — NEVER write a synthesized summary sentence into "sourceExcerpt".
    - For uploaded images or PDFs, copy the exact visible text snippet into "sourceExcerpt" and include "pageReference" (e.g., "Page 1", "Screenshot") whenever available.
12. Do not calculate totals or subtotals; only extract the stated inputs.`;

const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  required: [
    'vendorName',
    'category',
    'events',
    'quoteKind',
    'currency',
    'taxStatus',
    'taxPercent',
    'gratuityStatus',
    'gratuityPercent',
    'gratuityBasis',
    'packages',
    'lineItems',
    'paymentTerms',
    'openQuestions',
  ],
  properties: {
    vendorName: { type: 'STRING', nullable: true },
    vendorLocation: { type: 'STRING', nullable: true },
    vendorContact: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING' },
        email: { type: 'STRING' },
        phone: { type: 'STRING' },
      },
    },
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
    taxPercent: { type: 'NUMBER', nullable: true },
    gratuityStatus: { type: 'STRING', enum: ['included', 'excluded', 'unknown'] },
    gratuityPercent: { type: 'NUMBER', nullable: true },
    gratuityBasis: {
      type: 'STRING',
      nullable: true,
      enum: ['specific_line_items', 'food_subtotal', 'entire_subtotal', 'custom_amount', 'unknown'],
    },
    serviceDurationHours: { type: 'NUMBER' },
    selectedPackageId: { type: 'STRING', nullable: true },
    packages: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['id', 'name', 'pricingType', 'amount', 'inclusions', 'sourceExcerpt'],
        properties: {
          id: { type: 'STRING' },
          name: { type: 'STRING' },
          pricingType: { type: 'STRING', enum: ['flat', 'per_person', 'unknown'] },
          amount: { type: 'NUMBER', nullable: true },
          minGuests: { type: 'NUMBER' },
          includedGuests: { type: 'NUMBER' },
          extraGuestRate: { type: 'NUMBER' },
          maxCapacity: { type: 'NUMBER' },
          hours: { type: 'NUMBER' },
          isFoodItem: { type: 'BOOLEAN' },
          taxStatus: { type: 'STRING', enum: ['included', 'excluded', 'unknown'] },
          taxPercent: { type: 'NUMBER', nullable: true },
          gratuityStatus: { type: 'STRING', enum: ['included', 'excluded', 'unknown'] },
          gratuityPercent: { type: 'NUMBER', nullable: true },
          gratuityBasis: {
            type: 'STRING',
            enum: ['specific_line_items', 'food_subtotal', 'entire_subtotal', 'custom_amount', 'unknown'],
          },
          inclusions: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              required: ['name'],
              properties: {
                category: { type: 'STRING' },
                name: { type: 'STRING' },
                quantity: { type: 'NUMBER' },
                unit: { type: 'STRING' },
                durationHours: { type: 'NUMBER' },
                sourceExcerpt: { type: 'STRING' },
              },
            },
          },
          deliveryTerms: { type: 'ARRAY', items: { type: 'STRING' } },
          sourceExcerpt: { type: 'STRING' },
          pageReference: { type: 'STRING' },
        },
      },
    },
    lineItems: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['label', 'pricingType', 'amount', 'sourceExcerpt'],
        properties: {
          label: { type: 'STRING' },
          pricingType: {
            type: 'STRING',
            enum: ['flat', 'per_person', 'per_extra_guest', 'per_hour', 'per_guest_ratio', 'percentage', 'included', 'unknown'],
          },
          amount: { type: 'NUMBER', nullable: true },
          minGuests: { type: 'NUMBER' },
          guestThreshold: { type: 'NUMBER' },
          packageId: { type: 'STRING' },
          ratioGuests: { type: 'NUMBER' },
          unitLabel: { type: 'STRING' },
          hours: { type: 'NUMBER' },
          percentageRate: { type: 'NUMBER' },
          percentageBasis: {
            type: 'STRING',
            enum: ['specific_line_items', 'food_subtotal', 'entire_subtotal', 'custom_amount', 'unknown'],
          },
          percentageTargetLabels: { type: 'ARRAY', items: { type: 'STRING' } },
          originalAmount: { type: 'NUMBER' },
          isThirdParty: { type: 'BOOLEAN' },
          thirdPartyProvider: { type: 'STRING' },
          isFoodItem: { type: 'BOOLEAN' },
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
                  enum: ['flat', 'per_person', 'per_extra_guest', 'per_hour', 'per_guest_ratio', 'percentage', 'included', 'unknown'],
                },
                amount: { type: 'NUMBER' },
                sourceExcerpt: { type: 'STRING' },
              },
            },
          },
          sourceExcerpt: { type: 'STRING' },
          pageReference: { type: 'STRING' },
        },
      },
    },
    inclusions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['name'],
        properties: {
          category: { type: 'STRING' },
          name: { type: 'STRING' },
          quantity: { type: 'NUMBER' },
          unit: { type: 'STRING' },
          durationHours: { type: 'NUMBER' },
          packageId: { type: 'STRING' },
          sourceExcerpt: { type: 'STRING' },
        },
      },
    },
    deliveryTerms: { type: 'ARRAY', items: { type: 'STRING' } },
    exclusions: { type: 'ARRAY', items: { type: 'STRING' } },
    restrictions: { type: 'ARRAY', items: { type: 'STRING' } },
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
        milestones: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            required: ['label'],
            properties: {
              label: { type: 'STRING' },
              amount: { type: 'NUMBER' },
              percent: { type: 'NUMBER' },
              dueDate: { type: 'STRING' },
              relativeDaysBeforeEvent: { type: 'NUMBER' },
              relativeDeadlineText: { type: 'STRING' },
              sourceExcerpt: { type: 'STRING' },
            },
          },
        },
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
          pageReference: { type: 'STRING' },
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
    'paymentTerms',
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

export function normalizeProviderResponse(parsed: unknown): unknown {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return parsed;
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.gratuityBasis === null) {
    delete obj.gratuityBasis;
  }
  if (
    typeof obj.photographerDetails === 'object' &&
    obj.photographerDetails !== null &&
    !Array.isArray(obj.photographerDetails)
  ) {
    const pd = obj.photographerDetails as Record<string, unknown>;
    if (pd.includesMiniShoot === 'yes') pd.includesMiniShoot = true;
    else if (pd.includesMiniShoot === 'no') pd.includesMiniShoot = false;
  }
  if (Array.isArray(obj.lineItems)) {
    for (const rawItem of obj.lineItems) {
      if (typeof rawItem !== 'object' || rawItem === null || Array.isArray(rawItem)) continue;
      const li = rawItem as Record<string, unknown>;
      if (
        typeof li.originalAmount === 'number' &&
        typeof li.amount === 'number' &&
        Math.abs(li.originalAmount - li.amount) < 0.01
      ) {
        delete li.originalAmount;
      }
      if (li.pricingType !== 'per_guest_ratio' && li.ratioGuests === 0) {
        delete li.ratioGuests;
      }
      if (li.pricingType !== 'percentage') {
        if (li.percentageRate === 0) delete li.percentageRate;
        if (li.percentageBasis === 'unknown') delete li.percentageBasis;
      }
      // If top-level lineItem.amount matches a conflictingOptions entry uniquely by amount
      // but carries the wrong pricingType from another option (e.g., flat $2,400 labeled per_person),
      // align the provisional pricingType with its matching option.
      if (Array.isArray(li.conflictingOptions) && typeof li.amount === 'number') {
        const opts = li.conflictingOptions.filter(
          (o): o is Record<string, unknown> =>
            typeof o === 'object' &&
            o !== null &&
            typeof (o as Record<string, unknown>).amount === 'number' &&
            typeof (o as Record<string, unknown>).pricingType === 'string',
        );
        const exactMatch = opts.some(
          (o) =>
            o.pricingType === li.pricingType &&
            Math.abs((o.amount as number) - (li.amount as number)) < 0.01,
        );
        if (!exactMatch) {
          const sameAmountMatches = opts.filter(
            (o) => Math.abs((o.amount as number) - (li.amount as number)) < 0.01,
          );
          if (sameAmountMatches.length === 1) {
            li.pricingType = sameAmountMatches[0]!.pricingType;
          }
        }
      }
    }
  }
  const sanitizeInclusions = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const rawInc of list) {
      if (typeof rawInc !== 'object' || rawInc === null || Array.isArray(rawInc)) continue;
      const inc = rawInc as Record<string, unknown>;
      if (
        typeof inc.unit === 'string' &&
        (inc.unit.trim().length > 30 || inc.unit.includes('_'))
      ) {
        delete inc.unit;
      }
    }
  };
  sanitizeInclusions(obj.inclusions);
  if (Array.isArray(obj.packages)) {
    for (const rawPkg of obj.packages) {
      if (typeof rawPkg === 'object' && rawPkg !== null && !Array.isArray(rawPkg)) {
        const pkgObj = rawPkg as Record<string, unknown>;
        if (pkgObj.gratuityBasis === null) {
          delete pkgObj.gratuityBasis;
        }
        sanitizeInclusions(pkgObj.inclusions);
      }
    }
    // Single-package quotes belong in lineItems (packages[] is strictly for >= 2 mutually exclusive tiers).
    // If the model put a single package in packages[], fold it into lineItems only if not already duplicated.
    if (obj.packages.length === 1 && Array.isArray(obj.lineItems)) {
      const onlyPkg = obj.packages[0] as Record<string, unknown>;
      // Propagate package-level tax/gratuity onto top-level ONLY when top-level was unset/unknown
      if (
        (obj.taxStatus === undefined || obj.taxStatus === 'unknown') &&
        typeof onlyPkg.taxStatus === 'string' &&
        onlyPkg.taxStatus !== 'unknown'
      ) {
        obj.taxStatus = onlyPkg.taxStatus;
      }
      if (
        (obj.taxPercent === undefined || obj.taxPercent === null) &&
        typeof onlyPkg.taxPercent === 'number'
      ) {
        obj.taxPercent = onlyPkg.taxPercent;
      }
      if (
        (obj.gratuityStatus === undefined || obj.gratuityStatus === 'unknown') &&
        typeof onlyPkg.gratuityStatus === 'string' &&
        onlyPkg.gratuityStatus !== 'unknown'
      ) {
        obj.gratuityStatus = onlyPkg.gratuityStatus;
      }
      if (
        (obj.gratuityPercent === undefined || obj.gratuityPercent === null) &&
        typeof onlyPkg.gratuityPercent === 'number'
      ) {
        obj.gratuityPercent = onlyPkg.gratuityPercent;
      }
      if (
        typeof onlyPkg.gratuityBasis === 'string' &&
        (obj.gratuityBasis === undefined ||
          (obj.gratuityBasis === 'unknown' && onlyPkg.gratuityBasis !== 'unknown'))
      ) {
        obj.gratuityBasis = onlyPkg.gratuityBasis;
      }
      const alreadyInLineItems = obj.lineItems.some((rawLi) => {
        if (typeof rawLi !== 'object' || rawLi === null) return false;
        const li = rawLi as Record<string, unknown>;
        return (
          li.pricingType === onlyPkg.pricingType &&
          typeof li.amount === 'number' &&
          typeof onlyPkg.amount === 'number' &&
          Math.abs(li.amount - onlyPkg.amount) < 0.01
        );
      });
      if (!alreadyInLineItems && typeof onlyPkg.name === 'string') {
        obj.lineItems.unshift({
          label: onlyPkg.name,
          pricingType: onlyPkg.pricingType ?? 'flat',
          amount: onlyPkg.amount ?? null,
          minGuests: onlyPkg.minGuests,
          hours: onlyPkg.hours,
          isFoodItem: onlyPkg.isFoodItem,
          chargeType: 'mandatory',
          sourceExcerpt: onlyPkg.sourceExcerpt ?? onlyPkg.name,
          pageReference: onlyPkg.pageReference,
        });
      }
      // Merge any package-level inclusions into quote.inclusions before clearing single-item packages[]
      if (Array.isArray(onlyPkg.inclusions) && onlyPkg.inclusions.length > 0) {
        const existingIncs = Array.isArray(obj.inclusions) ? obj.inclusions : [];
        obj.inclusions = [...onlyPkg.inclusions, ...existingIncs];
      }
      obj.packages = [];
    }
  }
  // Clear stray packageId values when quote does not have >= 2 mutually exclusive packages
  const hasMultiPackages = Array.isArray(obj.packages) && obj.packages.length >= 2;
  if (!hasMultiPackages && Array.isArray(obj.lineItems)) {
    for (const rawLi of obj.lineItems) {
      if (typeof rawLi === 'object' && rawLi !== null && !Array.isArray(rawLi)) {
        delete (rawLi as Record<string, unknown>).packageId;
      }
    }
  }
  return obj;
}

export async function extractQuote(
  rawMessage: string,
  options: {
    provider?: ProviderName;
    model?: string;
    mockLookup?: ExtractedQuote;
    attachments?: ExtractionAttachment[];
    onRetry?: (info: RetryInfo) => void;
  } = {},
): Promise<ExtractResult> {
  const provider =
    options.provider ??
    (process.env.EXTRACTOR_PROVIDER as ProviderName | undefined) ??
    (process.env.GEMINI_API_KEY ? 'gemini' : 'mock');

  const attachmentErrors = validateAttachments(options.attachments);
  if (attachmentErrors.length > 0) {
    throw new ExtractionError({
      message: attachmentErrors.join(' '),
      kind: 'api_error',
      rawMessage,
      statusCode: 400,
      retryCount: 0,
      latencyMs: 0,
      latencyWithoutRetriesMs: 0,
    });
  }

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

  const model = options.model ?? process.env.GEMINI_MODEL ?? 'gemini-flash-lite-latest';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const userParts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [];

  if (options.attachments && options.attachments.length > 0) {
    userParts.push({
      text: rawMessage.trim()
        ? `Extract quote facts from the attached quote document(s) and accompanying text note. Never invent details not visible in the source:\n\n${rawMessage}`
        : 'Extract quote facts from the attached wedding vendor quote document(s). Preserve exact visible text snippets in sourceExcerpt and include pageReference where available. Never invent details not visible in the document.',
    });
    for (const att of options.attachments) {
      userParts.push({
        inlineData: {
          mimeType: att.mimeType,
          data: att.base64Data,
        },
      });
    }
  } else {
    userParts.push({
      text: `Extract quote facts from this vendor message:\n\n${rawMessage}`,
    });
  }

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
            parts: userParts,
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
