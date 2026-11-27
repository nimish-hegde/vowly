import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoWorkspace } from '../data/demoWorkspace.ts';
import {
  buildBookingMilestones,
  calculateQuoteFinancials,
  calculateVendorComparison,
  calculateWorkspaceFinancials,
  DEFAULT_DEPOSIT_ALREADY_PAID,
  deriveBookingScheduleDefaults,
  detectLegacyQuoteReviewReasons,
  getEffectiveQuoteDeliveryTerms,
  getEffectiveQuoteInclusions,
  getVendorBookingEligibility,
  normalizeIsoDate,
  resolveRelativeDeadlineDate,
} from './financialCalculator.ts';
import {
  BackendQuoteExtractor,
  formatStructuredInclusion,
  mapBackendExtractionToFrontendResult,
} from '../services/quoteExtractor.ts';
import {
  applyApproveQuote,
  applyConfirmBooking,
  applySaveDraftQuote,
} from '../store/workspaceTransitions.ts';
import type { Quote, Vendor } from '../types/vowly';

function makeCleanQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: 'q-test-1',
    title: 'Test Reception Quote',
    approvalState: 'approved',
    quoteKind: 'personalized',
    receivedDate: '2026-11-24',
    sourceType: 'pasted_message',
    sourceChannel: 'Email',
    sourceText: 'Reception package CAD $10,000 + 13% HST.',
    currency: 'CAD',
    currencySource: 'explicit_quote',
    locationContext: 'Mississauga, ON, Canada',
    taxHandling: 'excluded_plus_hst',
    lineItems: [
      {
        id: 'li-test-1',
        label: 'Reception Package',
        pricingModel: 'flat',
        unitPrice: 10000,
      },
    ],
    addOns: [],
    unconfirmedFees: [],
    conflicts: [],
    inclusions: ['Reception hall'],
    paymentTermsSummary: '$2,500 deposit; balance due 30 days prior.',
    clarificationQuestions: [],
    evidenceSpans: [],
    ...overrides,
  };
}

test('booking eligibility blocks unresolved mandatory fees and confirmBooking refuses to book', () => {
  const ws = createDemoWorkspace();
  const verdi = ws.vendors.find((v) => v.id === 'ven-verdi');
  assert.ok(verdi, 'Verdi demo vendor should exist');

  const eligibility = getVendorBookingEligibility(verdi, ws.events);
  assert.equal(eligibility.canBook, false);
  assert.ok(
    eligibility.blockingReasons.some((r) => /mandatory/i.test(r)),
    'Expected mandatory fee blocker reason'
  );

  const beforeFin = calculateWorkspaceFinancials(ws);
  const res = applyConfirmBooking(ws, {
    vendorId: verdi.id,
    contractTotal: 33877.4,
    milestones: [],
  });
  assert.equal(res.booked, false);
  assert.equal(res.workspace, ws);
  assert.deepEqual(calculateWorkspaceFinancials(res.workspace), beforeFin);
});

test('booking eligibility blocks unresolved price conflicts and confirmBooking refuses to book', () => {
  const ws = createDemoWorkspace();
  const conflictQuote = makeCleanQuote({
    id: 'q-conflict',
    conflicts: [
      {
        id: 'conf-1',
        fieldLabel: 'Package Base Price',
        description: 'DM vs PDF conflict',
        targetLineItemId: 'li-test-1',
        options: [
          { id: 'opt-1', label: '$5,400', sourceLabel: 'DM', amount: 5400 },
          { id: 'opt-2', label: '$6,000', sourceLabel: 'PDF', amount: 6000 },
        ],
      },
    ],
  });
  const vendorWithConflict: Vendor = {
    id: 'ven-conflict',
    name: 'Conflict Vendor',
    category: 'videography',
    eventIds: ['evt-reception'],
    location: 'Vaughan, ON',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    status: 'Quoted',
    isPreferred: true,
    notes: '',
    quotes: [conflictQuote],
    activeQuoteId: conflictQuote.id,
  };
  const nextWs = { ...ws, vendors: [vendorWithConflict, ...ws.vendors] };

  const eligibility = getVendorBookingEligibility(vendorWithConflict, nextWs.events);
  assert.equal(eligibility.canBook, false);
  assert.ok(
    eligibility.blockingReasons.some((r) => /conflicting price/i.test(r)),
    'Expected price conflict blocker reason'
  );

  const res = applyConfirmBooking(nextWs, {
    vendorId: vendorWithConflict.id,
    contractTotal: 6102,
    milestones: [],
  });
  assert.equal(res.booked, false);
  assert.equal(res.workspace, nextWs);
});

test('booking eligibility blocks vendors with a pending draft quote review', () => {
  const ws = createDemoWorkspace();
  const versailles = ws.vendors.find((v) => v.id === 'ven-versailles');
  assert.ok(versailles);
  assert.equal(getVendorBookingEligibility(versailles, ws.events).canBook, true);

  const { workspace: wsWithDraft } = applySaveDraftQuote(
    ws,
    versailles.id,
    null,
    makeCleanQuote({ id: 'q-vers-draft', approvalState: 'draft' }),
    versailles.id
  );
  const updatedVersailles = wsWithDraft.vendors.find((v) => v.id === versailles.id)!;
  const eligibility = getVendorBookingEligibility(updatedVersailles, wsWithDraft.events);
  assert.equal(eligibility.canBook, false);
  assert.ok(
    eligibility.blockingReasons.some((r) => /pending draft/i.test(r)),
    'Expected pending draft blocker reason'
  );

  const res = applyConfirmBooking(wsWithDraft, {
    vendorId: versailles.id,
    contractTotal: 35000,
    milestones: [],
  });
  assert.equal(res.booked, false);
  assert.equal(res.workspace, wsWithDraft);
});

test('saving a draft revision for an existing vendor does not alter approved budget or event associations until approval', () => {
  const ws = createDemoWorkspace();
  const versailles = ws.vendors.find((v) => v.id === 'ven-versailles');
  assert.ok(versailles);
  const beforeFin = calculateWorkspaceFinancials(ws);

  const draftQuote = makeCleanQuote({
    id: 'q-vers-draft-rev',
    approvalState: 'draft',
    lineItems: [
      {
        id: 'li-vers-draft-pp',
        label: 'Revised Per-Person Rate',
        pricingModel: 'per_person',
        unitPrice: 70,
      },
    ],
  });

  // Attempt to change name, category, and event associations in the draft review
  const editedPayload: Omit<Vendor, 'id' | 'quotes'> = {
    name: 'Versailles Renamed Draft',
    category: 'catering',
    eventIds: ['evt-mehndi'], // 95 guests instead of 320
    location: 'Brampton, ON',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    status: 'Revision pending',
    isPreferred: false,
    isDemoVenue: true,
    notes: '',
  };

  const { workspace: afterDraft } = applySaveDraftQuote(
    ws,
    versailles.id,
    editedPayload,
    draftQuote,
    versailles.id
  );

  const vendorAfterDraft = afterDraft.vendors.find((v) => v.id === versailles.id)!;
  assert.equal(vendorAfterDraft.name, versailles.name);
  assert.equal(vendorAfterDraft.category, versailles.category);
  assert.deepEqual(vendorAfterDraft.eventIds, versailles.eventIds);
  assert.equal(vendorAfterDraft.location, versailles.location);
  assert.deepEqual(vendorAfterDraft.draftVendorMetadata?.eventIds, ['evt-mehndi']);

  const afterDraftFin = calculateWorkspaceFinancials(afterDraft);
  assert.equal(afterDraftFin.projectedSpend, beforeFin.projectedSpend);
  assert.equal(afterDraftFin.committedSpend, beforeFin.committedSpend);

  // Approving the revision applies the staged metadata and clears draft fields
  const { workspace: afterApprove } = applyApproveQuote(
    afterDraft,
    versailles.id,
    null,
    draftQuote,
    versailles.id
  );
  const vendorAfterApprove = afterApprove.vendors.find((v) => v.id === versailles.id)!;
  assert.equal(vendorAfterApprove.name, 'Versailles Renamed Draft');
  assert.equal(vendorAfterApprove.category, 'catering');
  assert.deepEqual(vendorAfterApprove.eventIds, ['evt-mehndi']);
  assert.equal(vendorAfterApprove.draftQuote, undefined);
  assert.equal(vendorAfterApprove.draftVendorMetadata, undefined);
});

