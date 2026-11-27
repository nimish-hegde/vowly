import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoWorkspace } from '../data/demoWorkspace.ts';
import { calculateQuoteFinancials, calculateWorkspaceFinancials, getVendorBookingEligibility } from './financialCalculator.ts';
import { reconcileQuoteRevision } from './quoteRevision.ts';
import { buildQuoteRevisionPreview } from './revisionPreview.ts';
import { applyApproveQuote, applySaveDraftQuote } from '../store/workspaceTransitions.ts';
import type { PaymentMilestone, Quote, Vendor, WeddingWorkspace } from '../types/vowly.ts';

const reception = 'evt-reception';
const vendorId = 'venue-revision-test';
const packageText = 'The Reception Package is CAD 16,300.';
const originalAvText = 'The original AV fee is CAD 600.';
const revisedAvText = 'The revised AV fee is CAD 300.';
const bartenderText = 'Mandatory bartender staffing price will be confirmed later.';

function original(overrides: Partial<Quote> = {}): Quote {
  return {
    id: 'q-v1',
    title: 'Reception quote',
    approvalState: 'approved',
    quoteKind: 'personalized',
    receivedDate: '2026-11-24',
    sourceType: 'pasted_message',
    sourceChannel: 'Email',
    sourceText: [packageText, originalAvText, 'All prices are plus 13% HST.'].join(' '),
    currency: 'CAD',
    currencySource: 'explicit_quote',
    taxHandling: 'excluded_plus_hst',
    taxPercent: 13,
    lineItems: [
      { id: 'base', label: 'Reception Package', pricingModel: 'flat', unitPrice: 16300, evidenceId: 'ev-1' },
      { id: 'av-old', label: 'AV fee', pricingModel: 'flat', unitPrice: 600, evidenceId: 'ev-2' },
    ],
    addOns: [],
    unconfirmedFees: [],
    conflicts: [],
    inclusions: ['Reception hall'],
    paymentTermsSummary: 'CAD 2,500 deposit; balance 30 days before the reception.',
    clarificationQuestions: [],
    evidenceSpans: [
      { id: 'ev-1', excerpt: packageText, sourceLabel: 'Original email' },
      { id: 'ev-2', excerpt: originalAvText, sourceLabel: 'Original email' },
    ],
    ...overrides,
  };
}

function amendment(baselineQuoteId = 'q-v1', overrides: Partial<Quote> = {}): Quote {
  return original({
    id: 'q-v2',
    approvalState: 'draft',
    sourceText: revisedAvText,
    currency: 'UNKNOWN',
    currencySource: 'unknown',
    taxHandling: 'unspecified',
    taxPercent: undefined,
    lineItems: [
      { id: 'av-new', label: 'AV fee', pricingModel: 'flat', unitPrice: 300, evidenceId: 'ev-1' },
    ],
    inclusions: [],
    paymentTermsSummary: '',
    evidenceSpans: [{ id: 'ev-1', excerpt: revisedAvText, sourceLabel: 'Revised email' }],
    revisionDraft: { baselineQuoteId, mode: 'partial' },
    ...overrides,
  });
}

function workspace(prior: Quote, options: Partial<Vendor> = {}, payments: PaymentMilestone[] = []): WeddingWorkspace {
  return {
    ...createDemoWorkspace(),
    vendors: [{
      id: vendorId,
      name: 'Synthetic Juniper Hall',
      category: 'venue',
      eventIds: [reception],
      location: '',
      contactName: '',
      contactEmail: '',
      contactPhone: '',
      status: 'Quoted',
      isPreferred: true,
      notes: '',
      quotes: [prior],
      activeQuoteId: prior.id,
      ...options,
    }],
    payments,
    activities: [],
    tasks: [],
    manualExpenses: [],
  };
}

function active(ws: WeddingWorkspace): Quote {
  const vendor = ws.vendors[0];
  const quote = vendor.quotes.find(({ id }) => id === vendor.activeQuoteId);
  assert.ok(quote);
  return quote;
}

function approve(ws: WeddingWorkspace, candidate: Quote) {
  return applyApproveQuote(ws, vendorId, null, candidate, vendorId);
}

function withUnpricedBartender(): Quote {
  const prior = original();
  return {
    ...prior,
    sourceText: prior.sourceText + ' ' + bartenderText,
    unconfirmedFees: [{
      id: 'bartender', label: 'Bartender staffing', mandatory: true,
      description: bartenderText, status: 'unconfirmed', evidenceId: 'ev-3',
    }],
    evidenceSpans: [...prior.evidenceSpans, { id: 'ev-3', excerpt: bartenderText, sourceLabel: 'Original email' }],
  };
}

