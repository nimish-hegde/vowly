import { calculateQuoteTotal, type QuoteCalculation } from './calculator.ts';
import type { TelemetryTracker } from './telemetry.ts';
import type { CurrencyCode, ExtractedQuote, LineItem, PricingType } from './types.ts';

export interface ResolvedQuestion {
  index: number;
  resolutionNote: string;
  resolvedAt: string;
}

export interface QuoteReviewSession {
  id: string;
  originalQuote: ExtractedQuote;
  draftQuote: ExtractedQuote;
  guestCount?: number;
  hours?: number;
  status: 'pending_review' | 'approved' | 'dismissed';
  correctionsByField: Record<string, number>;
  resolvedQuestions: ResolvedQuestion[];
  calculation: QuoteCalculation;
}

export interface WeddingBudgetState {
  committedTotal: number;
  approvedQuotes: Array<{
    id: string;
    vendorName: string;
    currency: CurrencyCode;
    knownSubtotal: number;
    approvedAt: string;
  }>;
}

export function createBudgetState(): WeddingBudgetState {
  return { committedTotal: 0, approvedQuotes: [] };
}

export function createReviewSession(
  id: string,
  extractedQuote: ExtractedQuote,
  ctx: { guestCount?: number; hours?: number } = {},
): QuoteReviewSession {
  const draftQuote = structuredClone(extractedQuote);
  return {
    id,
    originalQuote: structuredClone(extractedQuote),
    draftQuote,
    guestCount: ctx.guestCount,
    hours: ctx.hours,
    status: 'pending_review',
    correctionsByField: {},
    resolvedQuestions: [],
    calculation: calculateQuoteTotal(draftQuote, ctx),
  };
}

export interface LineItemPatch {
  label?: string;
  pricingType?: PricingType;
  amount?: number | null;
  minGuests?: number;
  ratioGuests?: number;
  optionalAddon?: boolean;
}

export function correctLineItem(
  session: QuoteReviewSession,
  index: number,
  patch: LineItemPatch,
): QuoteReviewSession {
  if (session.status !== 'pending_review') {
    throw new Error('Cannot edit a quote after it has been approved or dismissed.');
  }
  const item = session.draftQuote.lineItems[index];
  if (!item) {
    throw new Error(`Line item index ${index} out of range.`);
  }

  const fields: Array<keyof LineItemPatch> = [
    'label',
    'pricingType',
    'amount',
    'minGuests',
    'ratioGuests',
    'optionalAddon',
  ];

  for (const field of fields) {
    if (patch[field] !== undefined && patch[field] !== item[field]) {
      (item as unknown as Record<string, unknown>)[field] = patch[field];
      session.correctionsByField[field] = (session.correctionsByField[field] ?? 0) + 1;
    }
  }

  session.calculation = calculateQuoteTotal(session.draftQuote, {
    guestCount: session.guestCount,
    hours: session.hours,
  });
  return session;
}

export function correctCurrency(
  session: QuoteReviewSession,
  currency: CurrencyCode,
): QuoteReviewSession {
  if (session.status !== 'pending_review') {
    throw new Error('Cannot edit a quote after it has been approved or dismissed.');
  }
  if (session.draftQuote.currency !== currency) {
    session.draftQuote.currency = currency;
    session.correctionsByField.currency = (session.correctionsByField.currency ?? 0) + 1;
  }
  session.calculation = calculateQuoteTotal(session.draftQuote, {
    guestCount: session.guestCount,
    hours: session.hours,
  });
  return session;
}

export function resolveOpenQuestion(
  session: QuoteReviewSession,
  questionIndex: number,
  resolutionNote: string,
): QuoteReviewSession {
  if (session.status !== 'pending_review') {
    throw new Error('Cannot resolve questions after a quote has been approved or dismissed.');
  }
  if (!session.draftQuote.openQuestions[questionIndex]) {
    throw new Error(`Open question index ${questionIndex} out of range.`);
  }
  if (!session.resolvedQuestions.some((r) => r.index === questionIndex)) {
    session.resolvedQuestions.push({
      index: questionIndex,
      resolutionNote: resolutionNote.trim() || 'Resolved by couple',
      resolvedAt: new Date().toISOString(),
    });
  }
  return session;
}

export function getUnresolvedQuestionCount(session: QuoteReviewSession): number {
  const resolvedSet = new Set(session.resolvedQuestions.map((r) => r.index));
  return session.draftQuote.openQuestions.filter((_, idx) => !resolvedSet.has(idx)).length;
}

export function approveQuote(
  session: QuoteReviewSession,
  budget: WeddingBudgetState,
  telemetry?: TelemetryTracker,
): WeddingBudgetState {
  if (session.status !== 'pending_review') {
    return budget;
  }
  session.status = 'approved';

  const calc = calculateQuoteTotal(session.draftQuote, {
    guestCount: session.guestCount,
    hours: session.hours,
  });
  session.calculation = calc;

  const updatedBudget: WeddingBudgetState = {
    committedTotal: Math.round((budget.committedTotal + calc.knownSubtotal) * 100) / 100,
    approvedQuotes: [
      ...budget.approvedQuotes,
      {
        id: session.id,
        vendorName: session.draftQuote.vendorName,
        currency: session.draftQuote.currency,
        knownSubtotal: calc.knownSubtotal,
        approvedAt: new Date().toISOString(),
      },
    ],
  };

  telemetry?.recordReviewDecision({
    quoteId: session.id,
    decision: 'approved',
    correctionsByField: { ...session.correctionsByField },
    unresolvedQuestionsRemaining: getUnresolvedQuestionCount(session),
  });

  return updatedBudget;
}

export function dismissQuote(
  session: QuoteReviewSession,
  budget: WeddingBudgetState,
  telemetry?: TelemetryTracker,
): WeddingBudgetState {
  if (session.status !== 'pending_review') {
    return budget;
  }
  session.status = 'dismissed';

  telemetry?.recordReviewDecision({
    quoteId: session.id,
    decision: 'dismissed',
    correctionsByField: { ...session.correctionsByField },
    unresolvedQuestionsRemaining: getUnresolvedQuestionCount(session),
  });

  return budget;
}

export type { LineItem };
