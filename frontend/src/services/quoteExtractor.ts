import {
  CurrencyCode,
  CurrencySource,
  Quote,
  QuoteEvidenceSpan,
  TaxHandling,
  VendorCategory,
} from '../types/vowly';

export interface ExtractionInput {
  sourceType: 'pasted_message' | 'pdf' | 'screenshot';
  sourceChannel: string;
  rawText: string;
  fileName?: string;
  presetId?: string;
  targetVendorId?: string;
  targetEventIds?: string[];
}

export interface ExtractedQuoteResult {
  suggestedVendorName: string;
  suggestedCategory: VendorCategory;
  suggestedLocation: string;
  isDemoVenue: boolean;
  quote: Quote;
  isRevisionOfExistingVendorId?: string;
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

export const quoteExtractor: QuoteExtractionAdapter = new SimulatedQuoteExtractor();