test('approving a competing new venue does not double-count projected budget', () => {
  const ws = createDemoWorkspace();
  const beforeFin = calculateWorkspaceFinancials(ws);

  const competingQuote = makeCleanQuote({ id: 'q-competing-hall' });
  const { workspace: afterImport } = applyApproveQuote(
    ws,
    null,
    {
      name: 'Competing Reception Hall',
      category: 'venue',
      eventIds: ['evt-reception'],
      location: 'Mississauga, ON',
      contactName: '',
      contactEmail: '',
      contactPhone: '',
      status: 'Quoted',
      isPreferred: true,
      notes: '',
    },
    competingQuote,
    'ven-competing'
  );

  const imported = afterImport.vendors.find((v) => v.id === 'ven-competing')!;
  assert.equal(imported.isPreferred, false);
  const afterFin = calculateWorkspaceFinancials(afterImport);
  assert.equal(afterFin.projectedSpend, beforeFin.projectedSpend);
});

test('deposits default to unpaid until explicitly confirmed by the user', () => {
  assert.equal(DEFAULT_DEPOSIT_ALREADY_PAID, false);

  const ws = createDemoWorkspace();
  const beforePaid = calculateWorkspaceFinancials(ws).paidToDate;
  const versailles = ws.vendors.find((v) => v.id === 'ven-versailles')!;

  const defaultMilestones = buildBookingMilestones({
    contractTotal: 35800,
    depositAmount: 6000,
    depositDate: '2026-11-24',
    depositPayer: 'Meera & Kabir',
    coupleNames: ws.coupleNames,
    balanceHasKnownDate: true,
    balanceDueDate: '2027-07-15',
    balanceRelativeLabel: '',
    balancePayer: 'Unassigned',
  });

  assert.equal(defaultMilestones[0].label, 'Booking Deposit');
  assert.equal(defaultMilestones[0].status, 'Upcoming');
  assert.equal(defaultMilestones[0].paidDate, undefined);
  assert.equal(defaultMilestones[0].paidBy, undefined);
  assert.equal(defaultMilestones[0].reminderEnabled, true);

  const bookedUnpaid = applyConfirmBooking(ws, {
    vendorId: versailles.id,
    contractTotal: 35800,
    milestones: defaultMilestones,
    today: '2026-11-24',
    timestamp: 1000,
  });
  assert.equal(bookedUnpaid.booked, true);
  assert.equal(calculateWorkspaceFinancials(bookedUnpaid.workspace).paidToDate, beforePaid);

  // Explicit confirmation marks deposit Paid and increments paidTotal
  const paidMilestones = buildBookingMilestones({
    contractTotal: 35800,
    depositAmount: 6000,
    depositAlreadyPaid: true,
    depositDate: '2026-11-24',
    depositPayer: 'Meera & Kabir',
    coupleNames: ws.coupleNames,
    balanceHasKnownDate: true,
    balanceDueDate: '2027-07-15',
    balanceRelativeLabel: '',
    balancePayer: 'Unassigned',
  });

  assert.equal(paidMilestones[0].status, 'Paid');
  assert.equal(paidMilestones[0].paidDate, '2026-11-24');
  assert.equal(paidMilestones[0].paidBy, 'Meera & Kabir');
  assert.equal(paidMilestones[0].reminderEnabled, false);

  const bookedPaid = applyConfirmBooking(ws, {
    vendorId: versailles.id,
    contractTotal: 35800,
    milestones: paidMilestones,
    today: '2026-11-24',
    timestamp: 2000,
  });
  assert.equal(bookedPaid.booked, true);
  assert.equal(
    calculateWorkspaceFinancials(bookedPaid.workspace).paidToDate,
    beforePaid + 6000
  );
});

test('Parity UAT Case A: missing gratuity percentage blocks approval and booking without fabricating vendor info', () => {
  const ws = createDemoWorkspace();
  const mapped = mapBackendExtractionToFrontendResult(
    {
      session: {
        id: 's-case-a',
        draftQuote: {
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
          openQuestions: [],
        },
      },
    },
    {
      sourceType: 'pasted_message',
      sourceChannel: 'Email',
      rawText: 'Our banquet package is $55 per person plus 13% HST and gratuity.',
      targetEventIds: ['evt-reception'],
    }
  );

  assert.equal(mapped.suggestedVendorName, '');
  assert.equal(mapped.vendorNameMissing, true);
  assert.equal(mapped.suggestedLocation, '');
  assert.equal(mapped.quote.structuredInclusions?.length, 4);

  const calc = calculateQuoteFinancials(mapped.quote, ws.events, ['evt-reception'], 120);
  assert.equal(calc.preTaxTotal, 8250); // 150 min * $55
  assert.equal(calc.gratuityUnresolved, true);
  assert.equal(calc.canApprove, false);
  assert.equal(calc.isEstimateComplete, false);
});

test('Parity UAT Case B & C: negotiated photography savings and complex venue food-subtotal gratuity + bartenders', () => {
  const ws = createDemoWorkspace();

  // Case B: Negotiated photography
  const caseB = mapBackendExtractionToFrontendResult(
    {
      session: {
        id: 's-case-b',
        draftQuote: {
          vendorName: null,
          category: 'photographer',
          events: ['Engagement'],
          quoteKind: 'initial',
          currency: 'CAD',
          taxStatus: 'tax_exempt' as 'unknown',
          gratuityStatus: 'unknown',
          serviceDurationHours: 6,
          lineItems: [
            {
              label: '6-hour engagement photography',
              pricingType: 'flat',
              amount: 900,
              originalAmount: 1000,
              hours: 6,
              sourceExcerpt: 'I normally charge $1,000, but I can do $900',
            },
          ],
          inclusions: [
            { category: 'photography', name: 'Edited photos' },
            { category: 'photography', name: 'Online gallery' },
          ],
          paymentTerms: { depositAmount: 200, methodRule: 'unknown' },
          openQuestions: [],
        },
      },
    },
    { sourceType: 'pasted_message', sourceChannel: 'DM', rawText: 'Negotiated quote' }
  );
  const calcB = calculateQuoteFinancials(caseB.quote, ws.events, []);
  assert.equal(calcB.preTaxTotal, 900);
  assert.equal(calcB.negotiatedSavings, 100);
  assert.equal(calcB.unresolvedConflictsCount, 0);
  assert.equal(caseB.quote.depositAmount, 200);

  // Case C: Complex venue at 175 guests — exact numerical parity with backend calculator
  const caseC = mapBackendExtractionToFrontendResult(
    {
      session: {
        id: 's-case-c',
        draftQuote: {
          vendorName: 'Grand Banquet',
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
              sourceExcerpt: 'CAD $60 per guest',
            },
            {
              label: 'AV package',
              pricingType: 'flat',
              amount: 750,
              isThirdParty: true,
              thirdPartyProvider: 'Preferred third-party supplier',
              isFoodItem: false,
              sourceExcerpt: 'AV $750',
            },
            {
              label: 'Bartenders',
              pricingType: 'per_guest_ratio',
              amount: 250,
              ratioGuests: 75,
              unitLabel: 'bartender',
              isFoodItem: false,
              sourceExcerpt: 'Bartenders $250 each, 1 per 75 guests',
            },
          ],
          venueDetails: { minGuests: 150, maxCapacity: 200 },
          paymentTerms: {
            depositPercent: 30,
            methodRule: 'unknown',
            milestones: [
              { label: 'Balance', percent: 70, relativeDaysBeforeEvent: 30 },
            ],
          },
          openQuestions: [],
        },
      },
    },
    { sourceType: 'pasted_message', sourceChannel: 'Email', rawText: 'Complex venue' }
  );

  const calcC = calculateQuoteFinancials(caseC.quote, ws.events, ['evt-reception'], 175);
  assert.equal(calcC.preTaxTotal, 12000); // 10,500 + 750 + 750
  assert.equal(calcC.gratuityAmount, 1050); // 10% of $10,500 food subtotal
  assert.equal(calcC.taxAmount, 1696.5); // 13% of $13,050
  assert.equal(calcC.estimatedAllInTotal, 14746.5);
  assert.equal(resolveRelativeDeadlineDate('2027-08-15', 30), '2027-07-16');
});