test('partial revision shows exact prior and proposed evidence, carries omissions, and previews the real savings', () => {
  const prior = original();
  const ws = workspace(prior);
  const before = structuredClone(ws);
  const incoming = amendment();
  const preview = buildQuoteRevisionPreview(ws, ws.vendors[0], incoming);
  assert.ok(preview);
  assert.equal(preview.stale, false);
  assert.equal(preview.preTaxDelta, -300);
  assert.equal(preview.allInDelta, -339);
  assert.equal(preview.projectedDelta, -339);
  assert.equal(preview.quote.currency, 'CAD');
  assert.equal(preview.quote.taxPercent, 13);
  assert.equal(preview.quote.paymentTermsSummary, prior.paymentTermsSummary);

  const av = preview.changes.find((change) =>
    JSON.stringify(change.previousEvidence)?.includes(originalAvText)
    && JSON.stringify(change.proposedEvidence)?.includes(revisedAvText));
  assert.ok(av, 'AV change has both verbatim source passages');
  assert.match(av.previous ?? '', /600/);
  assert.match(av.proposed ?? '', /300/);

  const mergedBase = preview.quote.lineItems.find(({ id }) => id === 'base');
  const mergedAv = preview.quote.lineItems.find(({ id }) => id === 'av-old');
  assert.ok(mergedBase);
  assert.ok(mergedAv);
  assert.equal(mergedAv.unitPrice, 300);
  assert.equal(preview.quote.evidenceSpans.find(({ id }) => id === mergedBase.evidenceId)?.excerpt, packageText);
  assert.equal(preview.quote.evidenceSpans.find(({ id }) => id === mergedAv.evidenceId)?.excerpt, revisedAvText);
  assert.deepEqual(ws, before);
});

test('an omitted mandatory bartender fee stays unknown, blocks approval, and survives draft reload', () => {
  const ws = workspace(withUnpricedBartender());
  const incoming = amendment();
  const preview = buildQuoteRevisionPreview(ws, ws.vendors[0], incoming);
  assert.ok(preview);
  assert.equal(preview.preTaxDelta, -300);
  assert.equal(preview.allInDelta, null);
  assert.equal(preview.projectedDelta, null);
  assert.equal(preview.quote.unconfirmedFees[0].id, 'bartender');
  assert.equal(preview.quote.unconfirmedFees[0].status, 'unconfirmed');
  assert.match(preview.blockingReasons.join(' '), /mandatory|bartender/i);

  const saved = applySaveDraftQuote(ws, vendorId, null, incoming, vendorId).workspace;
  const reloaded: WeddingWorkspace = JSON.parse(JSON.stringify(saved));
  assert.equal(active(reloaded).id, 'q-v1');
  assert.deepEqual(calculateWorkspaceFinancials(reloaded).projectedSpend, calculateWorkspaceFinancials(ws).projectedSpend);
  const draft = reloaded.vendors[0].draftQuote;
  assert.ok(draft);
  const result = approve(reloaded, draft);
  assert.equal(result.approved, false);
  assert.match(result.blockingReasons.join(' '), /mandatory|bartender/i);
  assert.equal(result.workspace, reloaded);
});

test('explicit review removal drops a line while omission alone carries it', () => {
  const prior = original({
    lineItems: [
      ...original().lineItems,
      { id: 'late', label: 'Late-night room access', unitPrice: 225, pricingModel: 'flat' },
    ],
  });
  const incoming = amendment();
  const first = reconcileQuoteRevision(prior, incoming);
  assert.ok(first.quote.lineItems.some(({ id }) => id === 'late'));
  const removal = first.changes.find((change) => change.canRemove && /late-night room access/i.test(change.field));
  assert.ok(removal, 'an inherited line must have an explicit removal action');
  const confirmed = reconcileQuoteRevision(prior, incoming, { [removal.id]: { action: 'remove' } });
  assert.ok(!confirmed.quote.lineItems.some(({ id }) => id === 'late'));
  assert.equal(confirmed.quote.lineItems.find(({ id }) => id === 'av-old')?.unitPrice, 300);
});

