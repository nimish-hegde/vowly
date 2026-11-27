import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createDemoWorkspace } from '../data/demoWorkspace.ts';
import { mapBackendExtractionToFrontendResult } from '../services/quoteExtractor.ts';
import type { Quote, Vendor, VendorCategory, WeddingWorkspace } from '../types/vowly.ts';
import { buildVendorComparison } from './vendorComparison.ts';

const reception = 'evt-reception';
const sangeet = 'evt-sangeet';

function quote(id: string, overrides: Partial<Quote> = {}): Quote {
  return {
    id,
    title: id,
    approvalState: 'approved',
    quoteKind: 'personalized',
    receivedDate: '2027-01-01',
    sourceType: 'pasted_message',
    sourceChannel: 'Synthetic test quote',
    sourceText: '',
    currency: 'CAD',
    currencySource: 'explicit_quote',
    taxHandling: 'tax_exempt',
    lineItems: [{ id: id + '-base', label: 'Service', pricingModel: 'flat', unitPrice: 1000 }],
    addOns: [],
    unconfirmedFees: [],
    conflicts: [],
    inclusions: [],
    paymentTermsSummary: '',
    clarificationQuestions: [],
    evidenceSpans: [],
    ...overrides,
  };
}

function vendor(id: string, category: VendorCategory, entry?: Quote, overrides: Partial<Vendor> = {}): Vendor {
  return {
    id,
    name: id,
    category,
    eventIds: [reception],
    location: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    status: entry ? 'Quoted' : 'Researching',
    isPreferred: false,
    notes: '',
    quotes: entry ? [entry] : [],
    activeQuoteId: entry?.id,
    ...overrides,
  };
}

function workspace(...vendors: Vendor[]): WeddingWorkspace {
  return { ...createDemoWorkspace(), vendors };
}

function freeze(value: unknown): void {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
}

type Option = ReturnType<typeof buildVendorComparison>['entries'][number];

function findOption(entries: Option[], vendorId: string, packageId?: string): Option {
  const entry = entries.find((candidate) =>
    candidate.vendor.id === vendorId && (packageId === undefined || candidate.packageId === packageId));
  assert.ok(entry, [vendorId, packageId].filter(Boolean).join(' / '));
  return entry;
}

function option(entries: Option[], vendorId: string, packageId?: string) {
  const entry = findOption(entries, vendorId, packageId);
  assert.ok(entry.quote, 'Expected an approved quote for ' + vendorId);
  assert.ok(entry.calc, 'Expected calculated pricing for ' + vendorId);
  return { ...entry, quote: entry.quote, calc: entry.calc };
}

test('filters by comparison category and event and separates unquoted and draft-only vendors', () => {
  const noteOnly = vendor('note-only', 'venue');
  const draftOnlyQuote = quote('draft-only-quote', { approvalState: 'draft' });
  const draftOnly = vendor('draft-only', 'venue', draftOnlyQuote, { draftQuote: draftOnlyQuote });
  const venueQuote = quote('venue', { minGuests: 150, maxCapacity: 200 });
  const venue = vendor('reception-venue', 'venue', venueQuote, {
    draftQuote: quote('unsaved-revision', { approvalState: 'draft' }),
  });
  const otherEvent = vendor('different-event', 'venue', quote('other-venue'), { eventIds: [sangeet] });
  const catering = vendor('caterer', 'catering', quote('catering'));
  const comparison = buildVendorComparison(
    workspace(venue, otherEvent, catering, noteOnly, draftOnly),
    { category: 'venue', eventId: reception, guestCount: 160 },
  );
  assert.deepEqual(comparison.entries.map((entry) => entry.vendor.id), ['reception-venue']);
  assert.deepEqual(new Set(comparison.unquotedVendors.map(({ id }) => id)), new Set(['note-only', 'draft-only']));
  assert.equal(option(comparison.entries, venue.id).quote.id, venueQuote.id);
  assert.match(comparison.entries[0].rows.minimum.text, /150/);
  assert.match(comparison.entries[0].rows.capacity.text, /200/);
});

