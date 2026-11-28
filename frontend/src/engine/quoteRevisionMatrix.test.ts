import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoWorkspace } from '../data/demoWorkspace.ts';
import { calculateQuoteFinancials, deriveBookingScheduleDefaults } from './financialCalculator.ts';
import { reconcileQuoteRevision } from './quoteRevision.ts';
import { buildQuoteRevisionPreview } from './revisionPreview.ts';
import { applyApproveQuote } from '../store/workspaceTransitions.ts';
import type {
  Quote, QuoteConflict, QuoteLineItem, QuotePackageOption, RevisionDecision, Vendor, WeddingWorkspace,
} from '../types/vowly.ts';

/**
 * Reconciliation matrix for partial quote revisions.
 *
 * Every row applies one incoming fragment to an approved quote and asserts the field-level outcome, then
 * re-checks the lifecycle invariants shared by all rows:
 *   - the preview and the approved quote price identically,
 *   - the previous approved version is never mutated,
 *   - replaying the same fragment after a reload is a no-op,
 *   - optional follow-up fragments (reverse transitions) land on the expected result.
 */

const reception = 'evt-reception';
const vendorId = 'matrix-vendor';
const contract = 10000;
type Preview = NonNullable<ReturnType<typeof buildQuoteRevisionPreview>>;

function base(overrides: Partial<Quote> = {}): Quote {
  return {
    id: 'm-v1', title: 'Matrix quote', approvalState: 'approved', quoteKind: 'personalized',
    receivedDate: '2026-11-24', sourceType: 'pasted_message', sourceChannel: 'Email',
    sourceText: 'Matrix baseline quote.', currency: 'CAD', currencySource: 'explicit_quote',
    taxHandling: 'excluded_plus_hst', taxPercent: 13,
    lineItems: [{ id: 'hall', label: 'Hall rental', pricingModel: 'flat', unitPrice: 900 }],
    addOns: [], unconfirmedFees: [], conflicts: [], inclusions: [], paymentTermsSummary: '',
    clarificationQuestions: [], evidenceSpans: [], ...overrides,
  };
}

function fragment(
  prior: Quote, text: string, overrides: Partial<Quote> = {}, decisions?: Record<string, RevisionDecision>,
): Quote {
  return base({
    id: 'frag-' + text.replace(/\W+/g, '-'), approvalState: 'draft', sourceText: text,
    currency: 'UNKNOWN', currencySource: 'unknown', taxHandling: 'unspecified', taxPercent: undefined,
    lineItems: [], paymentTermsSummary: '',
    revisionDraft: { baselineQuoteId: prior.id, mode: 'partial', decisions },
    ...overrides,
  });
}

function workspace(prior: Quote): WeddingWorkspace {
  const vendor: Vendor = {
    id: vendorId, name: 'Matrix Hall', category: 'venue', eventIds: [reception], location: '',
    contactName: '', contactEmail: '', contactPhone: '', status: 'Quoted', isPreferred: true, notes: '',
    quotes: [prior], activeQuoteId: prior.id,
  };
  return { ...createDemoWorkspace(), vendors: [vendor], payments: [], activities: [], tasks: [], manualExpenses: [] };
}

function active(ws: WeddingWorkspace): Quote {
  const vendor = ws.vendors[0];
  const quote = vendor.quotes.find(({ id }) => id === vendor.activeQuoteId);
  assert.ok(quote);
  return quote;
}

const price = (quote: Quote, ws: WeddingWorkspace) => calculateQuoteFinancials(quote, ws.events, [reception]);
const hall = (unitPrice: number): QuoteLineItem[] => [{ id: 'hall-new', label: 'Hall rental', pricingModel: 'flat', unitPrice }];
const depositOf = (quote: Quote) => deriveBookingScheduleDefaults(quote, createDemoWorkspace().events, [reception], contract).depositAmount;

interface Step {
  text: string;
  overrides: (applied: Quote) => Partial<Quote>;
  check: (preview: Preview, ws: WeddingWorkspace) => void;
}
interface Row {
  name: string;
  prior: Quote;
  text: string;
  overrides: Partial<Quote>;
  decisions?: Record<string, RevisionDecision>;
  blocked?: boolean;
  check: (preview: Preview, ws: WeddingWorkspace) => void;
  then?: Step[];
}

function exercise(ws: WeddingWorkspace, incoming: Quote) {
  const preview = buildQuoteRevisionPreview(ws, ws.vendors[0], incoming);
  assert.ok(preview);
  return { preview, result: applyApproveQuote(ws, vendorId, null, incoming, vendorId) };
}

function run(row: Row) {
  const ws = workspace(row.prior);
  const incoming = fragment(row.prior, row.text, row.overrides, row.decisions);
  const { preview, result } = exercise(ws, incoming);
  row.check(preview, ws);
  if (row.blocked) {
    assert.ok(preview.blockingReasons.length > 0, 'a blocked row must surface a blocker');
    assert.equal(result.approved, false);
    assert.equal(result.workspace, ws);
    return;
  }
  assert.deepEqual(preview.blockingReasons, []);
  assert.equal(result.approved, true);
  assert.notEqual(result.duplicate, true, 'the row must change the approved quote');

  const saved = active(result.workspace);
  const calc = price(saved, result.workspace);
  assert.equal(calc.preTaxTotal, preview.proposedCalc.preTaxTotal, 'approval prices like the preview (pre-tax)');
  assert.equal(calc.estimatedAllInTotal, preview.proposedCalc.estimatedAllInTotal, 'approval prices like the preview (all-in)');
  assert.equal(calc.isEstimateComplete, preview.proposedCalc.isEstimateComplete);
  assert.deepEqual(result.workspace.vendors[0].quotes[0], row.prior, 'the previous approved version is immutable');

  const reloaded: WeddingWorkspace = JSON.parse(JSON.stringify(result.workspace));
  const replay = applyApproveQuote(reloaded, vendorId, null, incoming, vendorId);
  assert.equal(replay.duplicate, true, 'replay after reload is a no-op');
  assert.equal(replay.workspace.vendors[0].quotes.length, 2);

  let current = result.workspace;
  for (const step of row.then ?? []) {
    const stepIncoming = fragment(active(current), step.text, step.overrides(active(current)));
    const next = exercise(current, stepIncoming);
    step.check(next.preview, current);
    assert.equal(next.result.approved, true, 'follow-up "' + step.text + '" approves');
    current = next.result.workspace;
  }
}

function table(group: string, rows: Row[]) {
  for (const row of rows) test(group + ': ' + row.name, () => run(row));
}

// ---------------------------------------------------------------------------------------------------------
// Quote-level tax: unknown in the source keeps the confirmed treatment; explicit facts replace it.
// ---------------------------------------------------------------------------------------------------------
const taxRow = (name: string, overrides: Partial<Quote>, allIn: number, extra: Partial<Row> = {}): Row => ({
  name, prior: base(), text: 'tax ' + name, overrides: { lineItems: hall(1000), ...overrides },
  check: (preview) => {
    assert.equal(preview.proposedCalc.preTaxTotal, 1000);
    assert.equal(preview.proposedCalc.estimatedAllInTotal, allIn);
  },
  ...extra,
});

table('quote tax', [
  taxRow('unstated tax keeps the confirmed 13%', { taxHandling: 'unspecified' }, 1130),
  taxRow('restated treatment without a rate keeps the confirmed rate', { taxHandling: 'excluded_plus_hst', taxPercent: null }, 1130),
  taxRow('explicit new rate replaces the old rate', { taxHandling: 'excluded_plus_hst', taxPercent: 15 }, 1150),
  taxRow('tax included clears the stale rate', { taxHandling: 'included' }, 1000, {
    check: (preview) => {
      assert.equal(preview.quote.taxHandling, 'included');
      assert.ok(preview.quote.taxPercent == null);
      assert.equal(preview.proposedCalc.estimatedAllInTotal, 1000);
    },
    then: [{
      text: 'tax restored', overrides: () => ({ lineItems: hall(1001), taxHandling: 'excluded_plus_hst', taxPercent: 13 }),
      check: (preview) => assert.equal(preview.proposedCalc.estimatedAllInTotal, 1131.13),
    }],
  }),
  taxRow('reviewer retaining the previous tax overrides an explicit change', { taxHandling: 'excluded_plus_hst', taxPercent: 15 }, 1130, {
    decisions: { 'quote:tax': { action: 'retain' } },
  }),
  {
    name: 'previously included tax becomes taxable when the source says plus tax',
    prior: base({ taxHandling: 'included', taxPercent: undefined }),
    text: 'tax plus', overrides: { lineItems: hall(1000), taxHandling: 'excluded_plus_hst', taxPercent: 13 },
    check: (preview) => assert.equal(preview.proposedCalc.estimatedAllInTotal, 1130),
  },
]);

