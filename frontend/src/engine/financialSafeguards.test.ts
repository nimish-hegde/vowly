import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoWorkspace } from '../data/demoWorkspace.ts';
import {
  buildBookingMilestones,
  calculateQuoteFinancials,
  calculateWorkspaceFinancials,
  DEFAULT_DEPOSIT_ALREADY_PAID,
  getVendorBookingEligibility,
  resolveRelativeDeadlineDate,
} from './financialCalculator.ts';
import {
  BackendQuoteExtractor,
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