test('venue break-even retains the CAD 500 bartender threshold at 160 guests', () => {
  const juniper = vendor('Juniper Hall', 'venue', quote('juniper', {
    minGuests: 120,
    maxCapacity: 200,
    lineItems: [
      { id: 'juniper-food', label: 'Banquet', pricingModel: 'per_person', unitPrice: 100 },
      { id: 'juniper-av', label: 'AV fee', pricingModel: 'flat', unitPrice: 300 },
    ],
    unconfirmedFees: [{
      id: 'bartender', label: 'Bartender staffing', description: 'Bartender staffing TBD',
      mandatory: true, status: 'unconfirmed',
    }],
  }));
  const maple = vendor('Maple Pavilion', 'venue', quote('maple', {
    minGuests: 120,
    maxCapacity: 200,
    lineItems: [{ id: 'maple-food', label: 'Banquet', pricingModel: 'per_person', unitPrice: 105 }],
  }));
  const state = workspace(juniper, maple);
  freeze(state);
  const scenario = { category: 'venue', eventId: reception, guestCount: 160 } as const;
  const comparison = buildVendorComparison(state, scenario);
  assert.equal(option(comparison.entries, juniper.id).calc.preTaxTotal, 16300);
  assert.equal(option(comparison.entries, maple.id).calc.preTaxTotal, 16800);
  assert.match(comparison.difference ?? '', /\$500(?:\.00)?\b/);
  assert.match(comparison.difference ?? '', /Bartender staffing/i);
  assert.equal(state.events.find(({ id }) => id === reception)?.guestCount, 320);

  const overCapacityMaple = { ...maple, quotes: [{ ...maple.quotes[0], maxCapacity: 150 }] };
  const overCapacity = buildVendorComparison(workspace(juniper, overCapacityMaple), scenario);
  assert.equal(option(overCapacity.entries, maple.id).calc.capacityExceeded, true);
  assert.equal(overCapacity.difference, null);
});

test('catering compares per-person meals, service staffing, gratuity and tax at one guest count', () => {
  const caterer = vendor('Dahlia Catering', 'catering', quote('dahlia', {
    taxHandling: 'excluded_plus_hst',
    taxPercent: 13,
    gratuityStatus: 'excluded',
    gratuityPercent: 10,
    gratuityBasis: 'food_subtotal',
    lineItems: [
      { id: 'meal', label: 'Dinner buffet', pricingModel: 'per_person', unitPrice: 35, isFoodItem: true },
      { id: 'staff', label: 'Servers', pricingModel: 'guest_ratio', unitPrice: 125, ratioDivisor: 50, isFoodItem: false },
    ],
    cateringAndBarSummary: 'Dinner buffet and coffee service',
    structuredInclusions: [{ category: 'food', name: 'Dinner buffet', sourceExcerpt: 'Dinner buffet and coffee service' }],
  }));
  const comparison = buildVendorComparison(workspace(caterer), {
    category: 'catering', eventId: reception, guestCount: 120,
  });
  const entry = option(comparison.entries, caterer.id);
  assert.equal(entry.calc.preTaxTotal, 4575);
  assert.equal(entry.calc.gratuityAmount, 420);
  assert.equal(entry.calc.taxAmount, 649.35);
  assert.equal(entry.calc.estimatedAllInTotal, 5644.35);
  assert.match(entry.rows.menu.text, /buffet/i);
  assert.match(entry.rows.staffing.text, /servers/i);
});