test('a package amendment remaps fresh package and fee IDs while keeping the sibling tier unchanged', () => {
  const avFee = original().lineItems[1];
  const prior = original({
    lineItems: [],
    selectedPackageId: 'orchid',
    packages: [
      { id: 'orchid', name: 'Orchid', unitPrice: 16300, pricingModel: 'flat', inclusions: ['Hall'], fees: [{ ...avFee, packageId: 'orchid' }] },
      { id: 'cedar', name: 'Cedar', unitPrice: 11000, pricingModel: 'flat', inclusions: ['Terrace'],
        fees: [{ ...avFee, id: 'cedar-av', unitPrice: 425, packageId: 'cedar' }] },
    ],
  });
  const incoming = amendment('q-v1', {
    lineItems: [],
    packages: [{
      id: 'new-orchid-id', name: 'Orchid', unitPrice: 16300, pricingModel: 'flat', inclusions: [],
      fees: [{ ...amendment().lineItems[0], packageId: 'new-orchid-id' }],
    }],
  });
  const result = reconcileQuoteRevision(prior, incoming);
  assert.equal(result.quote.selectedPackageId, 'orchid');
  assert.equal(result.quote.packages?.length, 2);
  const orchid = result.quote.packages?.find(({ id }) => id === 'orchid');
  const cedar = result.quote.packages?.find(({ id }) => id === 'cedar');
  assert.equal(orchid?.fees?.length, 1);
  assert.equal(orchid?.fees?.[0].unitPrice, 300);
  assert.equal(orchid?.fees?.[0].packageId, 'orchid');
  assert.equal(cedar?.fees?.[0].unitPrice, 425);
  assert.deepEqual(cedar?.inclusions, ['Terrace']);

  const ws = workspace(prior);
  const calc = calculateQuoteFinancials(result.quote, ws.events, [reception]);
  assert.equal(calc.preTaxTotal, 16600);
});

test('approval is idempotent across reload with fresh IDs, while an explicit reversal applies', () => {
  const ws = workspace(original());
  const candidate = amendment();
  const first = approve(ws, candidate);
  assert.equal(first.approved, true);
  assert.equal(first.workspace.vendors[0].quotes.length, 2);
  assert.equal(active(first.workspace).revisions?.length, 1);
  assert.equal(active(first.workspace).revisions?.[0].previousPreTaxTotal, 16900);
  assert.equal(active(first.workspace).revisions?.[0].newPreTaxTotal, 16600);
  assert.deepEqual(ws.vendors[0].quotes, [original()]);

  const reloaded: WeddingWorkspace = JSON.parse(JSON.stringify(first.workspace));
  const lastApproved = active(reloaded);
  const exactReplay = approve(reloaded, candidate);
  assert.equal(exactReplay.duplicate, true);
  assert.equal(exactReplay.workspace, reloaded);

  const repeated = approve(reloaded, amendment(lastApproved.id, {
    id: 'fresh-repeat-quote',
    lineItems: [{ ...candidate.lineItems[0], id: 'fresh-repeat-line', evidenceId: 'fresh-repeat-evidence' }],
    evidenceSpans: [{ ...candidate.evidenceSpans[0], id: 'fresh-repeat-evidence' }],
  }));
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.workspace, reloaded);
  assert.equal(repeated.workspace.vendors[0].quotes.length, 2);
  assert.equal(active(repeated.workspace).revisions?.length, 1);

  const reversalText = 'The AV fee is restored to CAD 600.';
  const reversed = approve(reloaded, {
    ...lastApproved,
    id: 'q-v3-reversal',
    approvalState: 'draft',
    revisionDraft: { baselineQuoteId: lastApproved.id, mode: 'manual', note: reversalText },
    lineItems: lastApproved.lineItems.map((item) => item.id === 'av-old'
      ? { ...item, unitPrice: 600, evidenceId: 'reversal-evidence' }
      : item),
    evidenceSpans: [...lastApproved.evidenceSpans, { id: 'reversal-evidence', excerpt: reversalText, sourceLabel: 'Reversal email' }],
  });
  assert.equal(reversed.approved, true);
  assert.notEqual(reversed.duplicate, true);
  assert.equal(reversed.workspace.vendors[0].quotes.length, 3);
  assert.equal(active(reversed.workspace).revisions?.length, 2);
  assert.equal(active(reversed.workspace).lineItems.find(({ id }) => id === 'av-old')?.unitPrice, 600);
});

