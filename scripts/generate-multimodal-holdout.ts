import { execFileSync } from 'node:child_process';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  CurrencyCode,
  ExtractedQuote,
  PaymentMethodRule,
  PercentageBasis,
  QuoteKind,
  TaxOrGratuityStatus,
  VendorCategory,
} from '../src/types.ts';

export type BenchmarkModality = 'text' | 'image' | 'pdf';
export type BenchmarkDifficulty = 'ordinary' | 'difficult';

export interface BenchmarkCase {
  id: string;
  split: 'held-out-v3-multimodal';
  modality: BenchmarkModality;
  difficulty: BenchmarkDifficulty;
  description: string;
  rawMessage: string;
  attachmentPath?: string;
  mimeType?: 'image/png' | 'application/pdf';
  /** Exact visible text inside the image/PDF (used for true multimodal grounding checks). */
  documentText: string;
  calcContext: {
    guestCount?: number;
    hours?: number;
    selectedPackageName?: string;
  };
  expected: {
    vendorName: string | null;
    category: VendorCategory;
    currency: CurrencyCode;
    quoteKind: QuoteKind;
    taxStatus: TaxOrGratuityStatus;
    taxPercent?: number | null;
    gratuityStatus?: TaxOrGratuityStatus;
    gratuityPercent?: number | null;
    gratuityBasis?: PercentageBasis;
    minGuests?: number;
    maxCapacity?: number;
    knownSubtotal: number;
    expectedSelectedPackageSubtotal?: number;
    unknownItemLabels: string[];
    expectedPackageCount?: number;
    expectUnresolvedPackageSelection?: boolean;
    expectedPriceConflictDiscrepancy?: number;
    expectedNegotiatedSavings?: number;
    expectedDepositAmount?: number;
    expectedDepositPercent?: number;
    paymentMethodRule?: PaymentMethodRule;
    expectedDueDates?: string[];
    expectedRelativeDays?: number;
    expectedInclusions?: string[];
    expectedDeliveryTerms?: string[];
    expectedSourceSnippets: string[];
    /** Legitimate user decisions / confirmations inherent to the quote (NOT AI errors). */
    legitimateUserConfirmations: string[];
    /** Information genuinely absent from the source document (NOT AI errors). */
    missingSourceInfo: string[];
  };
  mockExtraction: ExtractedQuote;
}

