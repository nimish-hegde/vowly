import {
  calculateQuoteTotal,
  normalizeConflictingOptions,
  type QuoteCalculation,
} from './calculator.ts';
import type { TelemetryTracker } from './telemetry.ts';
import type {
  ChargeRequirement,
  CurrencyCode,
  ExtractedQuote,
  LineItem,
  PricingType,
} from './types.ts';

export interface ResolvedQuestion {
  index: number;
  resolutionNote: string;
  resolvedAt: string;
}

export interface ResolvedPriceConflict {
  lineItemIndex: number;
  label: string;
  chosenSourceLabel: string;
  chosenAmount: number;
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
  resolvedPriceConflicts: ResolvedPriceConflict[];
  calculation: QuoteCalculation;
  /** Validator messages for excerpts that could not be found in the original message. */
  sourceWarnings: string[];
  /** The couple has checked the flagged evidence against the original message. */
  sourceWarningsAcknowledged: boolean;
}

export interface WeddingBudgetState {
  /**
   * Committed totals kept per currency. We never add CAD to USD without a
   * real conversion, so each currency gets its own running total.
   */
  committedTotals: Partial<Record<CurrencyCode, number>>;
  approvedQuotes: Array<{
    id: string;
    vendorName: string;
    currency: CurrencyCode;
    knownSubtotal: number;
    approvedAt: string;
  }>;
}

export function createBudgetState(): WeddingBudgetState {
  return { committedTotals: {}, approvedQuotes: [] };
}

export function createReviewSession(
  id: string,
  extractedQuote: ExtractedQuote,
  ctx: { guestCount?: number; hours?: number; sourceWarnings?: string[] } = {},
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
    resolvedPriceConflicts: [],
    calculation: calculateQuoteTotal(draftQuote, ctx),
    sourceWarnings: [...(ctx.sourceWarnings ?? [])],
    sourceWarningsAcknowledged: false,
  };
}

export interface LineItemPatch {
  label?: string;
  pricingType?: PricingType;
  amount?: number | null;
  minGuests?: number;
  ratioGuests?: number;
  chargeType?: ChargeRequirement;
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
    'chargeType',
    'optionalAddon',
  ];

  for (const field of fields) {
    if (patch[field] !== undefined && patch[field] !== item[field]) {
      (item as unknown as Record<string, unknown>)[field] = patch[field];
      session.correctionsByField[field] = (session.correctionsByField[field] ?? 0) + 1;
    }
  }

  // Keep optionalAddon and chargeType consistent when toggled from the UI
  if (patch.optionalAddon === true && patch.chargeType === undefined) {
    item.chargeType = 'optional';
  } else if (patch.optionalAddon === false && item.chargeType === 'optional') {
    item.chargeType = 'mandatory';
  }

  session.calculation = calculateQuoteTotal(session.draftQuote, {
    guestCount: session.guestCount,
    hours: session.hours,
  });
  return session;
}

/**
 * Resolves a conflicting-price line item by selecting one of its extracted
 * candidate prices, clearing the conflict, and recalculating the quote subtotal.
 */