test('a different stale draft cannot overwrite a newer approved quote', () => {
  const ws = workspace(original());
  const stale = amendment('q-v1', {
    id: 'different-stale-revision',
    sourceText: 'The AV fee is CAD 275.',
    lineItems: [{ ...amendment().lineItems[0], unitPrice: 275 }],
    evidenceSpans: [{ id: 'ev-1', excerpt: 'The AV fee is CAD 275.', sourceLabel: 'Stale email' }],
  });
  const newer = approve(ws, amendment());
  assert.equal(newer.approved, true);
  const preview = buildQuoteRevisionPreview(newer.workspace, newer.workspace.vendors[0], stale);
  assert.ok(preview);
  assert.equal(preview.stale, true);
  const result = approve(newer.workspace, stale);
  assert.equal(result.approved, false);
  assert.equal(result.workspace, newer.workspace);
  assert.equal(active(result.workspace).revisions?.length, 1);
});

test('a booked venue previews a quote reduction without altering the contract or paid schedule', () => {
  const payments: PaymentMilestone[] = [
    { id: 'deposit', vendorId, vendorName: 'Synthetic Juniper Hall', eventId: reception, label: 'Deposit',
      amount: 2500, dueDate: '2026-11-30', status: 'Paid', paidDate: '2026-11-30', paidBy: 'Test partner',
      reminderEnabled: false },
    { id: 'balance', vendorId, vendorName: 'Synthetic Juniper Hall', eventId: reception, label: 'Balance',
      amount: 16597, dueDate: '2027-07-16', status: 'Upcoming', reminderEnabled: true },
  ];
  const ws = workspace(original(), {
    status: 'Booked', bookedContractTotal: 19097, bookedDate: '2026-11-28',
  }, payments);
  const preview = buildQuoteRevisionPreview(ws, ws.vendors[0], amendment());
  assert.ok(preview);
  assert.equal(preview.preTaxDelta, -300);
  assert.equal(preview.allInDelta, -339);
  assert.equal(preview.projectedDelta, 0);
  assert.equal(preview.bookedContractTotal, 19097);

  const result = approve(ws, amendment());
  assert.equal(result.approved, true);
  assert.equal(result.workspace.vendors[0].status, 'Booked');
  assert.equal(result.workspace.vendors[0].bookedContractTotal, 19097);
  assert.equal(result.workspace.vendors[0].bookedDate, '2026-11-28');
  assert.deepEqual(result.workspace.payments, payments);
  assert.equal(calculateWorkspaceFinancials(result.workspace).projectedSpend, 19097);
  assert.equal(active(result.workspace).lineItems.find(({ id }) => id === 'av-old')?.unitPrice, 300);
});

test('a legacy booking without a locked contract cannot be repriced by approving a revision', () => {
  const ws = workspace(original(), { status: 'Booked' });
  const candidate = amendment();
  const preview = buildQuoteRevisionPreview(ws, ws.vendors[0], candidate);
  assert.ok(preview);
  assert.match(preview.blockingReasons.join(' '), /contract|booking/i);
  assert.equal(preview.projectedDelta, null);

  const result = approve(ws, candidate);
  assert.equal(result.approved, false);
  assert.equal(result.workspace, ws);
});

test('revision preview uses the proposed event headcount while saving a draft keeps the approved scope', () => {
  const originalQuote = original({
    lineItems: [
      { id: 'meal', label: 'Dinner', pricingModel: 'per_person', unitPrice: 100 },
      original().lineItems[1],
    ],
  });
  const ws = workspace(originalQuote);
  const originalEventIds = ws.vendors[0].eventIds;
  const proposedEventIds = ['evt-sangeet'];
  const candidate = amendment();
  const preview = buildQuoteRevisionPreview(ws, ws.vendors[0], candidate, proposedEventIds);
  assert.ok(preview);
  // Reception has 320 guests and Sangeet has 220. The new AV fee saves a further CAD 300.
  assert.equal(preview.preTaxDelta, -10300);
  assert.equal(preview.allInDelta, -11639);
  assert.equal(preview.projectedDelta, -11639);
  assert.deepEqual(ws.vendors[0].eventIds, [reception]);

  const { id, quotes, ...vendorMetadata } = ws.vendors[0];
  const staged = applySaveDraftQuote(ws, id, { ...vendorMetadata, eventIds: proposedEventIds }, candidate, id).workspace;
  assert.deepEqual(staged.vendors[0].eventIds, originalEventIds);
  assert.deepEqual(staged.vendors[0].draftVendorMetadata?.eventIds, proposedEventIds);
  assert.equal(calculateWorkspaceFinancials(staged).projectedSpend, 36838);
});