// ---------------------------------------------------------------------------------------------------------
// Quote-level gratuity: status, rate and basis move together.
// ---------------------------------------------------------------------------------------------------------
const gratuityPrior = () => base({ gratuityStatus: 'excluded', gratuityPercent: 20, gratuityBasis: 'entire_subtotal' });
const gratuityRow = (
  name: string, overrides: Partial<Quote>, expected: [string | undefined, number | null | undefined, string | undefined],
  extra: Partial<Row> = {},
): Row => ({
  name, prior: gratuityPrior(), text: 'gratuity ' + name, overrides: { lineItems: hall(1000), ...overrides },
  check: (preview) => {
    const { gratuityStatus, gratuityPercent, gratuityBasis } = preview.quote;
    assert.equal(gratuityStatus, expected[0]);
    assert.equal(gratuityPercent ?? undefined, expected[1] ?? undefined);
    assert.equal(gratuityBasis, expected[2]);
  },
  ...extra,
});

table('quote gratuity', [
  gratuityRow('unknown gratuity keeps the confirmed terms', { gratuityStatus: 'unknown' }, ['excluded', 20, 'entire_subtotal']),
  gratuityRow('restated gratuity without a rate keeps the confirmed rate', { gratuityStatus: 'excluded', gratuityPercent: null },
    ['excluded', 20, 'entire_subtotal']),
  gratuityRow('new rate with an unstated basis keeps the confirmed basis',
    { gratuityStatus: 'excluded', gratuityPercent: 18, gratuityBasis: 'unknown' }, ['excluded', 18, 'entire_subtotal']),
  // A food-only base cannot be priced for a hall rental, so the new basis is kept but approval stays blocked.
  gratuityRow('explicit new basis replaces the old basis',
    { gratuityStatus: 'excluded', gratuityPercent: 18, gratuityBasis: 'food_subtotal' }, ['excluded', 18, 'food_subtotal'],
    { blocked: true }),
  gratuityRow('included gratuity clears the stale rate and basis', { gratuityStatus: 'included' }, ['included', undefined, undefined], {
    then: [{
      text: 'gratuity restored',
      overrides: () => ({ lineItems: hall(1001), gratuityStatus: 'excluded', gratuityPercent: 20, gratuityBasis: 'entire_subtotal' }),
      check: (preview) => assert.equal(preview.quote.gratuityPercent, 20),
    }],
  }),
]);

// ---------------------------------------------------------------------------------------------------------
// Package-scoped tax and gratuity.
// ---------------------------------------------------------------------------------------------------------
const orchid = (overrides: Partial<QuotePackageOption> = {}): QuotePackageOption => ({
  id: 'orchid', name: 'Orchid', pricingModel: 'flat', unitPrice: 1000, inclusions: ['Hall'],
  taxHandling: 'excluded_plus_hst', taxPercent: 13, ...overrides,
});
const cedar = (): QuotePackageOption => ({ id: 'cedar', name: 'Cedar', pricingModel: 'flat', unitPrice: 800, inclusions: ['Terrace'] });
const packagePrior = (pkg: Partial<QuotePackageOption> = {}, quote: Partial<Quote> = {}) => base({
  lineItems: [], taxHandling: 'unspecified', taxPercent: undefined, selectedPackageId: 'orchid',
  packages: [orchid(pkg), cedar()], ...quote,
});
const pkgFragment = (pkg: Partial<QuotePackageOption>, quote: Partial<Quote> = {}): Partial<Quote> => ({
  packages: [{ id: 'new-orchid', name: 'Orchid', pricingModel: 'flat', unitPrice: 900, inclusions: [], ...pkg }], ...quote,
});
const packageTaxRow = (name: string, pkg: Partial<QuotePackageOption>, allIn: number, extra: Partial<Row> = {}): Row => ({
  name, prior: packagePrior(), text: 'package tax ' + name, overrides: pkgFragment(pkg),
  check: (preview) => {
    assert.equal(preview.proposedCalc.preTaxTotal, 900);
    assert.equal(preview.proposedCalc.estimatedAllInTotal, allIn);
    assert.equal(preview.quote.packages?.find(({ id }) => id === 'cedar')?.unitPrice, 800, 'the sibling tier is untouched');
  },
  ...extra,
});

table('package tax', [
  packageTaxRow('unstated package tax keeps the confirmed treatment', { taxHandling: 'unspecified' }, 1017),
  packageTaxRow('omitted package tax keeps the confirmed treatment', {}, 1017),
  packageTaxRow('restated treatment without a rate keeps the confirmed rate', { taxHandling: 'excluded_plus_hst', taxPercent: null }, 1017),
  packageTaxRow('explicit new package rate replaces the old rate', { taxHandling: 'excluded_plus_hst', taxPercent: 15 }, 1035),
  packageTaxRow('package tax included clears the stale rate', { taxHandling: 'included' }, 900, {
    then: [{
      text: 'package tax restored',
      overrides: () => pkgFragment({ unitPrice: 901, taxHandling: 'excluded_plus_hst', taxPercent: 13 }),
      check: (preview) => assert.equal(preview.proposedCalc.estimatedAllInTotal, 1018.13),
    }],
  }),
]);

table('package gratuity', [
  {
    name: 'unknown package gratuity keeps the confirmed terms',
    prior: packagePrior({ gratuityStatus: 'excluded', gratuityPercent: 20, gratuityBasis: 'entire_subtotal' }),
    text: 'package gratuity unknown',
    overrides: pkgFragment({ gratuityStatus: 'unknown', gratuityPercent: null }),
    check: (preview) => {
      const pkg = preview.quote.packages?.find(({ id }) => id === 'orchid');
      assert.equal(pkg?.gratuityStatus, 'excluded');
      assert.equal(pkg?.gratuityPercent, 20);
      assert.equal(pkg?.gratuityBasis, 'entire_subtotal');
    },
  },
  {
    name: 'explicit included package gratuity clears the stale rate',
    prior: packagePrior({ gratuityStatus: 'excluded', gratuityPercent: 20, gratuityBasis: 'entire_subtotal' }),
    text: 'package gratuity included',
    overrides: pkgFragment({ gratuityStatus: 'included' }),
    check: (preview) => {
      const pkg = preview.quote.packages?.find(({ id }) => id === 'orchid');
      assert.equal(pkg?.gratuityStatus, 'included');
      assert.ok(pkg?.gratuityPercent == null);
    },
  },
]);

// ---------------------------------------------------------------------------------------------------------
// Hourly rates, confirmed quantities and conditional overtime.
// ---------------------------------------------------------------------------------------------------------
const hourlyLine = (overrides: Partial<QuoteLineItem>): QuoteLineItem => ({
  id: 'ot', label: 'Additional hourly coverage', pricingModel: 'hourly', unitPrice: 100, ...overrides,
});
const withHourly = (overrides: Partial<QuoteLineItem>) => base({ lineItems: [...base().lineItems, hourlyLine(overrides)] });
const hourlyFragment = (overrides: Partial<QuoteLineItem>): Partial<Quote> => ({
  lineItems: [hourlyLine({ id: 'ot-new', ...overrides })],
});
const hourlyRow = (
  name: string, prior: Quote, incoming: Partial<QuoteLineItem>, preTax: number, extra: Partial<Row> = {},
): Row => ({
  name, prior, text: 'hourly ' + name, overrides: hourlyFragment(incoming),
  check: (preview) => assert.equal(preview.proposedCalc.preTaxTotal, preTax),
  ...extra,
});
const confirmedTwoHours = () => withHourly({ quantity: 2, extractedHours: 2, isConditionalOvertime: false, chargeType: 'mandatory' });
const conditionalNoHours = () => withHourly({ isConditionalOvertime: true, chargeType: 'conditional' });
const conditionalWithHours = () => withHourly({ quantity: 3, isConditionalOvertime: true, chargeType: 'conditional' });

