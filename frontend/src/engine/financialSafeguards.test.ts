import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoWorkspace } from '../data/demoWorkspace.ts';
import {
  buildBookingMilestones,
  calculateWorkspaceFinancials,
  DEFAULT_DEPOSIT_ALREADY_PAID,
  getVendorBookingEligibility,
} from './financialCalculator.ts';
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