test('I04 photo tiers keep their own hours, deliverables and costs when coverage changes', () => {
  const cases = JSON.parse(readFileSync(new URL(
    '../../../eval-data/held-out-v3-multimodal/cases.json', import.meta.url,
  ), 'utf8')) as Array<{ id: string; mockExtraction: NonNullable<
    Parameters<typeof mapBackendExtractionToFrontendResult>[0]['session']
  >['draftQuote'] }>;
  const i04 = cases.find(({ id }) => id === 'I04');
  assert.ok(i04);
  const imported = mapBackendExtractionToFrontendResult(
    { session: { id: 'i04-comparison-session', draftQuote: i04.mockExtraction, sourceWarnings: [] } },
    { sourceType: 'screenshot', sourceChannel: 'Frozen comparison fixture', rawText: '', guestCount: 160 },
  ).quote;
  const photo = vendor('Aurora Frame Studio', 'photography', {
    ...imported, id: 'aurora-rate-card', approvalState: 'approved', selectedPackageId: 'full-collection',
  });
  const state = workspace(photo);
  const before = structuredClone(state);
  freeze(state);
  const scenario = { category: 'photography', eventId: reception, vendorId: photo.id } as const;
  const eightHours = buildVendorComparison(state, { ...scenario, coverageHours: 8 });
  const nineHours = buildVendorComparison(state, { ...scenario, coverageHours: 9 });

  assert.equal(eightHours.entries.length, 3);
  const fullAtEight = option(eightHours.entries, photo.id, 'full-collection');
  const fullAtNine = option(nineHours.entries, photo.id, 'full-collection');
  const luxuryAtNine = option(nineHours.entries, photo.id, 'luxury-collection');
  assert.equal(fullAtEight.calc.estimatedAllInTotal, 3503);
  assert.equal(fullAtNine.calc.estimatedAllInTotal, 3813.75);
  assert.equal(luxuryAtNine.calc.preTaxTotal, 4600);
  assert.match(fullAtNine.rows.coverage.text, /\b8\b/);
  assert.match(fullAtNine.rows.inclusions.text, /second photographer/i);
  assert.match(fullAtNine.rows.delivery.text, /6 weeks/i);
  assert.match(luxuryAtNine.rows.inclusions.text, /engagement session/i);
  assert.doesNotMatch(fullAtNine.rows.inclusions.text, /engagement session/i);
  assert.deepEqual(state, before);
});

test('DJ compares package-scoped equipment, evidence, overtime and fees', () => {
  const dj = vendor('Silverline DJ', 'dj', quote('silverline', {
    lineItems: [{
      id: 'dj-overtime', label: 'Overtime', pricingModel: 'hourly', unitPrice: 80,
      chargeType: 'conditional', sourceExcerpt: 'Overtime is $80 per extra hour.',
    }],
    selectedPackageId: 'essential',
    packages: [
      {
        id: 'essential', name: 'Essential', pricingModel: 'flat', unitPrice: 700, hours: 5,
        inclusions: ['2 speakers'],
        structuredInclusions: [{ category: 'equipment', name: 'Speakers', quantity: 2,
          sourceExcerpt: 'Essential: 2 speakers included.' }],
      },
      {
        id: 'signature', name: 'Signature', pricingModel: 'flat', unitPrice: 1000, hours: 7,
        inclusions: ['Wireless microphone'],
        structuredInclusions: [{ category: 'equipment', name: 'Wireless microphone', quantity: 1,
          sourceExcerpt: 'Signature comes with a wireless microphone.' }],
        fees: [{ id: 'setup', label: 'Speaker setup', pricingModel: 'flat', unitPrice: 45, packageId: 'signature' }],
      },
    ],
  }));
  const state = workspace(dj);
  freeze(state);
  const scenario = { category: 'dj', eventId: reception, coverageHours: 6 } as const;
  const tiers = buildVendorComparison(state, { ...scenario, vendorId: dj.id });
  const essential = option(tiers.entries, dj.id, 'essential');
  const signature = option(tiers.entries, dj.id, 'signature');
  assert.equal(essential.calc.preTaxTotal, 780);
  assert.equal(signature.calc.preTaxTotal, 1045);
  assert.match(essential.rows.equipment.text, /speakers/i);
  assert.match(signature.rows.equipment.text, /wireless microphone/i);
  assert.match(JSON.stringify(signature.rows.equipment.evidence), /Signature comes with a wireless microphone\./);
  assert.doesNotMatch(essential.rows.equipment.text, /wireless microphone/i);

  assert.equal(option(buildVendorComparison(state, scenario).entries, dj.id).packageId, 'essential');
  const alternative = buildVendorComparison(state, { ...scenario, packageByVendor: { [dj.id]: 'signature' } });
  assert.equal(option(alternative.entries, dj.id).packageId, 'signature');
  assert.equal(dj.quotes[0].selectedPackageId, 'essential');
});

