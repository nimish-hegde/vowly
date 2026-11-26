import type {
  CurrencyCode,
  CurrencySource,
  LineItemPricingModel,
  PercentageBasis,
  Quote,
  QuoteAddOn,
  QuoteAttachmentPreview,
  QuoteConflict,
  QuoteEvidenceSpan,
  QuoteLineItem,
  QuotePaymentMilestone,
  QuoteUnconfirmedFee,
  StructuredInclusion,
  TaxHandling,
  VendorCategory,
} from '../types/vowly';

export const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export interface ExtractionAttachmentInput {
  mimeType: string;
  base64Data: string;
  fileName: string;
  sizeBytes: number;
  dataUrl?: string;
}

export interface ExtractionInput {
  sourceType: 'pasted_message' | 'pdf' | 'screenshot';
  sourceChannel: string;
  rawText: string;
  fileName?: string;
  attachments?: ExtractionAttachmentInput[];
  guestCount?: number;
  presetId?: string;
  targetVendorId?: string;
  targetEventIds?: string[];
}

export interface ExtractedQuoteResult {
  suggestedVendorName: string;
  vendorNameMissing?: boolean;
  suggestedCategory: VendorCategory;
  suggestedLocation: string;
  isDemoVenue: boolean;
  quote: Quote;
  isRevisionOfExistingVendorId?: string;
  extractionMeta?: {
    provider: string;
    model: string;
    latencyMs: number;
    tokenUsage?: { promptTokens: number; outputTokens: number; totalTokens: number };
  };
}

export function validateUploadFile(file: { name: string; type: string; size: number }): string | null {
  if (!ALLOWED_UPLOAD_MIME_TYPES.has(file.type)) {
    return `Unsupported format (${file.type || 'unknown'}). Please upload a PNG, JPEG, WebP, GIF, or PDF file.`;
  }
  if (file.size <= 0) {
    return `"${file.name}" is empty.`;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `"${file.name}" exceeds the 10 MB upload limit.`;
  }
  return null;
}

/**
 * Modular extraction interface so Vowly's production AI extraction backend
 * (Antigravity / Gemini quote extractor) can drop in cleanly later.
 */
export interface QuoteExtractionAdapter {
  extractQuote(input: ExtractionInput): Promise<ExtractedQuoteResult>;
}

export interface SampleQuotePreset {
  id: string;
  label: string;
  badge: string;
  description: string;
  sourceType: 'pasted_message' | 'pdf' | 'screenshot';
  sourceChannel: string;
  isDemoVenue?: boolean;
  rawText: string;
}

export const SAMPLE_QUOTE_PRESETS: SampleQuotePreset[] = [
  {
    id: 'preset-verdi-unconfirmed',
    label: 'Verdi Convention Centre — Revised WhatsApp',
    badge: 'Unconfirmed mandatory fee · CAD inferred',
    description:
      'Lower per-person rate in Mississauga, Ontario, but security & valet staffing remains unconfirmed (blocks approval, allows Save as Draft).',
    sourceType: 'pasted_message',
    sourceChannel: 'WhatsApp message',
    isDemoVenue: true,
    rawText: `Hi Meera & Kabir! Thanks for touring Verdi Convention Centre in Mississauga yesterday.
For your Aug 15, 2027 Grand Reception (approx 320 guests, min 280, hall fits up to 480):
- Deluxe South Asian dinner buffet + standard open bar: $88 per guest (down from $89)
- In-house AV, projector & stage lighting package: $1,200 flat (reduced from $1,500)
- Mandatory licensed security & valet staffing: fee TBD once bar hours are finalized
All rates exclude HST. 25% deposit upon booking, balance due 30 days prior to event.`,
  },
  {
    id: 'preset-crown-conflict-cash',
    label: 'Crown Cinema Films — IG DM vs. PDF Conflict',
    badge: 'Price conflict · Cash vs. Regular',
    description:
      'Instagram DM quotes $5,400 while the attached PDF lists $6,000, plus a cash option that does not automatically waive Ontario HST.',
    sourceType: 'pdf',
    sourceChannel: 'Instagram DM + Attached PDF',
    rawText: `[Instagram DM - Crown Cinema Films, Vaughan ON]
Hey Meera! For 4-event Sikh + Hindu wedding cinema coverage (Sangeet, Anand Karaj, Hindu Ceremony, Reception), we can do $5,400 for you guys. If you pay cash we can take $200 off ($5,200). Optional drone aerials add-on is $450.

[Attached PDF - 2027 Multi-Event Cinema Quote]
Full 4-Event Cinema Package (2 videographers, 6-min highlight film + full ceremony edits): CAD $6,000 + HST.
Deposit: $1,500 to hold dates. Remaining balance due 14 days before wedding weekend.`,
  },
  {
    id: 'preset-noor-beauty',
    label: 'Noor Bridal Artistry — Clean Email Quote',
    badge: 'Ready to approve · Relative deadline',
    description:
      'Explicit CAD quote covering bridal hair & makeup across 3 events with an optional dupatta setting add-on and Ontario HST noted.',
    sourceType: 'pasted_message',
    sourceChannel: 'Email',
    rawText: `Hi Meera,
So excited for your August 2027 wedding in the GTA! Here is your custom bridal quote (Brampton / Mississauga travel included):
- Bridal Hair, Makeup & Styling across Anand Karaj, Hindu Ceremony & Reception (3 looks): CAD $2,450
- Bridal Trial Session (Mississauga Studio): CAD $250
- Optional Add-on: Mother of the Bride + 2 Bridesmaids hair & makeup: CAD $600
Note: 13% HST applies to all services.
$600 retainer due upon confirmation. Final look schedule due 21 days prior to first ceremony.`,
  },
  {
    id: 'preset-versailles-revision',
    label: 'Versailles Convention Centre — Updated Revision',
    badge: 'Verified savings · Explicit CAD + HST',
    description:
      'Negotiated revision reducing per-person reception rate and AV fee with exact source citations.',
    sourceType: 'screenshot',
    sourceChannel: 'Email PDF Screenshot',
    isDemoVenue: true,
    rawText: `Versailles Convention Centre — Mississauga, ON (Revised Proposal #2)
Client: Meera Gill & Kabir Sharma | Event: Grand Reception (320 guests, min 250, max 550)
Updated Menu & Open Bar Package: CAD $91 per person (previously CAD $94 per person)
Lighting, Rigging & AV Package: CAD $1,350 flat (previously CAD $1,600)
Late-night Masala Chai & Jalebi Station (Optional Add-on): CAD $750
Plus 13% Ontario HST. Deposit: $6,000 on signing; 50% due 6 months prior; final count due 14 days prior.`,
  },
];

const CANADIAN_LOCATION_PATTERN =
  /\b(ontario|toronto|mississauga|brampton|vaughan|markham|oakville|burlington|etobicoke|scarborough|gta|canada|\bon\b)\b/i;