table('hourly', [
  hourlyRow('rate-only change keeps the confirmed quantity', confirmedTwoHours(),
    { unitPrice: 120, extractedHours: 2, chargeType: 'mandatory' }, 1140),
  hourlyRow('revised source hours replace the confirmed quantity', confirmedTwoHours(),
    { extractedHours: 4, chargeType: 'mandatory' }, 1300, {
      then: [{
        text: 'hourly hours restored', overrides: () => hourlyFragment({ extractedHours: 2, chargeType: 'mandatory' }),
        check: (preview) => assert.equal(preview.proposedCalc.preTaxTotal, 1100),
      }],
    }),
  hourlyRow('conditional line confirmed as mandatory hours bills them', conditionalNoHours(),
    { extractedHours: 4, chargeType: 'mandatory' }, 1300, {
      then: [{
        text: 'hourly back to conditional', overrides: () => hourlyFragment({ extractedHours: 1, chargeType: 'conditional' }),
        check: (preview) => assert.equal(preview.proposedCalc.preTaxTotal, 900),
      }],
    }),
  hourlyRow('mandatory line restated as conditional stops billing the confirmed hours', confirmedTwoHours(),
    { extractedHours: 1, chargeType: 'conditional' }, 900),
  hourlyRow('noisy single hour on a conditional rate keeps the confirmed overtime quantity', conditionalWithHours(),
    { extractedHours: 1, chargeType: 'conditional' }, 1200),
  hourlyRow('conditional rate change keeps the confirmed overtime quantity', conditionalWithHours(),
    { unitPrice: 150, extractedHours: 1, chargeType: 'conditional' }, 1350),
]);

// ---------------------------------------------------------------------------------------------------------
// Optional add-on selection.
// ---------------------------------------------------------------------------------------------------------
const addOn = (selected: boolean, pricePreTax = 500) =>
  ({ id: 'ao', label: 'Uplighting', description: 'Ambient lighting', pricePreTax, selected });
const addOnRow = (
  name: string, selected: boolean, incoming: { pricePreTax: number; selected: boolean; selectionConfirmed?: boolean },
  preTax: number, selectedAfter: boolean, extra: Partial<Row> = {},
): Row => ({
  name, prior: base({ addOns: [addOn(selected)] }), text: 'add-on ' + name,
  overrides: { addOns: [{ ...addOn(selected), id: 'ao-new', ...incoming }] },
  check: (preview) => {
    assert.equal(preview.proposedCalc.preTaxTotal, preTax);
    assert.equal(preview.quote.addOns[0].selected, selectedAfter);
    assert.equal(preview.quote.addOns[0].selectionConfirmed, undefined, 'review-only state never reaches the saved quote');
  },
  ...extra,
});

table('add-on', [
  addOnRow('untouched unselected add-on stays unselected after a price change', false, { pricePreTax: 400, selected: false }, 900, false),
  addOnRow('untouched selected add-on stays selected after a price change', true, { pricePreTax: 400, selected: false }, 1300, true),
  addOnRow('explicit selection is honored', false, { pricePreTax: 500, selected: true, selectionConfirmed: true }, 1400, true),
  addOnRow('explicit deselection is honored', true, { pricePreTax: 400, selected: false, selectionConfirmed: true }, 900, false, {
    then: [{
      text: 'add-on reselected',
      overrides: () => ({ addOns: [{ ...addOn(false, 400), id: 'ao-again', selected: true, selectionConfirmed: true }] }),
      check: (preview) => assert.equal(preview.proposedCalc.preTaxTotal, 1300),
    }],
  }),
]);

// ---------------------------------------------------------------------------------------------------------
// Confirmed and waived fees survive restated unknowns; explicit facts still win.
// ---------------------------------------------------------------------------------------------------------
const feePrior = (status: 'confirmed_amount' | 'waived_or_included') => base({
  unconfirmedFees: [{
    id: 'bar', label: 'Bartender staffing', description: 'Staffing', mandatory: true, status,
    confirmedAmount: status === 'confirmed_amount' ? 300 : undefined,
  }],
});
const feeFragment = (status: 'unconfirmed' | 'confirmed_amount' | 'waived_or_included', confirmedAmount?: number): Partial<Quote> => ({
  lineItems: hall(1000),
  unconfirmedFees: [{ id: 'bar-new', label: 'Bartender staffing', description: 'Staffing', mandatory: true, status, confirmedAmount }],
});

table('fee', [
  {
    name: 'restated unknown amount keeps the confirmed fee', prior: feePrior('confirmed_amount'), text: 'fee restated',
    overrides: feeFragment('unconfirmed'),
    check: (preview) => {
      assert.equal(preview.proposedCalc.preTaxTotal, 1300);
      assert.equal(preview.quote.unconfirmedFees[0].status, 'confirmed_amount');
    },
  },
  {
    name: 'restated unknown amount keeps the waived fee', prior: feePrior('waived_or_included'), text: 'fee waived restated',
    overrides: feeFragment('unconfirmed'),
    check: (preview) => {
      assert.equal(preview.proposedCalc.preTaxTotal, 1000);
      assert.equal(preview.quote.unconfirmedFees[0].status, 'waived_or_included');
    },
  },
  {
    name: 'explicit new amount replaces the confirmed amount', prior: feePrior('confirmed_amount'), text: 'fee new amount',
    overrides: feeFragment('confirmed_amount', 350),
    check: (preview) => assert.equal(preview.proposedCalc.preTaxTotal, 1350),
  },
  {
    name: 'explicit waiver replaces the confirmed amount', prior: feePrior('confirmed_amount'), text: 'fee newly waived',
    overrides: feeFragment('waived_or_included'),
    check: (preview) => assert.equal(preview.proposedCalc.preTaxTotal, 1000),
    then: [{
      text: 'fee reinstated', overrides: () => feeFragment('confirmed_amount', 300),
      check: (preview) => assert.equal(preview.proposedCalc.preTaxTotal, 1300),
    }],
  },
]);

// ---------------------------------------------------------------------------------------------------------
// Percentage bases, negotiated prices and ambiguity decisions.
// ---------------------------------------------------------------------------------------------------------
const serviceCharge = (overrides: Partial<QuoteLineItem>): QuoteLineItem => ({
  id: 'svc', label: 'Service charge', pricingModel: 'percentage', unitPrice: 15, ...overrides,
});
const percentPrior = (overrides: Partial<QuoteLineItem> = {}) => base({
  lineItems: [...base().lineItems, serviceCharge({ percentageBasis: 'entire_subtotal', ...overrides })],
});
const percentRow = (
  name: string, prior: Quote, incoming: Partial<QuoteLineItem>, preTax: number, basis: string | undefined,
): Row => ({
  name, prior, text: 'percentage ' + name, overrides: { lineItems: [serviceCharge({ id: 'svc-new', ...incoming })] },
  check: (preview) => {
    assert.equal(preview.proposedCalc.preTaxTotal, preTax);
    assert.equal(preview.quote.lineItems.find(({ label }) => label === 'Service charge')?.percentageBasis, basis);
  },
});

table('percentage', [
  percentRow('unknown basis keeps the confirmed basis', percentPrior(), { unitPrice: 18, percentageBasis: 'unknown' }, 1062, 'entire_subtotal'),
  percentRow('omitted basis keeps the confirmed basis', percentPrior(), { unitPrice: 18 }, 1062, 'entire_subtotal'),
  percentRow('unknown basis keeps a confirmed custom amount',
    percentPrior({ percentageBasis: 'custom_amount', customBasisAmount: 2000 }),
    { unitPrice: 10, percentageBasis: 'unknown' }, 1100, 'custom_amount'),
  percentRow('explicit new basis drops the stale custom amount',
    percentPrior({ percentageBasis: 'custom_amount', customBasisAmount: 2000 }),
    { unitPrice: 10, percentageBasis: 'entire_subtotal' }, 990, 'entire_subtotal'),
]);

