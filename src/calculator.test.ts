import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateQuoteTotal, compareVenueQuotes } from './calculator.ts';
import type { ExtractedQuote } from './types.ts';

const juniperHall: ExtractedQuote = {
  vendorName: 'Juniper Hall',
  category: 'venue',
  events: ['Reception'],
  quoteKind: 'revision',
  currency: 'CAD',
  taxStatus: 'excluded',
  gratuityStatus: 'excluded',
  venueDetails: {
    roomName: 'Cedar Ballroom',
    maxCapacity: 200,
    minGuests: 150,
    packageName: 'Royal',
    dayOfWeek: 'Friday',
  },
  lineItems: [
    {
      label: 'Royal catering package',
      pricingType: 'per_person',
      amount: 50,
      minGuests: 150,
      sourceExcerpt: '$50/person + tax + gratuity; 150-person minimum',
    },
    {
      label: 'AV fee',
      pricingType: 'flat',
      amount: 300,
      sourceExcerpt: 'We can reduce the AV fee to $300',
    },
    {
      label: 'Bartender staffing',
      pricingType: 'unknown',
      amount: null,
      sourceExcerpt: 'Bartender fee still TBD',
    },
    {
      label: 'Lamb upgrade',
      pricingType: 'per_person',
      amount: 4,
      optionalAddon: true,
      sourceExcerpt: 'Lamb: +$4/person',
    },
  ],
  openQuestions: [
    {
      question: 'Confirm bartender fee',
      reason: 'missing_price',
      sourceExcerpt: 'Bartender fee still TBD',
    },
  ],
};

test('applies minimum guest floor when requested count is below minimum', () => {
  const result = calculateQuoteTotal(juniperHall, { guestCount: 120 });
  assert.equal(result.minGuestsApplied, true);
  // 150 * 50 + 300 = 7800 (optional lamb upgrade excluded, unknown bartender excluded)
  assert.equal(result.knownSubtotal, 7800);
  assert.deepEqual(result.unknownItems, ['Bartender staffing']);
  assert.deepEqual(result.optionalAddons, ['Lamb upgrade']);
});

test('calculates bartender ratio fees using ceil(guests / ratio)', () => {
  const hallWithRatio: ExtractedQuote = {
    vendorName: 'Maple Event Space',
    category: 'venue',
    events: ['Reception'],
    quoteKind: 'initial',
    currency: 'CAD',
    taxStatus: 'excluded',
    gratuityStatus: 'unknown',
    venueDetails: { maxCapacity: 200 },
    lineItems: [
      {
        label: 'Deluxe menu',
        pricingType: 'per_person',
        amount: 60,
        sourceExcerpt: 'Friday Deluxe $60/person',
      },
      {
        label: 'Bartenders',
        pricingType: 'per_guest_ratio',
        amount: 495,
        ratioGuests: 150,
        sourceExcerpt: 'bartenders at $495 each (up to 150 guests per bartender)',
      },
    ],
    openQuestions: [],
  };

  // At 180 guests: 2 bartenders (2 * 495 = 990) + 180 * 60 (10800) = 11790
  const result = calculateQuoteTotal(hallWithRatio, { guestCount: 180 });
  assert.equal(result.knownSubtotal, 11790);
  assert.equal(result.capacityExceeded, false);
});

test('flags capacity exceeded when guest count is over room max', () => {
  const result = calculateQuoteTotal(juniperHall, { guestCount: 220 });
  assert.equal(result.capacityExceeded, true);
  assert.match(result.capacityWarning ?? '', /exceeds room capacity \(200\)/);
});

test('computes break-even note when cheaper venue has an unknown fee', () => {
  const secondVenue: ExtractedQuote = {
    vendorName: 'Harbour Banquet',
    category: 'venue',
    events: ['Reception'],
    quoteKind: 'initial',
    currency: 'CAD',
    taxStatus: 'excluded',
    gratuityStatus: 'excluded',
    lineItems: [
      {
        label: 'Gold menu',
        pricingType: 'per_person',
        amount: 55,
        sourceExcerpt: '$55/person',
      },
      {
        label: 'AV fee',
        pricingType: 'flat',
        amount: 300,
        sourceExcerpt: 'AV $300',
      },
      {
        label: 'Bartender',
        pricingType: 'flat',
        amount: 300,
        sourceExcerpt: 'Bartender $300',
      },
    ],
    openQuestions: [],
  };

  // At 160 guests:
  // Juniper: 160 * 50 + 300 = 8300 (+ unknown bartender)
  // Harbour: 160 * 55 + 300 + 300 = 9400
  // Difference = 1100
  const cmp = compareVenueQuotes(juniperHall, secondVenue, 160);
  assert.equal(cmp.cheaperVenue, 'Juniper Hall');
  assert.equal(cmp.knownDifference, 1100);
  assert.match(cmp.breakEvenNote ?? '', /Bartender staffing exceeds CAD 1100/);
});

test('calculates hourly photographer quotes cleanly', () => {
  const photoQuote: ExtractedQuote = {
    vendorName: 'Northlight Photo',
    category: 'photographer',
    events: ['Wedding'],
    quoteKind: 'initial',
    currency: 'CAD',
    taxStatus: 'unknown',
    gratuityStatus: 'unknown',
    photographerDetails: {
      hoursIncluded: 5,
      teamSize: 2,
      includesMiniShoot: true,
    },
    lineItems: [
      {
        label: 'Hourly photography coverage',
        pricingType: 'per_hour',
        amount: 300,
        hours: 5,
        sourceExcerpt: '$300/hr for 5 hours with two photographers',
      },
    ],
    openQuestions: [],
  };

  const result = calculateQuoteTotal(photoQuote, { hours: 6 });
  assert.equal(result.knownSubtotal, 1800);
});