export function resolvePriceConflict(
  session: QuoteReviewSession,
  lineItemIndex: number,
  optionIndex: number,
): QuoteReviewSession {
  if (session.status !== 'pending_review') {
    throw new Error('Cannot resolve price conflicts after a quote has been approved or dismissed.');
  }
  const item = session.draftQuote.lineItems[lineItemIndex];
  if (!item) {
    throw new Error(`Line item index ${lineItemIndex} out of range.`);
  }
  const options = normalizeConflictingOptions(item);
  if (options.length < 2) {
    throw new Error(`Line item ${lineItemIndex} does not have a price conflict to resolve.`);
  }
  const chosen = options[optionIndex];
  if (!chosen) {
    throw new Error(`Price option index ${optionIndex} out of range.`);
  }

  const prevAmount = item.amount;
  item.amount = chosen.amount;
  item.pricingType = chosen.pricingType;
  item.sourceExcerpt = chosen.sourceExcerpt;
  delete item.conflictingOptions;

  session.correctionsByField.priceConflict = (session.correctionsByField.priceConflict ?? 0) + 1;
  if (prevAmount !== chosen.amount) {
    session.correctionsByField.amount = (session.correctionsByField.amount ?? 0) + 1;
  }

  session.resolvedPriceConflicts.push({
    lineItemIndex,
    label: item.label,
    chosenSourceLabel: chosen.sourceLabel,
    chosenAmount: chosen.amount,
    resolvedAt: new Date().toISOString(),
  });

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

export function acknowledgeSourceWarnings(session: QuoteReviewSession): QuoteReviewSession {
  if (session.status !== 'pending_review') {
    throw new Error('Cannot change a quote after it has been approved or dismissed.');
  }
  session.sourceWarningsAcknowledged = true;
  return session;
}

export function selectPackage(
  session: QuoteReviewSession,
  packageId: string,
): QuoteReviewSession {
  if (session.status !== 'pending_review') {
    throw new Error('Cannot change package selection after a quote has been approved or dismissed.');
  }
  const pkgs = session.draftQuote.packages ?? [];
  const chosen = pkgs.find((p) => p.id === packageId);
  if (!chosen) {
    throw new Error(`Package "${packageId}" not found on this quote.`);
  }
  if (session.draftQuote.selectedPackageId !== chosen.id) {
    session.draftQuote.selectedPackageId = chosen.id;
    session.correctionsByField.selectedPackageId =
      (session.correctionsByField.selectedPackageId ?? 0) + 1;
  }
  session.calculation = calculateQuoteTotal(session.draftQuote, {
    guestCount: session.guestCount,
    hours: session.hours,
  });
  return session;
}

/** Reasons the quote cannot be approved yet. Empty means it is safe to approve. */
export function getApprovalBlockers(session: QuoteReviewSession): string[] {
  const blockers: string[] = [];
  if (session.calculation.unresolvedPackageSelection) {
    blockers.push('Select one package option before adding this quote to the budget.');
  }
  if (session.draftQuote.currency === 'UNKNOWN') {
    blockers.push('Confirm the quote currency before adding it to the budget.');
  }
  if (session.calculation.priceConflicts.length > 0) {
    for (const conflict of session.calculation.priceConflicts) {
      const choices = conflict.options
        .map((o) => `${o.sourceLabel}: ${o.calculatedTotal ?? o.unitAmount}`)
        .join(' vs ');
      const diffText = conflict.discrepancy !== null ? ` (${conflict.discrepancy} difference)` : '';
      blockers.push(
        `Resolve conflicting prices for ${conflict.label} (${choices}${diffText}) before adding this quote to the budget.`,
      );
    }
  }
  if (session.calculation.unknownItems.length > 0) {
    blockers.push(
      `Resolve mandatory TBD costs (${session.calculation.unknownItems.join(', ')}) before adding this quote to the budget.`,
    );
  }
  if (session.calculation.gratuityUnresolved) {
    blockers.push(
      'Resolve the missing gratuity percentage or calculation basis before adding this quote to the budget.',
    );
  }
  if (session.sourceWarnings.length > 0 && !session.sourceWarningsAcknowledged) {
    blockers.push(
      'Some source excerpts were not found in the original message. Check them before approving.',
    );
  }
  return blockers;
}

export function approveQuote(
  session: QuoteReviewSession,
  budget: WeddingBudgetState,
  telemetry?: TelemetryTracker,
): WeddingBudgetState {
  if (session.status !== 'pending_review') {
    return budget;
  }
  const calc = calculateQuoteTotal(session.draftQuote, {
    guestCount: session.guestCount,
    hours: session.hours,
  });
  session.calculation = calc;

  const blockers = getApprovalBlockers(session);
  if (blockers.length > 0) {
    throw new Error(blockers.join(' '));
  }
  session.status = 'approved';

  const currency = session.draftQuote.currency;
  const previous = budget.committedTotals[currency] ?? 0;
  const updatedBudget: WeddingBudgetState = {
    committedTotals: {
      ...budget.committedTotals,
      [currency]: Math.round((previous + calc.knownSubtotal) * 100) / 100,
    },
    approvedQuotes: [
      ...budget.approvedQuotes,
      {
        id: session.id,
        vendorName: session.draftQuote.vendorName ?? 'Unnamed vendor',
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