table('negotiated price', [
  {
    name: 'a new price without a restated original drops the stale negotiated original',
    prior: base({ lineItems: [{ id: 'hall', label: 'Hall rental', pricingModel: 'flat', unitPrice: 900, originalUnitPrice: 1000 }] }),
    text: 'negotiated new price', overrides: { lineItems: hall(800) },
    check: (preview) => {
      assert.equal(preview.quote.lineItems[0].originalUnitPrice, undefined);
      assert.equal(preview.proposedCalc.negotiatedSavings, 0);
    },
  },
  {
    name: 'a restated original keeps the negotiated saving',
    prior: base({ lineItems: [{ id: 'hall', label: 'Hall rental', pricingModel: 'flat', unitPrice: 900, originalUnitPrice: 1000 }] }),
    text: 'negotiated restated',
    overrides: { lineItems: [{ id: 'hall-new', label: 'Hall rental', pricingModel: 'flat', unitPrice: 800, originalUnitPrice: 1000 }] },
    check: (preview) => assert.equal(preview.proposedCalc.negotiatedSavings, 200),
  },
]);

const renamedHall: Partial<Quote> = { lineItems: [{ id: 'hall-setup', label: 'Hall setup', pricingModel: 'flat', unitPrice: 200 }] };
table('reviewer decisions', [
  {
    name: 'an ambiguous charge blocks until the reviewer decides', prior: base(), text: 'ambiguous charge', overrides: renamedHall, blocked: true,
    check: (preview) => assert.ok(preview.changes.some(({ needsDecision }) => needsDecision)),
  },
  {
    name: 'accepting an ambiguous charge adds it without replacing the original', prior: base(), text: 'ambiguous accepted',
    overrides: renamedHall, decisions: { 'cost:hall-setup': { action: 'accept' } },
    check: (preview) => assert.equal(preview.proposedCalc.preTaxTotal, 1100),
  },
  {
    name: 'a manual amount overrides the proposed price', prior: base(), text: 'manual amount', overrides: { lineItems: hall(1000) },
    decisions: { 'cost:hall-new': { action: 'manual', value: '1200' } },
    check: (preview) => assert.equal(preview.proposedCalc.preTaxTotal, 1200),
  },
]);

// ---------------------------------------------------------------------------------------------------------
// Resolved pricing conflicts compare effective prices, at the quote and the package level.
// ---------------------------------------------------------------------------------------------------------
const avConflict = (): QuoteConflict => ({
  id: 'c-av', fieldLabel: 'AV fee', description: 'AV fee differs', targetLineItemId: 'av', resolvedOptionId: 'o300',
  options: [
    { id: 'o600', label: 'Email', sourceLabel: 'Email', amount: 600 },
    { id: 'o300', label: 'Contract', sourceLabel: 'Contract', amount: 300 },
  ],
});
const avLine = (unitPrice: number, packageId?: string): QuoteLineItem =>
  ({ id: 'av', label: 'AV fee', pricingModel: 'flat', unitPrice, packageId });

for (const stored of [600, 300]) {
  table('resolved conflict (top-level, stored ' + stored + ')', [
    {
      name: 'confirming the unselected option replaces the resolved choice',
      prior: base({ lineItems: [...base().lineItems, avLine(stored)], conflicts: [avConflict()] }),
      text: 'conflict top-level 600',
      overrides: { lineItems: [{ ...avLine(600), id: 'av-new' }] },
      check: (preview) => {
        assert.equal(preview.proposedCalc.preTaxTotal, 1500);
        assert.deepEqual(preview.quote.conflicts, []);
      },
      then: [{
        text: 'conflict top-level 300 again', overrides: () => ({ lineItems: [{ ...avLine(300), id: 'av-again' }] }),
        check: (preview) => assert.equal(preview.proposedCalc.preTaxTotal, 1200),
      }],
    },
    {
      name: 'restating the resolved price keeps the choice',
      prior: base({ lineItems: [...base().lineItems, avLine(stored)], conflicts: [avConflict()] }),
      text: 'conflict top-level 300',
      overrides: { lineItems: [{ ...hall(1000)[0] }, { ...avLine(300), id: 'av-new' }] },
      check: (preview) => {
        assert.equal(preview.proposedCalc.preTaxTotal, 1300);
        assert.equal(preview.quote.conflicts.length, 1);
        assert.equal(preview.quote.conflicts[0].resolvedOptionId, 'o300');
      },
    },
  ]);
  table('resolved conflict (package fee, stored ' + stored + ')', [
    {
      name: 'confirming the unselected option replaces the resolved choice',
      prior: packagePrior({ fees: [avLine(stored, 'orchid')] }, { conflicts: [avConflict()] }),
      text: 'conflict package 600',
      overrides: pkgFragment({ unitPrice: 1000, fees: [{ ...avLine(600, 'new-orchid'), id: 'av-new' }] }),
      check: (preview) => {
        assert.equal(preview.proposedCalc.preTaxTotal, 1600);
        assert.deepEqual(preview.quote.conflicts, []);
      },
    },
    {
      name: 'restating the resolved price keeps the choice',
      prior: packagePrior({ fees: [avLine(stored, 'orchid')] }, { conflicts: [avConflict()] }),
      text: 'conflict package 300',
      overrides: pkgFragment({ unitPrice: 1100, fees: [{ ...avLine(300, 'new-orchid'), id: 'av-new' }] }),
      check: (preview) => {
        assert.equal(preview.proposedCalc.preTaxTotal, 1400);
        assert.equal(preview.quote.conflicts[0]?.resolvedOptionId, 'o300');
      },
    },
  ]);
}

// ---------------------------------------------------------------------------------------------------------
// Deposit terms and payment milestones stay consistent with each other.
// ---------------------------------------------------------------------------------------------------------
const paymentPrior = (pkg = false) => {
  const terms = {
    paymentTermsSummary: 'Deposit then balance',
    depositAmount: 2500,
    paymentMilestones: [{ label: 'Deposit', amount: 2500 }, { label: 'Balance', amount: 7500, relativeDaysBeforeEvent: 30 }],
  };
  return pkg
    ? base({ lineItems: [], selectedPackageId: 'orchid', packages: [orchid({ ...terms, taxHandling: undefined, taxPercent: undefined }), cedar()] })
    : base(terms);
};
const paymentRow = (
  name: string, incoming: Partial<Quote> & Partial<QuotePackageOption>, deposit: number, extra: Partial<Row> = {},
): Row => ({
  name, prior: paymentPrior(), text: 'payment ' + name,
  overrides: { depositAmount: undefined, depositPercent: undefined, paymentMilestones: undefined, ...incoming },
  check: (preview) => {
    assert.equal(depositOf(preview.quote), deposit);
    assert.equal(preview.quote.paymentMilestones?.filter(({ label }) => /deposit|retainer/i.test(label)).length, 1,
      'exactly one deposit milestone survives');
    const balance = preview.quote.paymentMilestones?.find(({ label }) => /balance|final/i.test(label));
    assert.equal(balance?.relativeDaysBeforeEvent ?? 30, 30, 'the balance schedule is untouched unless restated');
  },
  ...extra,
});
const restoreDeposit: Step = {
  text: 'payment deposit restored', overrides: () => ({ depositAmount: 2500 }),
  check: (preview) => assert.equal(depositOf(preview.quote), 2500),
};

table('payment', [
  paymentRow('revised deposit percent updates the retained milestone', { depositPercent: 30 }, 3000, { then: [restoreDeposit] }),
  paymentRow('revised deposit amount updates the retained milestone', { depositAmount: 3000 }, 3000, { then: [restoreDeposit] }),
  paymentRow('revised deposit milestone updates the deposit fields', { paymentMilestones: [{ label: 'Deposit', amount: 3500 }] }, 3500, {
    check: (preview) => {
      assert.equal(depositOf(preview.quote), 3500);
      assert.equal(preview.quote.depositAmount, 3500);
    },
  }),
  paymentRow('a renamed deposit milestone amends the existing deposit', { paymentMilestones: [{ label: 'Retainer', amount: 3500 }] }, 3500),
  paymentRow('a restated balance leaves the deposit alone',
    { paymentMilestones: [{ label: 'Balance', relativeDaysBeforeEvent: 14 }] }, 2500, {
      check: (preview) => {
        assert.equal(depositOf(preview.quote), 2500);
        assert.equal(preview.quote.paymentMilestones?.find(({ label }) => label === 'Balance')?.relativeDaysBeforeEvent, 14);
      },
    }),
]);

