import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateQuoteTotal, resolveRelativeDeadlineDate } from './calculator.ts';
import { extractQuote, normalizeProviderResponse, validateAttachments } from './extractor.ts';
import { createReviewSession, getApprovalBlockers, selectPackage } from './review.ts';
import type { ExtractedQuote } from './types.ts';
import { validateExtractedQuote } from './validator.ts';

test('Case A: venue with missing gratuity percentage preserves inclusions and blocks approval', () => {
  const rawMessage =
    'Our banquet package is $55 per person plus 13% HST and gratuity. Minimum 150 guests. Includes 4 appetizers, 3 main dishes, 2 desserts and unlimited soft drinks.';

  const quote: ExtractedQuote = {
    vendorName: null,
    category: 'venue',
    events: ['Reception'],
    quoteKind: 'initial',
    currency: 'UNKNOWN',
    taxStatus: 'excluded',
    taxPercent: 13,
    gratuityStatus: 'excluded',
    gratuityPercent: null,
    gratuityBasis: 'unknown',
    lineItems: [
      {
        label: 'Banquet package',
        pricingType: 'per_person',
        amount: 55,
        minGuests: 150,
        isFoodItem: true,
        chargeType: 'mandatory',
        sourceExcerpt: 'Our banquet package is $55 per person',
      },
    ],
    inclusions: [
      { category: 'food', name: 'Appetizers', quantity: 4, unit: 'appetizers' },
      { category: 'food', name: 'Main dishes', quantity: 3, unit: 'main dishes' },
      { category: 'food', name: 'Desserts', quantity: 2, unit: 'desserts' },
      { category: 'beverage', name: 'Unlimited soft drinks' },
    ],
    venueDetails: { minGuests: 150 },
    openQuestions: [
      {
        question: 'Confirm the gratuity percentage and what it applies to.',
        reason: 'missing_price',
        sourceExcerpt: 'plus 13% HST and gratuity',
      },
      {
        question: 'Confirm whether prices are in CAD or USD.',
        reason: 'ambiguous_rule',
        sourceExcerpt: '$55 per person',
      },
    ],
  };

  const validation = validateExtractedQuote(quote, rawMessage);
  assert.equal(validation.valid, true);
  assert.equal(quote.vendorName, null);
  assert.equal(quote.vendorLocation, undefined);
  assert.equal(quote.inclusions?.length, 4);

  const calc = calculateQuoteTotal(quote, { guestCount: 120 });
  assert.equal(calc.knownSubtotal, 8250); // 150 min * $55
  assert.equal(calc.minGuestsApplied, true);
  assert.equal(calc.gratuityUnresolved, true);
  assert.equal(calc.isEstimateComplete, false);

  const session = createReviewSession('case-a', quote, { guestCount: 120 });
  const blockers = getApprovalBlockers(session);
  assert.ok(blockers.some((b) => /gratuity/i.test(b)));
  assert.ok(blockers.some((b) => /currency/i.test(b)));
});

test('Case B: negotiated photography quote records $100 savings without false price conflict', () => {
  const rawMessage =
    'I normally charge $1,000 for 6 hours of photography, but I can do $900 for your engagement. Includes edited photos and an online gallery. $200 deposit to confirm.';

  const quote: ExtractedQuote = {
    vendorName: null,
    category: 'photographer',
    events: ['Engagement'],
    quoteKind: 'initial',
    currency: 'UNKNOWN',
    taxStatus: 'unknown',
    gratuityStatus: 'unknown',
    serviceDurationHours: 6,
    lineItems: [
      {
        label: '6-hour engagement photography',
        pricingType: 'flat',
        amount: 900,
        originalAmount: 1000,
        hours: 6,
        chargeType: 'mandatory',
        sourceExcerpt:
          'I normally charge $1,000 for 6 hours of photography, but I can do $900 for your engagement',
      },
    ],
    inclusions: [
      { category: 'photography', name: 'Photography coverage', quantity: 6, unit: 'hours' },
      { category: 'photography', name: 'Edited photos' },
      { category: 'photography', name: 'Online gallery' },
    ],
    photographerDetails: { hoursIncluded: 6 },
    paymentTerms: {
      depositAmount: 200,
      methodRule: 'unknown',
      scheduleNotes: '$200 deposit to confirm.',
    },
    openQuestions: [
      {
        question: 'Confirm whether prices are in CAD or USD.',
        reason: 'ambiguous_rule',
        sourceExcerpt: '$900 for your engagement',
      },
    ],
  };

  const validation = validateExtractedQuote(quote, rawMessage);
  assert.equal(validation.valid, true);

  const calc = calculateQuoteTotal(quote);
  assert.equal(calc.knownSubtotal, 900);
  assert.equal(calc.negotiatedSavings, 100);
  assert.equal(calc.priceConflicts.length, 0);
  assert.equal(quote.quoteKind, 'initial');
});

