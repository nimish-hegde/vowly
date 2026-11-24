import assert from 'node:assert/strict';
import test from 'node:test';
import {
  approveQuote,
  correctCurrency,
  correctLineItem,
  createBudgetState,
  createReviewSession,
  dismissQuote,
  getUnresolvedQuestionCount,
  resolveOpenQuestion,
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

test('pending edits and resolved questions do not change budget until explicit approval', () => {
  const telemetry = new TelemetryTracker();
  let budget = createBudgetState();
  const session = createReviewSession('q-1', sampleQuote, { guestCount: 180 });

  // Before approval, budget stays 0
  assert.equal(budget.committedTotal, 0);
  assert.equal(session.calculation.knownSubtotal, 10500);
  assert.equal(getUnresolvedQuestionCount(session), 2);

  // User corrects AV fee from 600 to 300 and confirms currency as CAD
  correctLineItem(session, 1, { amount: 300 });
  correctCurrency(session, 'CAD');
  resolveOpenQuestion(session, 0, 'Confirmed CAD over email');

  assert.equal(session.calculation.knownSubtotal, 10200);
  assert.equal(session.draftQuote.currency, 'CAD');
  assert.equal(getUnresolvedQuestionCount(session), 1);
  assert.equal(budget.committedTotal, 0); // Still 0 before approval!

  // Approve quote -> now budget updates
  budget = approveQuote(session, budget, telemetry);
  assert.equal(session.status, 'approved');
  assert.equal(budget.committedTotal, 10200);
  assert.equal(budget.approvedQuotes.length, 1);

  const summary = telemetry.getSummary();
  assert.deepEqual(summary.correctionsByField, { amount: 1, currency: 1 });
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
  assert.equal(budget.committedTotal, 0);
  assert.equal(budget.approvedQuotes.length, 0);

  const summary = telemetry.getSummary();
  assert.equal(summary.quotesReviewed, 1);
  assert.equal(summary.quotesApproved, 0);
  assert.equal(summary.quoteApprovalRate, 0);
});