function detectCurrency(
  rawText: string,
  locationContext?: string
): { currency: CurrencyCode; source: CurrencySource } {
  if (/\bUSD\b|US\$/i.test(rawText)) {
    return { currency: 'USD', source: 'explicit_quote' };
  }
  if (/\bCAD\b|C\$|CDN/i.test(rawText)) {
    return { currency: 'CAD', source: 'explicit_quote' };
  }
  if (
    CANADIAN_LOCATION_PATTERN.test(rawText) ||
    (locationContext && CANADIAN_LOCATION_PATTERN.test(locationContext))
  ) {
    return { currency: 'CAD', source: 'inferred_canada' };
  }
  return { currency: 'UNKNOWN', source: 'unknown' };
}

function detectTaxHandling(rawText: string, isOntario: boolean): TaxHandling {
  if (/\b(hst\s+included|tax\s+included|inclusive\s+of\s+hst|all[\s-]in\s+with\s+hst)\b/i.test(rawText)) {
    return 'included';
  }
  if (/\b(\+\s*hst|plus\s+(13%\s+)?hst|exclude(s|d)?\s+hst|13%\s+hst\s+applies)\b/i.test(rawText)) {
    return 'excluded_plus_hst';
  }
  if (isOntario) {
    return 'unspecified_ontario_assumed';
  }
  return 'excluded_plus_hst';
}