test('Case C: complex venue quote calculates banquet, third-party AV, bartenders, food-only gratuity, HST, and relative deadline', () => {
  const rawMessage =
    'Our banquet package is CAD $60 per guest with a minimum guarantee of 150 guests. Includes 5 appetizers, 4 main dishes, 2 desserts and unlimited soft drinks. Maximum capacity is 200 guests. HST is 13% and gratuity is 10% of the food subtotal. AV is provided by our preferred third-party supplier for $750. Bartenders cost $250 each, with one required per 75 guests. A 30% deposit is required to secure the date, with the remaining balance due 30 days before the event.';

  const quote: ExtractedQuote = {
    vendorName: null,
    category: 'venue',
    events: ['Reception'],
    quoteKind: 'initial',
    currency: 'CAD',
    taxStatus: 'excluded',
    taxPercent: 13,
    gratuityStatus: 'excluded',
    gratuityPercent: 10,
    gratuityBasis: 'food_subtotal',
    lineItems: [
      {
        label: 'Banquet package',
        pricingType: 'per_person',
        amount: 60,
        minGuests: 150,
        isFoodItem: true,
        chargeType: 'mandatory',
        sourceExcerpt: 'Our banquet package is CAD $60 per guest with a minimum guarantee of 150 guests',
      },
      {
        label: 'AV package',
        pricingType: 'flat',
        amount: 750,
        isThirdParty: true,
        thirdPartyProvider: 'Preferred third-party supplier',
        isFoodItem: false,
        chargeType: 'mandatory',
        sourceExcerpt: 'AV is provided by our preferred third-party supplier for $750',
      },
      {
        label: 'Bartenders',
        pricingType: 'per_guest_ratio',
        amount: 250,
        ratioGuests: 75,
        unitLabel: 'bartender',
        isFoodItem: false,
        chargeType: 'mandatory',
        sourceExcerpt: 'Bartenders cost $250 each, with one required per 75 guests',
      },
    ],
    inclusions: [
      { category: 'food', name: 'Appetizers', quantity: 5, unit: 'appetizers' },
      { category: 'food', name: 'Main dishes', quantity: 4, unit: 'main dishes' },
      { category: 'food', name: 'Desserts', quantity: 2, unit: 'desserts' },
      { category: 'beverage', name: 'Unlimited soft drinks' },
    ],
    venueDetails: { minGuests: 150, maxCapacity: 200 },
    paymentTerms: {
      depositPercent: 30,
      methodRule: 'unknown',
      scheduleNotes: '30% deposit to secure the date; remaining balance due 30 days before the event.',
      milestones: [
        { label: 'Deposit', percent: 30 },
        {
          label: 'Remaining balance',
          percent: 70,
          relativeDaysBeforeEvent: 30,
          relativeDeadlineText: '30 days before the event',
        },
      ],
    },
    openQuestions: [],
  };

  const validation = validateExtractedQuote(quote, rawMessage);
  assert.equal(validation.valid, true);

  const calc = calculateQuoteTotal(quote, { guestCount: 175 });
  assert.equal(calc.itemTotals[0]?.amount, 10500); // 175 * $60
  assert.equal(calc.itemTotals[1]?.amount, 750); // AV
  assert.equal(calc.itemTotals[2]?.amount, 750); // ceil(175/75) = 3 * $250
  assert.equal(calc.knownSubtotal, 12000);
  assert.equal(calc.gratuityAmount, 1050); // 10% of $10,500 food subtotal
  assert.equal(calc.taxAmount, 1696.5); // 13% of ($12,000 + $1,050)
  assert.equal(calc.knownAllInTotal, 14746.5);
  assert.equal(calc.isEstimateComplete, true);
  assert.equal(resolveRelativeDeadlineDate('2027-08-15', 30), '2027-07-16');
});