table('package payment', [
  {
    name: 'revised package deposit percent updates the retained package milestone', prior: paymentPrior(true),
    text: 'package payment percent', overrides: pkgFragment({ unitPrice: 1000, depositPercent: 30 }),
    check: (preview) => assert.equal(depositOf(preview.quote), 3000),
    then: [{
      text: 'package payment restored', overrides: () => pkgFragment({ unitPrice: 1000, depositAmount: 2500 }),
      check: (preview) => assert.equal(depositOf(preview.quote), 2500),
    }],
  },
  {
    name: 'revised package deposit milestone updates the package deposit fields', prior: paymentPrior(true),
    text: 'package payment milestone',
    overrides: pkgFragment({ unitPrice: 1000, paymentMilestones: [{ label: 'Deposit', amount: 3500 }] }),
    check: (preview) => {
      assert.equal(depositOf(preview.quote), 3500);
      assert.equal(preview.quote.packages?.find(({ id }) => id === 'orchid')?.depositAmount, 3500);
    },
  },
]);

// ---------------------------------------------------------------------------------------------------------
// Whole-quote invariants.
// ---------------------------------------------------------------------------------------------------------
test('a fragment that restates only unknowns changes nothing and is treated as already applied', () => {
  const prior = base({
    gratuityStatus: 'excluded', gratuityPercent: 20, gratuityBasis: 'entire_subtotal',
    addOns: [addOn(true)], depositAmount: 2500,
    paymentMilestones: [{ label: 'Deposit', amount: 2500 }],
    unconfirmedFees: [feePrior('confirmed_amount').unconfirmedFees[0]],
    selectedPackageId: 'orchid', packages: [orchid({ taxHandling: 'excluded_plus_hst' }), cedar()],
    lineItems: [...base().lineItems, avLine(600)], conflicts: [avConflict()],
  });
  const ws = workspace(prior);
  const noop = fragment(prior, 'unknowns only', {
    gratuityStatus: 'unknown', gratuityPercent: null,
    packages: [{ id: 'x', name: 'Orchid', pricingModel: 'unknown', unitPrice: null, inclusions: [], taxHandling: 'unspecified', gratuityStatus: 'unknown' }],
    unconfirmedFees: [{ id: 'f', label: 'Bartender staffing', description: '', mandatory: true, status: 'unconfirmed' }],
  });
  const preview = buildQuoteRevisionPreview(ws, ws.vendors[0], noop);
  assert.ok(preview);
  assert.deepEqual(preview.blockingReasons, []);
  assert.equal(preview.duplicate, true);
  assert.equal(preview.preTaxDelta, 0);
  const result = applyApproveQuote(ws, vendorId, null, noop, vendorId);
  assert.equal(result.duplicate, true);
  assert.equal(result.workspace.vendors[0].quotes.length, 1);
  const kept = reconcileQuoteRevision(prior, noop).quote;
  for (const key of ['taxHandling', 'taxPercent', 'gratuityStatus', 'gratuityPercent', 'gratuityBasis', 'selectedPackageId',
    'addOns', 'conflicts', 'depositAmount', 'paymentMilestones'] as const) {
    assert.deepEqual(kept[key], prior[key], key + ' is untouched');
  }
  assert.deepEqual(kept.packages?.map(({ id, unitPrice, taxHandling, taxPercent }) => [id, unitPrice, taxHandling, taxPercent]),
    prior.packages?.map(({ id, unitPrice, taxHandling, taxPercent }) => [id, unitPrice, taxHandling, taxPercent]));
});

test('a confirmed booking keeps its contract, schedule and paid deposit through every matrix transition', () => {
  const prior = base({ lineItems: [...base().lineItems, hourlyLine({ quantity: 2, extractedHours: 2, isConditionalOvertime: false, chargeType: 'mandatory' })] });
  const ws = workspace(prior);
  const payments = [
    { id: 'dep', vendorId, vendorName: 'Matrix Hall', eventId: reception, label: 'Deposit', amount: 2500, dueDate: '2026-11-30',
      status: 'Paid' as const, paidDate: '2026-11-30', paidBy: 'Partner', reminderEnabled: false },
    { id: 'bal', vendorId, vendorName: 'Matrix Hall', eventId: reception, label: 'Balance', amount: 7500, dueDate: '2027-07-16',
      status: 'Upcoming' as const, reminderEnabled: true },
  ];
  const booked: WeddingWorkspace = {
    ...ws, payments, vendors: [{ ...ws.vendors[0], status: 'Booked', bookedContractTotal: 10000, bookedDate: '2026-11-28' }],
  };
  for (const overrides of [
    hourlyFragment({ extractedHours: 4, chargeType: 'mandatory' }),
    { lineItems: hall(1000), taxHandling: 'included' as const },
    { lineItems: hall(1000), depositPercent: 30 },
  ]) {
    const result = applyApproveQuote(booked, vendorId, null, fragment(prior, 'booked ' + JSON.stringify(overrides), overrides), vendorId);
    assert.equal(result.approved, true);
    assert.equal(result.workspace.vendors[0].status, 'Booked');
    assert.equal(result.workspace.vendors[0].bookedContractTotal, 10000);
    assert.deepEqual(result.workspace.payments, payments);
  }
});

// ---------------------------------------------------------------------------------------------------------
// Guest minimums and thresholds survive a re-priced charge unless the source restates them.
// ---------------------------------------------------------------------------------------------------------
const guestRow = (
  name: string, prior: Partial<QuoteLineItem>, incoming: Partial<QuoteLineItem>, preTax: number,
): Row => ({
  name,
  prior: base({ lineItems: [{ id: 'guest', label: 'Dinner', pricingModel: 'per_person', unitPrice: 100, ...prior }] }),
  text: 'guests ' + name,
  overrides: { lineItems: [{ id: 'guest-new', label: 'Dinner', pricingModel: 'per_person', unitPrice: 100, ...incoming }] },
  check: (preview) => assert.equal(preview.proposedCalc.preTaxTotal, preTax),
});

table('guest minimum', [
  guestRow('a new rate keeps the confirmed guest floor', { minGuests: 350 }, { unitPrice: 110 }, 38500),
  guestRow('a restated lower floor yields to the 320 guests attending', { minGuests: 350 }, { unitPrice: 100, minGuests: 300 }, 32000),
]);

const thresholdRow = (name: string, incoming: Partial<QuoteLineItem>, preTax: number): Row => ({
  name,
  prior: base({ lineItems: [{ id: 'extra', label: 'Additional guests', pricingModel: 'per_extra_guest', unitPrice: 50, guestThreshold: 300 }] }),
  text: 'threshold ' + name,
  overrides: { lineItems: [{ id: 'extra-new', label: 'Additional guests', pricingModel: 'per_extra_guest', unitPrice: 50, ...incoming }] },
  check: (preview) => assert.equal(preview.proposedCalc.preTaxTotal, preTax),
});

table('guest threshold', [
  thresholdRow('a new rate keeps the confirmed threshold', { unitPrice: 60 }, 1200),
  thresholdRow('a restated threshold replaces the old one', { unitPrice: 60, guestThreshold: 310 }, 600),
]);

// ---------------------------------------------------------------------------------------------------------
// Package selection is never changed silently.
// ---------------------------------------------------------------------------------------------------------
const selectionFragment = (): Partial<Quote> => ({
  packages: [{ id: 'new-cedar', name: 'Cedar', pricingModel: 'flat', unitPrice: 700, inclusions: [] }],
  selectedPackageId: 'new-cedar',
});

table('package selection', [
  {
    name: 'a source that selects another tier keeps the confirmed tier until the reviewer accepts',
    prior: packagePrior(), text: 'selection carried', overrides: selectionFragment(),
    check: (preview) => {
      assert.equal(preview.quote.selectedPackageId, 'orchid');
      assert.equal(preview.proposedCalc.preTaxTotal, 1000);
      assert.equal(preview.quote.packages?.find(({ id }) => id === 'cedar')?.unitPrice, 700, 'the tier price still amends');
    },
  },
  {
    name: 'accepting the proposed selection switches tier and prices it',
    prior: packagePrior(), text: 'selection accepted', overrides: selectionFragment(),
    decisions: { 'quote:package-selection': { action: 'accept' } },
    check: (preview) => {
      assert.equal(preview.quote.selectedPackageId, 'cedar');
      assert.equal(preview.proposedCalc.preTaxTotal, 700);
    },
    then: [{
      text: 'selection back to orchid',
      overrides: (applied) => ({
        packages: [{ id: 'again', name: 'Orchid', pricingModel: 'flat', unitPrice: 1000, inclusions: [] }],
        selectedPackageId: 'again',
      }),
      check: (preview) => assert.equal(preview.quote.selectedPackageId, 'cedar', 'selection still waits for the reviewer'),
    }],
  },
]);