export class SimulatedQuoteExtractor implements QuoteExtractionAdapter {
  async extractQuote(input: ExtractionInput): Promise<ExtractedQuoteResult> {
    // Simulated realistic processing delay handled cleanly by caller UI steps as well
    await new Promise((resolve) => setTimeout(resolve, 650));

    const nowDate = '2026-11-24';
    const uid = `q-${Date.now()}`;

    if (input.presetId === 'preset-verdi-unconfirmed') {
      const spans: QuoteEvidenceSpan[] = [
        {
          id: 'ev-verdi-loc',
          excerpt: 'Verdi Convention Centre in Mississauga',
          sourceLabel: 'WhatsApp line 1',
        },
        {
          id: 'ev-verdi-pp',
          excerpt: 'Deluxe South Asian dinner buffet + standard open bar: $88 per guest (down from $89)',
          sourceLabel: 'WhatsApp line 3',
        },
        {
          id: 'ev-verdi-av',
          excerpt: 'In-house AV, projector & stage lighting package: $1,200 flat (reduced from $1,500)',
          sourceLabel: 'WhatsApp line 4',
        },
        {
          id: 'ev-verdi-sec',
          excerpt: 'Mandatory licensed security & valet staffing: fee TBD once bar hours are finalized',
          sourceLabel: 'WhatsApp line 5',
        },
        {
          id: 'ev-verdi-tax',
          excerpt: 'All rates exclude HST. 25% deposit upon booking, balance due 30 days prior to event.',
          sourceLabel: 'WhatsApp line 6',
        },
      ];
      return {
        suggestedVendorName: 'Verdi Convention Centre',
        suggestedCategory: 'venue',
        suggestedLocation: 'Mississauga, ON, Canada',
        isDemoVenue: true,
        isRevisionOfExistingVendorId: 'ven-verdi',
        quote: {
          id: uid,
          title: 'Revised Reception Quote (WhatsApp)',
          approvalState: 'draft',
          quoteKind: 'personalized',
          receivedDate: nowDate,
          sourceType: input.sourceType,
          sourceChannel: input.sourceChannel,
          sourceText: input.rawText,
          currency: 'CAD',
          currencySource: 'inferred_canada',
          locationContext: 'Mississauga, ON, Canada',
          taxHandling: 'excluded_plus_hst',
          minGuests: 280,
          maxCapacity: 480,
          lineItems: [
            {
              id: 'li-verdi-pp-rev',
              label: 'Deluxe South Asian Dinner Buffet & Open Bar',
              pricingModel: 'per_person',
              unitPrice: 88,
              eventId: 'evt-reception',
              minGuests: 280,
              evidenceId: 'ev-verdi-pp',
            },
            {
              id: 'li-verdi-av-rev',
              label: 'In-House AV, Projector & Stage Lighting',
              pricingModel: 'flat',
              unitPrice: 1200,
              evidenceId: 'ev-verdi-av',
            },
          ],
          addOns: [],
          unconfirmedFees: [
            {
              id: 'uf-verdi-sec-rev',
              label: 'Mandatory Licensed Security & Valet Staffing',
              description:
                'Required by venue for bar service; exact fee not quoted yet. Must be confirmed or saved as draft.',
              mandatory: true,
              status: 'unconfirmed',
              evidenceId: 'ev-verdi-sec',
            },
          ],
          conflicts: [],
          inclusions: [
            'Deluxe South Asian dinner buffet',
            'Standard open bar',
            'In-house AV, projector & stage lighting',
          ],
          cateringAndBarSummary: 'Deluxe South Asian buffet + standard open bar',
          avAndStaffingSummary: '$1,200 AV flat; security & valet fee unconfirmed',
          paymentTermsSummary: '25% deposit on booking; balance due 30 days prior to event.',
          depositPercent: 25,
          clarificationQuestions: [
            'What is the exact mandatory licensed security & valet staffing fee for our reception bar hours?',
            'Are late-night tea/sweets included or billed separately?',
          ],
          evidenceSpans: spans,
          revisions: [
            {
              id: 'rev-verdi-2',
              date: nowDate,
              summary: 'Per-person reduced from $89 to $88; AV reduced from $1,500 to $1,200',
              previousPreTaxTotal: 320 * 89 + 1500,
              newPreTaxTotal: 320 * 88 + 1200,
              previousPerPerson: 89,
              newPerPerson: 88,
              note: 'Security & valet fee still open.',
            },
          ],
        },
      };
    }

    if (input.presetId === 'preset-crown-conflict-cash') {
      const spans: QuoteEvidenceSpan[] = [
        {
          id: 'ev-crown-dm',
          excerpt: 'we can do $5,400 for you guys.',
          sourceLabel: 'Instagram DM',
        },
        {
          id: 'ev-crown-cash',
          excerpt: 'If you pay cash we can take $200 off ($5,200).',
          sourceLabel: 'Instagram DM',
        },
        {
          id: 'ev-crown-drone',
          excerpt: 'Optional drone aerials add-on is $450.',
          sourceLabel: 'Instagram DM',
        },
        {
          id: 'ev-crown-pdf',
          excerpt: 'Full 4-Event Cinema Package (2 videographers, 6-min highlight film + full ceremony edits): CAD $6,000 + HST.',
          sourceLabel: 'Attached PDF',
        },
        {
          id: 'ev-crown-dep',
          excerpt: 'Deposit: $1,500 to hold dates. Remaining balance due 14 days before wedding weekend.',
          sourceLabel: 'Attached PDF',
        },
      ];
      return {
        suggestedVendorName: 'Crown Cinema Films',
        suggestedCategory: 'videography',
        suggestedLocation: 'Vaughan, ON, Canada',
        isDemoVenue: false,
        isRevisionOfExistingVendorId: 'ven-crown',
        quote: {
          id: uid,
          title: '4-Event Wedding Cinema Package (DM vs PDF)',
          approvalState: 'draft',
          quoteKind: 'personalized',
          receivedDate: nowDate,
          sourceType: input.sourceType,
          sourceChannel: input.sourceChannel,
          sourceText: input.rawText,
          currency: 'CAD',
          currencySource: 'explicit_quote',
          locationContext: 'Vaughan, ON, Canada',
          taxHandling: 'excluded_plus_hst',
          lineItems: [
            {
              id: 'li-crown-pkg',
              label: 'Full 4-Event Cinema Coverage (2 Videographers)',
              pricingModel: 'flat',
              unitPrice: 5400,
              evidenceId: 'ev-crown-dm',
            },
          ],
          addOns: [
            {
              id: 'ao-crown-drone',
              label: 'Drone Aerial Coverage',
              description: 'Outdoor aerial footage for Anand Karaj & Reception venue arrival.',
              pricePreTax: 450,
              selected: false,
              evidenceId: 'ev-crown-drone',
            },
          ],
          unconfirmedFees: [],
          conflicts: [
            {
              id: 'conf-crown-price',
              fieldLabel: '4-Event Cinema Package Base Price',
              description:
                'Instagram DM states $5,400, while the attached PDF lists CAD $6,000. Select the confirmed price before approving.',
              targetLineItemId: 'li-crown-pkg',
              options: [
                {
                  id: 'opt-dm-5400',
                  label: '$5,400 (Personalized Instagram DM)',
                  sourceLabel: 'Instagram DM',
                  amount: 5400,
                  evidenceId: 'ev-crown-dm',
                },
                {
                  id: 'opt-pdf-6000',
                  label: '$6,000 (Attached PDF Quote)',
                  sourceLabel: 'Attached PDF',
                  amount: 6000,
                  evidenceId: 'ev-crown-pdf',
                },
              ],
            },
          ],
          paymentOptions: [
            {
              id: 'payopt-regular',
              label: 'Regular Payment (E-Transfer / Card)',
              method: 'regular',
              adjustmentDelta: 0,
              taxHandling: 'excluded_plus_hst',
              note: 'Standard price plus 13% Ontario HST.',
              evidenceId: 'ev-crown-pdf',
            },
            {
              id: 'payopt-cash',
              label: 'Cash Payment Option (-$200)',
              method: 'cash',
              adjustmentDelta: -200,
              taxHandling: 'unspecified_ontario_assumed',
              note: '13% Ontario HST still estimated — Vowly never assumes cash is tax-free.',
              evidenceId: 'ev-crown-cash',
            },
          ],
          selectedPaymentOptionId: 'payopt-regular',
          inclusions: [
            '4 events covered (Sangeet, Anand Karaj, Hindu Ceremony, Reception)',
            '2 lead videographers',
            '6-minute cinematic highlight film',
            'Full edited ceremony & speeches films',
          ],
          paymentTermsSummary: '$1,500 deposit to hold dates; balance due 14 days before wedding weekend.',
          depositAmount: 1500,
          clarificationQuestions: [
            'Can you issue an updated PDF reflecting the $5,400 Instagram DM rate?',
            'Does the cash discount include an official HST receipt?',
          ],
          evidenceSpans: spans,
        },
      };
    }

    if (input.presetId === 'preset-noor-beauty') {
      const spans: QuoteEvidenceSpan[] = [
        {
          id: 'ev-noor-bridal',
          excerpt: 'Bridal Hair, Makeup & Styling across Anand Karaj, Hindu Ceremony & Reception (3 looks): CAD $2,450',
          sourceLabel: 'Email bullet 1',
        },
        {
          id: 'ev-noor-trial',
          excerpt: 'Bridal Trial Session (Mississauga Studio): CAD $250',
          sourceLabel: 'Email bullet 2',
        },
        {
          id: 'ev-noor-addon',
          excerpt: 'Optional Add-on: Mother of the Bride + 2 Bridesmaids hair & makeup: CAD $600',
          sourceLabel: 'Email bullet 3',
        },
        {
          id: 'ev-noor-tax',
          excerpt: 'Note: 13% HST applies to all services.',
          sourceLabel: 'Email line 6',
        },
      ];
      return {
        suggestedVendorName: 'Noor Bridal Artistry',
        suggestedCategory: 'beauty',
        suggestedLocation: 'Mississauga, ON, Canada',
        isDemoVenue: false,
        isRevisionOfExistingVendorId: 'ven-noor',
        quote: {
          id: uid,
          title: '3-Event Bridal Hair & Makeup Quote',
          approvalState: 'draft',
          quoteKind: 'personalized',
          receivedDate: nowDate,
          sourceType: input.sourceType,
          sourceChannel: input.sourceChannel,
          sourceText: input.rawText,
          currency: 'CAD',
          currencySource: 'explicit_quote',
          locationContext: 'Mississauga, ON, Canada',
          taxHandling: 'excluded_plus_hst',
          lineItems: [
            {
              id: 'li-noor-bridal',
              label: 'Bridal Hair, Makeup & Dupatta Styling (3 Looks)',
              pricingModel: 'flat',
              unitPrice: 2450,
              evidenceId: 'ev-noor-bridal',
            },
            {
              id: 'li-noor-trial',
              label: 'Bridal Studio Trial Session',
              pricingModel: 'flat',
              unitPrice: 250,
              evidenceId: 'ev-noor-trial',
            },
          ],
          addOns: [
            {
              id: 'ao-noor-family',
              label: 'Mother of Bride + 2 Bridesmaids Hair & Makeup',
              description: 'On-location hair & makeup for 3 family/bridal party members.',
              pricePreTax: 600,
              selected: false,
              evidenceId: 'ev-noor-addon',
            },
          ],
          unconfirmedFees: [],
          conflicts: [],
          inclusions: [
            '3 full bridal looks (Anand Karaj, Hindu Ceremony, Reception)',
            'Brampton & Mississauga travel included',
            'Bridal studio trial session',
          ],
          paymentTermsSummary: '$600 retainer on confirmation; look schedule due 21 days prior to first ceremony.',
          depositAmount: 600,
          clarificationQuestions: [
            'Are early-morning call times before 5:30 AM included for the Anand Karaj?',
          ],
          evidenceSpans: spans,
        },
      };
    }

    if (input.presetId === 'preset-versailles-revision') {
      const spans: QuoteEvidenceSpan[] = [
        {
          id: 'ev-vers-pp',
          excerpt: 'Updated Menu & Open Bar Package: CAD $91 per person (previously CAD $94 per person)',
          sourceLabel: 'Proposal #2 line 3',
        },
        {
          id: 'ev-vers-av',
          excerpt: 'Lighting, Rigging & AV Package: CAD $1,350 flat (previously CAD $1,600)',
          sourceLabel: 'Proposal #2 line 4',
        },
        {
          id: 'ev-vers-chai',
          excerpt: 'Late-night Masala Chai & Jalebi Station (Optional Add-on): CAD $750',
          sourceLabel: 'Proposal #2 line 5',
        },
      ];
      return {
        suggestedVendorName: 'Versailles Convention Centre',
        suggestedCategory: 'venue',
        suggestedLocation: 'Mississauga, ON, Canada',
        isDemoVenue: true,
        isRevisionOfExistingVendorId: 'ven-versailles',
        quote: {
          id: uid,
          title: 'Revised Proposal #2 — Grand Reception',
          approvalState: 'draft',
          quoteKind: 'personalized',
          receivedDate: nowDate,
          sourceType: input.sourceType,
          sourceChannel: input.sourceChannel,
          sourceText: input.rawText,
          currency: 'CAD',
          currencySource: 'explicit_quote',
          locationContext: 'Mississauga, ON, Canada',
          taxHandling: 'excluded_plus_hst',
          minGuests: 250,
          maxCapacity: 550,
          lineItems: [
            {
              id: 'li-vers-pp-2',
              label: 'Deluxe Reception Menu & Open Bar',
              pricingModel: 'per_person',
              unitPrice: 91,
              eventId: 'evt-reception',
              minGuests: 250,
              evidenceId: 'ev-vers-pp',
            },
            {
              id: 'li-vers-av-2',
              label: 'Lighting, Rigging & AV Package',
              pricingModel: 'flat',
              unitPrice: 1350,
              evidenceId: 'ev-vers-av',
            },
          ],
          addOns: [
            {
              id: 'ao-vers-chai',
              label: 'Late-Night Masala Chai & Jalebi Station',
              description: 'Live jalebi & masala chai service during dance floor hours.',
              pricePreTax: 750,
              selected: false,
              evidenceId: 'ev-vers-chai',
            },
          ],
          unconfirmedFees: [],
          conflicts: [],
          inclusions: [
            '5-course / buffet South Asian reception dinner',
            'Premium open bar & bartender staffing included',
            'Banquet chairs, white linens & security included',
            'Lighting, rigging & AV package',
          ],
          cateringAndBarSummary: 'In-house South Asian catering + premium open bar included',
          avAndStaffingSummary: '$1,350 AV & rigging; bartenders & security included',
          paymentTermsSummary: '$6,000 deposit on signing; 50% due 6 months prior; final count 14 days prior.',
          depositAmount: 6000,
          clarificationQuestions: [
            'Does the updated rate keep complimentary bridal suite access until midnight?',
          ],
          evidenceSpans: spans,
          revisions: [
            {
              id: 'rev-vers-3',
              date: nowDate,
              summary: 'Negotiated $3/guest reduction ($94 → $91) and $250 off AV ($1,600 → $1,350)',
              previousPreTaxTotal: 320 * 94 + 1600,
              newPreTaxTotal: 320 * 91 + 1350,
              previousPerPerson: 94,
              newPerPerson: 91,
              note: 'Saves $1,210 before tax ($1,367.30 incl. HST) vs prior quote.',
            },
          ],
        },
      };
    }

    // Generic heuristic extraction for any custom pasted text or uploaded file
    const text = input.rawText.trim() || `Uploaded file: ${input.fileName ?? 'Vendor Quote'}`;
    const isOntario = CANADIAN_LOCATION_PATTERN.test(text);
    const { currency, source: currencySource } = detectCurrency(
      text,
      isOntario ? 'Ontario, Canada' : undefined
    );
    const taxHandling = detectTaxHandling(text, isOntario);

    const perPersonMatch = text.match(/\$\s?([\d,]+(?:\.\d{1,2})?)\s*(?:\/\s*person|per\s+(?:person|guest)|pp)/i);
    const allMoneyMatches = [...text.matchAll(/\$\s?([\d,]+(?:\.\d{1,2})?)/g)]
      .map((m) => parseFloat(m[1].replace(/,/g, '')))
      .filter((n) => !Number.isNaN(n) && n > 0);

    const firstLine = text.split('\n')[0]?.slice(0, 48).trim() || 'New Vendor Quote';
    const inferredVendor =
      firstLine.length > 4 && !firstLine.toLowerCase().startsWith('hi ')
        ? firstLine.replace(/[-:—].*$/, '').trim()
        : input.fileName
          ? input.fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')
          : 'Imported Vendor';

    const category: VendorCategory = /venue|hall|convention|banquet|palace/i.test(text)
      ? 'venue'
      : /photo|camera|album|shoot/i.test(text)
        ? 'photography'
        : /video|cinema|film/i.test(text)
          ? 'videography'
          : /decor|mandap|floral|stage/i.test(text)
            ? 'decor'
            : /cater|buffet|menu|chaat/i.test(text)
              ? 'catering'
              : /dj|dhol|music|sound/i.test(text)
                ? 'dj'
                : /makeup|hair|mehndi|bridal/i.test(text)
                  ? 'beauty'
                  : 'other';

    const hasUnconfirmedFee = /\b(tbd|unconfirmed|to be confirmed|extra fee|additional charge)\b/i.test(
      text
    );

    const lineItems = perPersonMatch
      ? [
          {
            id: `li-custom-pp-${Date.now()}`,
            label: 'Per-Person Package Rate',
            pricingModel: 'per_person' as const,
            unitPrice: parseFloat(perPersonMatch[1].replace(/,/g, '')),
            eventId: input.targetEventIds?.[0],
            evidenceId: 'ev-custom-1',
          },
        ]
      : [
          {
            id: `li-custom-flat-${Date.now()}`,
            label: 'Quoted Package Total',
            pricingModel: 'flat' as const,
            unitPrice: allMoneyMatches[0] ?? 2500,
            evidenceId: 'ev-custom-1',
          },
        ];

    const spans: QuoteEvidenceSpan[] = [
      {
        id: 'ev-custom-1',
        excerpt: text.slice(0, 140),
        sourceLabel: input.sourceChannel,
      },
    ];

    return {
      suggestedVendorName: inferredVendor,
      suggestedCategory: category,
      suggestedLocation: isOntario ? 'Greater Toronto Area, ON, Canada' : 'Location unspecified',
      isDemoVenue: /bombay palace|versailles|verdi|grand empire|apollo|chandni/i.test(text),
      quote: {
        id: uid,
        title: input.fileName ? `Imported: ${input.fileName}` : 'Imported Vendor Quote',
        approvalState: 'draft',
        quoteKind: 'personalized',
        receivedDate: nowDate,
        sourceType: input.sourceType,
        sourceChannel: input.sourceChannel,
        sourceText: text,
        currency,
        currencySource,
        locationContext: isOntario ? 'Greater Toronto Area, ON, Canada' : undefined,
        taxHandling,
        lineItems,
        addOns: [],
        unconfirmedFees: hasUnconfirmedFee
          ? [
              {
                id: `uf-custom-${Date.now()}`,
                label: 'Unconfirmed Additional Fee Mentioned in Quote',
                description:
                  'Source text mentions a TBD or unconfirmed extra charge. Confirm amount or save as draft.',
                mandatory: true,
                status: 'unconfirmed',
                evidenceId: 'ev-custom-1',
              },
            ]
          : [],
        conflicts: [],
        inclusions: ['Review and edit package inclusions extracted from source text'],
        paymentTermsSummary: 'Confirm deposit schedule and payment milestones with vendor.',
        clarificationQuestions: [
          ...(currency === 'UNKNOWN'
            ? ['Confirm whether quoted amounts are in CAD or USD.']
            : []),
          ...(taxHandling === 'unspecified_ontario_assumed'
            ? ['Confirm whether 13% Ontario HST is excluded or included in the quote.']
            : []),
          ...(hasUnconfirmedFee
            ? ['Request a written amount for the TBD fee mentioned in the quote.']
            : []),
        ],
        evidenceSpans: spans,
      },
    };
  }
}

