import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acknowledgeSourceWarnings,
  approveQuote,
  correctCurrency,
  correctLineItem,
  createBudgetState,
  createReviewSession,
  dismissQuote,
  getApprovalBlockers,
  getUnresolvedQuestionCount,
  resolveOpenQuestion,
  resolvePriceConflict,
} from './review.ts';
import { TelemetryTracker } from './telemetry.ts';
import type { ExtractedQuote } from './types.ts';

const sampleQuote: ExtractedQuote = {
  vendorName: 'Summit Banquet Hall',
  category: 'venue',
  events: ['Reception'],
  quoteKind: 'initial',
  currency: 'UNKNOWN',
  taxStatus: 'unknown',
  gratuityStatus: 'unknown',
  venueDetails: { minGuests: 180 },
  lineItems: [
    {
      label: 'Catering package',
      pricingType: 'per_person',
      amount: 55,
      minGuests: 180,
      sourceExcerpt: '$55/person with a 180-person minimum',
    },
    {
      label: 'AV fee',
      pricingType: 'flat',
      amount: 600,
      sourceExcerpt: 'AV is $600',
    },
    {
      label: 'Bartender fee',
      pricingType: 'unknown',
      amount: null,
      sourceExcerpt: 'Bartender fee TBD',
    },
  ],
  openQuestions: [
    {
      question: 'Confirm currency (CAD or USD)',
      reason: 'ambiguous_rule',
      sourceExcerpt: '$55/person with a 180-person minimum',
    },
    {
      question: 'Confirm bartender fee',
      reason: 'missing_price',
      sourceExcerpt: 'Bartender fee TBD',
    },
  ],
};

const resolvedSampleQuote: ExtractedQuote = {
  ...sampleQuote,
  currency: 'CAD',
  lineItems: sampleQuote.lineItems.slice(0, 2),
};

test('pending edits and resolved questions do not change budget until explicit approval', () => {
  const telemetry = new TelemetryTracker();
  let budget = createBudgetState();
  const session = createReviewSession('q-1', sampleQuote, { guestCount: 180 });

  // Before approval, budget stays empty
  assert.deepEqual(budget.committedTotals, {});
  assert.equal(session.calculation.knownSubtotal, 10500);
  assert.equal(getUnresolvedQuestionCount(session), 2);

  // User corrects AV fee from 600 to 300, confirms currency as CAD, and prices the TBD bartender fee
  correctLineItem(session, 1, { amount: 300 });
  correctCurrency(session, 'CAD');
  resolveOpenQuestion(session, 0, 'Confirmed CAD over email');

  // Still blocked because mandatory Bartender fee is TBD
  assert.throws(() => approveQuote(session, budget, telemetry), /mandatory TBD costs/i);
  assert.equal(session.status, 'pending_review');
  assert.deepEqual(budget.committedTotals, {});

  // Once the bartender fee is priced, approval succeeds
  correctLineItem(session, 2, { pricingType: 'flat', amount: 500 });
  assert.equal(session.calculation.knownSubtotal, 10700);
  assert.equal(session.draftQuote.currency, 'CAD');
  assert.equal(getUnresolvedQuestionCount(session), 1);
  assert.deepEqual(budget.committedTotals, {}); // Still empty before approval!

  // Approve quote -> now budget updates
  budget = approveQuote(session, budget, telemetry);
  assert.equal(session.status, 'approved');
  assert.deepEqual(budget.committedTotals, { CAD: 10700 });
  assert.equal(budget.approvedQuotes.length, 1);

  const summary = telemetry.getSummary();
  assert.deepEqual(summary.correctionsByField, { amount: 2, currency: 1, pricingType: 1 });
  assert.equal(summary.unresolvedQuestions, 1);
  assert.equal(summary.quotesApproved, 1);
  assert.equal(summary.quoteApprovalRate, 1);
});

test('dismissing a quote leaves wedding budget untouched and records telemetry', () => {
  const telemetry = new TelemetryTracker();
  let budget = createBudgetState();
  const session = createReviewSession('q-2', sampleQuote, { guestCount: 180 });

  budget = dismissQuote(session, budget, telemetry);
  assert.equal(session.status, 'dismissed');
  assert.deepEqual(budget.committedTotals, {});
  assert.equal(budget.approvedQuotes.length, 0);

  const summary = telemetry.getSummary();
  assert.equal(summary.quotesReviewed, 1);
  assert.equal(summary.quotesApproved, 0);
  assert.equal(summary.quoteApprovalRate, 0);
});

test('approved quotes in different currencies keep separate totals', () => {
  let budget = createBudgetState();
  const cad = createReviewSession('q-cad', { ...resolvedSampleQuote, currency: 'CAD' }, { guestCount: 180 });
  const usd = createReviewSession('q-usd', { ...resolvedSampleQuote, currency: 'USD' }, { guestCount: 180 });
  budget = approveQuote(cad, budget);
  budget = approveQuote(usd, budget);
  assert.deepEqual(budget.committedTotals, { CAD: 10500, USD: 10500 });
});