// ---------------------------------------------------------------------------------------------------------
// Manual quote edits: a typed price supersedes a recorded conflict choice, a re-resolved choice does not.
// ---------------------------------------------------------------------------------------------------------
function runManual(
  name: string, prior: Quote, edit: (quote: Quote) => Quote, preTax: number, check?: (quote: Quote) => void,
) {
  test('manual edit: ' + name, () => {
    const ws = workspace(prior);
    const draft: Quote = {
      ...edit(structuredClone(prior)), id: 'manual-draft', approvalState: 'draft',
      revisionDraft: { baselineQuoteId: prior.id, mode: 'manual' },
    };
    const { preview, result } = exercise(ws, draft);
    assert.deepEqual(preview.blockingReasons, []);
    assert.equal(preview.proposedCalc.preTaxTotal, preTax);
    assert.equal(result.approved, true);
    const saved = active(result.workspace);
    assert.equal(price(saved, result.workspace).preTaxTotal, preTax, 'approval prices like the preview');
    check?.(saved);
  });
}

const conflictLine = () => base({ lineItems: [...base().lineItems, avLine(300)], conflicts: [avConflict()] });
const withLine = (quote: Quote, id: string, patch: Partial<QuoteLineItem>): Quote => ({
  ...quote, lineItems: quote.lineItems.map((line) => line.id === id ? { ...line, ...patch } : line),
});

runManual('a typed price replaces the resolved conflict choice', conflictLine(),
  (quote) => withLine(quote, 'av', { unitPrice: 450 }), 1350, (saved) => assert.deepEqual(saved.conflicts, []));
runManual('re-resolving a conflict keeps the new choice', conflictLine(),
  (quote) => ({
    ...withLine(quote, 'av', { unitPrice: 600 }),
    conflicts: quote.conflicts.map((conflict) => ({ ...conflict, resolvedOptionId: 'o600' })),
  }), 1500, (saved) => assert.equal(saved.conflicts[0]?.resolvedOptionId, 'o600'));
runManual('a typed package-fee price replaces the resolved conflict choice',
  packagePrior({ fees: [avLine(300, 'orchid')] }, { conflicts: [avConflict()] }),
  (quote) => ({
    ...quote,
    packages: quote.packages?.map((pkg) => pkg.id === 'orchid' ? { ...pkg, fees: [avLine(450, 'orchid')] } : pkg),
  }), 1450, (saved) => assert.deepEqual(saved.conflicts, []));
runManual('a confirmed hourly quantity can be edited', confirmedTwoHours(),
  (quote) => withLine(quote, 'ot', { quantity: 3 }), 1200);

// ---------------------------------------------------------------------------------------------------------
// A charge that the source now treats differently (included, or priced instead of TBD) is replaced, not duplicated.
// ---------------------------------------------------------------------------------------------------------
table('charge reclassification', [
  {
    name: 'a priced charge restated as included stops billing without leaving a conflict behind',
    prior: base({ lineItems: [...base().lineItems, avLine(600)], conflicts: [avConflict()] }),
    text: 'av included',
    overrides: { includedPricingItems: [{ label: 'AV fee', sourceExcerpt: 'AV is included in the rental.' }] },
    check: (preview) => {
      assert.equal(preview.proposedCalc.preTaxTotal, 900);
      assert.equal(preview.quote.lineItems.filter(({ label }) => label === 'AV fee').length, 0);
      assert.deepEqual(preview.quote.conflicts, []);
    },
  },
  {
    name: 'an unpriced mandatory fee that now has a price becomes a priced charge exactly once',
    prior: base({
      unconfirmedFees: [{ id: 'bar', label: 'Bartender staffing', description: 'Staffing', mandatory: true, status: 'unconfirmed' }],
    }),
    text: 'bartender priced', overrides: { lineItems: [{ id: 'bar-new', label: 'Bartender staffing', pricingModel: 'flat', unitPrice: 300 }] },
    check: (preview) => {
      assert.equal(preview.proposedCalc.preTaxTotal, 1200);
      assert.equal(preview.quote.unconfirmedFees.length, 0);
      assert.equal(preview.quote.lineItems.filter(({ label }) => label === 'Bartender staffing').length, 1);
    },
  },
]);

// ---------------------------------------------------------------------------------------------------------
// Parent-child financial inheritance: quote -> package -> line items (PR #26 P1s + equivalents).
// ---------------------------------------------------------------------------------------------------------
table('parent-child tax and gratuity inheritance', [
  {
    name: 'quote-wide tax change prompts for confirmation when a retained package has an independent tax override, and reverses cleanly',
    prior: packagePrior({ taxHandling: 'excluded_plus_hst', taxPercent: 13 }, { taxHandling: 'unspecified', taxPercent: undefined }),
    text: 'quote tax blocks independent package override',
    overrides: { taxHandling: 'included' },
    blocked: true,
    check: (preview) => {
      const change = preview.changes.find((c) => c.id === 'package:orchid:tax');
      assert.ok(change?.needsDecision);
      assert.equal(change.scope, 'Orchid');
      assert.equal(change.previous, 'Plus 13% tax');
      assert.equal(change.proposed, 'Tax included');
    },
  },
  {
    name: 'accepting quote-wide tax updates the retained package override and supports reversing back',
    prior: packagePrior({ taxHandling: 'excluded_plus_hst', taxPercent: 13 }, { taxHandling: 'unspecified', taxPercent: undefined }),
    text: 'quote tax accepted for package',
    overrides: { taxHandling: 'included' },
    decisions: { 'package:orchid:tax': { action: 'accept' } },
    check: (preview) => {
      assert.equal(preview.quote.taxHandling, 'included');
      assert.equal(preview.quote.packages?.find(({ id }) => id === 'orchid')?.taxHandling, 'included');
      assert.equal(preview.proposedCalc.estimatedAllInTotal, 1000);
    },
    then: [{
      text: 'quote tax reversed to 13% HST',
      overrides: () => ({ taxHandling: 'excluded_plus_hst', taxPercent: 13 }),
      check: (preview) => {
        assert.equal(preview.quote.packages?.find(({ id }) => id === 'orchid')?.taxHandling, 'excluded_plus_hst');
        assert.equal(preview.quote.packages?.find(({ id }) => id === 'orchid')?.taxPercent, 13);
        assert.equal(preview.proposedCalc.estimatedAllInTotal, 1130);
      },
    }],
  },
  {
    name: 'retaining an independent package tax override preserves it when quote-wide tax changes',
    prior: packagePrior({ taxHandling: 'excluded_plus_hst', taxPercent: 13 }, { taxHandling: 'unspecified', taxPercent: undefined }),
    text: 'quote tax retained for package',
    overrides: { taxHandling: 'included' },
    decisions: { 'package:orchid:tax': { action: 'retain' } },
    check: (preview) => {
      assert.equal(preview.quote.taxHandling, 'included');
      assert.equal(preview.quote.packages?.find(({ id }) => id === 'orchid')?.taxHandling, 'excluded_plus_hst');
      assert.equal(preview.proposedCalc.estimatedAllInTotal, 1130);
    },
  },
  {
    name: 'inherited package tax updates automatically while an independent sibling tier prompts',
    prior: base({
      lineItems: [],
      taxHandling: 'excluded_plus_hst',
      taxPercent: 13,
      selectedPackageId: 'orchid',
      packages: [
        orchid({ taxHandling: 'excluded_plus_hst', taxPercent: 13 }),
        { ...cedar(), taxHandling: 'included', taxPercent: undefined },
      ],
    }),
    text: 'inherited vs independent sibling tax',
    overrides: { taxHandling: 'excluded_plus_hst', taxPercent: 15 },
    decisions: { 'package:cedar:tax': { action: 'retain' } },
    check: (preview) => {
      assert.equal(preview.quote.packages?.find(({ id }) => id === 'orchid')?.taxPercent, 15);
      assert.equal(preview.quote.packages?.find(({ id }) => id === 'cedar')?.taxHandling, 'included');
      assert.equal(preview.proposedCalc.estimatedAllInTotal, 1150);
    },
  },
  {
    name: 'quote-wide gratuity change prompts for independent package gratuity and accepts or retains cleanly',
    prior: packagePrior(
      { taxHandling: 'included', taxPercent: 0, gratuityStatus: 'excluded', gratuityPercent: 18, gratuityBasis: 'entire_subtotal' },
      { taxHandling: 'included', taxPercent: 0, gratuityStatus: 'unknown' },
    ),
    text: 'quote gratuity prompts independent package',
    overrides: { gratuityStatus: 'excluded', gratuityPercent: 20, gratuityBasis: 'entire_subtotal' },
    blocked: true,
    check: (preview) => assert.ok(preview.changes.some((c) => c.id === 'package:orchid:gratuity' && c.needsDecision)),
  },
  {
    name: 'accepting quote-wide gratuity updates independent package gratuity and reverses',
    prior: packagePrior(
      { taxHandling: 'included', taxPercent: 0, gratuityStatus: 'excluded', gratuityPercent: 18, gratuityBasis: 'entire_subtotal' },
      { taxHandling: 'included', taxPercent: 0, gratuityStatus: 'unknown' },
    ),
    text: 'quote gratuity accepted for package',
    overrides: { gratuityStatus: 'excluded', gratuityPercent: 20, gratuityBasis: 'entire_subtotal' },
    decisions: { 'package:orchid:gratuity': { action: 'accept' } },
    check: (preview) => {
      assert.equal(preview.quote.packages?.find(({ id }) => id === 'orchid')?.gratuityPercent, 20);
      assert.equal(preview.proposedCalc.estimatedAllInTotal, 1200);
    },
    then: [{
      text: 'quote gratuity reversed to 18%',
      overrides: () => ({ gratuityStatus: 'excluded', gratuityPercent: 18, gratuityBasis: 'entire_subtotal' }),
      check: (preview) => {
        assert.equal(preview.quote.packages?.find(({ id }) => id === 'orchid')?.gratuityPercent, 18);
        assert.equal(preview.proposedCalc.estimatedAllInTotal, 1180);
      },
    }],
  },
]);