interface BackendLineItem {
  label: string;
  pricingType: string;
  amount: number | null;
  minGuests?: number;
  guestThreshold?: number;
  packageId?: string;
  ratioGuests?: number;
  unitLabel?: string;
  hours?: number;
  percentageRate?: number;
  percentageBasis?: PercentageBasis;
  percentageTargetLabels?: string[];
  customBasisAmount?: number;
  originalAmount?: number;
  isThirdParty?: boolean;
  thirdPartyProvider?: string;
  isFoodItem?: boolean;
  chargeType?: 'mandatory' | 'conditional' | 'optional';
  optionalAddon?: boolean;
  conflictingOptions?: Array<{
    sourceLabel: string;
    pricingType: string;
    amount: number;
    sourceExcerpt: string;
  }>;
  sourceExcerpt: string;
  pageReference?: string;
}

interface BackendPackageOption {
  id: string;
  name: string;
  pricingType: 'flat' | 'per_person' | 'unknown';
  amount: number | null;
  minGuests?: number;
  includedGuests?: number;
  extraGuestRate?: number;
  maxCapacity?: number;
  hours?: number;
  isFoodItem?: boolean;
  fees?: BackendLineItem[];
  taxStatus?: 'included' | 'excluded' | 'unknown';
  taxPercent?: number | null;
  gratuityStatus?: 'included' | 'excluded' | 'unknown';
  gratuityPercent?: number | null;
  gratuityBasis?: PercentageBasis;
  inclusions?: StructuredInclusion[];
  deliveryTerms?: string[];
  paymentTerms?: {
    depositAmount?: number;
    depositPercent?: number;
    methodRule: string;
    scheduleNotes?: string;
    milestones?: QuotePaymentMilestone[];
  };
  sourceExcerpt: string;
  pageReference?: string;
}