test('ambiguous wording requires review before replacing an existing charge', () => {
  const prior = original();
  const renamedText = 'Updated sound and projection charge is CAD 300.';
  const incoming = amendment('q-v1', {
    sourceText: renamedText,
    lineItems: [{ ...amendment().lineItems[0], label: 'Sound and projection' }],
    evidenceSpans: [{ id: 'ev-1', excerpt: renamedText, sourceLabel: 'Revised email' }],
  });
  const undecided = reconcileQuoteRevision(prior, incoming);
  const change = undecided.changes.find(({ needsDecision, candidates }) =>
    needsDecision && candidates?.some(({ id }) => id === 'av-old'));
  assert.ok(change);
  assert.ok(undecided.blockingReasons.length > 0);
  assert.equal(undecided.quote.lineItems.find(({ id }) => id === 'av-old')?.unitPrice, 600);

  const accepted = reconcileQuoteRevision(prior, incoming, {
    [change.id]: { action: 'replace', targetId: 'av-old' },
  });
  assert.deepEqual(accepted.blockingReasons, []);
  assert.equal(accepted.quote.lineItems.length, 2);
  assert.equal(accepted.quote.lineItems.find(({ id }) => id === 'av-old')?.unitPrice, 300);
});

test('a partial revision cannot mix a foreign-currency fee with retained prices', () => {
  const ws = workspace(original());
  const incoming = amendment('q-v1', {
    currency: 'USD',
    currencySource: 'explicit_quote',
    sourceText: 'The revised AV fee is USD 300.',
    evidenceSpans: [{ id: 'ev-1', excerpt: 'The revised AV fee is USD 300.', sourceLabel: 'Revised email' }],
  });
  const preview = buildQuoteRevisionPreview(ws, ws.vendors[0], incoming);
  assert.ok(preview);
  assert.match(preview.blockingReasons.join(' '), /currency|currencies/i);
  assert.equal(preview.preTaxDelta, null);
  assert.equal(preview.allInDelta, null);
  assert.equal(preview.projectedDelta, null);
  const result = approve(ws, incoming);
  assert.equal(result.approved, false);
  assert.equal(result.workspace, ws);
});