test('Case D: BackendQuoteExtractor sends distinct uploaded image payloads and never silently falls back to mock on failure', async () => {
  const originalFetch = globalThis.fetch;
  const sentPayloads: string[] = [];

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      requireLive?: boolean;
      attachments?: Array<{ base64Data: string; fileName: string }>;
    };
    assert.equal(body.requireLive, true);
    const b64 = body.attachments?.[0]?.base64Data ?? '';
    sentPayloads.push(b64);

    if (b64 === 'FAIL_ME') {
      return new Response(JSON.stringify({ error: 'Gemini unavailable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        session: {
          id: 's-img',
          draftQuote: {
            vendorName: b64 === 'IMG_ONE' ? 'First Venue' : 'Second Studio',
            category: 'venue',
            events: ['Reception'],
            quoteKind: 'initial',
            currency: 'CAD',
            taxStatus: 'excluded',
            gratuityStatus: 'unknown',
            lineItems: [
              {
                label: 'Package',
                pricingType: 'flat',
                amount: b64 === 'IMG_ONE' ? 5000 : 9000,
                sourceExcerpt: 'Visible price',
              },
            ],
            openQuestions: [],
          },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  try {
    const extractor = new BackendQuoteExtractor('/api/extract');
    const r1 = await extractor.extractQuote({
      sourceType: 'screenshot',
      sourceChannel: 'Screenshot',
      rawText: '',
      attachments: [
        { mimeType: 'image/png', base64Data: 'IMG_ONE', fileName: 'a.png', sizeBytes: 100 },
      ],
    });
    const r2 = await extractor.extractQuote({
      sourceType: 'screenshot',
      sourceChannel: 'Screenshot',
      rawText: '',
      attachments: [
        { mimeType: 'image/png', base64Data: 'IMG_TWO', fileName: 'b.png', sizeBytes: 100 },
      ],
    });

    assert.deepEqual(sentPayloads, ['IMG_ONE', 'IMG_TWO']);
    assert.equal(r1.suggestedVendorName, 'First Venue');
    assert.equal(r2.suggestedVendorName, 'Second Studio');
    assert.notEqual(r1.quote.lineItems[0].unitPrice, r2.quote.lineItems[0].unitPrice);

    await assert.rejects(
      () =>
        extractor.extractQuote({
          sourceType: 'screenshot',
          sourceChannel: 'Screenshot',
          rawText: '',
          attachments: [
            { mimeType: 'image/png', base64Data: 'FAIL_ME', fileName: 'c.png', sizeBytes: 100 },
          ],
        }),
      /Gemini unavailable/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Codex P2 fixes: per-person optional add-ons, conditional overtime defaulting to 0 hrs, and confirmed extra fees in whole-subtotal percentage bases', () => {
  const ws = createDemoWorkspace();

  // 1. Optional per-person add-on ($20/person for 100 guests = $2,000, not $20)
  const addOnMapped = mapBackendExtractionToFrontendResult(
    {
      session: {
        id: 's-addon',
        draftQuote: {
          vendorName: 'Catering Co',
          category: 'catering',
          events: ['Reception'],
          quoteKind: 'initial',
          currency: 'CAD',
          taxStatus: 'included',
          gratuityStatus: 'included',
          lineItems: [
            {
              label: 'Base dinner',
              pricingType: 'flat',
              amount: 5000,
              sourceExcerpt: 'Base dinner $5,000',
            },
            {
              label: 'Optional late-night station',
              pricingType: 'per_person',
              amount: 20,
              chargeType: 'optional',
              optionalAddon: true,
              sourceExcerpt: 'Optional late-night station $20/person',
            },
          ],
          openQuestions: [],
        },
      },
    },
    { sourceType: 'pasted_message', sourceChannel: 'Email', rawText: 'Catering quote' }
  );
  addOnMapped.quote.addOns[0].selected = true;
  const addOnCalc = calculateQuoteFinancials(addOnMapped.quote, ws.events, ['evt-reception'], 100);
  assert.equal(addOnCalc.selectedAddOnsPreTax, 2000);
  assert.equal(addOnCalc.preTaxTotal, 7000);

  // 2. Conditional overtime ($2,000 8-hr package + $250/hr overtime => $2,000, NOT $2,250)
  const overtimeMapped = mapBackendExtractionToFrontendResult(
    {
      session: {
        id: 's-overtime',
        draftQuote: {
          vendorName: 'Lens Studio',
          category: 'photographer',
          events: ['Reception'],
          quoteKind: 'initial',
          currency: 'CAD',
          taxStatus: 'included',
          gratuityStatus: 'included',
          photographerDetails: { hoursIncluded: 8, extraHourRate: 250 },
          lineItems: [
            {
              label: '8-hour wedding coverage',
              pricingType: 'flat',
              amount: 2000,
              hours: 8,
              sourceExcerpt: '8-hour coverage $2,000',
            },
            {
              label: 'Overtime hours',
              pricingType: 'per_hour',
              amount: 250,
              chargeType: 'conditional',
              sourceExcerpt: 'Additional overtime hours $250/hr',
            },
          ],
          openQuestions: [],
        },
      },
    },
    { sourceType: 'pasted_message', sourceChannel: 'Email', rawText: 'Photo quote' }
  );
  const overtimeCalc = calculateQuoteFinancials(overtimeMapped.quote, ws.events, []);
  assert.equal(overtimeCalc.preTaxTotal, 2000);

  // 3. Confirmed extra fees included in whole-subtotal percentage bases ($1,000 + $500 confirmed + 10% = $1,650)
  const pctMapped = mapBackendExtractionToFrontendResult(
    {
      session: {
        id: 's-pct',
        draftQuote: {
          vendorName: 'Hall Co',
          category: 'venue',
          events: ['Reception'],
          quoteKind: 'initial',
          currency: 'CAD',
          taxStatus: 'included',
          gratuityStatus: 'included',
          lineItems: [
            {
              label: 'Hall package',
              pricingType: 'flat',
              amount: 1000,
              sourceExcerpt: 'Hall package $1,000',
            },
            {
              label: 'Setup fee',
              pricingType: 'unknown',
              amount: null,
              chargeType: 'mandatory',
              sourceExcerpt: 'Setup fee TBD',
            },
            {
              label: 'Service surcharge',
              pricingType: 'percentage',
              amount: 10,
              percentageRate: 10,
              percentageBasis: 'entire_subtotal',
              sourceExcerpt: '10% service surcharge on total',
            },
          ],
          openQuestions: [],
        },
      },
    },
    { sourceType: 'pasted_message', sourceChannel: 'Email', rawText: 'Hall quote' }
  );
  pctMapped.quote.unconfirmedFees[0].status = 'confirmed_amount';
  pctMapped.quote.unconfirmedFees[0].confirmedAmount = 500;
  const pctCalc = calculateQuoteFinancials(pctMapped.quote, ws.events, []);
  assert.equal(pctCalc.preTaxTotal, 1650); // $1,000 + $500 + 10% of $1,500 ($150)

  // 4. Duplicate service-charge percentage line item matching gratuityPercent counts once in gratuityAmount, not preTaxTotal
  const dupServiceQuote = mapBackendExtractionToFrontendResult(
    {
      session: {
        id: 's-dup-gratuity',
        draftQuote: {
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
              sourceExcerpt: 'flat $350 delivery',
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
        },
      },
    },
    { sourceType: 'pasted_message', sourceChannel: 'Email', rawText: 'Catering quote' }
  );
  const dupCalc = calculateQuoteFinancials(dupServiceQuote.quote, ws.events, [], 130);
  assert.equal(dupCalc.preTaxTotal, 5810);
  assert.equal(dupCalc.gratuityAmount, 871.5);
});

test('UAT Multi-package venue parity, package-specific inclusions, and approval/booking gates', () => {
  const ws = createDemoWorkspace();
  const mapped = mapBackendExtractionToFrontendResult(
    {
      session: {
        id: 's-multi-pkg',
        draftQuote: {
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
              inclusions: [
                { name: 'Appetizers', quantity: 4, unit: 'appetizers' },
                { name: 'Main dishes', quantity: 3, unit: 'main dishes' },
              ],
              sourceExcerpt: 'Royal Package $55/person min 150',
            },
            {
              id: 'imperial-package',
              name: 'Imperial Package',
              pricingType: 'per_person',
              amount: 65,
              minGuests: 100,
              isFoodItem: true,
              inclusions: [
                { name: 'Appetizers', quantity: 6, unit: 'appetizers' },
                { name: 'Deluxe dessert table' },
              ],
              sourceExcerpt: 'Imperial Package $65/person min 100',
            },
          ],
          lineItems: [
            {
              label: 'Extra guest pricing',
              pricingType: 'per_person',
              amount: 55,
              chargeType: 'conditional',
              sourceExcerpt: 'Extra guests $55/person',
            },
          ],
          openQuestions: [],
        },
      },
    },
    { sourceType: 'pasted_message', sourceChannel: 'Email', rawText: 'Multi-package brochure' }
  );

  // Unselected: cannot approve, packages NOT summed
  const unselectedCalc = calculateQuoteFinancials(mapped.quote, ws.events, [], 175);
  assert.equal(unselectedCalc.unresolvedPackageSelection, true);
  assert.equal(unselectedCalc.canApprove, false);
  assert.equal(unselectedCalc.preTaxTotal, 0);

  // Select Royal: $9,625 pre-tax, $11,963.88 all-in (exact parity with backend), Royal inclusions shown
  const royalQuote: Quote = { ...mapped.quote, selectedPackageId: 'royal-package' };
  const royalCalc = calculateQuoteFinancials(royalQuote, ws.events, [], 175);
  assert.equal(royalCalc.unresolvedPackageSelection, false);
  assert.equal(royalCalc.canApprove, true);
  assert.equal(royalCalc.preTaxTotal, 9625);
  assert.equal(royalCalc.gratuityAmount, 962.5);
  assert.equal(royalCalc.taxAmount, 1376.38);
  assert.equal(royalCalc.estimatedAllInTotal, 11963.88);
  assert.deepEqual(getEffectiveQuoteInclusions(royalQuote), ['4 Appetizers', '3 Main dishes']);

  // Switch to Imperial: $11,375 pre-tax, Imperial inclusions shown, Royal still preserved in packages[]
  const imperialQuote: Quote = { ...mapped.quote, selectedPackageId: 'imperial-package' };
  const imperialCalc = calculateQuoteFinancials(imperialQuote, ws.events, [], 175);
  assert.equal(imperialCalc.preTaxTotal, 11375);
  assert.equal(imperialQuote.packages?.length, 2);
  assert.deepEqual(getEffectiveQuoteInclusions(imperialQuote), [
    '6 Appetizers',
    'Deluxe dessert table',
  ]);
});

test('UAT Photography conditional overtime ($900 + $250/hr), unknown tax booking gate, inclusion hygiene & deliveryTerms', () => {
  const ws = createDemoWorkspace();
  const mapped = mapBackendExtractionToFrontendResult(
    {
      session: {
        id: 's-hsr-photo',
        draftQuote: {
          vendorName: null,
          category: 'photographer',
          events: ['Wedding'],
          quoteKind: 'initial',
          currency: 'CAD',
          taxStatus: 'unknown',
          gratuityStatus: 'unknown',
          lineItems: [
            {
              label: 'Photography package (5 hours)',
              pricingType: 'flat',
              amount: 900,
              chargeType: 'mandatory',
              sourceExcerpt: '$900 package includes 5 hours',
            },
            {
              label: 'Additional hourly coverage',
              pricingType: 'per_hour',
              amount: 250,
              hours: 1,
              chargeType: 'conditional',
              sourceExcerpt: '$250/hour for additional hours',
            },
          ],
          inclusions: [
            { name: '2 photographers', quantity: 2 },
            { name: 'Second photographer', quantity: 5, unit: 'hours' },
            { name: 'Online gallery (photography_coverage)', unit: 'deliverables' },
          ],
          deliveryTerms: ['Sneak peeks in 48 hours', 'Online gallery delivered in 6-8 weeks'],
          openQuestions: [],
        },
      },
    },
    { sourceType: 'pasted_message', sourceChannel: 'Instagram DM', rawText: 'Photo quote' }
  );

  // 1. Conditional overtime defaults to 0 extra hours ($900 subtotal, NOT $1,150)
  const calc = calculateQuoteFinancials(mapped.quote, ws.events, []);
  assert.equal(calc.preTaxTotal, 900);
  assert.equal(mapped.quote.taxHandling, 'unspecified');
  assert.equal(calc.taxNotStated, true);
  assert.equal(calc.taxStatusLabel, 'Tax not stated — excluded from estimate.');
  // Allowed for projected budget approval, clearly labeled incomplete, BLOCKED from booking!
  assert.equal(calc.canApprove, true);
  assert.equal(calc.isEstimateComplete, false);

  const vendorWithUnknownTax: Vendor = {
    id: 'v-photo-unknown-tax',
    name: 'HSR Photography',
    category: 'photography',
    eventIds: [],
    location: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    status: 'Quoted',
    isPreferred: true,
    notes: '',
    quotes: [{ ...mapped.quote, approvalState: 'approved' }],
    activeQuoteId: mapped.quote.id,
  };
  const eligibility = getVendorBookingEligibility(vendorWithUnknownTax, ws.events);
  assert.equal(eligibility.canBook, false);
  assert.ok(eligibility.blockingReasons.some((r) => /confirm tax handling before booking/i.test(r)));

  // 2. Inclusion hygiene & deliveryTerms
  assert.equal(formatStructuredInclusion({ name: '2 photographers', quantity: 2 }), '2 photographers');
  assert.equal(
    formatStructuredInclusion({ name: 'Second photographer', quantity: 5, unit: 'hours' }),
    'Second photographer (5 hours coverage)'
  );
  assert.equal(
    formatStructuredInclusion({ name: 'Second photographer', quantity: 1, unit: 'photographer', durationHours: 5 }),
    'Second photographer (5 hours coverage)'
  );
  assert.equal(
    formatStructuredInclusion({ name: 'Online gallery (photography_coverage)', unit: 'deliverables' }),
    'Online gallery'
  );
  assert.deepEqual(getEffectiveQuoteDeliveryTerms(mapped.quote), [
    'Sneak peeks in 48 hours',
    'Online gallery delivered in 6-8 weeks',
  ]);
});

test('UAT Legacy saved quotes with known calculation bugs are flagged and blocked from booking, while manual edits preserve history & booked totals', () => {
  const ws = createDemoWorkspace();
  const legacyBuggyQuote = makeCleanQuote({
    id: 'q-legacy-buggy',
    legacyReviewAcknowledged: false,
    taxHandling: 'tax_exempt',
    sourceText: 'Royal Package $55/person min 150. Imperial Package $65/person min 100.',
    lineItems: [
      { id: 'l1', label: 'Royal Package', pricingModel: 'per_person', unitPrice: 55, minGuests: 150 },
      { id: 'l2', label: 'Imperial Package', pricingModel: 'per_person', unitPrice: 65, minGuests: 100 },
    ],
  });

  const legacyReasons = detectLegacyQuoteReviewReasons(legacyBuggyQuote);
  assert.ok(legacyReasons.length >= 2); // Summed packages + unstated tax_exempt

  const legacyVendor: Vendor = {
    id: 'v-legacy-1',
    name: 'Legacy Venue',
    category: 'venue',
    eventIds: [ws.events[0].id],
    location: 'GTA',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    status: 'Quoted',
    isPreferred: false,
    notes: '',
    quotes: [legacyBuggyQuote],
    activeQuoteId: legacyBuggyQuote.id,
  };
  const legacyEligibility = getVendorBookingEligibility(legacyVendor, ws.events);
  assert.equal(legacyEligibility.canBook, false);
  assert.ok(legacyEligibility.blockingReasons.some((r) => /re-review/i.test(r)));

  // Manual edit of an approved quote preserves prior version, adds QuoteRevisionRecord, and never alters bookedContractTotal
  const bookedVendor: Vendor = {
    ...legacyVendor,
    id: 'v-booked-edit',
    status: 'Booked',
    bookedContractTotal: 15000,
    quotes: [makeCleanQuote({ id: 'q-v1', legacyReviewAcknowledged: true })],
    activeQuoteId: 'q-v1',
  };
  const wsWithBooked = { ...ws, vendors: [bookedVendor, ...ws.vendors] };
  const editedQuote: Quote = {
    ...bookedVendor.quotes[0],
    lineItems: [{ id: 'li-1', label: 'Updated package', pricingModel: 'flat', unitPrice: 12000 }],
  };
  const approvedRes = applyApproveQuote(
    wsWithBooked,
    bookedVendor.id,
    null,
    editedQuote,
    bookedVendor.id,
    'Corrected line item after phone call'
  );
  const updatedVendor = approvedRes.workspace.vendors.find((v) => v.id === bookedVendor.id)!;
  assert.equal(updatedVendor.quotes.length, 2); // Prior approved version preserved
  assert.equal(updatedVendor.bookedContractTotal, 15000); // Booked total untouched
  const activeAfterEdit = updatedVendor.quotes.find((q) => q.id === updatedVendor.activeQuoteId)!;
  assert.equal(activeAfterEdit.revisions?.length, 1);
  assert.equal(activeAfterEdit.revisions?.[0].summary, 'Corrected line item after phone call');
});

test('Codex P1/P2 fixes: package unknown fees, unknown package base price, package fee parameters, and package tax override', () => {
  const ws = createDemoWorkspace();
  const mapped = mapBackendExtractionToFrontendResult(
    {
      session: {
        id: 's-codex-pkg',
        draftQuote: {
          vendorName: 'Emerald Hall',
          category: 'venue',
          events: ['Reception'],
          quoteKind: 'initial',
          currency: 'CAD',
          taxStatus: 'excluded',
          taxPercent: 13,
          gratuityStatus: 'included',
          selectedPackageId: null,
          packages: [
            {
              id: 'pkg-tbd-fee',
              name: 'Standard Package',
              pricingType: 'flat',
              amount: 1000,
              taxStatus: 'unknown',
              fees: [
                {
                  label: 'Mandatory setup fee',
                  pricingType: 'unknown',
                  amount: null,
                  chargeType: 'mandatory',
                  sourceExcerpt: 'Setup fee TBD',
                },
                {
                  label: 'Lighting technician',
                  pricingType: 'per_hour',
                  amount: 100,
                  hours: 4,
                  chargeType: 'mandatory',
                  sourceExcerpt: '4 hours at $100/hr',
                },
                {
                  label: 'Admin surcharge',
                  pricingType: 'percentage',
                  amount: 10,
                  percentageRate: 10,
                  percentageBasis: 'entire_subtotal',
                  chargeType: 'mandatory',
                  sourceExcerpt: '10% admin surcharge on subtotal',
                },
              ],
              sourceExcerpt: 'Standard Package $1,000',
            },
            {
              id: 'pkg-unknown-price',
              name: 'Custom Luxury Package',
              pricingType: 'unknown',
              amount: null,
              sourceExcerpt: 'Custom Luxury Package pricing on request',
            },
          ],
          lineItems: [],
          openQuestions: [],
        },
      },
    },
    { sourceType: 'pasted_message', sourceChannel: 'Email', rawText: 'Package brochure' }
  );

  // 1. Selecting Standard Package preserves mandatory TBD fee (blocks approval), preserves 4h*$100=$400 + 10%=$140 -> $1,540
  const stdQuote: Quote = { ...mapped.quote, selectedPackageId: 'pkg-tbd-fee' };
  const stdCalc = calculateQuoteFinancials(stdQuote, ws.events, []);
  assert.equal(stdCalc.unresolvedMandatoryFeesCount, 1);
  assert.equal(stdCalc.canApprove, false);
  assert.equal(stdCalc.preTaxTotal, 1540); // $1,000 + $400 + 10% of $1,400 ($140)
  assert.equal(stdCalc.taxNotStated, true); // package-level taxStatus: 'unknown'

  // Updating selected package tax override clears taxNotStated
  const taxResolvedQuote: Quote = {
    ...stdQuote,
    taxHandling: 'excluded_plus_hst',
    packages: stdQuote.packages?.map((p) =>
      p.id === 'pkg-tbd-fee' ? { ...p, taxHandling: 'excluded_plus_hst' } : p
    ),
  };
  const taxResolvedCalc = calculateQuoteFinancials(taxResolvedQuote, ws.events, []);
  assert.equal(taxResolvedCalc.taxNotStated, false);
  assert.equal(taxResolvedCalc.taxRate, 0.13);

  // 2. Selecting Custom Luxury Package preserves unknown price (NOT $0 complete/approvable)
  const unkQuote: Quote = { ...mapped.quote, selectedPackageId: 'pkg-unknown-price' };
  const unkCalc = calculateQuoteFinancials(unkQuote, ws.events, []);
  assert.equal(unkCalc.unresolvedPackagePrice, true);
  assert.equal(unkCalc.canApprove, false);
  assert.equal(unkCalc.isEstimateComplete, false);
  assert.equal(unkCalc.unresolvedMandatoryFeesCount, 0); // Standard Package's TBD fee does not bleed into Custom Luxury
});

test('UAT HSR Photography: "Additional Hourly Pricing: $250/hr" defaults to $900 and BookingModal schedule uses explicit August 13, 2027 date', () => {
  const ws = createDemoWorkspace();
  const mapped = mapBackendExtractionToFrontendResult(
    {
      session: {
        id: 's-hsr-real',
        draftQuote: {
          vendorName: 'HSR Photography',
          category: 'photographer',
          events: ['Engagement'],
          quoteKind: 'initial',
          currency: 'CAD',
          taxStatus: 'unknown',
          gratuityStatus: 'unknown',
          lineItems: [
            {
              label: 'Photography Package',
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
          paymentTerms: {
            depositAmount: 200,
            methodRule: 'etransfer',
            scheduleNotes: '$200 deposit due upon signing, $700 balance due August 13, 2027',
            milestones: [
              { label: 'Deposit', amount: 200, relativeDeadlineText: 'Due upon signing' },
              { label: 'Remaining balance', amount: 700, dueDate: 'August 13, 2027' },
            ],
          },
          openQuestions: [],
        },
      },
    },
    { sourceType: 'screenshot', sourceChannel: 'Screenshot', rawText: 'HSR Photography screenshot' }
  );

  // Conditional "Additional Hourly Pricing: $250/hr" defaults to 0 hrs -> $900 subtotal
  const calc = calculateQuoteFinancials(mapped.quote, ws.events, []);
  assert.equal(calc.preTaxTotal, 900);
  const overtime = calc.lineItemBreakdowns.find((row) => row.id === mapped.quote.lineItems[1].id);
  assert.equal(overtime?.conditionalOvertime, true);
  assert.equal(overtime?.billableHours, 0);

  // Explicit date parsing + Booking schedule propagation (NEVER July 14, 2027 or hardcoded dates)
  assert.equal(normalizeIsoDate('August 13, 2027'), '2027-08-13');
  const schedule = deriveBookingScheduleDefaults(mapped.quote, ws.events, [ws.events[0].id], 900);
  assert.equal(schedule.depositAmount, 200);
  assert.equal(schedule.depositHasKnownDate, false);
  assert.equal(schedule.depositRelativeLabel, 'Due upon signing');
  assert.equal(schedule.balanceHasKnownDate, true);
  assert.equal(schedule.balanceDueDate, '2027-08-13');

  // Reconciles $200 + $700 = $900 and defaults to unpaid
  const milestones = buildBookingMilestones({
    contractTotal: 900,
    depositAmount: schedule.depositAmount,
    depositHasKnownDate: schedule.depositHasKnownDate,
    depositDate: schedule.depositDate,
    depositRelativeLabel: schedule.depositRelativeLabel,
    depositPayer: 'Meera & Kabir',
    coupleNames: 'Meera & Kabir',
    balanceHasKnownDate: schedule.balanceHasKnownDate,
    balanceDueDate: schedule.balanceDueDate,
    balanceRelativeLabel: schedule.balanceRelativeLabel,
    balancePayer: 'Unassigned',
  });
  assert.equal(milestones.length, 2);
  assert.equal(milestones[0].amount + milestones[1].amount, 900);
  assert.notEqual(milestones[0].status, 'Paid');
  assert.equal(milestones[1].dueDate, '2027-08-13');

  // Quote with no stated dates leaves both deadlines unresolved (no hardcoded 2026-11-24 or 2027-07-15)
  const noDatesSchedule = deriveBookingScheduleDefaults(
    makeCleanQuote({ paymentMilestones: [], depositAmount: undefined, depositPercent: undefined }),
    ws.events,
    [ws.events[0].id],
    1000
  );
  assert.equal(noDatesSchedule.depositHasKnownDate, false);
  assert.equal(noDatesSchedule.depositDate, '');
  assert.equal(noDatesSchedule.balanceHasKnownDate, false);
  assert.equal(noDatesSchedule.balanceDueDate, '');
});

test('Codex final 3 findings: unknown tax rate on plus-tax quotes, selected percentage add-on unresolved basis blocker, and package-specific deposits', () => {
  const ws = createDemoWorkspace();

  // 1. USD $1,000 "plus tax" without rate must NOT default to 13% ($1,130), must be incomplete & block booking
  const plusTaxMapped = mapBackendExtractionToFrontendResult(
    {
      session: {
        id: 's-usd-plus-tax',
        draftQuote: {
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
        },
      },
    },
    { sourceType: 'pasted_message', sourceChannel: 'Email', rawText: 'USD $1,000 plus tax' }
  );

  assert.equal(plusTaxMapped.quote.taxPercent, null);
  const plusTaxCalc = calculateQuoteFinancials(plusTaxMapped.quote, ws.events, []);
  assert.equal(plusTaxCalc.taxRateUnresolved, true);
  assert.equal(plusTaxCalc.taxAmount, 0);
  assert.equal(plusTaxCalc.estimatedAllInTotal, 1000); // NOT 1130
  assert.equal(plusTaxCalc.canApprove, true); // Allows incomplete projected estimate
  assert.equal(plusTaxCalc.isEstimateComplete, false);

  const plusTaxVendor: Vendor = {
    id: 'v-usd-plus-tax',
    name: 'US Studio',
    category: 'photography',
    eventIds: [],
    location: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    status: 'Quoted',
    isPreferred: true,
    notes: '',
    quotes: [{ ...plusTaxMapped.quote, approvalState: 'approved' }],
    activeQuoteId: plusTaxMapped.quote.id,
  };
  const plusTaxElig = getVendorBookingEligibility(plusTaxVendor, ws.events);
  assert.equal(plusTaxElig.canBook, false);
  assert.ok(plusTaxElig.blockingReasons.some((r) => /tax percentage/i.test(r)));

  // 2. Percentage add-on with unknown basis: nonblocking when unselected, blocks approval & booking when selected
  const addOnQuote = makeCleanQuote({
    id: 'q-pct-addon',
    legacyReviewAcknowledged: true,
    taxHandling: 'included',
    lineItems: [{ id: 'li-1', label: 'Base package', pricingModel: 'flat', unitPrice: 1000 }],
    addOns: [
      {
        id: 'ao-pct',
        label: 'Optional 10% rush fee',
        description: '10% rush processing',
        pricePreTax: 10,
        pricingModel: 'percentage',
        percentageBasis: 'unknown',
        selected: false,
      },
    ],
  });
  const unselectedAddOnCalc = calculateQuoteFinancials(addOnQuote, ws.events, []);
  assert.equal(unselectedAddOnCalc.unresolvedPercentageCount, 0);
  assert.equal(unselectedAddOnCalc.canApprove, true);

  const selectedAddOnQuote: Quote = {
    ...addOnQuote,
    addOns: addOnQuote.addOns.map((a) => ({ ...a, selected: true })),
  };
  const selectedAddOnCalc = calculateQuoteFinancials(selectedAddOnQuote, ws.events, []);
  assert.equal(selectedAddOnCalc.unresolvedPercentageCount, 1);
  assert.equal(selectedAddOnCalc.canApprove, false);
  assert.equal(selectedAddOnCalc.isEstimateComplete, false);

  const addOnVendor: Vendor = {
    ...plusTaxVendor,
    id: 'v-pct-addon',
    quotes: [selectedAddOnQuote],
    activeQuoteId: selectedAddOnQuote.id,
  };
  assert.equal(getVendorBookingEligibility(addOnVendor, ws.events).canBook, false);

  // 3. Package-specific depositAmount / depositPercent prioritized over quote-level defaults
  const pkgDepositMapped = mapBackendExtractionToFrontendResult(
    {
      session: {
        id: 's-pkg-deposit',
        draftQuote: {
          vendorName: 'Crown Hall',
          category: 'venue',
          events: ['Reception'],
          quoteKind: 'initial',
          currency: 'CAD',
          taxStatus: 'included',
          gratuityStatus: 'included',
          selectedPackageId: 'pkg-50pct',
          packages: [
            {
              id: 'pkg-50pct',
              name: 'Gold Package',
              pricingType: 'flat',
              amount: 1000,
              paymentTerms: { depositPercent: 50, methodRule: 'etransfer' },
              sourceExcerpt: 'Gold Package $1,000, 50% deposit',
            },
            {
              id: 'pkg-fixed',
              name: 'Silver Package',
              pricingType: 'flat',
              amount: 1000,
              paymentTerms: { depositAmount: 350, methodRule: 'etransfer' },
              sourceExcerpt: 'Silver Package $1,000, $350 deposit',
            },
          ],
          lineItems: [],
          paymentTerms: { depositAmount: 100, methodRule: 'etransfer' },
          openQuestions: [],
        },
      },
    },
    { sourceType: 'pasted_message', sourceChannel: 'Email', rawText: 'Package deposits' }
  );

  const goldSchedule = deriveBookingScheduleDefaults(pkgDepositMapped.quote, ws.events, [], 1000);
  assert.equal(goldSchedule.depositAmount, 500); // 50% of $1,000 (overrides quote-level $100)

  const silverSchedule = deriveBookingScheduleDefaults(
    { ...pkgDepositMapped.quote, selectedPackageId: 'pkg-fixed' },
    ws.events,
    [],
    1000
  );
  assert.equal(silverSchedule.depositAmount, 350); // $350 fixed (overrides quote-level $100)
});

test('Codex 4 findings + combined rules: null package gratuity, conflicting pricing models, order-independent percentage add-ons, and whole-subtotal gratuity parity', () => {
  const ws = createDemoWorkspace();

  // 1. Explicit null package gratuity under quote-wide 15% default must remain unresolved and block approval & booking
  const nullGratMapped = mapBackendExtractionToFrontendResult(
    {
      session: {
        id: 's-null-pkg-grat',
        draftQuote: {
          vendorName: 'Royal Estate',
          category: 'venue',
          events: ['Reception'],
          quoteKind: 'initial',
          currency: 'CAD',
          taxStatus: 'included',
          gratuityStatus: 'excluded',
          gratuityPercent: 15,
          gratuityBasis: 'entire_subtotal',
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
              id: 'pkg-classic',
              name: 'Classic Package',
              pricingType: 'flat',
              amount: 1200,
              sourceExcerpt: 'Classic Package $1,200',
            },
          ],
          lineItems: [],
          openQuestions: [],
        },
      },
    },
    { sourceType: 'pasted_message', sourceChannel: 'Email', rawText: 'Royal Package quote' }
  );

  assert.equal(nullGratMapped.quote.packages?.[0].gratuityPercent, null);
  const nullGratCalc = calculateQuoteFinancials(nullGratMapped.quote, ws.events, []);
  assert.equal(nullGratCalc.gratuityUnresolved, true);
  assert.equal(nullGratCalc.canApprove, false);
  assert.equal(nullGratCalc.isEstimateComplete, false);

  // 2. Conflicting price options with different pricing models (flat $1,000 vs per_person $20 @ 100 guests -> $2,000)
  const conflictModelMapped = mapBackendExtractionToFrontendResult(
    {
      session: {
        id: 's-conflict-model',
        draftQuote: {
          vendorName: 'Catering Co',
          category: 'catering',
          events: ['Reception'],
          quoteKind: 'revision',
          currency: 'CAD',
          taxStatus: 'included',
          gratuityStatus: 'included',
          lineItems: [
            {
              label: 'Buffet service',
              pricingType: 'flat',
              amount: 1000,
              chargeType: 'mandatory',
              conflictingOptions: [
                {
                  sourceLabel: 'PDF contract',
                  pricingType: 'per_person',
                  amount: 20,
                  sourceExcerpt: '$20/person in PDF contract',
                },
              ],
              sourceExcerpt: '$1,000 flat in DM',
            },
          ],
          openQuestions: [],
        },
      },
    },
    { sourceType: 'pasted_message', sourceChannel: 'Email', rawText: 'Conflict quote' }
  );

  const conflict = conflictModelMapped.quote.conflicts[0];
  assert.equal(conflict.options.length, 2);
  const perPersonOpt = conflict.options.find((o) => o.sourceLabel === 'PDF contract')!;
  assert.equal(perPersonOpt.pricingModel, 'per_person');

  const resolvedConflictQuote: Quote = {
    ...conflictModelMapped.quote,
    conflicts: conflictModelMapped.quote.conflicts.map((c) => ({
      ...c,
      resolvedOptionId: perPersonOpt.id,
    })),
  };
  const resolvedConflictCalc = calculateQuoteFinancials(resolvedConflictQuote, ws.events, [], 100);
  assert.equal(resolvedConflictCalc.preTaxTotal, 2000); // 100 * $20, NOT $20!
  assert.equal(resolvedConflictCalc.canApprove, true);

  // 3. Order-independent percentage add-ons + mandatory percentage fee + whole-subtotal gratuity combined
  const baseWithPctFirst = makeCleanQuote({
    id: 'q-order-1',
    legacyReviewAcknowledged: true,
    taxHandling: 'included',
    gratuityStatus: 'excluded',
    gratuityPercent: 15,
    gratuityBasis: 'entire_subtotal',
    lineItems: [
      { id: 'li-1', label: 'Dinner package', pricingModel: 'flat', unitPrice: 1000 },
      {
        id: 'li-2',
        label: 'Administrative fee',
        pricingModel: 'percentage',
        unitPrice: 10,
        percentageBasis: 'entire_subtotal',
      },
    ],
    addOns: [
      {
        id: 'ao-pct',
        label: '10% coordination surcharge',
        description: '10% of entire subtotal',
        pricePreTax: 10,
        pricingModel: 'percentage',
        percentageBasis: 'entire_subtotal',
        selected: true,
      },
      {
        id: 'ao-flat',
        label: 'Late-night dessert station',
        description: 'Flat $500',
        pricePreTax: 500,
        pricingModel: 'flat',
        selected: true,
      },
    ],
  });

  const baseWithFlatFirst: Quote = {
    ...baseWithPctFirst,
    addOns: [...baseWithPctFirst.addOns].reverse(),
  };

  const calcPctFirst = calculateQuoteFinancials(baseWithPctFirst, ws.events, []);
  const calcFlatFirst = calculateQuoteFinancials(baseWithFlatFirst, ws.events, []);

  // Both orders must yield identical pre-tax & all-in totals:
  // Non-pct base: $1,000 + $500 = $1,500; 10% add-on = $150; 10% admin fee = $150 -> preTax = $1,800; 15% gratuity = $270 -> all-in = $2,070
  assert.equal(calcPctFirst.preTaxTotal, 1800);
  assert.equal(calcFlatFirst.preTaxTotal, 1800);
  assert.equal(calcPctFirst.gratuityAmount, 270);
  assert.equal(calcFlatFirst.gratuityAmount, 270);
  assert.equal(calcPctFirst.estimatedAllInTotal, 2070);
  assert.equal(calcFlatFirst.estimatedAllInTotal, 2070);

  // Exact backend parity check on $1,000 + 10% admin fee + 15% whole-subtotal gratuity (no add-ons) = $1,265
  const noAddOnQuote: Quote = { ...baseWithPctFirst, addOns: [] };
  const noAddOnCalc = calculateQuoteFinancials(noAddOnQuote, ws.events, []);
  assert.equal(noAddOnCalc.preTaxTotal, 1100);
  assert.equal(noAddOnCalc.gratuityAmount, 165);
  assert.equal(noAddOnCalc.estimatedAllInTotal, 1265);
});

test('Issue #3: calculateVendorComparison computes CAD 500 break-even bartender fee at 160 guests without mutating event', () => {
  const ws = createDemoWorkspace();
  const evt = ws.events.find((e) => e.id === ws.events[0].id)!;
  const originalGuestCount = evt.guestCount;

  const juniperVenue: Vendor = {
    id: 'v-juniper-be',
    name: 'Juniper Hall',
    category: 'venue',
    eventIds: [evt.id],
    location: 'Mississauga, ON',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    status: 'Quoted',
    isPreferred: false,
    notes: '',
    quotes: [
      makeCleanQuote({
        id: 'q-juniper-be',
        legacyReviewAcknowledged: true,
        taxHandling: 'tax_exempt',
        minGuests: 120,
        maxCapacity: 200,
        lineItems: [
          {
            id: 'li-jun-1',
            label: 'Reception package',
            pricingModel: 'per_person',
            unitPrice: 100,
            minGuests: 120,
          },
          {
            id: 'li-jun-av',
            label: 'AV fee',
            pricingModel: 'flat',
            unitPrice: 300,
          },
        ],
        unconfirmedFees: [
          {
            id: 'uf-jun-bartender',
            label: 'Bartender staffing',
            description: 'Bartender staffing TBD',
            mandatory: true,
            status: 'unconfirmed',
          },
        ],
      }),
    ],
    activeQuoteId: 'q-juniper-be',
  };

  const mapleVenue: Vendor = {
    ...juniperVenue,
    id: 'v-maple-be',
    name: 'Maple Pavilion',
    quotes: [
      makeCleanQuote({
        id: 'q-maple-be',
        legacyReviewAcknowledged: true,
        taxHandling: 'tax_exempt',
        minGuests: 120,
        maxCapacity: 150,
        lineItems: [
          {
            id: 'li-map-1',
            label: 'Reception package',
            pricingModel: 'per_person',
            unitPrice: 105,
            minGuests: 120,
          },
        ],
        unconfirmedFees: [],
      }),
    ],
    activeQuoteId: 'q-maple-be',
  };

  // At 160 guests: Juniper = $16,300 (excl. unconfirmed bartender), Maple = $16,800 (over 150 cap).
  // Compare within-capacity at 150 guests: Juniper = $15,300, Maple = $15,750 -> $450 diff;
  // With Maple maxCapacity 200 at 160 guests: Juniper = $16,300, Maple = $16,800 -> exact $500 break-even!
  mapleVenue.quotes[0].maxCapacity = 200;
  const comp = calculateVendorComparison([juniperVenue, mapleVenue], ws.events, 160);
  assert.equal(comp.lowestKnownVendorId, 'v-juniper-be');
  assert.ok(comp.breakEvenNote?.includes('$500'));
  assert.ok(comp.breakEvenNote?.includes('Bartender staffing'));
  assert.equal(evt.guestCount, originalGuestCount); // Event guest count unchanged

  // Capacity exceeded flagged when hypothetical guests > maxCapacity
  mapleVenue.quotes[0].maxCapacity = 150;
  const capComp = calculateVendorComparison([juniperVenue, mapleVenue], ws.events, 160);
  const mapleEntry = capComp.entries.find((e) => e.vendor.id === 'v-maple-be')!;
  assert.equal(mapleEntry.calc.capacityExceeded, true);
});

test('direct approval and booking enforce package, cost, conflict, currency, and source blockers', () => {
  const workspace = createDemoWorkspace();
  const vendor = workspace.vendors.find((v) => v.id === 'ven-versailles')!;
  const cases: Array<{ reason: RegExp; overrides: Partial<Quote> }> = [
    { reason: /currency/i, overrides: { currency: 'UNKNOWN' } },
    {
      reason: /mandatory.*fee/i,
      overrides: {
        unconfirmedFees: [
          { id: 'unknown-av', label: 'AV fee', description: 'TBD', mandatory: true, status: 'unconfirmed' },
        ],
      },
    },
    {
      reason: /package option/i,
      overrides: {
        packages: [
          { id: 'mini', name: 'Mini', pricingModel: 'flat', unitPrice: 8000, inclusions: [] },
          { id: 'full', name: 'Full', pricingModel: 'flat', unitPrice: 10000, inclusions: [] },
        ],
      },
    },
    {
      reason: /conflicting price/i,
      overrides: {
        conflicts: [{
          id: 'conf-base', fieldLabel: 'Base price', description: 'Conflicting quotes',
          targetLineItemId: 'li-test-1',
          options: [
            { id: 'one', label: 'Email price', sourceLabel: 'Email', amount: 9000 },
            { id: 'two', label: 'Contract price', sourceLabel: 'Contract', amount: 10000 },
          ],
        }],
      },
    },
    {
      reason: /mandatory gratuity/i,
      overrides: { gratuityStatus: 'excluded', gratuityPercent: null },
    },
    {
      reason: /calculation basis/i,
      overrides: {
        lineItems: [{
          id: 'fee-1', label: 'Admin charge', pricingModel: 'percentage', unitPrice: 5,
          percentageBasis: 'unknown',
        }],
      },
    },
    {
      reason: /source evidence/i,
      overrides: {
        sourceWarnings: ['The line-item excerpt could not be located in the source.'],
        sourceWarningsAcknowledged: false,
      },
    },
  ];

  for (const { reason, overrides } of cases) {
    const quote = makeCleanQuote(overrides);
    const approval = applyApproveQuote(workspace, vendor.id, null, quote, vendor.id);
    assert.equal(approval.approved, false, reason.toString());
    assert.equal(approval.workspace, workspace);
    assert.ok(approval.blockingReasons.some((item) => reason.test(item)), reason.toString());

    const draft = applySaveDraftQuote(workspace, vendor.id, null, quote, vendor.id).workspace;
    assert.equal(draft.vendors.find((item) => item.id === vendor.id)!.draftQuote?.approvalState, 'draft');
    assert.equal(calculateWorkspaceFinancials(draft).projectedSpend, calculateWorkspaceFinancials(workspace).projectedSpend);

    const staleWorkspace = {
      ...workspace,
      vendors: workspace.vendors.map((item) =>
        item.id === vendor.id ? { ...item, quotes: [quote], activeQuoteId: quote.id } : item
      ),
    };
    const booking = applyConfirmBooking(staleWorkspace, {
      vendorId: vendor.id,
      contractTotal: 11300,
      milestones: [{
        label: 'Balance', status: 'Date TBD', amount: 11300, dueDate: null, reminderEnabled: false,
      }],
    });
    assert.equal(booking.booked, false, reason.toString());
    assert.equal(booking.workspace, staleWorkspace);
    assert.ok(booking.blockingReasons.some((item) => reason.test(item)), reason.toString());
  }
});

test('approving one quote cannot discard a different pending draft', () => {
  const workspace = createDemoWorkspace();
  const vendor = workspace.vendors.find((v) => v.id === 'ven-versailles')!;
  const pending = makeCleanQuote({ id: 'resume-this-draft' });
  const staged = applySaveDraftQuote(workspace, vendor.id, null, pending, vendor.id).workspace;

  const rejected = applyApproveQuote(staged, vendor.id, null, makeCleanQuote(), vendor.id);
  assert.equal(rejected.approved, false);
  assert.equal(rejected.workspace, staged);
  assert.match(rejected.blockingReasons[0], /pending draft/i);

  const approved = applyApproveQuote(staged, vendor.id, null, pending, vendor.id);
  assert.equal(approved.approved, true);
  assert.equal(approved.workspace.vendors.find((item) => item.id === vendor.id)!.activeQuoteId, pending.id);
});

test('booking reconciles existing paid milestones and protects the confirmed contract', () => {
  const original = createDemoWorkspace();
  const vendor = original.vendors.find((v) => v.id === 'ven-versailles')!;
  const priorPayment = {
    id: 'prior-deposit',
    vendorId: vendor.id,
    vendorName: vendor.name,
    label: 'Prior deposit',
    amount: 22.33,
    dueDate: '2026-11-24',
    paidDate: '2026-11-24',
    status: 'Paid' as const,
    reminderEnabled: false,
  };
  const ws = {
    ...original,
    payments: [...original.payments.filter((p) => p.vendorId !== vendor.id), priorPayment],
  };
  const inputs = {
    vendorId: vendor.id,
    contractTotal: 100.01,
    milestones: [{
      label: 'Balance', status: 'Upcoming' as const, amount: 77.68, dueDate: '2027-06-01', reminderEnabled: true,
    }],
  };
  const mismatched = applyConfirmBooking(ws, {
    ...inputs, milestones: [{ ...inputs.milestones[0], amount: 77.67 }],
  });
  assert.equal(mismatched.booked, false);
  assert.equal(mismatched.workspace, ws);
  assert.match(mismatched.blockingReasons[0], /add up to the agreed contract total/i);

  const booked = applyConfirmBooking(ws, inputs);
  assert.equal(booked.booked, true);
  const payments = booked.workspace.payments.filter((p) => p.vendorId === vendor.id);
  assert.equal(payments.length, 2);
  assert.deepEqual(payments[0], priorPayment);
  assert.equal(payments[1].status, 'Upcoming');
  assert.equal(payments[1].amount, 77.68);
  assert.equal(booked.workspace.vendors.find((v) => v.id === vendor.id)!.bookedContractTotal, 100.01);

  const repeated = applyConfirmBooking(booked.workspace, inputs);
  assert.equal(repeated.booked, false);
  assert.equal(repeated.workspace, booked.workspace);
});

test('ambiguous v1 overtime stays billable until the couple explicitly reviews the quantity', () => {
  const ws = createDemoWorkspace();
  const vendor = ws.vendors.find((v) => v.id === 'ven-versailles')!;
  const quote = makeCleanQuote({
    legacyReviewAcknowledged: true,
    lineItems: [
      { id: 'base', label: 'Full Collection', pricingModel: 'flat', unitPrice: 3100 },
      { id: 'rate', label: 'Overtime', pricingModel: 'hourly', unitPrice: 275 },
    ],
  });
  const restored = JSON.parse(JSON.stringify(quote)) as Quote;
  const previous = calculateQuoteFinancials(restored, ws.events, vendor.eventIds);
  assert.equal(previous.preTaxTotal, 3375);

  const blocked = applyApproveQuote(ws, vendor.id, null, restored, vendor.id);
  assert.equal(blocked.approved, false);
  assert.equal(blocked.workspace, ws);
  assert.match(blocked.blockingReasons[0], /hourly quantity|overtime/i);

  restored.lineItems[1] = {
    ...restored.lineItems[1],
    isConditionalOvertime: false,
    quantity: 1,
  };
  const approved = applyApproveQuote(ws, vendor.id, null, restored, vendor.id);
  assert.equal(approved.approved, true);
  assert.equal(calculateQuoteFinancials(restored, ws.events, vendor.eventIds).preTaxTotal, 3375);
});

test('workspace minimums do not change a separately selected per-guest add-on', () => {
  const quote = makeCleanQuote({
    minGuests: 200,
    taxPercent: 13,
    addOns: [{
      id: 'li-extra-dessert',
      label: 'Dessert',
      description: 'Optional dessert',
      pricingModel: 'per_person',
      pricePreTax: 20,
      selected: true,
    }],
  });
  const calc = calculateQuoteFinancials(quote, [], [], 100);
  assert.equal(calc.selectedAddOnsPreTax, 2000);
  assert.equal(calc.preTaxTotal, 12000);
  assert.equal(calc.taxAmount, 1560);
  assert.equal(calc.estimatedAllInTotal, 13560);
});

test('saved v1 demo workspace round trips its projected, committed, and paid totals', () => {
  const stored = JSON.stringify({ workspaces: [createDemoWorkspace()] });
  const [workspace] = JSON.parse(stored).workspaces;
  const before = calculateWorkspaceFinancials(workspace);
  const [reopened] = JSON.parse(JSON.stringify({ workspaces: [workspace] })).workspaces;
  const after = calculateWorkspaceFinancials(reopened);

  assert.equal(before.projectedSpend, 96177.20);
  assert.equal(before.committedSpend, 30555.20);
  assert.equal(before.paidToDate, 8000);
  assert.deepEqual(after, before);
});