/** Minimal deterministic PDF 1.4 writer (zero external dependencies, Helvetica + Helvetica-Bold). */
function buildPdfBuffer(pages: Array<{ title: string; subtitle?: string; lines: string[] }>): Buffer {
  const escapePdf = (s: string) =>
    s
      .replace(/[^\x20-\x7E]/g, (ch) => {
        if (ch === '\u2014' || ch === '\u2013') return '-';
        if (ch === '\u2018' || ch === '\u2019') return "'";
        if (ch === '\u201C' || ch === '\u201D') return '"';
        if (ch === '\u2022') return '*';
        return ' ';
      })
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');

  const wrapLine = (text: string, maxChars = 84): string[] => {
    if (text.length <= maxChars) return [text];
    const words = text.split(' ');
    const out: string[] = [];
    let cur = '';
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > maxChars) {
        if (cur) out.push(cur);
        cur = w;
      } else {
        cur = cur ? `${cur} ${w}` : w;
      }
    }
    if (cur) out.push(cur);
    return out;
  };

  // Objects: 1=Catalog, 2=Pages, 3=Font F1 (Helvetica), 4=Font F2 (Helvetica-Bold), then pairs of (Page, Content)
  const objects: string[] = [];
  const pageObjIds: number[] = [];

  // Placeholder slots 0..3
  objects.push(''); // 1
  objects.push(''); // 2
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'); // 3
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'); // 4

  pages.forEach((page, pageIdx) => {
    const pageObjId = objects.length + 1;
    const contentObjId = objects.length + 2;
    pageObjIds.push(pageObjId);

    const ops: string[] = [];
    let y = 748;
    ops.push('BT');
    ops.push('/F2 15 Tf');
    ops.push(`50 ${y} Td`);
    ops.push(`(${escapePdf(page.title)}) Tj`);
    ops.push('ET');
    y -= 20;

    if (page.subtitle) {
      ops.push('BT');
      ops.push('/F1 10 Tf');
      ops.push(`50 ${y} Td`);
      ops.push(`(${escapePdf(page.subtitle)}) Tj`);
      ops.push('ET');
      y -= 18;
    }

    // Horizontal divider
    ops.push(`0.75 w 50 ${y} m 562 ${y} l S`);
    y -= 20;

    for (const rawLine of page.lines) {
      if (rawLine === '') {
        y -= 10;
        continue;
      }
      const isHeading = rawLine.startsWith('## ');
      const cleanLine = isHeading ? rawLine.slice(3) : rawLine;
      const wrapped = wrapLine(cleanLine, isHeading ? 72 : 84);
      for (const wLine of wrapped) {
        if (y < 60) break;
        ops.push('BT');
        ops.push(isHeading ? '/F2 11.5 Tf' : '/F1 10 Tf');
        ops.push(`50 ${y} Td`);
        ops.push(`(${escapePdf(wLine)}) Tj`);
        ops.push('ET');
        y -= isHeading ? 16 : 14;
      }
    }

    // Footer page number
    ops.push('BT');
    ops.push('/F1 8.5 Tf');
    ops.push(`50 36 Td`);
    ops.push(`(Page ${pageIdx + 1} of ${pages.length}) Tj`);
    ops.push('ET');

    const stream = ops.join('\n');
    const streamLen = Buffer.byteLength(stream, 'utf8');

    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjId} 0 R >>`,
    );
    objects.push(`<< /Length ${streamLen} >>\nstream\n${stream}\nendstream`);
  });

  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjIds.length} >>`;

  const chunks: string[] = ['%PDF-1.4\n'];
  const offsets: number[] = [0];
  let byteOffset = Buffer.byteLength(chunks[0]!, 'utf8');

  for (let i = 0; i < objects.length; i++) {
    offsets.push(byteOffset);
    const body = `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
    chunks.push(body);
    byteOffset += Buffer.byteLength(body, 'utf8');
  }

  const xrefOffset = byteOffset;
  chunks.push(`xref\n0 ${objects.length + 1}\n`);
  chunks.push('0000000000 65535 f \n');
  for (let i = 1; i < offsets.length; i++) {
    chunks.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  chunks.push(
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );

  return Buffer.from(chunks.join(''), 'utf8');
}

const OUT_DIR = resolve('eval-data/held-out-v3-multimodal');
const IMG_DIR = resolve(OUT_DIR, 'images');
const PDF_DIR = resolve(OUT_DIR, 'pdfs');

mkdirSync(IMG_DIR, { recursive: true });
mkdirSync(PDF_DIR, { recursive: true });

// ============================================================================
// A. 10 PASTED TEXT CASES (T01 - T10)
// ============================================================================
const textCases: BenchmarkCase[] = [
  {
    id: 'T01',
    split: 'held-out-v3-multimodal',
    modality: 'text',
    difficulty: 'ordinary',
    description: 'Ordinary CAD venue per-person banquet quote with 13% HST and explicit deposit/balance',
    rawMessage: `Hi Priya & Devon,
Thank you for touring Maple Ridge Estates in Vaughan, ON!
For your Saturday October 17, 2027 Reception (Grand Ballroom, min 120 guests, max 240 guests):
- Classic Dinner & Bar Package: $95 CAD per person (includes 4-course plated dinner, standard open bar, white linens, and Chiavari chairs)
- All prices are subject to 13% HST and 15% service charge on the entire subtotal.
- Deposit: $2,500 CAD due upon signing to hold the date. Final balance due October 3, 2027. E-transfer or cheque accepted.
Warm regards,
Elena, Maple Ridge Estates`,
    documentText: '',
    calcContext: { guestCount: 150 },
    expected: {
      vendorName: 'Maple Ridge Estates',
      category: 'venue',
      currency: 'CAD',
      quoteKind: 'initial',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'excluded',
      gratuityPercent: 15,
      gratuityBasis: 'entire_subtotal',
      minGuests: 120,
      maxCapacity: 240,
      knownSubtotal: 14250,
      unknownItemLabels: [],
      expectedDepositAmount: 2500,
      paymentMethodRule: 'any',
      expectedDueDates: ['2027-10-03'],
      expectedInclusions: ['plated dinner', 'open bar', 'linens', 'Chiavari chairs'],
      expectedSourceSnippets: ['$95 CAD per person', '13% HST', '$2,500 CAD due upon signing'],
      legitimateUserConfirmations: [],
      missingSourceInfo: [],
    },
    mockExtraction: {
      vendorName: 'Maple Ridge Estates',
      vendorLocation: 'Vaughan, ON',
      category: 'venue',
      events: ['Reception'],
      quoteKind: 'initial',
      currency: 'CAD',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'excluded',
      gratuityPercent: 15,
      gratuityBasis: 'entire_subtotal',
      lineItems: [
        {
          label: 'Classic Dinner & Bar Package',
          pricingType: 'per_person',
          amount: 95,
          minGuests: 120,
          isFoodItem: true,
          chargeType: 'mandatory',
          sourceExcerpt: 'Classic Dinner & Bar Package: $95 CAD per person',
        },
      ],
      inclusions: [
        { name: '4-course plated dinner', sourceExcerpt: '4-course plated dinner' },
        { name: 'standard open bar', sourceExcerpt: 'standard open bar' },
        { name: 'white linens', sourceExcerpt: 'white linens' },
        { name: 'Chiavari chairs', sourceExcerpt: 'Chiavari chairs' },
      ],
      venueDetails: { roomName: 'Grand Ballroom', minGuests: 120, maxCapacity: 240, dayOfWeek: 'Saturday' },
      paymentTerms: {
        depositAmount: 2500,
        methodRule: 'any',
        milestones: [
          { label: 'Deposit', amount: 2500, sourceExcerpt: 'Deposit: $2,500 CAD due upon signing' },
          { label: 'Final balance', dueDate: '2027-10-03', sourceExcerpt: 'Final balance due October 3, 2027' },
        ],
      },
      openQuestions: [],
    },
  },
  {
    id: 'T02',
    split: 'held-out-v3-multimodal',
    modality: 'text',
    difficulty: 'difficult',
    description: '2 mutually exclusive venue packages with different minimums, inclusions, and repeated per-person phrasing',
    rawMessage: `Hello! Here are our two wedding banquet options at Saffron Courtyard in Brampton, Ontario (prices in CAD):

Option 1 - Silver Package: $62 per person (minimum 160 guests). Extra guests are $62 per person.
Includes: 3 appetizers, 3 main entrees, naan & rice, tea service, basic uplighting.

Option 2 - Gold Package: $78 per person (minimum 110 guests). Extra guests are $78 per person.
Includes: 5 appetizers, 5 main entrees, live chaat counter, dessert station, upgraded gold cutlery, and stage backdrop.

Both options include hall rental for 6 hours. Plus 13% HST and 15% gratuity. $2,000 CAD deposit required to confirm.`,
    documentText: '',
    calcContext: { guestCount: 140, selectedPackageName: 'Silver' },
    expected: {
      vendorName: 'Saffron Courtyard',
      category: 'venue',
      currency: 'CAD',
      quoteKind: 'initial',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'excluded',
      gratuityPercent: 15,
      knownSubtotal: 0,
      expectedSelectedPackageSubtotal: 9920, // 160 min * $62
      unknownItemLabels: [],
      expectedPackageCount: 2,
      expectUnresolvedPackageSelection: true,
      expectedDepositAmount: 2000,
      expectedInclusions: ['3 appetizers', 'live chaat counter', 'stage backdrop'],
      expectedSourceSnippets: ['Silver Package: $62 per person', 'Gold Package: $78 per person', 'Plus 13% HST'],
      legitimateUserConfirmations: ['Select between Silver Package and Gold Package'],
      missingSourceInfo: ['Gratuity calculation basis not specified'],
    },
    mockExtraction: {
      vendorName: 'Saffron Courtyard',
      vendorLocation: 'Brampton, Ontario',
      category: 'venue',
      events: ['Wedding'],
      quoteKind: 'initial',
      currency: 'CAD',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'excluded',
      gratuityPercent: 15,
      gratuityBasis: 'entire_subtotal',
      packages: [
        {
          id: 'silver-package',
          name: 'Silver Package',
          pricingType: 'per_person',
          amount: 62,
          minGuests: 160,
          isFoodItem: true,
          inclusions: [
            { name: '3 appetizers', packageId: 'silver-package', sourceExcerpt: '3 appetizers' },
            { name: '3 main entrees', packageId: 'silver-package', sourceExcerpt: '3 main entrees' },
            { name: 'basic uplighting', packageId: 'silver-package', sourceExcerpt: 'basic uplighting' },
          ],
          sourceExcerpt: 'Option 1 - Silver Package: $62 per person (minimum 160 guests)',
        },
        {
          id: 'gold-package',
          name: 'Gold Package',
          pricingType: 'per_person',
          amount: 78,
          minGuests: 110,
          isFoodItem: true,
          inclusions: [
            { name: '5 appetizers', packageId: 'gold-package', sourceExcerpt: '5 appetizers' },
            { name: 'live chaat counter', packageId: 'gold-package', sourceExcerpt: 'live chaat counter' },
            { name: 'stage backdrop', packageId: 'gold-package', sourceExcerpt: 'stage backdrop' },
          ],
          sourceExcerpt: 'Option 2 - Gold Package: $78 per person (minimum 110 guests)',
        },
      ],
      lineItems: [],
      paymentTerms: { depositAmount: 2000, methodRule: 'unknown' },
      openQuestions: [
        {
          question: 'Which package tier will you select (Silver vs. Gold)?',
          reason: 'ambiguous_rule',
          sourceExcerpt: 'Option 1 - Silver Package: $62 per person',
        },
      ],
    },
  },
  {
    id: 'T03',
    split: 'held-out-v3-multimodal',
    modality: 'text',
    difficulty: 'difficult',
    description: 'Flat base up to 150 guests + genuine incremental per_extra_guest + food-only 15% service charge + 1:75 bartender ratio',
    rawMessage: `Hi! Cedar Hall (Mississauga, ON) quote in CAD for your Reception:
- Hall & Dinner Package: $11,000 flat for up to 150 guests.
- Additional guests beyond 150: $60 per extra guest.
- Licensed Bartenders: $225 per bartender (1 bartender required per 75 guests).
- Service charge: 15% on food subtotal only. Plus 13% HST.
- 30% deposit due on booking.`,
    documentText: '',
    calcContext: { guestCount: 175 },
    expected: {
      vendorName: 'Cedar Hall',
      category: 'venue',
      currency: 'CAD',
      quoteKind: 'initial',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'excluded',
      gratuityPercent: 15,
      gratuityBasis: 'food_subtotal',
      knownSubtotal: 13175, // 11000 + (25*60=1500) + (ceil(175/75)=3 * 225 = 675)
      unknownItemLabels: [],
      expectedDepositPercent: 30,
      expectedSourceSnippets: ['$11,000 flat for up to 150 guests', '$60 per extra guest', '1 bartender required per 75 guests'],
      legitimateUserConfirmations: [],
      missingSourceInfo: ['Final balance due date not stated'],
    },
    mockExtraction: {
      vendorName: 'Cedar Hall',
      vendorLocation: 'Mississauga, ON',
      category: 'venue',
      events: ['Reception'],
      quoteKind: 'initial',
      currency: 'CAD',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'excluded',
      gratuityPercent: 15,
      gratuityBasis: 'food_subtotal',
      lineItems: [
        {
          label: 'Hall & Dinner Package (up to 150 guests)',
          pricingType: 'flat',
          amount: 11000,
          isFoodItem: true,
          chargeType: 'mandatory',
          sourceExcerpt: 'Hall & Dinner Package: $11,000 flat for up to 150 guests.',
        },
        {
          label: 'Additional guests beyond 150',
          pricingType: 'per_extra_guest',
          amount: 60,
          guestThreshold: 150,
          isFoodItem: true,
          chargeType: 'mandatory',
          sourceExcerpt: 'Additional guests beyond 150: $60 per extra guest.',
        },
        {
          label: 'Licensed Bartenders',
          pricingType: 'per_guest_ratio',
          amount: 225,
          ratioGuests: 75,
          unitLabel: 'bartender',
          isFoodItem: false,
          chargeType: 'mandatory',
          sourceExcerpt: 'Licensed Bartenders: $225 per bartender (1 bartender required per 75 guests).',
        },
      ],
      paymentTerms: { depositPercent: 30, methodRule: 'unknown' },
      openQuestions: [],
    },
  },
  {
    id: 'T04',
    split: 'held-out-v3-multimodal',
    modality: 'text',
    difficulty: 'ordinary',
    description: 'Ordinary photography flat package with explicit delivery terms and unstated tax',
    rawMessage: `Hey! Thanks for reaching out to Lumen & Co Photography (Toronto, ON).
Our Full Day Wedding Collection is $3,200 CAD for 8 hours of coverage with 1 lead photographer.
Includes 600+ edited high-resolution photos in a private online gallery.
Delivery: Sneak peeks delivered within 48 hours; full edited gallery delivered in 6-8 weeks. RAW files are not included.
A $500 retainer secures your date, balance due 2 weeks before the wedding.`,
    documentText: '',
    calcContext: { hours: 8 },
    expected: {
      vendorName: 'Lumen & Co Photography',
      category: 'photographer',
      currency: 'CAD',
      quoteKind: 'initial',
      taxStatus: 'unknown',
      knownSubtotal: 3200,
      unknownItemLabels: [],
      expectedDepositAmount: 500,
      expectedRelativeDays: 14,
      expectedInclusions: ['8 hours', 'lead photographer', 'online gallery'],
      expectedDeliveryTerms: ['48 hours', '6-8 weeks', 'RAW files'],
      expectedSourceSnippets: ['$3,200 CAD for 8 hours', 'Sneak peeks delivered within 48 hours', '$500 retainer'],
      legitimateUserConfirmations: ['Confirm tax handling before booking (tax not stated)'],
      missingSourceInfo: ['Tax status/rate not stated', 'Event date not stated for relative deadline'],
    },
    mockExtraction: {
      vendorName: 'Lumen & Co Photography',
      vendorLocation: 'Toronto, ON',
      category: 'photographer',
      events: ['Wedding'],
      quoteKind: 'initial',
      currency: 'CAD',
      taxStatus: 'unknown',
      gratuityStatus: 'unknown',
      serviceDurationHours: 8,
      lineItems: [
        {
          label: 'Full Day Wedding Collection',
          pricingType: 'flat',
          amount: 3200,
          hours: 8,
          chargeType: 'mandatory',
          sourceExcerpt: 'Our Full Day Wedding Collection is $3,200 CAD for 8 hours of coverage',
        },
      ],
      inclusions: [
        { name: 'Lead photographer coverage', quantity: 1, durationHours: 8, sourceExcerpt: '8 hours of coverage with 1 lead photographer' },
        { name: '600+ edited high-resolution photos in private online gallery', sourceExcerpt: '600+ edited high-resolution photos in a private online gallery' },
      ],
      deliveryTerms: [
        'Sneak peeks delivered within 48 hours',
        'Full edited gallery delivered in 6-8 weeks',
        'RAW files are not included',
      ],
      photographerDetails: { hoursIncluded: 8, teamSize: 1 },
      paymentTerms: {
        depositAmount: 500,
        methodRule: 'unknown',
        milestones: [
          { label: 'Retainer', amount: 500, sourceExcerpt: 'A $500 retainer secures your date' },
          { label: 'Balance', relativeDaysBeforeEvent: 14, relativeDeadlineText: '2 weeks before the wedding', sourceExcerpt: 'balance due 2 weeks before the wedding' },
        ],
      },
      openQuestions: [],
    },
  },
  {
    id: 'T05',
    split: 'held-out-v3-multimodal',
    modality: 'text',
    difficulty: 'difficult',
    description: 'Negotiated photography discount + conditional additional hourly pricing + explicit dates',
    rawMessage: `Hi! Following up from Northstar Lens (Ottawa, ON):
Normally our 5-hour Sangeet package is $1,200 CAD, but since you were referred by Arjun I can do $950 CAD for you.
Included: 5 hours photography coverage, 250 edited photos, online gallery within 4 weeks.
Additional Hourly Pricing: $250/hr if the event runs late.
Tax is not mentioned yet? Oh, plus 13% HST.
Payment: $300 deposit on signing, remaining balance due August 10, 2027.`,
    documentText: '',
    calcContext: { hours: 5 },
    expected: {
      vendorName: 'Northstar Lens',
      category: 'photographer',
      currency: 'CAD',
      quoteKind: 'initial',
      taxStatus: 'excluded',
      taxPercent: 13,
      knownSubtotal: 950,
      unknownItemLabels: [],
      expectedNegotiatedSavings: 250,
      expectedDepositAmount: 300,
      expectedDueDates: ['2027-08-10'],
      expectedDeliveryTerms: ['4 weeks'],
      expectedSourceSnippets: ['$950 CAD for you', 'Additional Hourly Pricing: $250/hr', 'August 10, 2027'],
      legitimateUserConfirmations: [],
      missingSourceInfo: [],
    },
    mockExtraction: {
      vendorName: 'Northstar Lens',
      vendorLocation: 'Ottawa, ON',
      category: 'photographer',
      events: ['Sangeet'],
      quoteKind: 'initial',
      currency: 'CAD',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'unknown',
      serviceDurationHours: 5,
      lineItems: [
        {
          label: '5-hour Sangeet package',
          pricingType: 'flat',
          amount: 950,
          originalAmount: 1200,
          hours: 5,
          chargeType: 'mandatory',
          sourceExcerpt: 'Normally our 5-hour Sangeet package is $1,200 CAD, but since you were referred by Arjun I can do $950 CAD for you.',
        },
        {
          label: 'Additional Hourly Pricing',
          pricingType: 'per_hour',
          amount: 250,
          chargeType: 'conditional',
          sourceExcerpt: 'Additional Hourly Pricing: $250/hr if the event runs late.',
        },
      ],
      inclusions: [
        { name: 'Photography coverage', durationHours: 5, sourceExcerpt: '5 hours photography coverage' },
        { name: '250 edited photos', sourceExcerpt: '250 edited photos' },
      ],
      deliveryTerms: ['Online gallery within 4 weeks'],
      photographerDetails: { hoursIncluded: 5, extraHourRate: 250 },
      paymentTerms: {
        depositAmount: 300,
        methodRule: 'unknown',
        milestones: [
          { label: 'Deposit', amount: 300, sourceExcerpt: '$300 deposit on signing' },
          { label: 'Remaining balance', dueDate: '2027-08-10', sourceExcerpt: 'remaining balance due August 10, 2027' },
        ],
      },
      openQuestions: [],
    },
  },
  {
    id: 'T06',
    split: 'held-out-v3-multimodal',
    modality: 'text',
    difficulty: 'difficult',
    description: 'Multi-shooter photography (lead 8h + 2nd shooter 5h) + USD plus tax (unstated rate) + optional album',
    rawMessage: `Hello from Golden Hour Visuals (Chicago, IL)!
Our Signature Wedding Collection is $3,800 USD plus tax.
What's included:
- 1 Lead Photographer for 8 hours
- 1 Second Photographer for 5 hours
- Online gallery with print release (delivered in 8 weeks)
Optional add-on: 10x10 heirloom linen album for $650 USD.
Booking requires a 25% retainer.`,
    documentText: '',
    calcContext: { hours: 8 },
    expected: {
      vendorName: 'Golden Hour Visuals',
      category: 'photographer',
      currency: 'USD',
      quoteKind: 'initial',
      taxStatus: 'excluded',
      taxPercent: null,
      knownSubtotal: 3800,
      unknownItemLabels: [],
      expectedDepositPercent: 25,
      expectedInclusions: ['Lead Photographer', 'Second Photographer', 'print release'],
      expectedDeliveryTerms: ['8 weeks'],
      expectedSourceSnippets: ['$3,800 USD plus tax', '1 Second Photographer for 5 hours', 'heirloom linen album for $650 USD'],
      legitimateUserConfirmations: ['Confirm local tax rate before booking ("plus tax" rate unstated)'],
      missingSourceInfo: ['Tax percentage not stated'],
    },
    mockExtraction: {
      vendorName: 'Golden Hour Visuals',
      vendorLocation: 'Chicago, IL',
      category: 'photographer',
      events: ['Wedding'],
      quoteKind: 'initial',
      currency: 'USD',
      taxStatus: 'excluded',
      taxPercent: null,
      gratuityStatus: 'unknown',
      serviceDurationHours: 8,
      lineItems: [
        {
          label: 'Signature Wedding Collection',
          pricingType: 'flat',
          amount: 3800,
          hours: 8,
          chargeType: 'mandatory',
          sourceExcerpt: 'Our Signature Wedding Collection is $3,800 USD plus tax.',
        },
        {
          label: '10x10 heirloom linen album',
          pricingType: 'flat',
          amount: 650,
          chargeType: 'optional',
          optionalAddon: true,
          sourceExcerpt: 'Optional add-on: 10x10 heirloom linen album for $650 USD.',
        },
      ],
      inclusions: [
        { name: 'Lead Photographer', quantity: 1, durationHours: 8, sourceExcerpt: '1 Lead Photographer for 8 hours' },
        { name: 'Second Photographer', quantity: 1, durationHours: 5, sourceExcerpt: '1 Second Photographer for 5 hours' },
        { name: 'Online gallery with print release', sourceExcerpt: 'Online gallery with print release' },
      ],
      deliveryTerms: ['Online gallery delivered in 8 weeks'],
      photographerDetails: { hoursIncluded: 8, teamSize: 2 },
      paymentTerms: { depositPercent: 25, methodRule: 'unknown' },
      openQuestions: [
        {
          question: 'What is the applicable tax rate?',
          reason: 'ambiguous_rule',
          sourceExcerpt: '$3,800 USD plus tax.',
        },
      ],
    },
  },
  {
    id: 'T07',
    split: 'held-out-v3-multimodal',
    modality: 'text',
    difficulty: 'difficult',
    description: 'Independent caterer at external hotel with conflicting pricing models (flat vs per-person) + TBD chafing fee',
    rawMessage: `Forwarding both messages from Spice Route Catering for our reception at the Marriott hotel (prices in CAD):
Instagram DM (March 2): "For your menu at the Marriott, catering is $1,800 flat for the evening."
Email proposal (March 5): "Marriott reception dinner buffet: $45 per person for 100 guests. Plus chafing dish & warming setup fee (TBD once kitchen access is confirmed). Plus 13% HST."`,
    documentText: '',
    calcContext: { guestCount: 100 },
    expected: {
      vendorName: 'Spice Route Catering',
      category: 'catering',
      currency: 'CAD',
      quoteKind: 'initial',
      taxStatus: 'excluded',
      taxPercent: 13,
      knownSubtotal: 1800,
      unknownItemLabels: ['chafing'],
      expectedPriceConflictDiscrepancy: 2700, // 4500 - 1800
      expectedSourceSnippets: ['$1,800 flat for the evening', '$45 per person', 'chafing dish & warming setup fee (TBD'],
      legitimateUserConfirmations: [
        'Resolve conflicting catering price ($1,800 flat vs $45/person = $4,500)',
        'Confirm TBD chafing dish & warming setup fee',
      ],
      missingSourceInfo: ['Chafing dish & warming setup fee is TBD'],
    },
    mockExtraction: {
      vendorName: 'Spice Route Catering',
      category: 'catering',
      events: ['Reception'],
      quoteKind: 'initial',
      currency: 'CAD',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'unknown',
      lineItems: [
        {
          label: 'Marriott reception catering',
          pricingType: 'flat',
          amount: 1800,
          isFoodItem: true,
          chargeType: 'mandatory',
          conflictingOptions: [
            {
              sourceLabel: 'Instagram DM',
              pricingType: 'flat',
              amount: 1800,
              sourceExcerpt: 'catering is $1,800 flat for the evening.',
            },
            {
              sourceLabel: 'Email proposal',
              pricingType: 'per_person',
              amount: 45,
              sourceExcerpt: 'Marriott reception dinner buffet: $45 per person',
            },
          ],
          sourceExcerpt: 'catering is $1,800 flat for the evening.',
        },
        {
          label: 'Chafing dish & warming setup fee',
          pricingType: 'unknown',
          amount: null,
          chargeType: 'mandatory',
          sourceExcerpt: 'chafing dish & warming setup fee (TBD once kitchen access is confirmed)',
        },
      ],
      openQuestions: [
        {
          question: 'Which catering rate applies: $1,800 flat or $45/person?',
          reason: 'conflict',
          sourceExcerpt: 'Marriott reception dinner buffet: $45 per person',
        },
        {
          question: 'What is the chafing dish & warming setup fee?',
          reason: 'missing_price',
          sourceExcerpt: 'chafing dish & warming setup fee (TBD once kitchen access is confirmed)',
        },
      ],
    },
  },
  {
    id: 'T08',
    split: 'held-out-v3-multimodal',
    modality: 'text',
    difficulty: 'difficult',
    description: 'Multi-event decor bundle + mandatory TBD rigging/teardown + optional dance floor wrap + relative deadline',
    rawMessage: `Hi! Velvet Petal Decor (Toronto, CAD):
- Mehndi + Reception Stage & Centerpieces Bundle: $4,600 CAD
- Mandatory late-night rigging & teardown crew fee: TBD depending on venue load-out window
- Optional add-on: Custom monogram dance floor wrap $850 CAD
- Plus 13% HST. 30% deposit to book, remaining balance due 21 days prior to event.`,
    documentText: '',
    calcContext: {},
    expected: {
      vendorName: 'Velvet Petal Decor',
      category: 'decor',
      currency: 'CAD',
      quoteKind: 'initial',
      taxStatus: 'excluded',
      taxPercent: 13,
      knownSubtotal: 4600,
      unknownItemLabels: ['rigging'],
      expectedDepositPercent: 30,
      expectedRelativeDays: 21,
      expectedSourceSnippets: ['$4,600 CAD', 'rigging & teardown crew fee: TBD', 'dance floor wrap $850 CAD'],
      legitimateUserConfirmations: ['Confirm TBD rigging & teardown crew fee before approval'],
      missingSourceInfo: ['Rigging & teardown crew fee is TBD', 'Event date not stated for 21-day deadline'],
    },
    mockExtraction: {
      vendorName: 'Velvet Petal Decor',
      vendorLocation: 'Toronto',
      category: 'decor',
      events: ['Mehndi', 'Reception'],
      quoteKind: 'initial',
      currency: 'CAD',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'unknown',
      lineItems: [
        {
          label: 'Mehndi + Reception Stage & Centerpieces Bundle',
          pricingType: 'flat',
          amount: 4600,
          chargeType: 'mandatory',
          sourceExcerpt: 'Mehndi + Reception Stage & Centerpieces Bundle: $4,600 CAD',
        },
        {
          label: 'Late-night rigging & teardown crew fee',
          pricingType: 'unknown',
          amount: null,
          chargeType: 'mandatory',
          sourceExcerpt: 'Mandatory late-night rigging & teardown crew fee: TBD depending on venue load-out window',
        },
        {
          label: 'Custom monogram dance floor wrap',
          pricingType: 'flat',
          amount: 850,
          chargeType: 'optional',
          optionalAddon: true,
          sourceExcerpt: 'Optional add-on: Custom monogram dance floor wrap $850 CAD',
        },
      ],
      paymentTerms: {
        depositPercent: 30,
        methodRule: 'unknown',
        milestones: [
          { label: 'Deposit', percent: 30, sourceExcerpt: '30% deposit to book' },
          { label: 'Remaining balance', relativeDaysBeforeEvent: 21, relativeDeadlineText: '21 days prior to event', sourceExcerpt: 'remaining balance due 21 days prior to event' },
        ],
      },
      openQuestions: [
        {
          question: 'What is the mandatory rigging & teardown crew fee?',
          reason: 'missing_price',
          sourceExcerpt: 'Mandatory late-night rigging & teardown crew fee: TBD depending on venue load-out window',
        },
      ],
    },
  },
  {
    id: 'T09',
    split: 'held-out-v3-multimodal',
    modality: 'text',
    difficulty: 'ordinary',
    description: 'Cash-only DJ package with unstated currency ($) and conditional overtime — must NOT assume tax-free from cash',
    rawMessage: `Yo! DJ Pulse here.
Reception DJ & sound package (6 hours): $1,400 cash only.
Overtime after 6 hours is $200/hr.
$300 deposit holds your date.`,
    documentText: '',
    calcContext: { hours: 6 },
    expected: {
      vendorName: 'DJ Pulse',
      category: 'dj',
      currency: 'UNKNOWN',
      quoteKind: 'initial',
      taxStatus: 'unknown',
      knownSubtotal: 1400,
      unknownItemLabels: [],
      expectedDepositAmount: 300,
      paymentMethodRule: 'cash_only',
      expectedSourceSnippets: ['$1,400 cash only', 'Overtime after 6 hours is $200/hr', '$300 deposit'],
      legitimateUserConfirmations: ['Confirm currency (CAD vs USD)', 'Confirm tax handling (cash does not imply tax-free)'],
      missingSourceInfo: ['Currency not stated', 'Tax handling not stated'],
    },
    mockExtraction: {
      vendorName: 'DJ Pulse',
      category: 'dj',
      events: ['Reception'],
      quoteKind: 'initial',
      currency: 'UNKNOWN',
      taxStatus: 'unknown',
      gratuityStatus: 'unknown',
      serviceDurationHours: 6,
      lineItems: [
        {
          label: 'Reception DJ & sound package (6 hours)',
          pricingType: 'flat',
          amount: 1400,
          hours: 6,
          chargeType: 'mandatory',
          sourceExcerpt: 'Reception DJ & sound package (6 hours): $1,400 cash only.',
        },
        {
          label: 'Overtime after 6 hours',
          pricingType: 'per_hour',
          amount: 200,
          chargeType: 'conditional',
          sourceExcerpt: 'Overtime after 6 hours is $200/hr.',
        },
      ],
      paymentTerms: { depositAmount: 300, methodRule: 'cash_only' },
      openQuestions: [
        {
          question: 'Which currency is this quote in (CAD or USD)?',
          reason: 'ambiguous_rule',
          sourceExcerpt: '$1,400 cash only.',
        },
      ],
    },
  },
  {
    id: 'T10',
    split: 'held-out-v3-multimodal',
    modality: 'text',
    difficulty: 'difficult',
    description: 'Ambiguous Hospitality & Events quote without venue/catering proof (must classify unknown + ask clarifying question)',
    rawMessage: `Hi! Horizon Hospitality & Events here.
For your wedding evening (150 guests): our Signature Evening Package is $70 CAD per person plus 13% HST.
Includes dinner service, glassware, and event coordinator on site.
$1,500 deposit to reserve.`,
    documentText: '',
    calcContext: { guestCount: 150 },
    expected: {
      vendorName: 'Horizon Hospitality & Events',
      category: 'unknown',
      currency: 'CAD',
      quoteKind: 'initial',
      taxStatus: 'excluded',
      taxPercent: 13,
      knownSubtotal: 10500,
      unknownItemLabels: [],
      expectedDepositAmount: 1500,
      expectedSourceSnippets: ['$70 CAD per person', 'plus 13% HST', '$1,500 deposit'],
      legitimateUserConfirmations: ['Clarify whether this vendor provides venue space or external catering only'],
      missingSourceInfo: ['Whether venue space is included or external catering only'],
    },
    mockExtraction: {
      vendorName: 'Horizon Hospitality & Events',
      category: 'unknown',
      events: ['Wedding'],
      quoteKind: 'initial',
      currency: 'CAD',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'unknown',
      lineItems: [
        {
          label: 'Signature Evening Package',
          pricingType: 'per_person',
          amount: 70,
          isFoodItem: true,
          chargeType: 'mandatory',
          sourceExcerpt: 'our Signature Evening Package is $70 CAD per person plus 13% HST.',
        },
      ],
      inclusions: [
        { name: 'dinner service', sourceExcerpt: 'dinner service' },
        { name: 'glassware', sourceExcerpt: 'glassware' },
        { name: 'event coordinator on site', sourceExcerpt: 'event coordinator on site' },
      ],
      paymentTerms: { depositAmount: 1500, methodRule: 'unknown' },
      openQuestions: [
        {
          question: 'Does Horizon Hospitality & Events include a venue space or is this catering/coordination only?',
          reason: 'ambiguous_rule',
          sourceExcerpt: 'Signature Evening Package is $70 CAD per person',
        },
      ],
    },
  },
];

// ============================================================================
// B. 10 SYNTHETIC SCREENSHOT / IMAGE CASES (I01 - I10)
// ============================================================================
interface ImageSpec {
  id: string;
  width?: number;
  height?: number;
  bg?: string;
  header?: { title: string; subtitle?: string; bg: string; fg: string; height?: number };
  columns?: Array<{ title: string; price?: string; badge?: string; bg?: string; border?: string; height?: number; lines: string[] }>;
  bubbles?: Array<{ sender: string; align: 'left' | 'right'; text: string; bg?: string; fg?: string }>;
  blocks?: Array<{ text: string; size?: number; bold?: boolean; fg?: string; boxBg?: string }>;
}

const imageSpecs: ImageSpec[] = [
  {
    id: 'I01',
    height: 620,
    header: { title: 'Grandview Banquet Hall - Quote Email', subtitle: 'From: events@grandviewhall.ca  |  Subject: Reception Quote (Markham, ON)', bg: '#1E293B', fg: '#FFFFFF' },
    blocks: [
      { text: 'Hi Maya & Rohan,', size: 12 },
      { text: 'Thank you for visiting Grandview Banquet Hall in Markham, Ontario. Here is your CAD quote for the Emerald Ballroom (min 120 guests, max 200 guests):', size: 11.5 },
      { text: 'Classic Wedding Buffet & Bar Package: $85 CAD per person\nIncludes: 4-course South Asian & Continental buffet, open standard bar, white linens, napkins, and setup/cleanup.', size: 11.5, boxBg: '#F8FAFC' },
      { text: 'Taxes & Gratuity: Plus 13% HST and 10% gratuity on total subtotal.', size: 11.5, bold: true },
      { text: 'Payment Terms: $2,000 CAD deposit upon booking. Balance due September 15, 2027. E-transfer or cheque.', size: 11.5 },
    ],
  },
  {
    id: 'I02',
    height: 760,
    header: { title: 'PALACE GARDENS BANQUET HALL', subtitle: '2027 Wedding Packages Brochure  |  Mississauga, Ontario  |  All prices in CAD', bg: '#7C2D12', fg: '#FEF3C7' },
    columns: [
      {
        title: 'Royal Package',
        price: '$58 CAD / person',
        badge: 'MIN 150 GUESTS',
        bg: '#FFFBEB',
        border: '#D97706',
        height: 410,
        lines: [
          'Minimum guarantee: 150 guests',
          'Extra guest rate: $58 per person',
          '- 3 Passed Appetizers',
          '- 4 Main Entrees + Naan & Rice',
          '- Fresh Fruit & Gulab Jamun',
          '- White Tablecloths & Napkins',
          '- 6 Hours Hall Rental',
        ],
      },
      {
        title: 'Imperial Package',
        price: '$68 CAD / person',
        badge: 'MIN 100 GUESTS',
        bg: '#F0F9FF',
        border: '#0284C7',
        height: 410,
        lines: [
          'Minimum guarantee: 100 guests',
          'Extra guest rate: $68 per person',
          '- 5 Passed Appetizers + Live Chaat',
          '- 6 Main Entrees + Tandoori Station',
          '- Espresso & Dessert Bar',
          '- Gold Chiavari Chairs & Chargers',
          '- 7 Hours Hall Rental + Bridal Suite',
        ],
      },
    ],
    blocks: [
      { text: 'Shared Mandatory Fee (applies to either package): In-House AV & Projector Package - $800 CAD flat.', size: 11.5, bold: true, boxBg: '#F1F5F9' },
      { text: 'All packages subject to 13% HST and 15% service charge on food subtotal. $2,500 CAD deposit to reserve.', size: 10.5 },
    ],
  },
  {
    id: 'I03',
    height: 680,
    bg: '#FFFFFF',
    header: { title: 'Instagram Direct Message', subtitle: 'Active 12m ago  |  Wedding Photo Inquiry', bg: '#E1306C', fg: '#FFFFFF', height: 64 },
    bubbles: [
      { sender: 'Couple', align: 'right', text: 'Hi! Are you available for our 5-hour Mehndi in Mississauga? What are your rates?', bg: '#E0F2FE' },
      { sender: 'Photographer', align: 'left', text: 'Yes we are available! Our 5-Hour Event Package is $900 CAD. Includes 5 hours coverage, 1 photographer, and 200+ edited photos via online gallery in 3 weeks.' },
      { sender: 'Photographer', align: 'left', text: 'Additional Hourly Pricing: $250/hr if you need extra coverage past 5 hours.' },
      { sender: 'Photographer', align: 'left', text: '$200 deposit via e-transfer locks in the date. Balance due on event day.' },
    ],
  },
  {
    id: 'I04',
    height: 760,
    header: { title: 'AURORA FRAME STUDIO', subtitle: '2027 Wedding Photography Rate Card (CAD)  |  Toronto, ON', bg: '#0F172A', fg: '#F8FAFC' },
    columns: [
      {
        title: 'Mini Collection',
        price: '$1,500 CAD',
        badge: '4 HOURS',
        height: 410,
        lines: [
          '1 Lead Photographer (4 hrs)',
          '250 edited digital images',
          'Online gallery delivery: 4 weeks',
          'Sneak peeks in 72 hours',
        ],
      },
      {
        title: 'Full Collection',
        price: '$3,100 CAD',
        badge: '8 HOURS · POPULAR',
        height: 410,
        lines: [
          '1 Lead Photographer (8 hrs)',
          '1 Second Photographer (5 hrs)',
          '600+ edited digital images',
          'Online gallery delivery: 6 weeks',
          'Sneak peeks in 48 hours',
        ],
      },
      {
        title: 'Luxury Collection',
        price: '$4,600 CAD',
        badge: '10 HOURS',
        height: 410,
        lines: [
          '2 Photographers (10 hrs)',
          'Engagement session included',
          '12x12 Italian Leather Album',
          'Online gallery delivery: 6 weeks',
          'Sneak peeks in 48 hours',
        ],
      },
    ],
    blocks: [
      { text: 'Notes: Overtime is $275/hr if needed. All collections are plus 13% HST. 30% retainer upon contract signing.', size: 11, boxBg: '#F8FAFC' },
    ],
  },
  {
    id: 'I05',
    height: 660,
    header: { title: 'ROYAL TANDOOR CATERING', subtitle: 'Full-Service Wedding Menu Flyer  |  Brampton, ON  |  CAD Pricing', bg: '#991B1B', fg: '#FFFFFF' },
    blocks: [
      { text: 'GRAND RECEPTION BUFFET MENU - $48 CAD PER PERSON (min 150 guests)', size: 14, bold: true, fg: '#7F1D1D' },
      { text: 'Includes: 4 Veg & Non-Veg Appetizers, Butter Chicken, Lamb Rogan Josh, Paneer Tikka Masala, Dal Makhani, Assorted Naan, Jeera Rice, Raita, Salad Bar, and 2 Desserts.', size: 11.5, boxBg: '#FEF2F2' },
      { text: 'Live Dosa / Chaat Station Surcharge: TBD based on guest count and venue electrical hookup (mandatory if live station requested).', size: 11.5 },
      { text: 'Delivery & Setup Fee: $350 CAD flat within GTA.', size: 11.5, bold: true },
      { text: 'Fine Print: 15% service charge applies on food subtotal only. Plus 13% HST. 25% deposit required to confirm date; balance due 10 days before event.', size: 9, fg: '#475569' },
    ],
  },
  {
    id: 'I06',
    height: 680,
    bg: '#ECE5DD',
    header: { title: 'WhatsApp - Blossom & Silk Decor', subtitle: 'online', bg: '#075E54', fg: '#FFFFFF', height: 64 },
    bubbles: [
      { sender: 'Blossom & Silk Decor', align: 'left', text: 'Hi! Here is your Reception Decor quote: Normally our Floral Arch + 20 Centerpieces package is $3,900, but for your Friday date I can offer $3,400.' },
      { sender: 'Blossom & Silk Decor', align: 'left', text: 'Note: Delivery and late-night teardown fee is TBD once we confirm your venue freight elevator access.' },
      { sender: 'Blossom & Silk Decor', align: 'left', text: '$500 deposit to reserve your date. Tax not included.' },
    ],
  },
  {
    id: 'I07',
    height: 600,
    header: { title: 'SOUNDWAVE ENTERTAINMENT', subtitle: 'Mobile Quote Summary  |  Mississauga, ON', bg: '#312E81', fg: '#FFFFFF' },
    blocks: [
      { text: 'Wedding Reception DJ & MC Package: $1,850 CAD flat', size: 14, bold: true, boxBg: '#EEF2FF' },
      { text: 'Includes:\n- 6 hours professional DJ + bilingual MC\n- Dual QSC sound system + 2 wireless microphones\n- 8 LED dance floor uplights', size: 11.5 },
      { text: 'Tax: Plus 13% HST.', size: 11.5, bold: true },
      { text: 'Payment Schedule: $300 CAD deposit due upon signing. Remaining balance due 14 days prior to event.', size: 11.5 },
    ],
  },
  {
    id: 'I08',
    height: 620,
    bg: '#FDF2F8',
    header: { title: 'RHYTHM & DHOL COLLECTIVE', subtitle: 'Live Baraat & Reception Entertainment  |  CAD', bg: '#FCE7F3', fg: '#831843' },
    blocks: [
      { text: 'Live 3-Piece Dhol + Brass Band (3 hours): $1,600 CAD', size: 13.5, bold: true, fg: '#831843', boxBg: '#FFF1F2' },
      { text: 'Overtime after 3 hours: $350 CAD per hour if extended.', size: 11.5, fg: '#4C1D95' },
      { text: 'Payment: Cash or e-transfer accepted ($100 off if paid in cash is NOT offered here - standard rate applies). $400 deposit to book.', size: 11, fg: '#4C1D95' },
      { text: 'Note: Tax treatment not stated on flyer.', size: 10, fg: '#6B21A8' },
    ],
  },
  {
    id: 'I09',
    height: 700,
    header: { title: 'LAKEVIEW PAVILION - TIER COMPARISON', subtitle: 'Cropped Screenshot  |  Oakville, ON  |  CAD', bg: '#0F766E', fg: '#FFFFFF' },
    columns: [
      {
        title: 'Classic Terrace Package',
        price: '$110 CAD / person',
        badge: 'MIN 100 GUESTS',
        height: 360,
        lines: [
          'Minimum 100 guests',
          'Plated 3-course dinner',
          'Standard open bar (5 hrs)',
          'Linens and chairs included',
        ],
      },
      {
        title: 'Custom Estate Buyout',
        price: 'Price TBD (Custom Quote)',
        badge: 'CUSTOM TIER',
        height: 360,
        lines: [
          'Full property buyout',
          'Custom chef tasting menu',
          'Pricing TBD upon guest count',
        ],
      },
    ],
    blocks: [
      { text: 'Mandatory Valet Parking Staffing Fee: TBD based on final vehicle estimate.', size: 11.5, bold: true, boxBg: '#FEF3C7' },
      { text: 'Plus 13% HST and 18% gratuity on entire subtotal.', size: 11 },
    ],
  },
  {
    id: 'I10',
    height: 580,
    header: { title: 'SILVERLINE STUDIO - PACKAGE SUMMARY CARD', subtitle: 'Embedded Graphic Attached to Email  |  CAD', bg: '#1E3A8A', fg: '#FFFFFF' },
    blocks: [
      { text: 'FULL WEDDING PHOTOGRAPHY COLLECTION: $3,500 CAD', size: 14, bold: true, fg: '#1E3A8A', boxBg: '#EFF6FF' },
      { text: 'Includes:\n- 1 Lead Photographer (8 hours)\n- 1 Second Photographer (5 hours)\n- Online gallery delivered within 6 weeks\n- Sneak peeks within 48 hours', size: 11.5 },
      { text: 'Tax: Plus 13% HST. Retainer: $750 CAD due upon signing.', size: 11.5, bold: true },
    ],
  },
];

// Flatten each image spec to exact rendered documentText for true multimodal grounding checks
function imageSpecToDocumentText(spec: ImageSpec): string {
  const parts: string[] = [];
  if (spec.header) {
    parts.push(spec.header.title);
    if (spec.header.subtitle) parts.push(spec.header.subtitle);
  }
  if (spec.columns) {
    for (const c of spec.columns) {
      parts.push(c.title);
      if (c.badge) parts.push(c.badge);
      if (c.price) parts.push(c.price);
      parts.push(...c.lines);
    }
  }
  if (spec.bubbles) {
    for (const b of spec.bubbles) {
      parts.push(`${b.sender}: ${b.text}`);
    }
  }
  if (spec.blocks) {
    for (const blk of spec.blocks) {
      parts.push(blk.text);
    }
  }
  return parts.join('\n');
}

const imageDocTexts = Object.fromEntries(imageSpecs.map((s) => [s.id, imageSpecToDocumentText(s)]));

const imageCases: BenchmarkCase[] = [
  {
    id: 'I01',
    split: 'held-out-v3-multimodal',
    modality: 'image',
    difficulty: 'ordinary',
    description: 'Clean email screenshot for CAD banquet package (min 120, max 200, 13% HST, 10% gratuity)',
    rawMessage: '',
    attachmentPath: 'eval-data/held-out-v3-multimodal/images/I01.png',
    mimeType: 'image/png',
    documentText: imageDocTexts.I01!,
    calcContext: { guestCount: 150 },
    expected: {
      vendorName: 'Grandview Banquet Hall',
      category: 'venue',
      currency: 'CAD',
      quoteKind: 'initial',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'excluded',
      gratuityPercent: 10,
      gratuityBasis: 'entire_subtotal',
      minGuests: 120,
      maxCapacity: 200,
      knownSubtotal: 12750,
      unknownItemLabels: [],
      expectedDepositAmount: 2000,
      paymentMethodRule: 'any',
      expectedDueDates: ['2027-09-15'],
      expectedInclusions: ['buffet', 'open standard bar', 'linens'],
      expectedSourceSnippets: ['$85 CAD per person', '13% HST', '10% gratuity'],
      legitimateUserConfirmations: [],
      missingSourceInfo: [],
    },
    mockExtraction: {
      vendorName: 'Grandview Banquet Hall',
      vendorLocation: 'Markham, Ontario',
      category: 'venue',
      events: ['Reception'],
      quoteKind: 'initial',
      currency: 'CAD',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'excluded',
      gratuityPercent: 10,
      gratuityBasis: 'entire_subtotal',
      lineItems: [
        {
          label: 'Classic Wedding Buffet & Bar Package',
          pricingType: 'per_person',
          amount: 85,
          minGuests: 120,
          isFoodItem: true,
          chargeType: 'mandatory',
          sourceExcerpt: 'Classic Wedding Buffet & Bar Package: $85 CAD per person',
          pageReference: 'Screenshot',
        },
      ],
      inclusions: [
        { name: '4-course South Asian & Continental buffet', sourceExcerpt: '4-course South Asian & Continental buffet' },
        { name: 'open standard bar', sourceExcerpt: 'open standard bar' },
        { name: 'white linens', sourceExcerpt: 'white linens' },
      ],
      venueDetails: { roomName: 'Emerald Ballroom', minGuests: 120, maxCapacity: 200 },
      paymentTerms: {
        depositAmount: 2000,
        methodRule: 'any',
        milestones: [
          { label: 'Deposit', amount: 2000, sourceExcerpt: '$2,000 CAD deposit upon booking' },
          { label: 'Balance', dueDate: '2027-09-15', sourceExcerpt: 'Balance due September 15, 2027' },
        ],
      },
      openQuestions: [],
    },
  },
  {
    id: 'I02',
    split: 'held-out-v3-multimodal',
    modality: 'image',
    difficulty: 'difficult',
    description: '2-column brochure screenshot: Royal ($58/pp min 150) vs Imperial ($68/pp min 100) + shared $800 AV',
    rawMessage: '',
    attachmentPath: 'eval-data/held-out-v3-multimodal/images/I02.png',
    mimeType: 'image/png',
    documentText: imageDocTexts.I02!,
    calcContext: { guestCount: 140, selectedPackageName: 'Royal' },
    expected: {
      vendorName: 'Palace Gardens Banquet Hall',
      category: 'venue',
      currency: 'CAD',
      quoteKind: 'initial',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'excluded',
      gratuityPercent: 15,
      gratuityBasis: 'food_subtotal',
      knownSubtotal: 800, // shared AV before package selection
      expectedSelectedPackageSubtotal: 9500, // (150 min * 58 = 8700) + 800 AV
      unknownItemLabels: [],
      expectedPackageCount: 2,
      expectUnresolvedPackageSelection: true,
      expectedDepositAmount: 2500,
      expectedInclusions: ['3 Passed Appetizers', 'Live Chaat', 'Gold Chiavari Chairs'],
      expectedSourceSnippets: ['$58 CAD / person', '$68 CAD / person', '$800 CAD flat'],
      legitimateUserConfirmations: ['Select between Royal Package and Imperial Package'],
      missingSourceInfo: ['Final balance due date not stated'],
    },
    mockExtraction: {
      vendorName: 'Palace Gardens Banquet Hall',
      vendorLocation: 'Mississauga, Ontario',
      category: 'venue',
      events: ['Wedding'],
      quoteKind: 'initial',
      currency: 'CAD',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'excluded',
      gratuityPercent: 15,
      gratuityBasis: 'food_subtotal',
      packages: [
        {
          id: 'royal-package',
          name: 'Royal Package',
          pricingType: 'per_person',
          amount: 58,
          minGuests: 150,
          isFoodItem: true,
          inclusions: [
            { name: '3 Passed Appetizers', packageId: 'royal-package', sourceExcerpt: '3 Passed Appetizers' },
            { name: '4 Main Entrees + Naan & Rice', packageId: 'royal-package', sourceExcerpt: '4 Main Entrees + Naan & Rice' },
          ],
          sourceExcerpt: 'Royal Package $58 CAD / person Minimum guarantee: 150 guests',
          pageReference: 'Left column',
        },
        {
          id: 'imperial-package',
          name: 'Imperial Package',
          pricingType: 'per_person',
          amount: 68,
          minGuests: 100,
          isFoodItem: true,
          inclusions: [
            { name: '5 Passed Appetizers + Live Chaat', packageId: 'imperial-package', sourceExcerpt: '5 Passed Appetizers + Live Chaat' },
            { name: 'Gold Chiavari Chairs & Chargers', packageId: 'imperial-package', sourceExcerpt: 'Gold Chiavari Chairs & Chargers' },
          ],
          sourceExcerpt: 'Imperial Package $68 CAD / person Minimum guarantee: 100 guests',
          pageReference: 'Right column',
        },
      ],
      lineItems: [
        {
          label: 'In-House AV & Projector Package',
          pricingType: 'flat',
          amount: 800,
          isFoodItem: false,
          chargeType: 'mandatory',
          sourceExcerpt: 'In-House AV & Projector Package - $800 CAD flat.',
          pageReference: 'Footer',
        },
      ],
      paymentTerms: { depositAmount: 2500, methodRule: 'unknown' },
      openQuestions: [
        {
          question: 'Which package tier will you select (Royal vs. Imperial)?',
          reason: 'ambiguous_rule',
          sourceExcerpt: 'Royal Package',
        },
      ],
    },
  },
  {
    id: 'I03',
    split: 'held-out-v3-multimodal',
    modality: 'image',
    difficulty: 'difficult',
    description: 'Instagram DM screenshot: $900 5-hr package + $250/hr conditional overtime, missing vendor name, unstated tax',
    rawMessage: '',
    attachmentPath: 'eval-data/held-out-v3-multimodal/images/I03.png',
    mimeType: 'image/png',
    documentText: imageDocTexts.I03!,
    calcContext: { hours: 5 },
    expected: {
      vendorName: null,
      category: 'photographer',
      currency: 'CAD',
      quoteKind: 'initial',
      taxStatus: 'unknown',
      knownSubtotal: 900,
      unknownItemLabels: [],
      expectedDepositAmount: 200,
      paymentMethodRule: 'etransfer',
      expectedDeliveryTerms: ['3 weeks'],
      expectedSourceSnippets: ['$900 CAD', 'Additional Hourly Pricing: $250/hr', '$200 deposit'],
      legitimateUserConfirmations: ['Enter missing vendor name', 'Confirm tax handling before booking'],
      missingSourceInfo: ['Vendor name not shown in DM screenshot', 'Tax handling not stated'],
    },
    mockExtraction: {
      vendorName: null,
      category: 'photographer',
      events: ['Mehndi'],
      quoteKind: 'initial',
      currency: 'CAD',
      taxStatus: 'unknown',
      gratuityStatus: 'unknown',
      serviceDurationHours: 5,
      lineItems: [
        {
          label: '5-Hour Event Package',
          pricingType: 'flat',
          amount: 900,
          hours: 5,
          chargeType: 'mandatory',
          sourceExcerpt: 'Our 5-Hour Event Package is $900 CAD.',
          pageReference: 'Chat bubble 2',
        },
        {
          label: 'Additional Hourly Pricing',
          pricingType: 'per_hour',
          amount: 250,
          chargeType: 'conditional',
          sourceExcerpt: 'Additional Hourly Pricing: $250/hr if you need extra coverage past 5 hours.',
          pageReference: 'Chat bubble 3',
        },
      ],
      inclusions: [
        { name: 'Photography coverage', quantity: 1, durationHours: 5, sourceExcerpt: '5 hours coverage, 1 photographer' },
        { name: '200+ edited photos', sourceExcerpt: '200+ edited photos via online gallery' },
      ],
      deliveryTerms: ['Online gallery in 3 weeks'],
      photographerDetails: { hoursIncluded: 5, extraHourRate: 250, teamSize: 1 },
      paymentTerms: { depositAmount: 200, methodRule: 'etransfer' },
      openQuestions: [],
    },
  },
  {
    id: 'I04',
    split: 'held-out-v3-multimodal',
    modality: 'image',
    difficulty: 'difficult',
    description: '3-tier photography rate card with badges, 2nd shooter partial hours, overtime footnote, and turnaround',
    rawMessage: '',
    attachmentPath: 'eval-data/held-out-v3-multimodal/images/I04.png',
    mimeType: 'image/png',
    documentText: imageDocTexts.I04!,
    calcContext: { hours: 8, selectedPackageName: 'Full' },
    expected: {
      vendorName: 'Aurora Frame Studio',
      category: 'photographer',
      currency: 'CAD',
      quoteKind: 'initial',
      taxStatus: 'excluded',
      taxPercent: 13,
      knownSubtotal: 0,
      expectedSelectedPackageSubtotal: 3100,
      unknownItemLabels: [],
      expectedPackageCount: 3,
      expectUnresolvedPackageSelection: true,
      expectedDepositPercent: 30,
      expectedInclusions: ['Second Photographer', 'Engagement session', 'Italian Leather Album'],
      expectedDeliveryTerms: ['48 hours', '6 weeks'],
      expectedSourceSnippets: ['Mini Collection', 'Full Collection', 'Luxury Collection', 'Overtime is $275/hr'],
      legitimateUserConfirmations: ['Select between Mini, Full, and Luxury Collections'],
      missingSourceInfo: ['Final balance due date not stated'],
    },
    mockExtraction: {
      vendorName: 'Aurora Frame Studio',
      vendorLocation: 'Toronto, ON',
      category: 'photographer',
      events: ['Wedding'],
      quoteKind: 'initial',
      currency: 'CAD',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'unknown',
      packages: [
        {
          id: 'mini-collection',
          name: 'Mini Collection',
          pricingType: 'flat',
          amount: 1500,
          hours: 4,
          inclusions: [{ name: 'Lead Photographer', quantity: 1, durationHours: 4, packageId: 'mini-collection', sourceExcerpt: '1 Lead Photographer (4 hrs)' }],
          deliveryTerms: ['Online gallery delivery: 4 weeks', 'Sneak peeks in 72 hours'],
          sourceExcerpt: 'Mini Collection $1,500 CAD',
        },
        {
          id: 'full-collection',
          name: 'Full Collection',
          pricingType: 'flat',
          amount: 3100,
          hours: 8,
          inclusions: [
            { name: 'Lead Photographer', quantity: 1, durationHours: 8, packageId: 'full-collection', sourceExcerpt: '1 Lead Photographer (8 hrs)' },
            { name: 'Second Photographer', quantity: 1, durationHours: 5, packageId: 'full-collection', sourceExcerpt: '1 Second Photographer (5 hrs)' },
          ],
          deliveryTerms: ['Online gallery delivery: 6 weeks', 'Sneak peeks in 48 hours'],
          sourceExcerpt: 'Full Collection $3,100 CAD',
        },
        {
          id: 'luxury-collection',
          name: 'Luxury Collection',
          pricingType: 'flat',
          amount: 4600,
          hours: 10,
          inclusions: [
            { name: 'Engagement session', packageId: 'luxury-collection', sourceExcerpt: 'Engagement session included' },
            { name: '12x12 Italian Leather Album', packageId: 'luxury-collection', sourceExcerpt: '12x12 Italian Leather Album' },
          ],
          deliveryTerms: ['Online gallery delivery: 6 weeks', 'Sneak peeks in 48 hours'],
          sourceExcerpt: 'Luxury Collection $4,600 CAD',
        },
      ],
      lineItems: [
        {
          label: 'Overtime',
          pricingType: 'per_hour',
          amount: 275,
          chargeType: 'conditional',
          sourceExcerpt: 'Overtime is $275/hr if needed.',
        },
      ],
      deliveryTerms: ['Sneak peeks in 48 hours', 'Online gallery delivery: 6 weeks'],
      paymentTerms: { depositPercent: 30, methodRule: 'unknown' },
      openQuestions: [
        {
          question: 'Which photography collection do you want to select?',
          reason: 'ambiguous_rule',
          sourceExcerpt: 'Full Collection $3,100 CAD',
        },
      ],
    },
  },
  {
    id: 'I05',
    split: 'held-out-v3-multimodal',
    modality: 'image',
    difficulty: 'difficult',
    description: 'Dense catering menu flyer with fine-print food-only 15% service charge + TBD live station surcharge',
    rawMessage: '',
    attachmentPath: 'eval-data/held-out-v3-multimodal/images/I05.png',
    mimeType: 'image/png',
    documentText: imageDocTexts.I05!,
    calcContext: { guestCount: 160 },
    expected: {
      vendorName: 'Royal Tandoor Catering',
      category: 'catering',
      currency: 'CAD',
      quoteKind: 'initial',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'excluded',
      gratuityPercent: 15,
      gratuityBasis: 'food_subtotal',
      minGuests: 150,
      knownSubtotal: 8030, // (160 * 48 = 7680) + 350 delivery
      unknownItemLabels: ['live'],
      expectedDepositPercent: 25,
      expectedRelativeDays: 10,
      expectedSourceSnippets: ['$48 CAD PER PERSON', 'Delivery & Setup Fee: $350 CAD', '15% service charge applies on food subtotal only'],
      legitimateUserConfirmations: ['Confirm whether Live Dosa/Chaat Station is needed and its TBD surcharge'],
      missingSourceInfo: ['Live station surcharge is TBD', 'Event date not stated for 10-day deadline'],
    },
    mockExtraction: {
      vendorName: 'Royal Tandoor Catering',
      vendorLocation: 'Brampton, ON',
      category: 'catering',
      events: ['Reception'],
      quoteKind: 'initial',
      currency: 'CAD',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'excluded',
      gratuityPercent: 15,
      gratuityBasis: 'food_subtotal',
      lineItems: [
        {
          label: 'Grand Reception Buffet Menu',
          pricingType: 'per_person',
          amount: 48,
          minGuests: 150,
          isFoodItem: true,
          chargeType: 'mandatory',
          sourceExcerpt: 'GRAND RECEPTION BUFFET MENU - $48 CAD PER PERSON (min 150 guests)',
        },
        {
          label: 'Delivery & Setup Fee',
          pricingType: 'flat',
          amount: 350,
          isFoodItem: false,
          chargeType: 'mandatory',
          sourceExcerpt: 'Delivery & Setup Fee: $350 CAD flat within GTA.',
        },
        {
          label: 'Live Dosa / Chaat Station Surcharge',
          pricingType: 'unknown',
          amount: null,
          chargeType: 'conditional',
          sourceExcerpt: 'Live Dosa / Chaat Station Surcharge: TBD based on guest count and venue electrical hookup',
        },
      ],
      paymentTerms: {
        depositPercent: 25,
        methodRule: 'unknown',
        milestones: [
          { label: 'Deposit', percent: 25, sourceExcerpt: '25% deposit required to confirm date' },
          { label: 'Balance', relativeDaysBeforeEvent: 10, relativeDeadlineText: '10 days before event', sourceExcerpt: 'balance due 10 days before event' },
        ],
      },
      openQuestions: [
        {
          question: 'What is the Live Dosa / Chaat Station Surcharge?',
          reason: 'missing_price',
          sourceExcerpt: 'Live Dosa / Chaat Station Surcharge: TBD based on guest count',
        },
      ],
    },
  },
  {
    id: 'I06',
    split: 'held-out-v3-multimodal',
    modality: 'image',
    difficulty: 'difficult',
    description: 'WhatsApp decor screenshot with negotiated $500 discount, unstated currency ($), and TBD delivery/teardown',
    rawMessage: '',
    attachmentPath: 'eval-data/held-out-v3-multimodal/images/I06.png',
    mimeType: 'image/png',
    documentText: imageDocTexts.I06!,
    calcContext: {},
    expected: {
      vendorName: 'Blossom & Silk Decor',
      category: 'decor',
      currency: 'UNKNOWN',
      quoteKind: 'initial',
      taxStatus: 'excluded',
      taxPercent: null,
      knownSubtotal: 3400,
      unknownItemLabels: ['delivery'],
      expectedNegotiatedSavings: 500,
      expectedDepositAmount: 500,
      expectedSourceSnippets: ['Normally our Floral Arch + 20 Centerpieces package is $3,900', 'I can offer $3,400', 'teardown fee is TBD'],
      legitimateUserConfirmations: [
        'Confirm currency (CAD vs USD)',
        'Confirm TBD delivery & teardown fee',
        'Confirm tax rate before booking',
      ],
      missingSourceInfo: ['Currency not stated', 'Delivery & teardown fee is TBD', 'Tax rate not stated'],
    },
    mockExtraction: {
      vendorName: 'Blossom & Silk Decor',
      category: 'decor',
      events: ['Reception'],
      quoteKind: 'initial',
      currency: 'UNKNOWN',
      taxStatus: 'excluded',
      taxPercent: null,
      gratuityStatus: 'unknown',
      lineItems: [
        {
          label: 'Floral Arch + 20 Centerpieces package',
          pricingType: 'flat',
          amount: 3400,
          originalAmount: 3900,
          chargeType: 'mandatory',
          sourceExcerpt: 'Normally our Floral Arch + 20 Centerpieces package is $3,900, but for your Friday date I can offer $3,400.',
        },
        {
          label: 'Delivery and late-night teardown fee',
          pricingType: 'unknown',
          amount: null,
          chargeType: 'mandatory',
          sourceExcerpt: 'Delivery and late-night teardown fee is TBD once we confirm your venue freight elevator access.',
        },
      ],
      paymentTerms: { depositAmount: 500, methodRule: 'unknown' },
      openQuestions: [
        {
          question: 'What is the delivery and teardown fee?',
          reason: 'missing_price',
          sourceExcerpt: 'Delivery and late-night teardown fee is TBD',
        },
      ],
    },
  },
  {
    id: 'I07',
    split: 'held-out-v3-multimodal',
    modality: 'image',
    difficulty: 'ordinary',
    description: 'Ordinary mobile DJ quote screenshot with 13% HST, $300 deposit, and 14-day relative balance deadline',
    rawMessage: '',
    attachmentPath: 'eval-data/held-out-v3-multimodal/images/I07.png',
    mimeType: 'image/png',
    documentText: imageDocTexts.I07!,
    calcContext: { hours: 6 },
    expected: {
      vendorName: 'Soundwave Entertainment',
      category: 'dj',
      currency: 'CAD',
      quoteKind: 'initial',
      taxStatus: 'excluded',
      taxPercent: 13,
      knownSubtotal: 1850,
      unknownItemLabels: [],
      expectedDepositAmount: 300,
      expectedRelativeDays: 14,
      expectedInclusions: ['bilingual MC', 'QSC sound system', 'uplights'],
      expectedSourceSnippets: ['$1,850 CAD flat', 'Plus 13% HST', '$300 CAD deposit'],
      legitimateUserConfirmations: [],
      missingSourceInfo: ['Event date not stated for 14-day deadline'],
    },
    mockExtraction: {
      vendorName: 'Soundwave Entertainment',
      vendorLocation: 'Mississauga, ON',
      category: 'dj',
      events: ['Reception'],
      quoteKind: 'initial',
      currency: 'CAD',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'unknown',
      serviceDurationHours: 6,
      lineItems: [
        {
          label: 'Wedding Reception DJ & MC Package',
          pricingType: 'flat',
          amount: 1850,
          hours: 6,
          chargeType: 'mandatory',
          sourceExcerpt: 'Wedding Reception DJ & MC Package: $1,850 CAD flat',
        },
      ],
      inclusions: [
        { name: 'Professional DJ + bilingual MC', durationHours: 6, sourceExcerpt: '6 hours professional DJ + bilingual MC' },
        { name: 'Dual QSC sound system + 2 wireless microphones', sourceExcerpt: 'Dual QSC sound system + 2 wireless microphones' },
        { name: '8 LED dance floor uplights', sourceExcerpt: '8 LED dance floor uplights' },
      ],
      paymentTerms: {
        depositAmount: 300,
        methodRule: 'unknown',
        milestones: [
          { label: 'Deposit', amount: 300, sourceExcerpt: '$300 CAD deposit due upon signing' },
          { label: 'Remaining balance', relativeDaysBeforeEvent: 14, relativeDeadlineText: '14 days prior to event', sourceExcerpt: 'Remaining balance due 14 days prior to event' },
        ],
      },
      openQuestions: [],
    },
  },
  {
    id: 'I08',
    split: 'held-out-v3-multimodal',
    modality: 'image',
    difficulty: 'ordinary',
    description: 'Low-contrast pastel entertainment card: live dhol + band with conditional overtime after 3 hours and unstated tax',
    rawMessage: '',
    attachmentPath: 'eval-data/held-out-v3-multimodal/images/I08.png',
    mimeType: 'image/png',
    documentText: imageDocTexts.I08!,
    calcContext: { hours: 3 },
    expected: {
      vendorName: 'Rhythm & Dhol Collective',
      category: 'entertainment',
      currency: 'CAD',
      quoteKind: 'initial',
      taxStatus: 'unknown',
      knownSubtotal: 1600,
      unknownItemLabels: [],
      expectedDepositAmount: 400,
      paymentMethodRule: 'any',
      expectedSourceSnippets: ['$1,600 CAD', 'Overtime after 3 hours: $350 CAD per hour', '$400 deposit'],
      legitimateUserConfirmations: ['Confirm tax handling before booking'],
      missingSourceInfo: ['Tax treatment not stated'],
    },
    mockExtraction: {
      vendorName: 'Rhythm & Dhol Collective',
      category: 'entertainment',
      events: ['Baraat', 'Reception'],
      quoteKind: 'initial',
      currency: 'CAD',
      taxStatus: 'unknown',
      gratuityStatus: 'unknown',
      serviceDurationHours: 3,
      lineItems: [
        {
          label: 'Live 3-Piece Dhol + Brass Band (3 hours)',
          pricingType: 'flat',
          amount: 1600,
          hours: 3,
          chargeType: 'mandatory',
          sourceExcerpt: 'Live 3-Piece Dhol + Brass Band (3 hours): $1,600 CAD',
        },
        {
          label: 'Overtime after 3 hours',
          pricingType: 'per_hour',
          amount: 350,
          chargeType: 'conditional',
          sourceExcerpt: 'Overtime after 3 hours: $350 CAD per hour if extended.',
        },
      ],
      paymentTerms: { depositAmount: 400, methodRule: 'any' },
      openQuestions: [],
    },
  },
  {
    id: 'I09',
    split: 'held-out-v3-multimodal',
    modality: 'image',
    difficulty: 'difficult',
    description: 'Cropped venue table with one priced package + one unknown/TBD custom buyout package + mandatory TBD valet fee',
    rawMessage: '',
    attachmentPath: 'eval-data/held-out-v3-multimodal/images/I09.png',
    mimeType: 'image/png',
    documentText: imageDocTexts.I09!,
    calcContext: { guestCount: 120, selectedPackageName: 'Classic' },
    expected: {
      vendorName: 'Lakeview Pavilion',
      category: 'venue',
      currency: 'CAD',
      quoteKind: 'initial',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'excluded',
      gratuityPercent: 18,
      gratuityBasis: 'entire_subtotal',
      knownSubtotal: 0,
      expectedSelectedPackageSubtotal: 13200, // 120 * 110
      unknownItemLabels: ['valet'],
      expectedPackageCount: 2,
      expectUnresolvedPackageSelection: true,
      expectedSourceSnippets: ['Classic Terrace Package', '$110 CAD / person', 'Price TBD', 'Valet Parking Staffing Fee: TBD'],
      legitimateUserConfirmations: ['Select between Classic Terrace and Custom Estate Buyout', 'Confirm TBD Valet Parking Staffing Fee'],
      missingSourceInfo: ['Custom Estate Buyout price is TBD', 'Valet Parking Staffing Fee is TBD'],
    },
    mockExtraction: {
      vendorName: 'Lakeview Pavilion',
      vendorLocation: 'Oakville, ON',
      category: 'venue',
      events: ['Wedding'],
      quoteKind: 'initial',
      currency: 'CAD',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'excluded',
      gratuityPercent: 18,
      gratuityBasis: 'entire_subtotal',
      packages: [
        {
          id: 'classic-terrace',
          name: 'Classic Terrace Package',
          pricingType: 'per_person',
          amount: 110,
          minGuests: 100,
          isFoodItem: true,
          sourceExcerpt: 'Classic Terrace Package $110 CAD / person Minimum 100 guests',
        },
        {
          id: 'custom-estate-buyout',
          name: 'Custom Estate Buyout',
          pricingType: 'unknown',
          amount: null,
          sourceExcerpt: 'Custom Estate Buyout Price TBD (Custom Quote)',
        },
      ],
      lineItems: [
        {
          label: 'Valet Parking Staffing Fee',
          pricingType: 'unknown',
          amount: null,
          chargeType: 'mandatory',
          sourceExcerpt: 'Mandatory Valet Parking Staffing Fee: TBD based on final vehicle estimate.',
        },
      ],
      openQuestions: [
        {
          question: 'What is the mandatory Valet Parking Staffing Fee?',
          reason: 'missing_price',
          sourceExcerpt: 'Mandatory Valet Parking Staffing Fee: TBD based on final vehicle estimate.',
        },
      ],
    },
  },
  {
    id: 'I10',
    split: 'held-out-v3-multimodal',
    modality: 'image',
    difficulty: 'difficult',
    description: 'Multimodal cross-source conflict: pasted email says $3,200 CAD while attached image summary says $3,500 CAD',
    rawMessage: 'Email from Silverline Studio: "Hi! Attached is our package graphic. For your wedding date, the Full Wedding Photography Collection is $3,200 CAD plus 13% HST."',
    attachmentPath: 'eval-data/held-out-v3-multimodal/images/I10.png',
    mimeType: 'image/png',
    documentText: imageDocTexts.I10!,
    calcContext: { hours: 8 },
    expected: {
      vendorName: 'Silverline Studio',
      category: 'photographer',
      currency: 'CAD',
      quoteKind: 'initial',
      taxStatus: 'excluded',
      taxPercent: 13,
      knownSubtotal: 3200,
      unknownItemLabels: [],
      expectedPriceConflictDiscrepancy: 300, // 3500 - 3200
      expectedDepositAmount: 750,
      expectedInclusions: ['Lead Photographer', 'Second Photographer'],
      expectedDeliveryTerms: ['6 weeks', '48 hours'],
      expectedSourceSnippets: ['$3,200 CAD', '$3,500 CAD', '1 Second Photographer (5 hours)'],
      legitimateUserConfirmations: ['Resolve price conflict between email ($3,200) and graphic ($3,500)'],
      missingSourceInfo: [],
    },
    mockExtraction: {
      vendorName: 'Silverline Studio',
      category: 'photographer',
      events: ['Wedding'],
      quoteKind: 'initial',
      currency: 'CAD',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'unknown',
      serviceDurationHours: 8,
      lineItems: [
        {
          label: 'Full Wedding Photography Collection',
          pricingType: 'flat',
          amount: 3200,
          hours: 8,
          chargeType: 'mandatory',
          conflictingOptions: [
            { sourceLabel: 'Email', pricingType: 'flat', amount: 3200, sourceExcerpt: 'Full Wedding Photography Collection is $3,200 CAD' },
            { sourceLabel: 'Attached graphic', pricingType: 'flat', amount: 3500, sourceExcerpt: 'FULL WEDDING PHOTOGRAPHY COLLECTION: $3,500 CAD' },
          ],
          sourceExcerpt: 'Full Wedding Photography Collection is $3,200 CAD',
        },
      ],
      inclusions: [
        { name: 'Lead Photographer', quantity: 1, durationHours: 8, sourceExcerpt: '1 Lead Photographer (8 hours)' },
        { name: 'Second Photographer', quantity: 1, durationHours: 5, sourceExcerpt: '1 Second Photographer (5 hours)' },
      ],
      deliveryTerms: ['Online gallery delivered within 6 weeks', 'Sneak peeks within 48 hours'],
      paymentTerms: { depositAmount: 750, methodRule: 'unknown' },
      openQuestions: [
        {
          question: 'Which price applies: $3,200 CAD (email) or $3,500 CAD (package graphic)?',
          reason: 'conflict',
          sourceExcerpt: 'FULL WEDDING PHOTOGRAPHY COLLECTION: $3,500 CAD',
        },
      ],
    },
  },
];

// ============================================================================
// C. 10 SYNTHETIC PDF CASES (P01 - P10)
// ============================================================================
interface PdfSpec {
  id: string;
  pages: Array<{ title: string; subtitle?: string; lines: string[] }>;
}

const pdfSpecs: PdfSpec[] = [
  {
    id: 'P01',
    pages: [
      {
        title: 'WILLOWBROOK MANOR - WEDDING PROPOSAL',
        subtitle: 'Burlington, Ontario  |  All amounts in CAD  |  Date: January 18, 2027',
        lines: [
          '## Event Summary',
          'Event: Wedding Reception (Garden Pavilion, min 100 guests, max 220 guests)',
          '',
          '## Pricing',
          '- Garden Pavilion Room Rental: $2,500 CAD flat',
          '- Three-Course Plated Dinner & Open Bar: $92 CAD per person (minimum 100 guests)',
          '',
          '## Inclusions',
          '- White floor-length linens, Chiavari chairs, china, and glassware',
          '- Dedicated day-of venue coordinator and complimentary menu tasting for 2',
          '',
          '## Taxes & Payment Schedule',
          '- All charges subject to 13% HST and 15% service charge on entire subtotal.',
          '- Deposit: $3,000 CAD due upon signing. Final balance due July 15, 2027. E-transfer or credit card.',
        ],
      },
    ],
  },
  {
    id: 'P02',
    pages: [
      {
        title: 'CRESTWOOD CONVENTION CENTRE - 2027 BANQUET BROCHURE',
        subtitle: 'Brampton, Ontario  |  All Pricing in CAD',
        lines: [
          '## Package 1: Classic Banquet ($60 CAD per person)',
          '- Minimum guest guarantee: 150 guests',
          '- Includes: 3 appetizers, 3 entrees, naan & rice, dessert table, standard linens',
          '',
          '## Package 2: Signature Banquet ($74 CAD per person)',
          '- Minimum guest guarantee: 120 guests',
          '- Includes: 5 appetizers, 5 entrees, live chaat bar, gold cutlery, upgraded backdrop',
          '',
          '## Package 3: Royal Gala ($90 CAD per person)',
          '- Minimum guest guarantee: 100 guests',
          '- Includes: 7 appetizers, 6 entrees, live chaat + pasta stations, premium open bar, Chiavari chairs',
        ],
      },
      {
        title: 'CRESTWOOD CONVENTION CENTRE - SHARED TERMS & STAFFING',
        subtitle: 'Page 2 - Applies to All Banquet Packages',
        lines: [
          '## Mandatory Shared Staffing & Fees',
          '- Licensed Bartenders: $200 CAD per bartender (1 bartender per 75 guests required)',
          '- In-House Sound & Lighting Package: $750 CAD flat',
          '',
          '## Taxes, Gratuity & Payment',
          '- 15% gratuity applies to food subtotal only.',
          '- 13% HST applies to all charges.',
          '- Deposit: $2,500 CAD due at booking. Final guest count & balance due 14 days prior to event.',
        ],
      },
    ],
  },
  {
    id: 'P03',
    pages: [
      {
        title: 'HARBORVIEW GRAND HOTEL - CATERING & BALLROOM CONTRACT',
        subtitle: 'Boston, Massachusetts  |  All Pricing in USD',
        lines: [
          '## Function Space',
          'Room: Harbor Ballroom (Maximum Capacity: 180 guests; Minimum 100 guests)',
          '',
          '## Food & Beverage Package',
          '- Grand Harbor Dinner & Premium Bar: $135 USD per person',
          '- Includes: 1-hour cocktail reception, 3-course plated dinner, 4-hour open bar, linens & staging',
        ],
      },
      {
        title: 'HARBORVIEW GRAND HOTEL - TERMS & CONDITIONS',
        subtitle: 'Page 2 - Service Charge, Taxes & Deposits',
        lines: [
          '## Gratuity & Taxes',
          '- 18% gratuity applies to food subtotal only.',
          '- Plus applicable local tax (rate determined by municipal schedule at event date).',
          '',
          '## Payment Schedule',
          '- Initial Deposit: 25% due upon contract execution.',
          '- Final Balance: Due 30 days prior to the event date.',
        ],
      },
    ],
  },
  {
    id: 'P04',
    pages: [
      {
        title: 'MONARCH LENS STUDIO - WEDDING PHOTOGRAPHY AGREEMENT',
        subtitle: 'Toronto, Ontario  |  Currency: CAD',
        lines: [
          '## Selected Package',
          '- Heritage Wedding Collection: $3,500 CAD flat',
          '',
          '## Coverage & Team',
          '- 1 Lead Photographer for 8 hours of continuous coverage',
          '- 1 Second Photographer for 5 hours of coverage',
          '- Overtime Rate: $275 CAD per hour if client requests additional coverage beyond 8 hours',
        ],
      },
      {
        title: 'MONARCH LENS STUDIO - DELIVERY & PAYMENT TERMS',
        subtitle: 'Page 2 - Deliverables & Milestones',
        lines: [
          '## Delivery Terms',
          '- 30+ sneak peek images delivered within 48 hours of the event',
          '- Full edited high-resolution online gallery (700+ photos) delivered within 8 weeks',
          '- RAW unedited files are not included in this agreement',
          '',
          '## Taxes & Payment Milestones',
          '- Plus 13% HST.',
          '- Milestone 1: $1,000 CAD retainer due upon signing',
          '- Milestone 2: $1,500 CAD due June 1, 2027',
          '- Milestone 3: Remaining balance due August 15, 2027',
        ],
      },
    ],
  },
  {
    id: 'P05',
    pages: [
      {
        title: 'SAFFRON TABLE CATERING - ITEMIZED QUOTE',
        subtitle: 'Mississauga, ON  |  CAD Pricing',
        lines: [
          '## Mandatory Catering Items',
          '- Wedding Dinner Buffet: $52 CAD per person (min 120 guests)',
          '- Kitchen Delivery & Chafing Setup: $400 CAD flat',
          '- Mandatory Linen & Serving Ware Fee: TBD once venue table count is confirmed',
          '',
          '## Optional Add-Ons',
          '- Optional Live Chaat Station: $900 CAD flat',
          '',
          '## Taxes & Payment',
          '- Plus 13% HST. 30% deposit required to book.',
        ],
      },
    ],
  },
  {
    id: 'P06',
    pages: [
      {
        title: 'GILDED PETAL EVENTS - FLORAL & STAGE DESIGN QUOTE',
        subtitle: 'Vaughan, Ontario  |  Prices in CAD',
        lines: [
          '## Events Covered: Ceremony & Reception',
          '- Custom Mandap, Reception Stage & 24 Floral Centerpieces: Standard rate $6,800 CAD; Preferred client price $6,100 CAD (savings of $700 CAD)',
          '- Mandatory Venue Rigging & Late-Night Strike Fee: TBD pending venue ceiling weight sign-off',
        ],
      },
      {
        title: 'GILDED PETAL EVENTS - PAYMENT SCHEDULE',
        subtitle: 'Page 2 - Taxes & Milestones',
        lines: [
          '## Taxes',
          '- All amounts subject to 13% HST.',
          '',
          '## Payment Milestones',
          '- Deposit: $1,500 CAD due upon signing',
          '- Second Installment: $2,000 CAD due May 1, 2027',
          '- Final Balance: Due 21 days prior to event',
        ],
      },
    ],
  },
  {
    id: 'P07',
    pages: [
      {
        title: 'BEATDROP AUDIO - WEDDING DJ CONTRACT',
        subtitle: 'Hamilton, Ontario  |  CAD',
        lines: [
          '## Package Details',
          '- Reception DJ, Sound & Dance Floor Lighting (6 hours): $2,100 CAD flat (HST included)',
          '- Includes: Professional DJ, wireless mic for speeches, 12 uplights, and custom playlist consultation',
          '',
          '## Payment Terms',
          '- 50% deposit required upon signing. Remaining 50% due 7 days before the wedding.',
          '- E-transfer or credit card accepted.',
        ],
      },
    ],
  },
  {
    id: 'P08',
    pages: [
      {
        title: 'CINEMATIC VOWS - WEDDING VIDEOGRAPHY PACKAGES',
        subtitle: 'Toronto, ON  |  All Pricing in CAD',
        lines: [
          '## Option A: Highlight Film Package - $2,800 CAD flat',
          '- 8 hours coverage, 1 videographer, 5-minute highlight film',
          '- Delivery: 8 weeks after wedding',
          '- Deposit: 25% due upon booking',
          '',
          '## Option B: Feature Film Package - $4,200 CAD flat',
          '- 10 hours coverage, 2 videographers, 5-minute highlight film + 45-minute full documentary edit + drone footage',
          '- Delivery: 14 weeks after wedding',
          '- Deposit: 40% due upon booking',
          '',
          '## Taxes',
          '- Plus 13% HST.',
        ],
      },
    ],
  },
  {
    id: 'P09',
    pages: [
      {
        title: 'MAPLE RIDGE ESTATES - QUOTE REVISION ADDENDUM #2',
        subtitle: 'Vaughan, Ontario  |  CAD  |  Supersedes Prior AV Rate',
        lines: [
          '## Revised Quote Summary',
          'This revised proposal updates our previous quote for your Reception (150 guests):',
          '- Classic Dinner & Bar Package: $95 CAD per person (unchanged)',
          '- In-House AV Package: Revised down from $900 CAD to $500 CAD flat',
          '- Mandatory Late-Night Licensed Security Fee: Still TBD pending bar close time',
        ],
      },
      {
        title: 'MAPLE RIDGE ESTATES - REVISION TERMS',
        subtitle: 'Page 2 - Taxes & Prior Deposit Credit',
        lines: [
          '## Taxes & Gratuity',
          '- Plus 13% HST and 15% gratuity on entire subtotal.',
          '',
          '## Payment',
          '- Prior $2,500 CAD deposit remains credited toward final balance.',
        ],
      },
    ],
  },
  {
    id: 'P10',
    pages: [
      {
        title: 'STARLIGHT LIVE BAND - PERFORMANCE TERMS & QUOTE',
        subtitle: 'Ottawa, ON  |  CAD Pricing',
        lines: [
          '## Performance Fee',
          '- 5-Piece Live Reception Band (4 hours): $3,200 CAD flat',
          '- Overtime beyond 4 hours: $450 CAD per hour if requested on site',
          '',
          '## Conditional Production & Travel Fees',
          '- Generator / Dedicated Power Supply Fee: TBD if outdoor setup lacks 20-amp circuits',
          '- Travel & Lodging Surcharge: TBD if venue is more than 60 km from downtown Ottawa',
          '',
          '## Payment & Tax Notice',
          '- Payment accepted via cash or e-transfer ($800 CAD deposit upon signing).',
          '- Tax status is not specified in this sheet.',
        ],
      },
    ],
  },
];

function pdfSpecToDocumentText(spec: PdfSpec): string {
  return spec.pages
    .map((p, idx) => [`[Page ${idx + 1}] ${p.title}`, p.subtitle ?? '', ...p.lines].filter(Boolean).join('\n'))
    .join('\n\n');
}

const pdfDocTexts = Object.fromEntries(pdfSpecs.map((s) => [s.id, pdfSpecToDocumentText(s)]));

const pdfCases: BenchmarkCase[] = [
  {
    id: 'P01',
    split: 'held-out-v3-multimodal',
    modality: 'pdf',
    difficulty: 'ordinary',
    description: '1-page clean venue proposal PDF (room rental + per-person dinner, 13% HST, 15% service charge, explicit due date)',
    rawMessage: '',
    attachmentPath: 'eval-data/held-out-v3-multimodal/pdfs/P01.pdf',
    mimeType: 'application/pdf',
    documentText: pdfDocTexts.P01!,
    calcContext: { guestCount: 150 },
    expected: {
      vendorName: 'Willowbrook Manor',
      category: 'venue',
      currency: 'CAD',
      quoteKind: 'initial',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'excluded',
      gratuityPercent: 15,
      gratuityBasis: 'entire_subtotal',
      minGuests: 100,
      maxCapacity: 220,
      knownSubtotal: 16300, // 2500 + (150 * 92 = 13800)
      unknownItemLabels: [],
      expectedDepositAmount: 3000,
      paymentMethodRule: 'any',
      expectedDueDates: ['2027-07-15'],
      expectedInclusions: ['Chiavari chairs', 'venue coordinator', 'menu tasting'],
      expectedSourceSnippets: ['$2,500 CAD flat', '$92 CAD per person', 'July 15, 2027'],
      legitimateUserConfirmations: [],
      missingSourceInfo: [],
    },
    mockExtraction: {
      vendorName: 'Willowbrook Manor',
      vendorLocation: 'Burlington, Ontario',
      category: 'venue',
      events: ['Reception'],
      quotedDate: '2027-01-18',
      quoteKind: 'initial',
      currency: 'CAD',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'excluded',
      gratuityPercent: 15,
      gratuityBasis: 'entire_subtotal',
      lineItems: [
        {
          label: 'Garden Pavilion Room Rental',
          pricingType: 'flat',
          amount: 2500,
          isFoodItem: false,
          chargeType: 'mandatory',
          sourceExcerpt: 'Garden Pavilion Room Rental: $2,500 CAD flat',
          pageReference: 'Page 1',
        },
        {
          label: 'Three-Course Plated Dinner & Open Bar',
          pricingType: 'per_person',
          amount: 92,
          minGuests: 100,
          isFoodItem: true,
          chargeType: 'mandatory',
          sourceExcerpt: 'Three-Course Plated Dinner & Open Bar: $92 CAD per person (minimum 100 guests)',
          pageReference: 'Page 1',
        },
      ],
      inclusions: [
        { name: 'White floor-length linens, Chiavari chairs, china, and glassware', sourceExcerpt: 'White floor-length linens, Chiavari chairs' },
        { name: 'Dedicated day-of venue coordinator', sourceExcerpt: 'Dedicated day-of venue coordinator' },
        { name: 'Complimentary menu tasting for 2', sourceExcerpt: 'complimentary menu tasting for 2' },
      ],
      venueDetails: { roomName: 'Garden Pavilion', minGuests: 100, maxCapacity: 220 },
      paymentTerms: {
        depositAmount: 3000,
        methodRule: 'any',
        milestones: [
          { label: 'Deposit', amount: 3000, sourceExcerpt: 'Deposit: $3,000 CAD due upon signing' },
          { label: 'Final balance', dueDate: '2027-07-15', sourceExcerpt: 'Final balance due July 15, 2027' },
        ],
      },
      openQuestions: [],
    },
  },
  {
    id: 'P02',
    split: 'held-out-v3-multimodal',
    modality: 'pdf',
    difficulty: 'difficult',
    description: '2-page banquet brochure PDF: 3 packages on p1 + shared bartender ratio (1:75), $750 sound/lighting, food-only gratuity on p2',
    rawMessage: '',
    attachmentPath: 'eval-data/held-out-v3-multimodal/pdfs/P02.pdf',
    mimeType: 'application/pdf',
    documentText: pdfDocTexts.P02!,
    calcContext: { guestCount: 150, selectedPackageName: 'Classic' },
    expected: {
      vendorName: 'Crestwood Convention Centre',
      category: 'venue',
      currency: 'CAD',
      quoteKind: 'initial',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'excluded',
      gratuityPercent: 15,
      gratuityBasis: 'food_subtotal',
      knownSubtotal: 1150, // (ceil(150/75)=2 * 200 = 400) + 750
      expectedSelectedPackageSubtotal: 10150, // (150 * 60 = 9000) + 400 + 750
      unknownItemLabels: [],
      expectedPackageCount: 3,
      expectUnresolvedPackageSelection: true,
      expectedDepositAmount: 2500,
      expectedRelativeDays: 14,
      expectedInclusions: ['3 appetizers', 'live chaat bar', 'premium open bar'],
      expectedSourceSnippets: ['Classic Banquet ($60 CAD per person)', '$200 CAD per bartender', '15% gratuity applies to food subtotal only'],
      legitimateUserConfirmations: ['Select between Classic, Signature, and Royal Gala packages'],
      missingSourceInfo: ['Event date not stated for 14-day balance deadline'],
    },
    mockExtraction: {
      vendorName: 'Crestwood Convention Centre',
      vendorLocation: 'Brampton, Ontario',
      category: 'venue',
      events: ['Wedding'],
      quoteKind: 'initial',
      currency: 'CAD',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'excluded',
      gratuityPercent: 15,
      gratuityBasis: 'food_subtotal',
      packages: [
        {
          id: 'classic-banquet',
          name: 'Classic Banquet',
          pricingType: 'per_person',
          amount: 60,
          minGuests: 150,
          isFoodItem: true,
          inclusions: [{ name: '3 appetizers', packageId: 'classic-banquet', sourceExcerpt: '3 appetizers' }],
          sourceExcerpt: 'Package 1: Classic Banquet ($60 CAD per person)',
          pageReference: 'Page 1',
        },
        {
          id: 'signature-banquet',
          name: 'Signature Banquet',
          pricingType: 'per_person',
          amount: 74,
          minGuests: 120,
          isFoodItem: true,
          inclusions: [{ name: 'live chaat bar', packageId: 'signature-banquet', sourceExcerpt: 'live chaat bar' }],
          sourceExcerpt: 'Package 2: Signature Banquet ($74 CAD per person)',
          pageReference: 'Page 1',
        },
        {
          id: 'royal-gala',
          name: 'Royal Gala',
          pricingType: 'per_person',
          amount: 90,
          minGuests: 100,
          isFoodItem: true,
          inclusions: [{ name: 'premium open bar', packageId: 'royal-gala', sourceExcerpt: 'premium open bar' }],
          sourceExcerpt: 'Package 3: Royal Gala ($90 CAD per person)',
          pageReference: 'Page 1',
        },
      ],
      lineItems: [
        {
          label: 'Licensed Bartenders',
          pricingType: 'per_guest_ratio',
          amount: 200,
          ratioGuests: 75,
          unitLabel: 'bartender',
          isFoodItem: false,
          chargeType: 'mandatory',
          sourceExcerpt: 'Licensed Bartenders: $200 CAD per bartender (1 bartender per 75 guests required)',
          pageReference: 'Page 2',
        },
        {
          label: 'In-House Sound & Lighting Package',
          pricingType: 'flat',
          amount: 750,
          isFoodItem: false,
          chargeType: 'mandatory',
          sourceExcerpt: 'In-House Sound & Lighting Package: $750 CAD flat',
          pageReference: 'Page 2',
        },
      ],
      paymentTerms: {
        depositAmount: 2500,
        methodRule: 'unknown',
        milestones: [
          { label: 'Deposit', amount: 2500, sourceExcerpt: 'Deposit: $2,500 CAD due at booking' },
          { label: 'Final balance', relativeDaysBeforeEvent: 14, relativeDeadlineText: '14 days prior to event', sourceExcerpt: 'balance due 14 days prior to event' },
        ],
      },
      openQuestions: [
        {
          question: 'Which banquet package will you select?',
          reason: 'ambiguous_rule',
          sourceExcerpt: 'Package 1: Classic Banquet ($60 CAD per person)',
          pageReference: 'Page 1',
        },
      ],
    },
  },
  {
    id: 'P03',
    split: 'held-out-v3-multimodal',
    modality: 'pdf',
    difficulty: 'difficult',
    description: '2-page USD hotel contract with unstated local tax rate, 18% food gratuity, max 180 capacity, 30-day relative deadline',
    rawMessage: '',
    attachmentPath: 'eval-data/held-out-v3-multimodal/pdfs/P03.pdf',
    mimeType: 'application/pdf',
    documentText: pdfDocTexts.P03!,
    calcContext: { guestCount: 150 },
    expected: {
      vendorName: 'Harborview Grand Hotel',
      category: 'venue',
      currency: 'USD',
      quoteKind: 'initial',
      taxStatus: 'excluded',
      taxPercent: null,
      gratuityStatus: 'excluded',
      gratuityPercent: 18,
      gratuityBasis: 'food_subtotal',
      minGuests: 100,
      maxCapacity: 180,
      knownSubtotal: 20250, // 150 * 135
      unknownItemLabels: [],
      expectedDepositPercent: 25,
      expectedRelativeDays: 30,
      expectedSourceSnippets: ['$135 USD per person', '18% gratuity applies to food subtotal only', 'applicable local tax'],
      legitimateUserConfirmations: ['Confirm applicable local tax rate before booking'],
      missingSourceInfo: ['Local tax percentage not stated', 'Event date not stated for 30-day deadline'],
    },
    mockExtraction: {
      vendorName: 'Harborview Grand Hotel',
      vendorLocation: 'Boston, Massachusetts',
      category: 'venue',
      events: ['Wedding'],
      quoteKind: 'initial',
      currency: 'USD',
      taxStatus: 'excluded',
      taxPercent: null,
      gratuityStatus: 'excluded',
      gratuityPercent: 18,
      gratuityBasis: 'food_subtotal',
      lineItems: [
        {
          label: 'Grand Harbor Dinner & Premium Bar',
          pricingType: 'per_person',
          amount: 135,
          minGuests: 100,
          isFoodItem: true,
          chargeType: 'mandatory',
          sourceExcerpt: 'Grand Harbor Dinner & Premium Bar: $135 USD per person',
          pageReference: 'Page 1',
        },
      ],
      venueDetails: { roomName: 'Harbor Ballroom', minGuests: 100, maxCapacity: 180 },
      paymentTerms: {
        depositPercent: 25,
        methodRule: 'unknown',
        milestones: [
          { label: 'Initial Deposit', percent: 25, sourceExcerpt: 'Initial Deposit: 25% due upon contract execution.' },
          { label: 'Final Balance', relativeDaysBeforeEvent: 30, relativeDeadlineText: '30 days prior to the event date', sourceExcerpt: 'Due 30 days prior to the event date.' },
        ],
      },
      openQuestions: [
        {
          question: 'What is the applicable local tax rate?',
          reason: 'ambiguous_rule',
          sourceExcerpt: 'Plus applicable local tax',
          pageReference: 'Page 2',
        },
      ],
    },
  },
  {
    id: 'P04',
    split: 'held-out-v3-multimodal',
    modality: 'pdf',
    difficulty: 'difficult',
    description: '2-page studio photography contract: $3,500 collection, lead 8h + 2nd shooter 5h, overtime $275/hr, delivery terms, 3 milestones',
    rawMessage: '',
    attachmentPath: 'eval-data/held-out-v3-multimodal/pdfs/P04.pdf',
    mimeType: 'application/pdf',
    documentText: pdfDocTexts.P04!,
    calcContext: { hours: 8 },
    expected: {
      vendorName: 'Monarch Lens Studio',
      category: 'photographer',
      currency: 'CAD',
      quoteKind: 'initial',
      taxStatus: 'excluded',
      taxPercent: 13,
      knownSubtotal: 3500,
      unknownItemLabels: [],
      expectedDepositAmount: 1000,
      expectedDueDates: ['2027-06-01', '2027-08-15'],
      expectedInclusions: ['Lead Photographer', 'Second Photographer'],
      expectedDeliveryTerms: ['48 hours', '8 weeks', 'RAW'],
      expectedSourceSnippets: ['$3,500 CAD flat', '1 Second Photographer for 5 hours', 'Overtime Rate: $275 CAD per hour'],
      legitimateUserConfirmations: [],
      missingSourceInfo: [],
    },
    mockExtraction: {
      vendorName: 'Monarch Lens Studio',
      vendorLocation: 'Toronto, Ontario',
      category: 'photographer',
      events: ['Wedding'],
      quoteKind: 'initial',
      currency: 'CAD',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'unknown',
      serviceDurationHours: 8,
      lineItems: [
        {
          label: 'Heritage Wedding Collection',
          pricingType: 'flat',
          amount: 3500,
          hours: 8,
          chargeType: 'mandatory',
          sourceExcerpt: 'Heritage Wedding Collection: $3,500 CAD flat',
          pageReference: 'Page 1',
        },
        {
          label: 'Overtime Rate',
          pricingType: 'per_hour',
          amount: 275,
          chargeType: 'conditional',
          sourceExcerpt: 'Overtime Rate: $275 CAD per hour if client requests additional coverage beyond 8 hours',
          pageReference: 'Page 1',
        },
      ],
      inclusions: [
        { name: 'Lead Photographer', quantity: 1, durationHours: 8, sourceExcerpt: '1 Lead Photographer for 8 hours of continuous coverage' },
        { name: 'Second Photographer', quantity: 1, durationHours: 5, sourceExcerpt: '1 Second Photographer for 5 hours of coverage' },
      ],
      deliveryTerms: [
        '30+ sneak peek images delivered within 48 hours of the event',
        'Full edited high-resolution online gallery (700+ photos) delivered within 8 weeks',
        'RAW unedited files are not included in this agreement',
      ],
      photographerDetails: { hoursIncluded: 8, extraHourRate: 275, teamSize: 2 },
      paymentTerms: {
        depositAmount: 1000,
        methodRule: 'unknown',
        milestones: [
          { label: 'Retainer', amount: 1000, sourceExcerpt: '$1,000 CAD retainer due upon signing' },
          { label: 'Second payment', amount: 1500, dueDate: '2027-06-01', sourceExcerpt: '$1,500 CAD due June 1, 2027' },
          { label: 'Remaining balance', dueDate: '2027-08-15', sourceExcerpt: 'Remaining balance due August 15, 2027' },
        ],
      },
      openQuestions: [],
    },
  },
  {
    id: 'P05',
    split: 'held-out-v3-multimodal',
    modality: 'pdf',
    difficulty: 'difficult',
    description: '1-page itemized catering invoice PDF: per-person menu + flat delivery + optional chaat station + mandatory TBD linen fee',
    rawMessage: '',
    attachmentPath: 'eval-data/held-out-v3-multimodal/pdfs/P05.pdf',
    mimeType: 'application/pdf',
    documentText: pdfDocTexts.P05!,
    calcContext: { guestCount: 140 },
    expected: {
      vendorName: 'Saffron Table Catering',
      category: 'catering',
      currency: 'CAD',
      quoteKind: 'initial',
      taxStatus: 'excluded',
      taxPercent: 13,
      minGuests: 120,
      knownSubtotal: 7680, // (140 * 52 = 7280) + 400 delivery (optional 900 excluded)
      unknownItemLabels: ['linen'],
      expectedDepositPercent: 30,
      expectedSourceSnippets: ['$52 CAD per person', '$400 CAD flat', 'Linen & Serving Ware Fee: TBD'],
      legitimateUserConfirmations: ['Confirm TBD Linen & Serving Ware Fee before approval'],
      missingSourceInfo: ['Linen & Serving Ware Fee is TBD'],
    },
    mockExtraction: {
      vendorName: 'Saffron Table Catering',
      vendorLocation: 'Mississauga, ON',
      category: 'catering',
      events: ['Wedding'],
      quoteKind: 'initial',
      currency: 'CAD',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'unknown',
      lineItems: [
        {
          label: 'Wedding Dinner Buffet',
          pricingType: 'per_person',
          amount: 52,
          minGuests: 120,
          isFoodItem: true,
          chargeType: 'mandatory',
          sourceExcerpt: 'Wedding Dinner Buffet: $52 CAD per person (min 120 guests)',
          pageReference: 'Page 1',
        },
        {
          label: 'Kitchen Delivery & Chafing Setup',
          pricingType: 'flat',
          amount: 400,
          isFoodItem: false,
          chargeType: 'mandatory',
          sourceExcerpt: 'Kitchen Delivery & Chafing Setup: $400 CAD flat',
          pageReference: 'Page 1',
        },
        {
          label: 'Linen & Serving Ware Fee',
          pricingType: 'unknown',
          amount: null,
          chargeType: 'mandatory',
          sourceExcerpt: 'Mandatory Linen & Serving Ware Fee: TBD once venue table count is confirmed',
          pageReference: 'Page 1',
        },
        {
          label: 'Live Chaat Station',
          pricingType: 'flat',
          amount: 900,
          chargeType: 'optional',
          optionalAddon: true,
          sourceExcerpt: 'Optional Live Chaat Station: $900 CAD flat',
          pageReference: 'Page 1',
        },
      ],
      paymentTerms: { depositPercent: 30, methodRule: 'unknown' },
      openQuestions: [
        {
          question: 'What is the mandatory Linen & Serving Ware Fee?',
          reason: 'missing_price',
          sourceExcerpt: 'Mandatory Linen & Serving Ware Fee: TBD once venue table count is confirmed',
          pageReference: 'Page 1',
        },
      ],
    },
  },
  {
    id: 'P06',
    split: 'held-out-v3-multimodal',
    modality: 'pdf',
    difficulty: 'difficult',
    description: '2-page multi-event decor quote PDF: negotiated $700 savings, mandatory TBD rigging fee, 3-milestone payment schedule',
    rawMessage: '',
    attachmentPath: 'eval-data/held-out-v3-multimodal/pdfs/P06.pdf',
    mimeType: 'application/pdf',
    documentText: pdfDocTexts.P06!,
    calcContext: {},
    expected: {
      vendorName: 'Gilded Petal Events',
      category: 'decor',
      currency: 'CAD',
      quoteKind: 'initial',
      taxStatus: 'excluded',
      taxPercent: 13,
      knownSubtotal: 6100,
      unknownItemLabels: ['rigging'],
      expectedNegotiatedSavings: 700,
      expectedDepositAmount: 1500,
      expectedDueDates: ['2027-05-01'],
      expectedRelativeDays: 21,
      expectedSourceSnippets: ['Preferred client price $6,100 CAD', 'Rigging & Late-Night Strike Fee: TBD', 'May 1, 2027'],
      legitimateUserConfirmations: ['Confirm TBD Venue Rigging & Late-Night Strike Fee'],
      missingSourceInfo: ['Venue Rigging & Strike Fee is TBD', 'Event date not stated for 21-day balance deadline'],
    },
    mockExtraction: {
      vendorName: 'Gilded Petal Events',
      vendorLocation: 'Vaughan, Ontario',
      category: 'decor',
      events: ['Ceremony', 'Reception'],
      quoteKind: 'initial',
      currency: 'CAD',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'unknown',
      lineItems: [
        {
          label: 'Custom Mandap, Reception Stage & 24 Floral Centerpieces',
          pricingType: 'flat',
          amount: 6100,
          originalAmount: 6800,
          chargeType: 'mandatory',
          sourceExcerpt: 'Standard rate $6,800 CAD; Preferred client price $6,100 CAD',
          pageReference: 'Page 1',
        },
        {
          label: 'Venue Rigging & Late-Night Strike Fee',
          pricingType: 'unknown',
          amount: null,
          chargeType: 'mandatory',
          sourceExcerpt: 'Mandatory Venue Rigging & Late-Night Strike Fee: TBD pending venue ceiling weight sign-off',
          pageReference: 'Page 1',
        },
      ],
      paymentTerms: {
        depositAmount: 1500,
        methodRule: 'unknown',
        milestones: [
          { label: 'Deposit', amount: 1500, sourceExcerpt: 'Deposit: $1,500 CAD due upon signing' },
          { label: 'Second Installment', amount: 2000, dueDate: '2027-05-01', sourceExcerpt: '$2,000 CAD due May 1, 2027' },
          { label: 'Final Balance', relativeDaysBeforeEvent: 21, relativeDeadlineText: '21 days prior to event', sourceExcerpt: 'Due 21 days prior to event' },
        ],
      },
      openQuestions: [
        {
          question: 'What is the mandatory Venue Rigging & Late-Night Strike Fee?',
          reason: 'missing_price',
          sourceExcerpt: 'Mandatory Venue Rigging & Late-Night Strike Fee: TBD',
          pageReference: 'Page 1',
        },
      ],
    },
  },
  {
    id: 'P07',
    split: 'held-out-v3-multimodal',
    modality: 'pdf',
    difficulty: 'ordinary',
    description: '1-page ordinary DJ contract PDF (CAD, HST included, 50% deposit, 7-day relative deadline)',
    rawMessage: '',
    attachmentPath: 'eval-data/held-out-v3-multimodal/pdfs/P07.pdf',
    mimeType: 'application/pdf',
    documentText: pdfDocTexts.P07!,
    calcContext: { hours: 6 },
    expected: {
      vendorName: 'Beatdrop Audio',
      category: 'dj',
      currency: 'CAD',
      quoteKind: 'initial',
      taxStatus: 'included',
      knownSubtotal: 2100,
      unknownItemLabels: [],
      expectedDepositPercent: 50,
      paymentMethodRule: 'any',
      expectedRelativeDays: 7,
      expectedInclusions: ['wireless mic', '12 uplights', 'playlist consultation'],
      expectedSourceSnippets: ['$2,100 CAD flat (HST included)', '50% deposit required upon signing'],
      legitimateUserConfirmations: [],
      missingSourceInfo: ['Event date not stated for 7-day deadline'],
    },
    mockExtraction: {
      vendorName: 'Beatdrop Audio',
      vendorLocation: 'Hamilton, Ontario',
      category: 'dj',
      events: ['Reception'],
      quoteKind: 'initial',
      currency: 'CAD',
      taxStatus: 'included',
      gratuityStatus: 'unknown',
      serviceDurationHours: 6,
      lineItems: [
        {
          label: 'Reception DJ, Sound & Dance Floor Lighting (6 hours)',
          pricingType: 'flat',
          amount: 2100,
          hours: 6,
          chargeType: 'mandatory',
          sourceExcerpt: 'Reception DJ, Sound & Dance Floor Lighting (6 hours): $2,100 CAD flat (HST included)',
          pageReference: 'Page 1',
        },
      ],
      inclusions: [
        { name: 'Professional DJ', sourceExcerpt: 'Professional DJ' },
        { name: 'wireless mic for speeches', sourceExcerpt: 'wireless mic for speeches' },
        { name: '12 uplights', sourceExcerpt: '12 uplights' },
        { name: 'custom playlist consultation', sourceExcerpt: 'custom playlist consultation' },
      ],
      paymentTerms: {
        depositPercent: 50,
        methodRule: 'any',
        milestones: [
          { label: 'Deposit', percent: 50, sourceExcerpt: '50% deposit required upon signing' },
          { label: 'Remaining 50%', percent: 50, relativeDaysBeforeEvent: 7, relativeDeadlineText: '7 days before the wedding', sourceExcerpt: 'Remaining 50% due 7 days before the wedding' },
        ],
      },
      openQuestions: [],
    },
  },
  {
    id: 'P08',
    split: 'held-out-v3-multimodal',
    modality: 'pdf',
    difficulty: 'difficult',
    description: '1-page videography 2-tier package sheet PDF with package-specific delivery turnarounds and deposit percentages',
    rawMessage: '',
    attachmentPath: 'eval-data/held-out-v3-multimodal/pdfs/P08.pdf',
    mimeType: 'application/pdf',
    documentText: pdfDocTexts.P08!,
    calcContext: { hours: 8, selectedPackageName: 'Highlight' },
    expected: {
      vendorName: 'Cinematic Vows',
      category: 'photographer', // videography maps to photographer or other — rubric accepts photographer/other
      currency: 'CAD',
      quoteKind: 'initial',
      taxStatus: 'excluded',
      taxPercent: 13,
      knownSubtotal: 0,
      expectedSelectedPackageSubtotal: 2800,
      unknownItemLabels: [],
      expectedPackageCount: 2,
      expectUnresolvedPackageSelection: true,
      expectedInclusions: ['highlight film', 'documentary edit', 'drone footage'],
      expectedDeliveryTerms: ['8 weeks', '14 weeks'],
      expectedSourceSnippets: ['Highlight Film Package - $2,800 CAD', 'Feature Film Package - $4,200 CAD', 'Deposit: 40%'],
      legitimateUserConfirmations: ['Select between Highlight Film and Feature Film packages'],
      missingSourceInfo: ['Final balance due date not stated'],
    },
    mockExtraction: {
      vendorName: 'Cinematic Vows',
      vendorLocation: 'Toronto, ON',
      category: 'photographer',
      events: ['Wedding'],
      quoteKind: 'initial',
      currency: 'CAD',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'unknown',
      packages: [
        {
          id: 'highlight-film',
          name: 'Highlight Film Package',
          pricingType: 'flat',
          amount: 2800,
          hours: 8,
          inclusions: [{ name: '5-minute highlight film', packageId: 'highlight-film', sourceExcerpt: '5-minute highlight film' }],
          deliveryTerms: ['Delivery: 8 weeks after wedding'],
          paymentTerms: { depositPercent: 25, methodRule: 'unknown' },
          sourceExcerpt: 'Option A: Highlight Film Package - $2,800 CAD flat',
          pageReference: 'Page 1',
        },
        {
          id: 'feature-film',
          name: 'Feature Film Package',
          pricingType: 'flat',
          amount: 4200,
          hours: 10,
          inclusions: [
            { name: '45-minute full documentary edit', packageId: 'feature-film', sourceExcerpt: '45-minute full documentary edit' },
            { name: 'drone footage', packageId: 'feature-film', sourceExcerpt: 'drone footage' },
          ],
          deliveryTerms: ['Delivery: 14 weeks after wedding'],
          paymentTerms: { depositPercent: 40, methodRule: 'unknown' },
          sourceExcerpt: 'Option B: Feature Film Package - $4,200 CAD flat',
          pageReference: 'Page 1',
        },
      ],
      lineItems: [],
      deliveryTerms: ['8 weeks after wedding', '14 weeks after wedding'],
      openQuestions: [
        {
          question: 'Which videography package will you select?',
          reason: 'ambiguous_rule',
          sourceExcerpt: 'Option A: Highlight Film Package - $2,800 CAD flat',
          pageReference: 'Page 1',
        },
      ],
    },
  },
  {
    id: 'P09',
    split: 'held-out-v3-multimodal',
    modality: 'pdf',
    difficulty: 'difficult',
    description: '2-page venue revision addendum PDF reducing AV from $900 to $500 while preserving TBD security fee and prior deposit',
    rawMessage: '',
    attachmentPath: 'eval-data/held-out-v3-multimodal/pdfs/P09.pdf',
    mimeType: 'application/pdf',
    documentText: pdfDocTexts.P09!,
    calcContext: { guestCount: 150 },
    expected: {
      vendorName: 'Maple Ridge Estates',
      category: 'venue',
      currency: 'CAD',
      quoteKind: 'revision',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'excluded',
      gratuityPercent: 15,
      gratuityBasis: 'entire_subtotal',
      knownSubtotal: 14750, // (150 * 95 = 14250) + 500 AV
      unknownItemLabels: ['security'],
      expectedNegotiatedSavings: 400,
      expectedDepositAmount: 2500,
      expectedSourceSnippets: ['Revised down from $900 CAD to $500 CAD', 'Licensed Security Fee: Still TBD', '$2,500 CAD deposit'],
      legitimateUserConfirmations: ['Confirm TBD Late-Night Licensed Security Fee'],
      missingSourceInfo: ['Late-Night Licensed Security Fee is still TBD'],
    },
    mockExtraction: {
      vendorName: 'Maple Ridge Estates',
      vendorLocation: 'Vaughan, Ontario',
      category: 'venue',
      events: ['Reception'],
      quoteKind: 'revision',
      currency: 'CAD',
      taxStatus: 'excluded',
      taxPercent: 13,
      gratuityStatus: 'excluded',
      gratuityPercent: 15,
      gratuityBasis: 'entire_subtotal',
      lineItems: [
        {
          label: 'Classic Dinner & Bar Package',
          pricingType: 'per_person',
          amount: 95,
          isFoodItem: true,
          chargeType: 'mandatory',
          sourceExcerpt: 'Classic Dinner & Bar Package: $95 CAD per person (unchanged)',
          pageReference: 'Page 1',
        },
        {
          label: 'In-House AV Package',
          pricingType: 'flat',
          amount: 500,
          originalAmount: 900,
          isFoodItem: false,
          chargeType: 'mandatory',
          sourceExcerpt: 'In-House AV Package: Revised down from $900 CAD to $500 CAD flat',
          pageReference: 'Page 1',
        },
        {
          label: 'Late-Night Licensed Security Fee',
          pricingType: 'unknown',
          amount: null,
          chargeType: 'mandatory',
          sourceExcerpt: 'Mandatory Late-Night Licensed Security Fee: Still TBD pending bar close time',
          pageReference: 'Page 1',
        },
      ],
      paymentTerms: { depositAmount: 2500, methodRule: 'unknown' },
      openQuestions: [
        {
          question: 'What is the mandatory Late-Night Licensed Security Fee?',
          reason: 'missing_price',
          sourceExcerpt: 'Mandatory Late-Night Licensed Security Fee: Still TBD pending bar close time',
          pageReference: 'Page 1',
        },
      ],
    },
  },
  {
    id: 'P10',
    split: 'held-out-v3-multimodal',
    modality: 'pdf',
    difficulty: 'difficult',
    description: '1-page dense live band PDF: flat base + conditional TBD power/travel fees + overtime + cash/etransfer (must not assume tax-free)',
    rawMessage: '',
    attachmentPath: 'eval-data/held-out-v3-multimodal/pdfs/P10.pdf',
    mimeType: 'application/pdf',
    documentText: pdfDocTexts.P10!,
    calcContext: { hours: 4 },
    expected: {
      vendorName: 'Starlight Live Band',
      category: 'entertainment',
      currency: 'CAD',
      quoteKind: 'initial',
      taxStatus: 'unknown',
      knownSubtotal: 3200,
      unknownItemLabels: ['power', 'travel'],
      expectedDepositAmount: 800,
      paymentMethodRule: 'any',
      expectedSourceSnippets: ['$3,200 CAD flat', 'Overtime beyond 4 hours: $450 CAD per hour', 'Power Supply Fee: TBD', 'Travel & Lodging Surcharge: TBD'],
      legitimateUserConfirmations: [
        'Confirm whether conditional Power Supply and Travel fees apply',
        'Confirm tax handling before booking',
      ],
      missingSourceInfo: ['Power Supply Fee is TBD', 'Travel & Lodging Surcharge is TBD', 'Tax status not specified'],
    },
    mockExtraction: {
      vendorName: 'Starlight Live Band',
      vendorLocation: 'Ottawa, ON',
      category: 'entertainment',
      events: ['Reception'],
      quoteKind: 'initial',
      currency: 'CAD',
      taxStatus: 'unknown',
      gratuityStatus: 'unknown',
      serviceDurationHours: 4,
      lineItems: [
        {
          label: '5-Piece Live Reception Band (4 hours)',
          pricingType: 'flat',
          amount: 3200,
          hours: 4,
          chargeType: 'mandatory',
          sourceExcerpt: '5-Piece Live Reception Band (4 hours): $3,200 CAD flat',
          pageReference: 'Page 1',
        },
        {
          label: 'Overtime beyond 4 hours',
          pricingType: 'per_hour',
          amount: 450,
          chargeType: 'conditional',
          sourceExcerpt: 'Overtime beyond 4 hours: $450 CAD per hour if requested on site',
          pageReference: 'Page 1',
        },
        {
          label: 'Generator / Dedicated Power Supply Fee',
          pricingType: 'unknown',
          amount: null,
          chargeType: 'conditional',
          sourceExcerpt: 'Generator / Dedicated Power Supply Fee: TBD if outdoor setup lacks 20-amp circuits',
          pageReference: 'Page 1',
        },
        {
          label: 'Travel & Lodging Surcharge',
          pricingType: 'unknown',
          amount: null,
          chargeType: 'conditional',
          sourceExcerpt: 'Travel & Lodging Surcharge: TBD if venue is more than 60 km from downtown Ottawa',
          pageReference: 'Page 1',
        },
      ],
      paymentTerms: { depositAmount: 800, methodRule: 'any' },
      openQuestions: [
        {
          question: 'Do the conditional Power Supply or Travel & Lodging surcharges apply?',
          reason: 'missing_price',
          sourceExcerpt: 'Generator / Dedicated Power Supply Fee: TBD',
          pageReference: 'Page 1',
        },
      ],
    },
  },
];

// 1. Render PNGs via PowerShell System.Drawing
const tmpSpecPath = resolve(OUT_DIR, '_image_specs.tmp.json');
writeFileSync(tmpSpecPath, JSON.stringify(imageSpecs, null, 2), 'utf8');
try {
  const out = execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      resolve('scripts/render-holdout-images.ps1'),
      '-SpecPath',
      tmpSpecPath,
      '-OutDir',
      IMG_DIR,
    ],
    { encoding: 'utf8' },
  );
  console.log(out.trim());
} finally {
  unlinkSync(tmpSpecPath);
}

// 2. Render PDFs via pure Node.js
for (const spec of pdfSpecs) {
  const buf = buildPdfBuffer(spec.pages);
  writeFileSync(resolve(PDF_DIR, `${spec.id}.pdf`), buf);
}
console.log(`Generated ${pdfSpecs.length} PDF documents into ${PDF_DIR}`);

// 3. Write frozen cases.json (30 cases)
const allCases: BenchmarkCase[] = [...textCases, ...imageCases, ...pdfCases];
writeFileSync(resolve(OUT_DIR, 'cases.json'), JSON.stringify(allCases, null, 2), 'utf8');
console.log(
  `Wrote ${allCases.length} frozen benchmark cases (${textCases.length} text, ${imageCases.length} image, ${pdfCases.length} pdf) to ${resolve(OUT_DIR, 'cases.json')}`,
);