test('a quote with UNKNOWN currency cannot be approved into the budget', () => {
  const budget = createBudgetState();
  const session = createReviewSession(
    'q-unknown',
    { ...resolvedSampleQuote, currency: 'UNKNOWN' },
    { guestCount: 180 },
  );
  assert.equal(getApprovalBlockers(session).length, 1);
  assert.throws(() => approveQuote(session, budget), /currency/);
  assert.equal(session.status, 'pending_review');

  correctCurrency(session, 'CAD');
  const updated = approveQuote(session, budget);
  assert.deepEqual(updated.committedTotals, { CAD: 10500 });
});

test('unsupported source excerpts block approval until the couple checks them', () => {
  const budget = createBudgetState();
  const session = createReviewSession(
    'q-src',
    resolvedSampleQuote,
    { guestCount: 180, sourceWarnings: ['lineItems[1].sourceExcerpt not found in raw message'] },
  );
  assert.throws(() => approveQuote(session, budget), /source excerpts/);
  acknowledgeSourceWarnings(session);
  const updated = approveQuote(session, budget);
  assert.equal(session.status, 'approved');
  assert.equal(updated.approvedQuotes.length, 1);
});

test('mandatory TBD costs block approval until priced or marked optional', () => {
  const budget = createBudgetState();
  const session = createReviewSession(
    'q-tbd',
    { ...sampleQuote, currency: 'CAD' },
    { guestCount: 180 },
  );
  assert.deepEqual(session.calculation.unknownItems, ['Bartender fee']);
  assert.equal(getApprovalBlockers(session).length, 1);
  assert.throws(() => approveQuote(session, budget), /Bartender fee/);
  assert.equal(session.status, 'pending_review');

  // Marking the TBD fee as optional removes it from mandatory unknown items
  correctLineItem(session, 2, { optionalAddon: true });
  assert.deepEqual(session.calculation.unknownItems, []);
  const updated = approveQuote(session, budget);
  assert.equal(session.status, 'approved');
  assert.deepEqual(updated.committedTotals, { CAD: 10500 });
});

test('price conflict ($3,200 DM vs $3,600 contract) blocks approval and recalculates budget for either choice', () => {
  const photoConflictQuote: ExtractedQuote = {
    vendorName: 'Northstar Studios',
    category: 'photographer',
    events: ['Wedding'],
    quoteKind: 'revision',
    currency: 'CAD',
    taxStatus: 'unknown',
    gratuityStatus: 'unknown',
    paymentTerms: { depositAmount: 800, methodRule: 'unknown', scheduleNotes: '$800 deposit' },
    lineItems: [
      {
        label: 'Full-day wedding coverage',
        pricingType: 'flat',
        amount: 3200,
        chargeType: 'mandatory',
        conflictingOptions: [
          {
            sourceLabel: 'Instagram DM',
            pricingType: 'flat',
            amount: 3200,
            sourceExcerpt: 'In Instagram DM you agreed to $3,200 flat for full-day wedding coverage',
          },
          {
            sourceLabel: 'PDF contract',
            pricingType: 'flat',
            amount: 3600,
            sourceExcerpt: 'the PDF contract sent today says $3,600',
          },
        ],
        sourceExcerpt: 'In Instagram DM you agreed to $3,200 flat for full-day wedding coverage',
      },
    ],
    openQuestions: [
      {
        question: 'Clarify whether $3,200 DM rate or $3,600 PDF contract applies ($400 difference)',
        reason: 'conflict',
        sourceExcerpt:
          'In Instagram DM you agreed to $3,200 flat for full-day wedding coverage, but the PDF contract sent today says $3,600',
      },
    ],
  };

  // Path A: select the $3,200 Instagram DM rate
  let budgetA = createBudgetState();
  const sessionA = createReviewSession('conflict-a', photoConflictQuote);
  assert.equal(sessionA.calculation.knownSubtotal, 3200);
  assert.equal(sessionA.calculation.priceConflicts.length, 1);
  assert.equal(sessionA.calculation.priceConflicts[0]?.discrepancy, 400);
  assert.throws(() => approveQuote(sessionA, budgetA), /conflicting prices/i);
  assert.equal(sessionA.status, 'pending_review');
  assert.deepEqual(budgetA.committedTotals, {});

  resolvePriceConflict(sessionA, 0, 0);
  assert.equal(sessionA.calculation.priceConflicts.length, 0);
  assert.equal(sessionA.calculation.knownSubtotal, 3200);
  budgetA = approveQuote(sessionA, budgetA);
  assert.equal(sessionA.status, 'approved');
  assert.deepEqual(budgetA.committedTotals, { CAD: 3200 });

  // Path B: select the $3,600 PDF contract rate
  let budgetB = createBudgetState();
  const sessionB = createReviewSession('conflict-b', photoConflictQuote);
  assert.throws(() => approveQuote(sessionB, budgetB), /400 difference/);

  resolvePriceConflict(sessionB, 0, 1);
  assert.equal(sessionB.calculation.priceConflicts.length, 0);
  assert.equal(sessionB.calculation.knownSubtotal, 3600);
  budgetB = approveQuote(sessionB, budgetB);
  assert.equal(sessionB.status, 'approved');
  assert.deepEqual(budgetB.committedTotals, { CAD: 3600 });
  assert.equal(sessionB.resolvedPriceConflicts[0]?.chosenSourceLabel, 'PDF contract');
});