test('manually amended inclusions and delivery appear in the revision history with financial impact', () => {
  const prior = original({ inclusions: ['Reception hall', 'Projector'], deliveryTerms: ['Gallery in six weeks'] });
  const state = workspace(prior);
  const manual: Quote = {
    ...prior, inclusions: ['Reception hall'], deliveryTerms: ['Gallery in four weeks'],
    revisionDraft: { baselineQuoteId: prior.id, mode: 'manual' },
  };
  const result = approve(state, manual);
  assert.equal(result.approved, true);
  const saved = active(result.workspace);
  assert.deepEqual(saved.inclusions, ['Reception hall']);
  assert.deepEqual(saved.deliveryTerms, ['Gallery in four weeks']);
  const history = saved.revisions?.at(-1);
  assert.match(history?.date ?? '', /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(history?.changes?.some((entry) => entry.field === 'Inclusions' && entry.previous?.includes('Projector')));
  assert.ok(history?.changes?.some((entry) => entry.field === 'Delivery terms' && entry.proposed?.includes('four weeks')));
  assert.equal(history?.projectedDelta, 0);
});

test('manual review may acknowledge saved source warnings without allowing partial imports to clear them', () => {
  const prior = original({ sourceWarnings: ['Confirm AV wording'], sourceWarningsAcknowledged: false });
  const fragment = amendment(prior.id, { sourceWarningsAcknowledged: true });
  assert.equal(reconcileQuoteRevision(prior, fragment).quote.sourceWarningsAcknowledged, false);
  const result = reconcileQuoteRevision(prior, { ...prior, sourceWarningsAcknowledged: true }, {}, 'manual');
  assert.equal(result.quote.sourceWarningsAcknowledged, true);
  assert.deepEqual(result.quote.sourceWarnings, prior.sourceWarnings);
});

test('an imported line scoped to the only vendor event replaces its unscoped legacy equivalent', () => {
  const prior = original();
  const state = workspace(prior);
  const fragment = amendment(prior.id, {
    lineItems: [{ id: 'scoped-av', label: 'AV fee', pricingModel: 'flat', unitPrice: 300, eventId: reception }],
  });
  const preview = buildQuoteRevisionPreview(state, state.vendors[0], fragment);
  assert.equal(preview?.preTaxDelta, -300);
  assert.equal(preview?.blockingReasons.length, 0);
  assert.equal(preview?.quote.lineItems.filter((line) => line.label === 'AV fee').length, 1);
});

test('revised source hours replace a previously confirmed hourly quantity while unchanged hours preserve it', () => {
  const prior = original({
    taxHandling: 'included',
    taxPercent: 0,
    lineItems: [
      { id: 'photo', label: 'Photographer coverage', pricingModel: 'hourly', unitPrice: 100, extractedHours: 2, quantity: 2 },
    ],
  });
  const ws = workspace(prior);

  const fourHours = amendment(prior.id, {
    sourceText: 'Updated photographer coverage is 4 hours at CAD 100/hour.',
    lineItems: [
      { id: 'photo-new', label: 'Photographer coverage', pricingModel: 'hourly', unitPrice: 100, extractedHours: 4 },
    ],
    evidenceSpans: [{ id: 'ev-1', excerpt: '4 hours at CAD 100/hour', sourceLabel: 'Revised email' }],
  });
  const preview = buildQuoteRevisionPreview(ws, ws.vendors[0], fourHours);
  assert.ok(preview);
  assert.equal(preview.proposedCalc.preTaxTotal, 400);
  assert.equal(preview.preTaxDelta, 200);
  assert.equal(preview.quote.lineItems[0].quantity, undefined);
  assert.equal(preview.quote.lineItems[0].extractedHours, 4);

  const manualOverridePrior = original({
    taxHandling: 'included',
    taxPercent: 0,
    lineItems: [
      { id: 'photo', label: 'Photographer coverage', pricingModel: 'hourly', unitPrice: 100, extractedHours: 2, quantity: 3 },
    ],
  });
  const rateOnly = amendment(manualOverridePrior.id, {
    sourceText: 'Hourly rate is now CAD 120/hour.',
    lineItems: [
      { id: 'photo-rate', label: 'Photographer coverage', pricingModel: 'hourly', unitPrice: 120, extractedHours: 2 },
    ],
  });
  const ratePreview = buildQuoteRevisionPreview(workspace(manualOverridePrior), workspace(manualOverridePrior).vendors[0], rateOnly);
  assert.ok(ratePreview);
  assert.equal(ratePreview.proposedCalc.preTaxTotal, 360);
  assert.equal(ratePreview.quote.lineItems[0].quantity, 3);
});

test('revising an hourly overtime override with confirmed mandatory hours clears the stale conditional flag even without prior quantity', () => {
  const prior = original({
    taxHandling: 'included',
    taxPercent: 0,
    lineItems: [
      { id: 'base', label: 'Photography package', pricingModel: 'flat', unitPrice: 900 },
      { id: 'ot', label: 'Additional hourly coverage', pricingModel: 'hourly', unitPrice: 100, isConditionalOvertime: true },
    ],
  });
  const ws = workspace(prior);
  assert.equal(calculateQuoteFinancials(prior, ws.events, [reception]).preTaxTotal, 900);

  const confirmedHours = amendment(prior.id, {
    sourceText: 'Confirmed 4 hours of additional hourly coverage at CAD 100/hour.',
    lineItems: [
      { id: 'ot-new', label: 'Additional hourly coverage', pricingModel: 'hourly', unitPrice: 100, extractedHours: 4, chargeType: 'mandatory' },
    ],
    evidenceSpans: [{ id: 'ev-1', excerpt: 'Confirmed 4 hours of additional hourly coverage at CAD 100/hour.', sourceLabel: 'Revised email' }],
  });
  const preview = buildQuoteRevisionPreview(ws, ws.vendors[0], confirmedHours);
  assert.ok(preview);
  assert.equal(preview.proposedCalc.preTaxTotal, 1300);
  assert.equal(preview.preTaxDelta, 400);
  assert.equal(preview.quote.lineItems.find(({ id }) => id === 'ot')?.isConditionalOvertime, undefined);

  const rateOnly = amendment(prior.id, {
    sourceText: 'Additional hourly coverage rate is now CAD 150/hour.',
    lineItems: [
      { id: 'ot-rate', label: 'Additional hourly coverage', pricingModel: 'hourly', unitPrice: 150 },
    ],
  });
  const ratePreview = buildQuoteRevisionPreview(ws, ws.vendors[0], rateOnly);
  assert.ok(ratePreview);
  assert.equal(ratePreview.proposedCalc.preTaxTotal, 900);
  assert.equal(ratePreview.quote.lineItems.find(({ id }) => id === 'ot')?.isConditionalOvertime, true);
});

test('revising a confirmed mandatory hourly line to conditional overtime clears the mandatory override and quantity', () => {
  const prior = original({
    taxHandling: 'included',
    taxPercent: 0,
    lineItems: [
      { id: 'base', label: 'Photography package', pricingModel: 'flat', unitPrice: 900 },
      {
        id: 'ot',
        label: 'Additional hourly coverage',
        pricingModel: 'hourly',
        unitPrice: 100,
        extractedHours: 2,
        quantity: 2,
        isConditionalOvertime: false,
      },
    ],
  });
  const ws = workspace(prior);
  assert.equal(calculateQuoteFinancials(prior, ws.events, [reception]).preTaxTotal, 1100);

  const conditionalRevision = amendment(prior.id, {
    sourceText: 'Additional hourly coverage is CAD 100/hour only if extra overtime is needed.',
    lineItems: [
      {
        id: 'ot-cond',
        label: 'Additional hourly coverage',
        pricingModel: 'hourly',
        unitPrice: 100,
        extractedHours: 1,
        chargeType: 'conditional',
        sourceExcerpt: 'CAD 100/hour only if extra overtime is needed',
      },
    ],
    evidenceSpans: [{ id: 'ev-1', excerpt: 'CAD 100/hour only if extra overtime is needed', sourceLabel: 'Revised email' }],
  });
  const preview = buildQuoteRevisionPreview(ws, ws.vendors[0], conditionalRevision);
  assert.ok(preview);
  assert.equal(preview.proposedCalc.preTaxTotal, 900);
  assert.equal(preview.preTaxDelta, -200);
  const reconciledLine = preview.quote.lineItems.find(({ id }) => id === 'ot');
  assert.equal(reconciledLine?.isConditionalOvertime, undefined);
  assert.equal(reconciledLine?.quantity, undefined);
  assert.equal(reconciledLine?.chargeType, 'conditional');
});

test('retaining an edited or removed package in a manual revision preserves its scoped fees and selection', () => {
  const avFee = { id: 'pkg-av', label: 'AV fee', pricingModel: 'flat' as const, unitPrice: 300, packageId: 'orchid' };
  const prior = original({
    taxHandling: 'included',
    taxPercent: 0,
    lineItems: [],
    selectedPackageId: 'orchid',
    packages: [
      { id: 'orchid', name: 'Orchid', unitPrice: 1000, pricingModel: 'flat', inclusions: ['Hall'], fees: [avFee] },
      { id: 'cedar', name: 'Cedar', unitPrice: 800, pricingModel: 'flat', inclusions: ['Terrace'], fees: [] },
    ],
  });
  const ws = workspace(prior);

  const manualEdit: Quote = {
    ...prior,
    id: 'q-manual-pkg',
    approvalState: 'draft',
    packages: [
      { ...prior.packages![0], unitPrice: 1200, fees: [{ ...avFee, unitPrice: 350 }] },
      prior.packages![1],
    ],
    revisionDraft: {
      baselineQuoteId: prior.id,
      mode: 'manual',
      decisions: { 'package:orchid': { action: 'retain' } },
    },
  };
  const preview = buildQuoteRevisionPreview(ws, ws.vendors[0], manualEdit);
  assert.ok(preview);
  assert.equal(preview.quote.selectedPackageId, 'orchid');
  assert.equal(preview.quote.packages?.find(({ id }) => id === 'orchid')?.unitPrice, 1000);
  assert.equal(preview.quote.packages?.find(({ id }) => id === 'orchid')?.fees?.length, 1);
  assert.equal(preview.quote.packages?.find(({ id }) => id === 'orchid')?.fees?.[0].unitPrice, 300);
  assert.equal(preview.proposedCalc.preTaxTotal, 1300);
  assert.equal(preview.preTaxDelta, 0);
});

test('approving a saved duplicate revision draft clears the draft, restores status, and unblocks booking without adding a version', () => {
  const ws = workspace(original());
  const first = approve(ws, amendment());
  assert.equal(first.approved, true);
  assert.equal(first.workspace.vendors[0].quotes.length, 2);

  const lastApproved = active(first.workspace);
  const reimported = amendment(lastApproved.id, {
    id: 'q-duplicate-draft',
    lineItems: [{ ...amendment().lineItems[0], id: 'dup-av', evidenceId: 'dup-ev' }],
    evidenceSpans: [{ ...amendment().evidenceSpans[0], id: 'dup-ev' }],
  });
  const drafted = applySaveDraftQuote(first.workspace, vendorId, null, reimported, vendorId).workspace;
  assert.equal(drafted.vendors[0].status, 'Revision pending');
  assert.ok(drafted.vendors[0].draftQuote);
  assert.equal(drafted.tasks.some((t) => t.kind === 'draft_quote' && t.status === 'Open'), true);
  assert.equal(getVendorBookingEligibility(drafted.vendors[0], drafted.events).canBook, false);

  const resolved = approve(drafted, drafted.vendors[0].draftQuote);
  assert.equal(resolved.approved, true);
  assert.equal(resolved.duplicate, true);
  assert.notEqual(resolved.workspace, drafted);
  assert.equal(resolved.workspace.vendors[0].quotes.length, 2);
  assert.equal(active(resolved.workspace).revisions?.length, 1);
  assert.equal(resolved.workspace.vendors[0].draftQuote, undefined);
  assert.equal(resolved.workspace.vendors[0].draftVendorMetadata, undefined);
  assert.equal(resolved.workspace.vendors[0].status, 'Quoted');
  assert.equal(resolved.workspace.tasks.some((t) => t.kind === 'draft_quote' && t.status === 'Open'), false);
  assert.equal(getVendorBookingEligibility(resolved.workspace.vendors[0], resolved.workspace.events).canBook, true);
});

test('partial revision preserves untouched add-on selection while honoring explicit selection and deselection during review', () => {
  const unselectedPrior = original({
    taxHandling: 'included',
    taxPercent: 0,
    addOns: [{ id: 'ao-1', label: 'Uplighting', description: 'Ambient lighting', pricePreTax: 500, selected: false }],
  });
  const wsUnselected = workspace(unselectedPrior);
  const selectIncoming = amendment(unselectedPrior.id, {
    lineItems: [],
    addOns: [{ id: 'ao-new', label: 'Uplighting', description: 'Ambient lighting', pricePreTax: 500, selected: true, selectionConfirmed: true }],
  });
  const selectPreview = buildQuoteRevisionPreview(wsUnselected, wsUnselected.vendors[0], selectIncoming);
  assert.ok(selectPreview);
  assert.equal(selectPreview.quote.addOns[0].selected, true);
  assert.equal(selectPreview.quote.addOns[0].selectionConfirmed, undefined);
  assert.equal(selectPreview.preTaxDelta, 500);
  const approvedSelect = approve(wsUnselected, selectIncoming);
  assert.equal(approvedSelect.approved, true);
  assert.equal(active(approvedSelect.workspace).addOns[0].selected, true);

  const selectedPrior = original({
    taxHandling: 'included',
    taxPercent: 0,
    addOns: [{ id: 'ao-1', label: 'Uplighting', description: 'Ambient lighting', pricePreTax: 500, selected: true }],
  });
  const wsSelected = workspace(selectedPrior);
  const untouchedImport = amendment(selectedPrior.id, {
    lineItems: [],
    addOns: [{ id: 'ao-new', label: 'Uplighting', description: 'Ambient lighting', pricePreTax: 400, selected: false }],
  });
  const untouchedPreview = buildQuoteRevisionPreview(wsSelected, wsSelected.vendors[0], untouchedImport);
  assert.ok(untouchedPreview);
  assert.equal(untouchedPreview.quote.addOns[0].selected, true);
  assert.equal(untouchedPreview.preTaxDelta, -100);

  const explicitDeselect = amendment(selectedPrior.id, {
    lineItems: [],
    addOns: [{ id: 'ao-new', label: 'Uplighting', description: 'Ambient lighting', pricePreTax: 400, selected: false, selectionConfirmed: true }],
  });
  const deselectPreview = buildQuoteRevisionPreview(wsSelected, wsSelected.vendors[0], explicitDeselect);
  assert.ok(deselectPreview);
  assert.equal(deselectPreview.quote.addOns[0].selected, false);
  assert.equal(deselectPreview.preTaxDelta, -500);
  const approvedDeselect = approve(wsSelected, explicitDeselect);
  assert.equal(approvedDeselect.approved, true);
  assert.equal(active(approvedDeselect.workspace).addOns[0].selected, false);
});