test('percentage line items support structured bases and block approval when basis is unknown', () => {
  const baseQuote: ExtractedQuote = {
    vendorName: 'Test Venue',
    category: 'venue',
    events: ['Reception'],
    quoteKind: 'initial',
    currency: 'CAD',
    taxStatus: 'included',
    gratuityStatus: 'included',
    lineItems: [
      {
        label: 'Dinner buffet',
        pricingType: 'flat',
        amount: 10000,
        isFoodItem: true,
        sourceExcerpt: 'Dinner buffet $10,000',
      },
      {
        label: 'AV rental',
        pricingType: 'flat',
        amount: 2000,
        isFoodItem: false,
        sourceExcerpt: 'AV rental $2,000',
      },
      {
        label: 'Service surcharge',
        pricingType: 'percentage',
        amount: 10,
        percentageRate: 10,
        percentageBasis: 'unknown',
        sourceExcerpt: '10% service surcharge',
      },
    ],
    openQuestions: [],
  };

  const unknownCalc = calculateQuoteTotal(baseQuote);
  assert.ok(unknownCalc.unknownItems.includes('Service surcharge'));
  assert.equal(unknownCalc.isEstimateComplete, false);

  const specificQuote = structuredClone(baseQuote);
  specificQuote.lineItems[2]!.percentageBasis = 'specific_line_items';
  specificQuote.lineItems[2]!.percentageTargetLabels = ['AV rental'];
  assert.equal(calculateQuoteTotal(specificQuote).knownSubtotal, 12200); // 10% of $2,000 = $200

  const customQuote = structuredClone(baseQuote);
  customQuote.lineItems[2]!.percentageBasis = 'custom_amount';
  customQuote.lineItems[2]!.customBasisAmount = 5000;
  assert.equal(calculateQuoteTotal(customQuote).knownSubtotal, 12500); // 10% of $5,000 = $500
});

test('Case D: multimodal attachment validation, distinct Gemini inlineData payloads, and document evidence tracking', async () => {
  // Reject unsupported format
  const badFormat = validateAttachments([
    { mimeType: 'application/x-msdownload', base64Data: 'AAAA', fileName: 'bad.exe' },
  ]);
  assert.ok(badFormat.length > 0);

  // Send two distinct images and verify Gemini receives distinct base64 inlineData
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  const capturedInlineData: string[] = [];

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      contents: Array<{ parts: Array<{ inlineData?: { data: string } }> }>;
    };
    const inlinePart = body.contents[0]?.parts.find((p) => p.inlineData);
    const b64 = inlinePart?.inlineData?.data ?? '';
    capturedInlineData.push(b64);

    const isImgA = b64 === 'SU1BR0VfQQ==';
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    vendorName: isImgA ? 'Alpha Hall' : 'Beta Studio',
                    category: isImgA ? 'venue' : 'photographer',
                    events: ['Reception'],
                    quoteKind: 'initial',
                    currency: 'CAD',
                    taxStatus: 'excluded',
                    gratuityStatus: 'unknown',
                    lineItems: [
                      {
                        label: isImgA ? 'Hall rental' : 'Photo package',
                        pricingType: 'flat',
                        amount: isImgA ? 8000 : 3500,
                        sourceExcerpt: isImgA ? 'Hall rental CAD $8,000' : 'Photo package CAD $3,500',
                        pageReference: 'Screenshot',
                      },
                    ],
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
    const resA = await extractQuote('', {
      provider: 'gemini',
      attachments: [{ mimeType: 'image/png', base64Data: 'SU1BR0VfQQ==', fileName: 'quote-a.png' }],
    });
    const resB = await extractQuote('', {
      provider: 'gemini',
      attachments: [{ mimeType: 'image/png', base64Data: 'SU1BR0VfQg==', fileName: 'quote-b.png' }],
    });

    assert.deepEqual(capturedInlineData, ['SU1BR0VfQQ==', 'SU1BR0VfQg==']);
    const valA = validateExtractedQuote(resA.rawResponse, '', { hasAttachments: true });
    const valB = validateExtractedQuote(resB.rawResponse, '', { hasAttachments: true });
    assert.equal(valA.valid, true);
    assert.equal(valB.valid, true);
    assert.equal(valA.quote?.vendorName, 'Alpha Hall');
    assert.equal(valB.quote?.vendorName, 'Beta Studio');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});