interface BackendExtractedQuote {
  vendorName: string | null;
  vendorLocation?: string | null;
  vendorContact?: { name?: string; email?: string; phone?: string };
  category: string;
  events: string[];
  quotedDate?: string;
  quoteKind: 'initial' | 'revision';
  currency: CurrencyCode;
  taxStatus: 'included' | 'excluded' | 'unknown';
  taxPercent?: number | null;
  gratuityStatus: 'included' | 'excluded' | 'unknown';
  gratuityPercent?: number | null;
  gratuityBasis?: PercentageBasis;
  serviceDurationHours?: number;
  packages?: BackendPackageOption[];
  selectedPackageId?: string | null;
  lineItems: BackendLineItem[];
  inclusions?: StructuredInclusion[];
  deliveryTerms?: string[];
  exclusions?: string[];
  restrictions?: string[];
  venueDetails?: {
    roomName?: string;
    maxCapacity?: number;
    minGuests?: number;
    packageName?: string;
    dayOfWeek?: string;
  };
  photographerDetails?: {
    hoursIncluded?: number;
    extraHourRate?: number;
    teamSize?: number;
    includesMiniShoot?: boolean | 'unknown';
  };
  paymentTerms?: {
    depositAmount?: number;
    depositPercent?: number;
    methodRule: string;
    scheduleNotes?: string;
    milestones?: QuotePaymentMilestone[];
  };
  openQuestions: Array<{
    question: string;
    reason: string;
    sourceExcerpt: string;
    pageReference?: string;
  }>;
}

export interface BackendExtractResponse {
  session?: {
    id: string;
    draftQuote: BackendExtractedQuote;
    sourceWarnings?: string[];
  };
  meta?: {
    provider: string;
    model: string;
    latencyMs: number;
    tokenUsage?: { promptTokens: number; outputTokens: number; totalTokens: number };
  };
  error?: string;
}

function mapBackendCategory(cat: string): VendorCategory {
  switch (cat) {
    case 'venue':
      return 'venue';
    case 'catering':
      return 'catering';
    case 'photographer':
      return 'photography';
    case 'dj':
      return 'dj';
    case 'decor':
      return 'decor';
    case 'entertainment':
      return 'entertainment';
    default:
      return 'other';
  }
}

const INTERNAL_SCHEMA_TOKENS = new Set([
  'deliverables',
  'deliverable',
  'team',
  'included',
  'mandatory',
  'conditional',
  'optional',
  'flat',
  'per_person',
  'per_extra_guest',
  'per_hour',
  'per_guest_ratio',
  'percentage',
  'unknown',
  'other',
  'none',
  'n/a',
  'item',
  'items',
  'unit',
  'units',
]);

const ROLE_OR_STATION_PATTERN =
  /\b(photographer|videographer|cinematographer|shooter|assistant|dj|mc|bartender|server|coordinator|planner|booth|station)\b/i;

function isInternalSchemaToken(value: string | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 30) return true;
  const lower = trimmed.toLowerCase();
  if (INTERNAL_SCHEMA_TOKENS.has(lower)) return true;
  // Detect snake_case or internal identifier tokens (e.g., "photography_coverage")
  if (trimmed.includes('_')) return true;
  return false;
}