table('parent-child minimum, threshold, and coverage-hour inheritance', [
  {
    name: 'changing quote minGuests propagates to inherited per-person line items and reverses',
    prior: base({
      taxHandling: 'included',
      taxPercent: 0,
      minGuests: 250,
      lineItems: [{ id: 'dinner', label: 'Dinner', pricingModel: 'per_person', unitPrice: 100, minGuests: 250 }],
    }),
    text: 'minGuests 250 to 350',
    overrides: { minGuests: 350 },
    check: (preview) => {
      assert.equal(preview.quote.lineItems[0].minGuests, 350);
      assert.equal(preview.proposedCalc.preTaxTotal, 35000);
    },
    then: [{
      text: 'minGuests reversed 350 to 250',
      overrides: () => ({ minGuests: 250 }),
      check: (preview) => {
        assert.equal(preview.quote.lineItems[0].minGuests, 250);
        assert.equal(preview.proposedCalc.preTaxTotal, 32000);
      },
    }],
  },
  {
    name: 'changing quote minGuests preserves an independent line-item minimum override',
    prior: base({
      taxHandling: 'included',
      taxPercent: 0,
      minGuests: 250,
      lineItems: [{ id: 'dinner', label: 'Dinner', pricingModel: 'per_person', unitPrice: 100, minGuests: 340 }],
    }),
    text: 'independent item minGuests preserved',
    overrides: { minGuests: 350 },
    check: (preview) => {
      assert.equal(preview.quote.minGuests, 350);
      assert.equal(preview.quote.lineItems[0].minGuests, 340);
      assert.equal(preview.proposedCalc.preTaxTotal, 34000);
    },
  },
  {
    name: 'changing package minGuests propagates to inherited package fees while preserving independent fee minimums',
    prior: packagePrior(
      {
        pricingModel: 'flat',
        unitPrice: 0,
        minGuests: 250,
        taxHandling: 'included',
        taxPercent: 0,
        fees: [
          { id: 'pkg-dinner', label: 'Banquet dinner', pricingModel: 'per_person', unitPrice: 100, minGuests: 250, packageId: 'orchid' },
          { id: 'pkg-late', label: 'Late snack', pricingModel: 'per_person', unitPrice: 10, minGuests: 330, packageId: 'orchid' },
        ],
      },
      { taxHandling: 'included', taxPercent: 0 },
    ),
    text: 'package minGuests updates inherited fee only',
    overrides: pkgFragment({ unitPrice: 0, minGuests: 350 }),
    check: (preview) => {
      const fees = preview.quote.packages?.find(({ id }) => id === 'orchid')?.fees ?? [];
      assert.equal(fees.find(({ id }) => id === 'pkg-dinner')?.minGuests, 350);
      assert.equal(fees.find(({ id }) => id === 'pkg-late')?.minGuests, 330);
      assert.equal(preview.proposedCalc.preTaxTotal, 38300);
    },
  },
  {
    name: 'changing quote minGuests updates inherited per_extra_guest threshold and reverses while preserving independent thresholds',
    prior: base({
      taxHandling: 'included',
      taxPercent: 0,
      minGuests: 250,
      lineItems: [
        { id: 'extra-inh', label: 'Extra meal', pricingModel: 'per_extra_guest', unitPrice: 50, guestThreshold: 250 },
        { id: 'extra-ind', label: 'Extra dessert', pricingModel: 'per_extra_guest', unitPrice: 20, guestThreshold: 300 },
      ],
    }),
    text: 'threshold inheritance',
    overrides: { minGuests: 280 },
    check: (preview) => {
      assert.equal(preview.quote.lineItems.find(({ id }) => id === 'extra-inh')?.guestThreshold, 280);
      assert.equal(preview.quote.lineItems.find(({ id }) => id === 'extra-ind')?.guestThreshold, 300);
      assert.equal(preview.proposedCalc.preTaxTotal, 2400);
    },
    then: [{
      text: 'threshold reversed',
      overrides: () => ({ minGuests: 250 }),
      check: (preview) => {
        assert.equal(preview.quote.lineItems.find(({ id }) => id === 'extra-inh')?.guestThreshold, 250);
        assert.equal(preview.proposedCalc.preTaxTotal, 3900);
      },
    }],
  },
  {
    name: 'changing quote coverage hours updates inherited overtime threshold and flat hours while preserving independent overrides',
    prior: base({
      taxHandling: 'included',
      taxPercent: 0,
      serviceDurationHours: 8,
      lineItems: [
        { id: 'pkg-flat', label: 'Coverage package', pricingModel: 'flat', unitPrice: 2000, extractedHours: 8 },
        {
          id: 'ot-inh',
          label: 'Overtime',
          pricingModel: 'hourly',
          unitPrice: 200,
          includedPackageHours: 8,
          isConditionalOvertime: true,
          chargeType: 'conditional',
        },
        {
          id: 'ot-ind',
          label: 'Assistant overtime',
          pricingModel: 'hourly',
          unitPrice: 100,
          includedPackageHours: 10,
          isConditionalOvertime: true,
          chargeType: 'conditional',
        },
      ],
    }),
    text: 'coverage hours 8 to 6',
    overrides: { serviceDurationHours: 6 },
    check: (preview) => {
      assert.equal(preview.quote.lineItems.find(({ id }) => id === 'pkg-flat')?.extractedHours, 6);
      assert.equal(preview.quote.lineItems.find(({ id }) => id === 'ot-inh')?.includedPackageHours, 6);
      assert.equal(preview.quote.lineItems.find(({ id }) => id === 'ot-ind')?.includedPackageHours, 10);
    },
    then: [{
      text: 'coverage hours reversed 6 to 8',
      overrides: () => ({ serviceDurationHours: 8 }),
      check: (preview) => {
        assert.equal(preview.quote.lineItems.find(({ id }) => id === 'pkg-flat')?.extractedHours, 8);
        assert.equal(preview.quote.lineItems.find(({ id }) => id === 'ot-inh')?.includedPackageHours, 8);
      },
    }],
  },
]);