test('deduplicates duplicate service-charge percentage line item when gratuityPercent is already set and strips zero/equal provider placeholders', () => {
  const normalized = normalizeProviderResponse({
    lineItems: [
      {
        label: 'Wedding buffet',
        pricingType: 'per_person',
        amount: 42,
        originalAmount: 42,
        ratioGuests: 0,
        percentageRate: 0,
        percentageBasis: 'unknown',
        sourceExcerpt: 'Wedding buffet is $42/person',
      },
    ],
  }) as { lineItems: Array<Record<string, unknown>> };

  assert.equal('originalAmount' in normalized.lineItems[0]!, false);
  assert.equal('ratioGuests' in normalized.lineItems[0]!, false);
  assert.equal('percentageRate' in normalized.lineItems[0]!, false);
  assert.equal('percentageBasis' in normalized.lineItems[0]!, false);

  const dupQuote: ExtractedQuote = {
    vendorName: 'Saffron Kitchen Catering',
    category: 'catering',
    events: ['Wedding'],
    quoteKind: 'initial',
    currency: 'CAD',
    taxStatus: 'excluded',
    taxPercent: 13,
    gratuityStatus: 'excluded',
    gratuityPercent: 15,
    gratuityBasis: 'entire_subtotal',
    lineItems: [
      {
        label: 'Wedding buffet',
        pricingType: 'per_person',
        amount: 42,
        minGuests: 120,
        sourceExcerpt: 'Wedding buffet is $42/person',
      },
      {
        label: 'Delivery fee',
        pricingType: 'flat',
        amount: 350,
        sourceExcerpt: 'flat $350 delivery fee',
      },
      {
        label: 'service charge',
        pricingType: 'percentage',
        amount: 15,
        percentageRate: 15,
        percentageBasis: 'entire_subtotal',
        sourceExcerpt: '15% service charge',
      },
    ],
    openQuestions: [],
  };

  const calc = calculateQuoteTotal(dupQuote, { guestCount: 130 });
  assert.equal(calc.knownSubtotal, 5810);
  assert.equal(calc.gratuityAmount, 871.5);
});

test('UAT Multi-package venue: mutually exclusive packages never sum, block approval until selected, and prevent redundant extra-guest double-counting', () => {
  const quote: ExtractedQuote = {
    vendorName: 'Palace Banquet Hall',
    category: 'venue',
    events: ['Reception'],
    quoteKind: 'initial',
    currency: 'CAD',
    taxStatus: 'excluded',
    taxPercent: 13,
    gratuityStatus: 'excluded',
    gratuityPercent: 10,
    gratuityBasis: 'entire_subtotal',
    selectedPackageId: null,
    packages: [
      {
        id: 'royal-package',
        name: 'Royal Package',
        pricingType: 'per_person',
        amount: 55,
        minGuests: 150,
        isFoodItem: true,
        inclusions: [{ name: 'Appetizers', quantity: 4, unit: 'appetizers' }],
        sourceExcerpt: 'Royal Package is $55/person (min 150)',
      },
      {
        id: 'imperial-package',
        name: 'Imperial Package',
        pricingType: 'per_person',
        amount: 65,
        minGuests: 100,
        isFoodItem: true,
        inclusions: [{ name: 'Appetizers', quantity: 6, unit: 'appetizers' }],
        sourceExcerpt: 'Imperial Package is $65/person (min 100)',
      },
    ],
    // Even if an extraction mistakenly includes a repeated $55/person extra-guest line, it must not double-count
    lineItems: [
      {
        label: 'Extra guest pricing',
        pricingType: 'per_person',
        amount: 55,
        chargeType: 'conditional',
        sourceExcerpt: 'Additional guests $55/person',
      },
    ],
    openQuestions: [],
  };

  // Unselected: packages must NOT be summed and approval must be blocked
  const session = createReviewSession('rev-multi-pkg', quote, { guestCount: 175 });
  assert.equal(session.calculation.unresolvedPackageSelection, true);
  assert.equal(session.calculation.isEstimateComplete, false);
  assert.ok(getApprovalBlockers(session).some((b) => /select one package/i.test(b)));

  // Selecting Royal at 175 guests: 175 * $55 = $9,625 (NOT $38,066.88!)
  selectPackage(session, 'royal-package');
  assert.equal(session.calculation.unresolvedPackageSelection, false);
  assert.equal(session.calculation.knownSubtotal, 9625);
  assert.equal(session.calculation.gratuityAmount, 962.5);
  assert.equal(session.calculation.taxAmount, 1376.38);
  assert.equal(session.calculation.knownAllInTotal, 11963.88);
  assert.equal(getApprovalBlockers(session).length, 0);

  // Royal at 120 guests applies 150-guest minimum ($8,250)
  const royalMinCalc = calculateQuoteTotal(session.draftQuote, { guestCount: 120 });
  assert.equal(royalMinCalc.knownSubtotal, 8250);
  assert.equal(royalMinCalc.minGuestsApplied, true);

  // Imperial at 175 guests: 175 * $65 = $11,375
  const imperialCalc = calculateQuoteTotal(quote, { guestCount: 175, selectedPackageId: 'imperial-package' });
  assert.equal(imperialCalc.knownSubtotal, 11375);
});