test('decor keeps installation evidence and priced or unconfirmed package fees scoped to the tier', () => {
  const decorator = vendor('Fern and Frame', 'decor', quote('fern', {
    lineItems: [],
    packages: [
      {
        id: 'arch', name: 'Arch', pricingModel: 'flat', unitPrice: 430, inclusions: ['Floral arch'],
        structuredInclusions: [{ category: 'decor', name: 'Floral arch',
          sourceExcerpt: 'The Arch package includes a floral arch.' }],
      },
      {
        id: 'stage', name: 'Stage', pricingModel: 'flat', unitPrice: 700, inclusions: ['Stage installation'],
        structuredInclusions: [{ category: 'setup', name: 'Stage installation',
          sourceExcerpt: 'Stage installation is included on site.' }],
        fees: [{ id: 'delivery', label: 'Delivery', pricingModel: 'flat', unitPrice: 150, packageId: 'stage' }],
      },
    ],
    unconfirmedFees: [{
      id: 'teardown', label: 'Teardown', description: 'Teardown cost to be confirmed.',
      mandatory: true, status: 'unconfirmed', packageId: 'stage',
    }],
  }));
  const comparison = buildVendorComparison(workspace(decorator), {
    category: 'decor', eventId: reception, vendorId: decorator.id,
  });
  const arch = option(comparison.entries, decorator.id, 'arch');
  const stage = option(comparison.entries, decorator.id, 'stage');
  assert.equal(arch.calc.preTaxTotal, 430);
  assert.equal(stage.calc.preTaxTotal, 850);
  assert.match(arch.rows.inclusions.text, /floral arch/i);
  assert.match(stage.rows.setup.text, /stage installation/i);
  assert.match(JSON.stringify(stage.rows.setup.evidence), /Stage installation is included on site\./);
  assert.doesNotMatch(JSON.stringify(arch.unresolved), /teardown/i);
  assert.match(JSON.stringify(stage.unresolved), /teardown/i);
  assert.match(stage.rows.unresolved.text, /Additional cost — TBD/);
  assert.equal(comparison.difference, null);
});

test('keeps cents and compares only compatible complete estimates, separately from bookings', () => {
  const first = vendor('First DJ', 'dj', quote('first'));
  const second = vendor('Second DJ', 'dj', quote('second', {
    lineItems: [{ id: 'second-base', label: 'Service', pricingModel: 'flat', unitPrice: 1000.07 }],
  }));
  const scenario = { category: 'dj', eventId: reception } as const;
  const complete = buildVendorComparison(workspace(first, second), scenario);
  assert.match(complete.difference ?? '', /0\.07\b/);
  assert.equal(option(complete.entries, second.id).calc.estimatedAllInTotal, 1000.07);

  for (const override of [
    { currency: 'USD' },
    { currency: 'UNKNOWN' },
    { taxHandling: 'unspecified' },
    { taxHandling: 'excluded_plus_hst', taxPercent: null },
  ] satisfies Array<Partial<Quote>>) {
    const altered = { ...second, quotes: [{ ...second.quotes[0], ...override }] };
    const comparison = buildVendorComparison(workspace(first, altered), scenario);
    assert.equal(comparison.difference, null, JSON.stringify(override));
  }

  const booked = { ...second, status: 'Booked' as const, bookedContractTotal: 995.18 };
  const bookedState = workspace(first, booked);
  freeze(bookedState);
  const comparison = buildVendorComparison(bookedState, scenario);
  const bookedOption = option(comparison.entries, booked.id);
  assert.equal(bookedOption.contractTotal, 995.18);
  assert.equal(bookedOption.calc.estimatedAllInTotal, 1000.07);
  assert.equal(comparison.difference, null);
});