test('exact PR #26 P1 guest-minimum reproduction: 150 guests with venue minGuests 100 -> 200 totals 20,000', () => {
  const baseWs = workspace(base({
    taxHandling: 'included',
    taxPercent: 0,
    minGuests: 100,
    lineItems: [{ id: 'dinner', label: 'Dinner', pricingModel: 'per_person', unitPrice: 100, minGuests: 100 }],
  }));
  const ws150: WeddingWorkspace = {
    ...baseWs,
    events: baseWs.events.map((evt) => evt.id === reception ? { ...evt, guestCount: 150 } : evt),
  };
  const prior = active(ws150);
  const incoming = fragment(prior, 'venue minimum 200', { minGuests: 200 });
  const { preview, result } = exercise(ws150, incoming);
  assert.deepEqual(preview.blockingReasons, []);
  assert.equal(preview.proposedCalc.preTaxTotal, 20000);
  assert.equal(result.approved, true);
  assert.equal(price(active(result.workspace), result.workspace).preTaxTotal, 20000);
});

// ---------------------------------------------------------------------------------------------------------
// Coupled gratuity/service-charge lines, package payment terms, and milestone deadline transitions.
// ---------------------------------------------------------------------------------------------------------
table('coupled service-charge line and package payment confirmation', [
  {
    name: 'revised quote gratuity blocks when a retained percentage service-charge line exists',
    prior: base({
      taxHandling: 'included',
      taxPercent: 0,
      gratuityStatus: 'excluded',
      gratuityPercent: 18,
      gratuityBasis: 'entire_subtotal',
      lineItems: [
        { id: 'food', label: 'Banquet dinner', pricingModel: 'flat', unitPrice: 1000, isFoodItem: true },
        { id: 'svc', label: 'Service charge', pricingModel: 'percentage', unitPrice: 18, percentageBasis: 'entire_subtotal' },
      ],
    }),
    text: 'gratuity 18 to 20 blocked by service charge line',
    overrides: { gratuityStatus: 'excluded', gratuityPercent: 20, gratuityBasis: 'entire_subtotal' },
    blocked: true,
    check: (preview) => assert.ok(preview.changes.some((c) => c.id === 'gratuity-line:svc' && c.needsDecision)),
  },
  {
    name: 'accepting revised gratuity removes the superseded service-charge line and bills the new 20% rate',
    prior: base({
      taxHandling: 'included',
      taxPercent: 0,
      gratuityStatus: 'excluded',
      gratuityPercent: 18,
      gratuityBasis: 'entire_subtotal',
      lineItems: [
        { id: 'food', label: 'Banquet dinner', pricingModel: 'flat', unitPrice: 1000, isFoodItem: true },
        { id: 'svc', label: 'Service charge', pricingModel: 'percentage', unitPrice: 18, percentageBasis: 'entire_subtotal' },
      ],
    }),
    text: 'gratuity 18 to 20 accepted',
    overrides: { gratuityStatus: 'excluded', gratuityPercent: 20, gratuityBasis: 'entire_subtotal' },
    decisions: { 'gratuity-line:svc': { action: 'accept' } },
    check: (preview) => {
      assert.equal(preview.quote.lineItems.some(({ id }) => id === 'svc'), false);
      assert.equal(preview.quote.gratuityPercent, 20);
      assert.equal(preview.proposedCalc.estimatedAllInTotal, 1200);
    },
  },
  {
    name: 'retaining the service-charge line preserves 18% without double-counting',
    prior: base({
      taxHandling: 'included',
      taxPercent: 0,
      gratuityStatus: 'excluded',
      gratuityPercent: 18,
      gratuityBasis: 'entire_subtotal',
      lineItems: [
        { id: 'food', label: 'Banquet dinner', pricingModel: 'flat', unitPrice: 1000, isFoodItem: true },
        { id: 'svc', label: 'Service charge', pricingModel: 'percentage', unitPrice: 18, percentageBasis: 'entire_subtotal' },
      ],
    }),
    text: 'gratuity 18 retained',
    overrides: { lineItems: [{ id: 'food-new', label: 'Banquet dinner', pricingModel: 'flat', unitPrice: 1000, isFoodItem: true }], gratuityStatus: 'excluded', gratuityPercent: 20, gratuityBasis: 'entire_subtotal' },
    decisions: { 'gratuity-line:svc': { action: 'retain' } },
    check: (preview) => {
      assert.equal(preview.quote.lineItems.some(({ id }) => id === 'svc'), true);
      assert.equal(preview.quote.gratuityPercent, 18);
      assert.equal(preview.proposedCalc.estimatedAllInTotal, 1180);
    },
    blocked: false,
  },
  {
    name: 'quote-wide deposit change blocks when a retained package has its own payment terms',
    prior: paymentPrior(true),
    text: 'quote deposit blocked by package payment',
    overrides: { depositPercent: 30 },
    blocked: true,
    check: (preview) => assert.ok(preview.changes.some((c) => c.id === 'package:orchid:payment' && c.needsDecision)),
  },
  {
    name: 'accepting quote-wide deposit updates the retained package payment terms and reverses cleanly',
    prior: paymentPrior(true),
    text: 'quote deposit accepted for package',
    overrides: { depositPercent: 30 },
    decisions: { 'package:orchid:payment': { action: 'accept' } },
    check: (preview) => {
      assert.equal(depositOf(preview.quote), 3000);
      assert.equal(preview.quote.packages?.find(({ id }) => id === 'orchid')?.depositPercent, 30);
    },
    then: [{
      text: 'package deposit reversed to 2500',
      overrides: () => pkgFragment({ unitPrice: 1000, depositAmount: 2500 }),
      check: (preview) => assert.equal(depositOf(preview.quote), 2500),
    }],
  },
  {
    name: 'retaining package payment terms keeps the $2,500 package deposit when quote deposit changes',
    prior: paymentPrior(true),
    text: 'quote deposit retained for package',
    overrides: { depositPercent: 30 },
    decisions: { 'package:orchid:payment': { action: 'retain' } },
    check: (preview) => {
      assert.equal(depositOf(preview.quote), 2500);
      assert.equal(preview.quote.packages?.find(({ id }) => id === 'orchid')?.depositAmount, 2500);
    },
  },
]);

test('textual milestone deadline clears stale calendar dueDate and reverses cleanly', () => {
  const prior = base({
    paymentTermsSummary: 'Deposit due August 13, 2027',
    depositAmount: 2500,
    paymentMilestones: [{ label: 'Deposit', amount: 2500, dueDate: '2027-08-13' }],
  });
  const ws = workspace(prior);
  const toTextual = fragment(prior, 'deposit upon signing', {
    paymentMilestones: [{ label: 'Deposit', amount: 2500, relativeDeadlineText: 'Upon signing' }],
  });
  const { preview, result } = exercise(ws, toTextual);
  assert.deepEqual(preview.blockingReasons, []);
  assert.equal(result.approved, true);
  const saved = active(result.workspace);
  assert.equal(saved.paymentMilestones?.[0].dueDate, undefined);
  assert.equal(saved.paymentMilestones?.[0].relativeDeadlineText, 'Upon signing');
  const defaults = deriveBookingScheduleDefaults(saved, ws.events, [reception], contract);
  assert.equal(defaults.depositHasKnownDate, false);
  assert.equal(defaults.depositDate, '');
  assert.equal(defaults.depositRelativeLabel, 'Upon signing');

  const backToDate = fragment(saved, 'deposit due 2027-08-13', {
    paymentMilestones: [{ label: 'Deposit', amount: 2500, dueDate: '2027-08-13' }],
  });
  const reversed = exercise(result.workspace, backToDate);
  assert.equal(reversed.result.approved, true);
  const savedReversed = active(reversed.result.workspace);
  assert.equal(savedReversed.paymentMilestones?.[0].dueDate, '2027-08-13');
  assert.equal(savedReversed.paymentMilestones?.[0].relativeDeadlineText, undefined);
  const reversedDefaults = deriveBookingScheduleDefaults(savedReversed, ws.events, [reception], contract);
  assert.equal(reversedDefaults.depositHasKnownDate, true);
  assert.equal(reversedDefaults.depositDate, '2027-08-13');
});