function cleanInclusionName(name: string): string {
  // Strip parenthetical internal schema tags like "(photography_coverage)" or trailing "[deliverables]"
  return name
    .replace(/\s*\(([a-z0-9]+_[a-z0-9_]+|deliverables|included|mandatory|conditional|optional|flat|team)\)/gi, '')
    .replace(/\s*\[([a-z0-9]+_[a-z0-9_]+|deliverables|included|mandatory|conditional|optional|flat|team)\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function singularStem(word: string): string {
  const lower = word.toLowerCase().trim();
  if (lower === 'hrs' || lower === 'hr' || lower === 'hours' || lower === 'hour') return 'hour';
  if (lower.endsWith('ies') && lower.length > 4) return `${lower.slice(0, -3)}y`;
  if (lower.endsWith('s') && lower.length > 3) return lower.slice(0, -1);
  return lower;
}

export function formatStructuredInclusion(inc: StructuredInclusion): string {
  const cleanName = cleanInclusionName(inc.name);
  const rawUnit = inc.unit && !isInternalSchemaToken(inc.unit) ? inc.unit.trim() : undefined;
  const qty = inc.quantity !== undefined && Number.isFinite(inc.quantity) ? inc.quantity : undefined;
  const durationHours =
    inc.durationHours !== undefined && Number.isFinite(inc.durationHours) && inc.durationHours > 0
      ? inc.durationHours
      : undefined;

  if (!cleanName) {
    if (qty !== undefined && rawUnit) return `${qty} ${rawUnit}`;
    return '';
  }

  // Case 1: explicit durationHours on a role or service (e.g., "Second photographer (5 hours coverage)")
  if (durationHours !== undefined) {
    const durationLabel = `${durationHours} hour${durationHours === 1 ? '' : 's'} coverage`;
    const nameAlreadyHasHours = new RegExp(`\\b${durationHours}\\s*(?:hours?|hrs?)\\b`, 'i').test(cleanName);
    const base =
      qty !== undefined &&
      qty > 1 &&
      !new RegExp(`^${qty}\\b`).test(cleanName)
        ? `${qty} ${cleanName}`
        : cleanName;
    return nameAlreadyHasHours ? base : `${base} (${durationLabel})`;
  }

  // Case 2: quantity + unit where unit is hours on a role/station name (e.g., { name: "Second photographer", quantity: 5, unit: "hours" })
  if (
    qty !== undefined &&
    rawUnit &&
    /^(hours?|hrs?)$/i.test(rawUnit) &&
    ROLE_OR_STATION_PATTERN.test(cleanName) &&
    !/\b(hours?|hrs?)\b/i.test(cleanName)
  ) {
    return `${cleanName} (${qty} hour${qty === 1 ? '' : 's'} coverage)`;
  }

  // Case 3: name already starts with or embeds the exact quantity (prevent "2 2 photographers" or "5 hours (5 hours coverage)")
  if (qty !== undefined) {
    const startsWithQty = new RegExp(`^${qty}\\b`).test(cleanName);
    const embedsQtyAndUnit =
      rawUnit !== undefined &&
      new RegExp(`\\b${qty}\\s*[-–]?\\s*${singularStem(rawUnit)}s?\\b`, 'i').test(cleanName);
    if (startsWithQty || embedsQtyAndUnit) {
      return cleanName;
    }
  }

  if (qty !== undefined && rawUnit) {
    const nameLower = cleanName.toLowerCase();
    const unitStem = singularStem(rawUnit);
    if (nameLower.includes(unitStem)) {
      return `${qty} ${cleanName}`;
    }
    return `${qty} ${rawUnit} (${cleanName})`;
  }

  if (qty !== undefined) {
    return `${qty} ${cleanName}`;
  }

  return cleanName;
}

const WORD_TO_HOURS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

function parseHoursFromText(text: string): number | undefined {
  const numMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(?:-|\s)?(?:hours?|hrs?)\b/i);
  if (numMatch) {
    const val = Number(numMatch[1]);
    if (Number.isFinite(val) && val > 0) return val;
  }
  const wordMatch = text.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:-|\s)?(?:hours?|hrs?)\b/i
  );
  if (wordMatch) {
    return WORD_TO_HOURS[wordMatch[1].toLowerCase()];
  }
  return undefined;
}

const OVERTIME_PATTERN =
  /\b(additional|extra|overtime|extension|extended|subsequent)\s*(hours?|hrs?)\b|\b(hours?|hrs?)\s*(extension|overtime)\b|\b(after|beyond)\s+\d+\s*(hours?|hrs?)\b|\bovertime\b/i;

function findIncludedHoursFromBackendQuote(bq: BackendExtractedQuote, excludeIdx: number): number | undefined {
  let hasSiblingFlat = Boolean(bq.packages?.some((p) => p.pricingType === 'flat'));
  for (let i = 0; i < bq.lineItems.length; i++) {
    if (i === excludeIdx) continue;
    const sibling = bq.lineItems[i];
    if (sibling.optionalAddon === true || sibling.chargeType === 'optional') continue;
    if (sibling.pricingType === 'flat' || sibling.pricingType === 'included') {
      hasSiblingFlat = true;
      if (sibling.hours !== undefined && sibling.hours > 0) return sibling.hours;
    }
  }
  if (hasSiblingFlat && bq.photographerDetails?.hoursIncluded && bq.photographerDetails.hoursIncluded > 0) {
    return bq.photographerDetails.hoursIncluded;
  }
  if (hasSiblingFlat && bq.serviceDurationHours && bq.serviceDurationHours > 0) {
    return bq.serviceDurationHours;
  }
  for (let i = 0; i < bq.lineItems.length; i++) {
    if (i === excludeIdx) continue;
    const sibling = bq.lineItems[i];
    if (sibling.optionalAddon === true || sibling.chargeType === 'optional') continue;
    if (sibling.pricingType === 'flat' || sibling.pricingType === 'included') {
      const fromLabel = parseHoursFromText(sibling.label);
      if (fromLabel !== undefined) return fromLabel;
      const fromExcerpt = parseHoursFromText(sibling.sourceExcerpt);
      if (fromExcerpt !== undefined) return fromExcerpt;
    }
  }
  if (hasSiblingFlat && bq.inclusions) {
    for (const inc of bq.inclusions) {
      if (
        inc.quantity !== undefined &&
        inc.quantity > 0 &&
        inc.unit &&
        /\b(hours?|hrs?)\b/i.test(inc.unit) &&
        !/\b(second|2nd|assistant|booth)\b/i.test(inc.name)
      ) {
        return inc.quantity;
      }
      const fromInc = parseHoursFromText(inc.name);
      if (fromInc !== undefined && !/\b(second|2nd|assistant|booth)\b/i.test(inc.name)) {
        return fromInc;
      }
    }
  }
  return undefined;
}

function mapPricingTypeToModel(pricingType: string): LineItemPricingModel {
  if (pricingType === 'per_person') return 'per_person';
  if (pricingType === 'per_extra_guest') return 'per_extra_guest';
  if (pricingType === 'per_hour') return 'hourly';
  if (pricingType === 'per_guest_ratio') return 'guest_ratio';
  if (pricingType === 'percentage') return 'percentage';
  return 'flat';
}

function mapBackendTaxStatus(status: 'included' | 'excluded' | 'unknown' | undefined): TaxHandling {
  if (status === 'included') return 'included';
  if (status === 'excluded') return 'excluded_plus_hst';
  return 'unspecified';
}