test('changing one event guest count preserves amounts and state for other included events', () => {
  const caterer = vendor('Shared caterer', 'catering', quote('shared', {
    lineItems: [
      { id: 'reception-meal', label: 'Reception meal', pricingModel: 'per_person',
        eventId: reception, unitPrice: 20 },
      { id: 'sangeet-meal', label: 'Sangeet meal', pricingModel: 'per_person',
        eventId: sangeet, unitPrice: 10 },
    ],
  }), { eventIds: [sangeet, reception] });
  const local = vendor('Reception only', 'catering', quote('reception-only'));
  const state = workspace(caterer, local);
  const before = structuredClone(state);
  freeze(state);
  const comparison = buildVendorComparison(state, { category: 'catering', eventId: reception, guestCount: 160 });
  const shared = option(comparison.entries, caterer.id);
  assert.equal(shared.calc.preTaxTotal, 160 * 20 + 220 * 10);
  assert.match(shared.rows.scope.text, /Grand Reception/);
  assert.match(shared.rows.scope.text, /Sangeet/);
  assert.equal(comparison.difference, null);
  assert.deepEqual(state, before);
});

test('alternate tiers do not inherit a guest minimum or capacity copied from the saved tier', () => {
  const venue = vendor('Two-room venue', 'venue', quote('rooms', {
    lineItems: [],
    selectedPackageId: 'gala',
    minGuests: 180,
    maxCapacity: 200,
    packages: [
      { id: 'gala', name: 'Gala', pricingModel: 'per_person', unitPrice: 100, minGuests: 180, maxCapacity: 200, inclusions: [] },
      { id: 'loft', name: 'Loft', pricingModel: 'per_person', unitPrice: 90, inclusions: [] },
    ],
  }));
  const state = workspace(venue);
  const scenario = { category: 'venue', eventId: reception, vendorId: venue.id } as const;
  const at160 = buildVendorComparison(state, { ...scenario, guestCount: 160 });
  const gala = option(at160.entries, venue.id, 'gala');
  const loft = option(at160.entries, venue.id, 'loft');
  assert.equal(gala.calc.preTaxTotal, 18000);
  assert.equal(loft.calc.preTaxTotal, 14400);
  assert.match(gala.rows.minimum.text, /180 guests.*minimum applied/i);
  assert.equal(loft.rows.minimum.text, 'Not stated');
  assert.equal(loft.rows.capacity.text, 'Not stated');

  const at220 = buildVendorComparison(state, { ...scenario, guestCount: 220 });
  assert.equal(option(at220.entries, venue.id, 'gala').calc.capacityExceeded, true);
  assert.equal(option(at220.entries, venue.id, 'loft').calc.capacityExceeded, false);
});

test('distinguishes exclusions from missing details and preserves a contract without a quote estimate', () => {
  const quoted = vendor('DJ with exclusion', 'dj', quote('dj-with-exclusion', {
    exclusions: ['Wireless microphone'],
  }));
  const contractOnly = vendor('Booked without quote', 'dj', undefined, {
    status: 'Booked', bookedContractTotal: 912.34,
  });
  const comparison = buildVendorComparison(workspace(quoted, contractOnly), {
    category: 'dj', eventId: reception, coverageHours: 6,
  });
  const quotedOption = option(comparison.entries, quoted.id);
  assert.equal(quotedOption.rows.equipment.text, 'Not included: Wireless microphone');
  assert.equal(quotedOption.rows.delivery.text, 'Not stated');

  const bookedOption = findOption(comparison.entries, contractOnly.id);
  assert.equal(bookedOption.contractTotal, 912.34);
  assert.equal(bookedOption.calc, null);
  assert.equal(bookedOption.rows.base.text, 'Not stated');
  assert.doesNotMatch(bookedOption.rows.total.text, /estimated total/i);
  assert.equal(comparison.difference, null);
});