test('UAT Genuine incremental per_extra_guest pricing bills only guests above threshold', () => {
  const quote: ExtractedQuote = {
    vendorName: 'Garden Estate',
    category: 'venue',
    events: ['Reception'],
    quoteKind: 'initial',
    currency: 'CAD',
    taxStatus: 'included',
    gratuityStatus: 'included',
    lineItems: [
      {
        label: 'Base reception package (up to 150 guests)',
        pricingType: 'flat',
        amount: 8250,
        chargeType: 'mandatory',
        sourceExcerpt: '$8,250 for up to 150 guests',
      },
      {
        label: 'Extra guest fee above 150',
        pricingType: 'per_extra_guest',
        amount: 55,
        guestThreshold: 150,
        chargeType: 'conditional',
        sourceExcerpt: '$55 per extra guest above 150',
      },
    ],
    openQuestions: [],
  };

  assert.equal(calculateQuoteTotal(quote, { guestCount: 175 }).knownSubtotal, 9625); // 8250 + 25*55
  assert.equal(calculateQuoteTotal(quote, { guestCount: 140 }).knownSubtotal, 8250); // 8250 + 0
});

test('UAT Photography conditional overtime: $900 (5 hrs) + $250/hr defaults to $900 even when hours: 1 or hours only in label/inclusions', () => {
  const quote: ExtractedQuote = {
    vendorName: null,
    category: 'photographer',
    events: ['Wedding'],
    quoteKind: 'initial',
    currency: 'CAD',
    taxStatus: 'unknown',
    gratuityStatus: 'unknown',
    lineItems: [
      {
        label: 'Wedding photography package (5 hours)',
        pricingType: 'flat',
        amount: 900,
        chargeType: 'mandatory',
        sourceExcerpt: '$900 package includes 5 hours',
      },
      {
        label: 'Additional hourly coverage',
        pricingType: 'per_hour',
        amount: 250,
        hours: 1, // Model frequently emits 1 for "$250 per additional hour"
        chargeType: 'conditional',
        sourceExcerpt: 'Additional hours are $250/hour',
      },
    ],
    openQuestions: [],
  };

  const defaultCalc = calculateQuoteTotal(quote);
  assert.equal(defaultCalc.knownSubtotal, 900);
  assert.equal(defaultCalc.taxNotStated, true);
  assert.equal(defaultCalc.isEstimateComplete, false);

  const extendedCalc = calculateQuoteTotal(quote, { hours: 7 });
  assert.equal(extendedCalc.knownSubtotal, 1400); // $900 + 2 * $250
});