export function mapBackendExtractionToFrontendResult(
  payload: BackendExtractResponse,
  input: ExtractionInput
): ExtractedQuoteResult {
  const bq = payload.session?.draftQuote;
  if (!bq) {
    throw new Error(payload.error || 'Backend extraction returned no quote data.');
  }

  const nowDate = new Date().toISOString().slice(0, 10);
  const uid = `q-${Date.now()}`;
  const evidenceSpans: QuoteEvidenceSpan[] = [];
  const addEvidence = (excerpt: string | undefined, label: string, pageRef?: string): string | undefined => {
    const clean = excerpt?.trim();
    if (!clean) return undefined;
    const id = `ev-${evidenceSpans.length + 1}`;
    evidenceSpans.push({
      id,
      excerpt: clean,
      sourceLabel: pageRef ? `${label} · ${pageRef}` : label,
    });
    return id;
  };

  const lineItems: QuoteLineItem[] = [];
  const addOns: QuoteAddOn[] = [];
  const unconfirmedFees: QuoteUnconfirmedFee[] = [];
  const conflicts: QuoteConflict[] = [];
  const inclusionStrings: string[] = [];

  bq.lineItems.forEach((item, idx) => {
    const evId = addEvidence(item.sourceExcerpt, item.label, item.pageReference);
    const isOptional = item.optionalAddon === true || item.chargeType === 'optional';

    if (item.pricingType === 'included') {
      inclusionStrings.push(item.label);
      return;
    }

    if (item.pricingType === 'unknown' || item.amount === null) {
      unconfirmedFees.push({
        id: `uf-${idx}-${Date.now()}`,
        label: item.label,
        description: item.sourceExcerpt || 'Stated charge without a confirmed dollar amount.',
        mandatory: !isOptional,
        status: 'unconfirmed',
        evidenceId: evId,
      });
      return;
    }

    if (isOptional) {
      const addOnModel = mapPricingTypeToModel(item.pricingType);
      addOns.push({
        id: `ao-${idx}-${Date.now()}`,
        label: item.label,
        description: item.sourceExcerpt || 'Optional add-on',
        pricePreTax: addOnModel === 'percentage' ? (item.percentageRate ?? item.amount) : item.amount,
        pricingModel: addOnModel,
        quantity: addOnModel === 'hourly' ? item.hours : undefined,
        ratioDivisor: item.ratioGuests,
        unitLabel: item.unitLabel,
        minGuests: item.minGuests,
        eventId: input.targetEventIds?.[0],
        percentageBasis: item.percentageBasis,
        percentageTargetLabels: item.percentageTargetLabels,
        customBasisAmount: item.customBasisAmount,
        selected: false,
        evidenceId: evId,
      });
      return;
    }

    const pricingModel = mapPricingTypeToModel(item.pricingType);
    const includedPackageHours =
      pricingModel === 'hourly' ? findIncludedHoursFromBackendQuote(bq, idx) : undefined;
    const isConditionalOvertime =
      pricingModel === 'hourly' &&
      includedPackageHours !== undefined &&
      !(item.hours !== undefined && item.hours > 1) &&
      ((bq.photographerDetails?.extraHourRate !== undefined &&
        Math.abs(item.amount - bq.photographerDetails.extraHourRate) < 0.01) ||
        OVERTIME_PATTERN.test(item.label) ||
        OVERTIME_PATTERN.test(item.sourceExcerpt));

    const liId = `li-${idx}-${Date.now()}`;
    lineItems.push({
      id: liId,
      label: item.label,
      pricingModel,
      unitPrice: pricingModel === 'percentage' ? (item.percentageRate ?? item.amount) : item.amount,
      quantity:
        pricingModel === 'hourly'
          ? isConditionalOvertime
            ? 0
            : item.hours
          : undefined,
      isConditionalOvertime: isConditionalOvertime || undefined,
      includedPackageHours: isConditionalOvertime ? includedPackageHours : undefined,
      ratioDivisor: item.ratioGuests,
      unitLabel: item.unitLabel,
      percentageBasis: item.percentageBasis,
      percentageTargetLabels: item.percentageTargetLabels,
      customBasisAmount: item.customBasisAmount,
      originalUnitPrice: item.originalAmount,
      isThirdParty: item.isThirdParty,
      thirdPartyProvider: item.thirdPartyProvider,
      isFoodItem: item.isFoodItem,
      minGuests: item.minGuests ?? bq.venueDetails?.minGuests,
      guestThreshold: item.guestThreshold,
      packageId: item.packageId,
      eventId: input.targetEventIds?.[0],
      evidenceId: evId,
      pageReference: item.pageReference,
    });

    if (item.conflictingOptions && item.conflictingOptions.length > 0) {
      const options: QuoteConflict['options'] = [];
      const hasPrimary = item.conflictingOptions.some(
        (o) => Math.abs(o.amount - item.amount!) < 0.01
      );
      if (!hasPrimary) {
        options.push({
          id: `opt-${idx}-primary`,
          label: `$${item.amount.toLocaleString('en-CA')} (Primary quote)`,
          sourceLabel: 'Primary quote',
          amount: item.amount,
          evidenceId: evId,
        });
      }
      item.conflictingOptions.forEach((opt, optIdx) => {
        const optEvId = addEvidence(opt.sourceExcerpt, opt.sourceLabel, item.pageReference);
        options.push({
          id: `opt-${idx}-${optIdx}`,
          label: `$${opt.amount.toLocaleString('en-CA')} (${opt.sourceLabel})`,
          sourceLabel: opt.sourceLabel,
          amount: opt.amount,
          evidenceId: optEvId,
        });
      });
      if (options.length >= 2) {
        conflicts.push({
          id: `conf-${idx}-${Date.now()}`,
          fieldLabel: item.label,
          description: `Conflicting prices found for ${item.label}. Select the confirmed price before approving.`,
          targetLineItemId: liId,
          options,
        });
      }
    }
  });

  const structuredInclusions = bq.inclusions ?? [];
  for (const inc of structuredInclusions) {
    const formatted = formatStructuredInclusion(inc);
    if (formatted) {
      inclusionStrings.push(formatted);
    }
    if (inc.sourceExcerpt) {
      addEvidence(inc.sourceExcerpt, inc.name);
    }
  }

  // Map mutually exclusive package options (when >= 2 tiers exist)
  const packages =
    bq.packages && bq.packages.length > 0
      ? bq.packages.map((pkg, pkgIdx) => {
          const pkgEvId = addEvidence(pkg.sourceExcerpt, pkg.name, pkg.pageReference);
          const pkgInclusionStrings = (pkg.inclusions ?? [])
            .map((inc) => {
              if (inc.sourceExcerpt) addEvidence(inc.sourceExcerpt, inc.name);
              return formatStructuredInclusion(inc);
            })
            .filter(Boolean);
          const pkgFees: QuoteLineItem[] = (pkg.fees ?? [])
            .filter((f) => f.amount !== null && f.pricingType !== 'unknown' && f.pricingType !== 'included')
            .map((f, fIdx) => {
              const fModel = mapPricingTypeToModel(f.pricingType);
              return {
                id: `pkg-${pkgIdx}-fee-${fIdx}-${Date.now()}`,
                label: f.label,
                pricingModel: fModel,
                unitPrice: fModel === 'percentage' ? (f.percentageRate ?? f.amount!) : f.amount!,
                minGuests: f.minGuests ?? pkg.minGuests,
                guestThreshold: f.guestThreshold,
                ratioDivisor: f.ratioGuests,
                unitLabel: f.unitLabel,
                isFoodItem: f.isFoodItem,
                packageId: pkg.id,
                eventId: input.targetEventIds?.[0],
                evidenceId: addEvidence(f.sourceExcerpt, f.label, f.pageReference),
                pageReference: f.pageReference,
              };
            });
          const pkgPayParts: string[] = [];
          if (pkg.paymentTerms?.depositAmount) {
            pkgPayParts.push(`$${pkg.paymentTerms.depositAmount.toLocaleString('en-CA')} deposit`);
          } else if (pkg.paymentTerms?.depositPercent) {
            pkgPayParts.push(`${pkg.paymentTerms.depositPercent}% deposit`);
          }
          if (pkg.paymentTerms?.scheduleNotes) {
            pkgPayParts.push(pkg.paymentTerms.scheduleNotes);
          }
          return {
            id: pkg.id || `pkg-${pkgIdx + 1}`,
            name: pkg.name,
            pricingModel: (pkg.pricingType === 'per_person' ? 'per_person' : 'flat') as 'flat' | 'per_person',
            unitPrice: pkg.amount ?? 0,
            minGuests: pkg.minGuests,
            includedGuests: pkg.includedGuests,
            extraGuestRate: pkg.extraGuestRate,
            maxCapacity: pkg.maxCapacity,
            hours: pkg.hours,
            isFoodItem: pkg.isFoodItem,
            fees: pkgFees.length > 0 ? pkgFees : undefined,
            taxHandling: pkg.taxStatus ? mapBackendTaxStatus(pkg.taxStatus) : undefined,
            taxPercent: pkg.taxPercent ?? undefined,
            gratuityStatus: pkg.gratuityStatus,
            gratuityPercent: pkg.gratuityPercent ?? undefined,
            gratuityBasis: pkg.gratuityBasis,
            inclusions: Array.from(new Set(pkgInclusionStrings)),
            structuredInclusions: pkg.inclusions,
            deliveryTerms: pkg.deliveryTerms,
            paymentTermsSummary: pkgPayParts.length > 0 ? pkgPayParts.join(' · ') : undefined,
            paymentMilestones: pkg.paymentTerms?.milestones,
            evidenceId: pkgEvId,
            pageReference: pkg.pageReference,
          };
        })
      : undefined;

  for (const q of bq.openQuestions) {
    addEvidence(q.sourceExcerpt, 'Needs attention', q.pageReference);
  }

  const taxHandling: TaxHandling = mapBackendTaxStatus(bq.taxStatus);

  const rawVendorName = (bq.vendorName ?? '').trim();
  const vendorNameMissing = rawVendorName.length === 0;
  const rawLocation = (bq.vendorLocation ?? '').trim();

  const paymentParts: string[] = [];
  if (bq.paymentTerms?.depositAmount) {
    paymentParts.push(`$${bq.paymentTerms.depositAmount.toLocaleString('en-CA')} deposit`);
  } else if (bq.paymentTerms?.depositPercent) {
    paymentParts.push(`${bq.paymentTerms.depositPercent}% deposit`);
  }
  if (bq.paymentTerms?.scheduleNotes) {
    paymentParts.push(bq.paymentTerms.scheduleNotes);
  }

  const firstAtt = input.attachments?.[0];
  const attachmentPreview: QuoteAttachmentPreview | undefined =
    firstAtt && firstAtt.dataUrl
      ? {
          fileName: firstAtt.fileName,
          mimeType: firstAtt.mimeType,
          dataUrl: firstAtt.dataUrl,
          sizeBytes: firstAtt.sizeBytes,
        }
      : undefined;

  const quote: Quote = {
    id: uid,
    title:
      bq.venueDetails?.packageName ||
      (rawVendorName ? `${rawVendorName} Quote` : 'Imported Vendor Quote'),
    approvalState: 'draft',
    quoteKind: 'personalized',
    receivedDate: bq.quotedDate || nowDate,
    sourceType: input.sourceType,
    sourceChannel: input.sourceChannel,
    sourceText:
      input.rawText.trim() ||
      (firstAtt ? `Uploaded document: ${firstAtt.fileName}` : ''),
    currency: bq.currency,
    currencySource: bq.currency === 'UNKNOWN' ? 'unknown' : 'explicit_quote',
    locationContext: rawLocation || undefined,
    taxHandling,
    taxPercent: bq.taxPercent ?? (bq.taxStatus === 'excluded' ? 13 : undefined),
    gratuityStatus: bq.gratuityStatus,
    gratuityPercent: bq.gratuityPercent ?? null,
    gratuityBasis: bq.gratuityBasis,
    serviceDurationHours:
      bq.serviceDurationHours ?? bq.photographerDetails?.hoursIncluded,
    minGuests: bq.venueDetails?.minGuests,
    maxCapacity: bq.venueDetails?.maxCapacity,
    packages,
    selectedPackageId:
      packages && packages.length === 1
        ? packages[0].id
        : (bq.selectedPackageId ?? null),
    lineItems,
    addOns,
    unconfirmedFees,
    conflicts,
    inclusions: Array.from(new Set(inclusionStrings.filter(Boolean))),
    structuredInclusions,
    deliveryTerms: bq.deliveryTerms ?? [],
    exclusions: bq.exclusions ?? [],
    restrictions: bq.restrictions ?? [],
    legacyReviewAcknowledged: true,
    paymentTermsSummary:
      paymentParts.join(' · ') || 'Confirm deposit and payment schedule with vendor.',
    paymentMilestones: bq.paymentTerms?.milestones ?? [],
    depositAmount: bq.paymentTerms?.depositAmount,
    depositPercent: bq.paymentTerms?.depositPercent,
    clarificationQuestions: bq.openQuestions.map((q) => q.question),
    evidenceSpans,
    sourceWarnings: payload.session?.sourceWarnings ?? [],
    sourceWarningsAcknowledged: false,
    attachmentPreview,
    vendorContact: bq.vendorContact,
  };

  return {
    suggestedVendorName: rawVendorName,
    vendorNameMissing,
    suggestedCategory: mapBackendCategory(bq.category),
    suggestedLocation: rawLocation,
    isDemoVenue: false,
    quote,
    extractionMeta: payload.meta,
  };
}

export class BackendQuoteExtractor implements QuoteExtractionAdapter {
  private readonly endpoint: string;

  constructor(endpoint = '/api/extract') {
    this.endpoint = endpoint;
  }

  async extractQuote(input: ExtractionInput): Promise<ExtractedQuoteResult> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rawMessage: input.rawText,
        guestCount: input.guestCount ?? 160,
        requireLive: true,
        attachments: input.attachments?.map((att) => ({
          mimeType: att.mimeType,
          base64Data: att.base64Data,
          fileName: att.fileName,
        })),
      }),
    });

    const data = (await response.json().catch(() => ({}))) as BackendExtractResponse;
    if (!response.ok) {
      throw new Error(
        data.error ||
          `Quote extraction failed (HTTP ${response.status}). Your source has been preserved so you can retry.`
      );
    }

    return mapBackendExtractionToFrontendResult(data, input);
  }
}

export const simulatedQuoteExtractor: QuoteExtractionAdapter = new SimulatedQuoteExtractor();
export const liveQuoteExtractor: QuoteExtractionAdapter = new BackendQuoteExtractor();
export const quoteExtractor: QuoteExtractionAdapter = liveQuoteExtractor;