test('an hourly rate with no coverage shows the rate and awaits a scenario amount', () => {
  const dj = vendor('Hourly-only DJ', 'dj', quote('hourly', {
    lineItems: [{ id: 'dj-hours', label: 'DJ coverage', pricingModel: 'hourly', unitPrice: 120 }],
  }));
  const state = workspace(dj);
  const scenario = { category: 'dj', eventId: reception } as const;
  const unknown = option(buildVendorComparison(state, scenario).entries, dj.id);
  assert.equal(unknown.rows.total.text, 'Not stated');
  assert.match(unknown.rows.pricing.text, /120\.00 per hour/);
  assert.match(unknown.rows.unresolved.text, /Billable hours are not stated/);
  const priced = option(buildVendorComparison(state, { ...scenario, coverageHours: 5 }).entries, dj.id);
  assert.equal(priced.calc.preTaxTotal, 600);
  assert.doesNotMatch(priced.rows.unresolved.text, /Billable hours are not stated/);
});

test('a multi-event venue capacity warning uses the comparison event attendance', () => {
  const hall = vendor('Two-event venue', 'venue', quote('shared-hall', {
    maxCapacity: 250,
  }), { eventIds: [sangeet, reception] });
  const state = workspace(hall);
  const scenario = { category: 'venue', eventId: reception } as const;
  const above = option(buildVendorComparison(state, { ...scenario, guestCount: 260 }).entries, hall.id);
  const below = option(buildVendorComparison(state, { ...scenario, guestCount: 240 }).entries, hall.id);
  assert.match(above.rows.capacity.text, /over capacity/);
  assert.doesNotMatch(below.rows.capacity.text, /over capacity/);
});

test('an hourly-only quote with saved duration responds to a coverage scenario', () => {
  const dj = vendor('hourly-dj', 'dj', quote('hourly-dj-quote', {
    serviceDurationHours: 4,
    lineItems: [{ id: 'coverage', label: 'DJ coverage', pricingModel: 'hourly', unitPrice: 100, quantity: 4 }],
  }));
  const state = workspace(dj);
  const before = structuredClone(state);
  freeze(state);
  const scenario = { category: 'dj', eventId: reception } as const;
  const original = option(buildVendorComparison(state, scenario).entries, dj.id);
  const revised = option(buildVendorComparison(state, { ...scenario, coverageHours: 6 }).entries, dj.id);
  assert.equal(original.calc.preTaxTotal, 400);
  assert.equal(revised.calc.preTaxTotal, 600);
  assert.match(revised.rows.coverage.text, /6 hours priced/);
  assert.doesNotMatch(revised.rows.coverage.text, /4 hours included/);
  assert.deepEqual(revised.unresolved, []);
  assert.deepEqual(state, before);
});

test('itemized overtime, AV and staffing stay separate from base and preserve totals across categories', () => {
  const categories = ['venue', 'catering', 'photography', 'dj', 'decor'] as const;
  for (const category of categories) {
    const rated = vendor(category, category, quote(category + '-quote', {
      taxHandling: 'excluded_plus_hst',
      taxPercent: 13,
      lineItems: [
        { id: 'base', label: 'Base service with AV and staffing included', pricingModel: 'flat', unitPrice: 1000 },
        { id: 'ot', label: 'Overtime', pricingModel: 'hourly', unitPrice: 125, quantity: 2, isConditionalOvertime: true },
        { id: 'av', label: 'AV equipment', pricingModel: 'flat', unitPrice: 100 },
        { id: 'staff', label: 'Servers', pricingModel: 'guest_ratio', unitPrice: 75, ratioDivisor: 50 },
      ],
    }));
    const state = workspace(rated);
    const before = structuredClone(state);
    freeze(state);
    const result = option(buildVendorComparison(state, { category, eventId: reception, guestCount: 100 }).entries, rated.id);
    assert.match(result.rows.base.text, /1,000\.00/);
    assert.doesNotMatch(result.rows.extras.text, /Base service/);
    assert.match(result.rows.extras.text, /Overtime.*250\.00/);
    assert.match(result.rows.extras.text, /AV equipment.*100\.00/);
    assert.match(result.rows.extras.text, /Servers.*150\.00/);
    assert.equal(result.calc.preTaxTotal, 1500);
    assert.equal(result.calc.estimatedAllInTotal, 1695);
    assert.deepEqual(state, before);
  }
});