test('UAT Conditional hourly pricing ("Additional Hourly Pricing: $250/hr") with durationHours in inclusions defaults to $900', () => {
  const quote: ExtractedQuote = {
    vendorName: 'HSR Photography',
    category: 'photographer',
    events: ['Wedding'],
    quoteKind: 'initial',
    currency: 'CAD',
    taxStatus: 'unknown',
    gratuityStatus: 'unknown',
    lineItems: [
      {
        label: 'Wedding photography package',
        pricingType: 'flat',
        amount: 900,
        chargeType: 'mandatory',
        sourceExcerpt: '$900 package',
      },
      {
        label: 'Additional Hourly Pricing',
        pricingType: 'per_hour',
        amount: 250,
        chargeType: 'conditional',
        sourceExcerpt: 'Additional Hourly Pricing: $250/hr',
      },
    ],
    inclusions: [{ name: 'Wedding coverage', durationHours: 5 }],
    openQuestions: [],
  };

  const calc = calculateQuoteTotal(quote);
  assert.equal(calc.knownSubtotal, 900);
  assert.equal(calc.taxNotStated, true);
  assert.equal(calc.isEstimateComplete, false);
});

test('Codex parity: "plus tax" without a stated percentage preserves taxAmount null and marks estimate incomplete', () => {
  const quote: ExtractedQuote = {
    vendorName: 'US Studio',
    category: 'photographer',
    events: ['Wedding'],
    quoteKind: 'initial',
    currency: 'USD',
    taxStatus: 'excluded',
    taxPercent: null,
    gratuityStatus: 'included',
    lineItems: [
      {
        label: 'Photography package',
        pricingType: 'flat',
        amount: 1000,
        chargeType: 'mandatory',
        sourceExcerpt: 'USD $1,000 plus tax',
      },
    ],
    openQuestions: [],
  };

  const calc = calculateQuoteTotal(quote);
  assert.equal(calc.knownSubtotal, 1000);
  assert.equal(calc.taxAmount, null);
  assert.equal(calc.knownAllInTotal, 1000);
  assert.equal(calc.isEstimateComplete, false);
});

test('Codex parity: whole-subtotal gratuity includes mandatory percentage fees and explicit null package gratuity does not inherit quote default', () => {
  // 1. $1,000 dinner + 10% mandatory admin fee ($100) + 15% whole-subtotal gratuity ($165) = $1,265
  const pctAndGratQuote: ExtractedQuote = {
    vendorName: 'Grand Ballroom',
    category: 'venue',
    events: ['Reception'],
    quoteKind: 'initial',
    currency: 'CAD',
    taxStatus: 'included',
    gratuityStatus: 'excluded',
    gratuityPercent: 15,
    gratuityBasis: 'entire_subtotal',
    lineItems: [
      {
        label: 'Dinner package',
        pricingType: 'flat',
        amount: 1000,
        chargeType: 'mandatory',
        sourceExcerpt: 'Dinner package $1,000',
      },
      {
        label: 'Administrative fee',
        pricingType: 'percentage',
        amount: 10,
        percentageRate: 10,
        percentageBasis: 'entire_subtotal',
        chargeType: 'mandatory',
        sourceExcerpt: '10% administrative fee',
      },
    ],
    openQuestions: [],
  };

  const calc = calculateQuoteTotal(pctAndGratQuote);
  assert.equal(calc.knownSubtotal, 1100);
  assert.equal(calc.gratuityAmount, 165);
  assert.equal(calc.knownAllInTotal, 1265);
  assert.equal(calc.isEstimateComplete, true);

  // 2. Explicit null package gratuity percentage never inherits quote-level 15%
  const nullPkgGratQuote: ExtractedQuote = {
    ...pctAndGratQuote,
    lineItems: [],
    selectedPackageId: 'pkg-tbd-grat',
    packages: [
      {
        id: 'pkg-tbd-grat',
        name: 'Royal Package',
        pricingType: 'flat',
        amount: 1000,
        gratuityStatus: 'excluded',
        gratuityPercent: null,
        sourceExcerpt: 'Royal Package $1,000 plus gratuity',
      },
      {
        id: 'pkg-std',
        name: 'Classic Package',
        pricingType: 'flat',
        amount: 1200,
        sourceExcerpt: 'Classic Package $1,200',
      },
    ],
  };

  const pkgCalc = calculateQuoteTotal(nullPkgGratQuote);
  assert.equal(pkgCalc.gratuityUnresolved, true);
  assert.equal(pkgCalc.gratuityAmount, null);
  assert.equal(pkgCalc.isEstimateComplete, false);
});
