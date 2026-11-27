import type {
  CurrencyCode,
  ExtractedQuote,
  PricingType,
} from './types.ts';

export interface CalcContext {
  guestCount?: number;
  hours?: number;
  selectedPackageId?: string;
}

export interface LineItemTotal {
  label: string;
  amount: number | null;
  note?: string;
}

export interface PriceConflictOption {
  sourceLabel: string;
  pricingType: PricingType;
  unitAmount: number;
  calculatedTotal: number | null;
  sourceExcerpt: string;
}

export interface PriceConflict {
  lineItemIndex: number;
  label: string;
  options: PriceConflictOption[];
  minTotal: number | null;
  maxTotal: number | null;
  discrepancy: number | null;
}

export interface QuoteCalculation {
  currency: CurrencyCode;
  knownSubtotal: number;
  itemTotals: LineItemTotal[];
  unknownItems: string[];
  optionalAddons: string[];
  priceConflicts: PriceConflict[];
  capacityExceeded: boolean;
  capacityWarning?: string;
  minGuestsApplied: boolean;
  negotiatedSavings: number;
  gratuityAmount: number | null;
  gratuityUnresolved: boolean;
  taxAmount: number | null;
  taxNotStated: boolean;
  unresolvedPackageSelection: boolean;
  selectedPackageName?: string;
  knownAllInTotal: number;
  isEstimateComplete: boolean;
}

import { calculateQuote, roundMoney } from '../shared/finance/calculator.ts';

export { normalizeConflictingOptions, resolvePercentageBasisAmount } from '../shared/finance/calculator.ts';

export function resolveRelativeDeadlineDate(
  eventDateIso: string | undefined,
  relativeDaysBeforeEvent: number | undefined,
): string | null {
  if (!eventDateIso || !/^\d{4}-\d{2}-\d{2}$/.test(eventDateIso)) return null;
  if (relativeDaysBeforeEvent === undefined || !Number.isFinite(relativeDaysBeforeEvent)) {
    return null;
  }
  const [y, m, d] = eventDateIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() - Math.round(relativeDaysBeforeEvent));
  return dt.toISOString().slice(0, 10);
}


export interface VenueComparison {
  guestCount: number;
  venueA: { name: string; calc: QuoteCalculation };
  venueB: { name: string; calc: QuoteCalculation };
  knownDifference: number;
  cheaperVenue: string | 'tie';
  breakEvenNote?: string;
}


export function calculateQuoteTotal(quote: ExtractedQuote, ctx: CalcContext = {}): QuoteCalculation {
  const result = calculateQuote(quote, {
    ...ctx,
    selectedPackageId: ctx.selectedPackageId ?? quote.selectedPackageId ?? undefined,
  });
  return {
    currency: result.currency,
    knownSubtotal: result.knownSubtotal,
    itemTotals: result.lines.map(({ item, total, note }) => ({ label: item.label, amount: total, note })),
    unknownItems: result.unknownItems,
    optionalAddons: result.optionalAddons,
    priceConflicts: result.priceConflicts,
    capacityExceeded: result.capacityExceeded,
    capacityWarning: result.capacityExceeded
      ? `Guest count (${ctx.guestCount}) exceeds room capacity (${result.selectedPackage?.maxCapacity ?? quote.venueDetails?.maxCapacity}).`
      : undefined,
    minGuestsApplied: result.appliedMinGuests !== null,
    negotiatedSavings: result.negotiatedSavings,
    gratuityAmount: result.gratuityAmount,
    gratuityUnresolved: result.gratuityAmount === null,
    taxAmount: result.taxAmount,
    taxNotStated: result.taxNotStated,
    unresolvedPackageSelection: result.unresolvedPackageSelection,
    selectedPackageName: result.selectedPackageName,
    knownAllInTotal: result.knownAllInTotal,
    isEstimateComplete: result.isEstimateComplete,
  };
}

export function compareVenueQuotes(
  quoteA: ExtractedQuote,
  quoteB: ExtractedQuote,
  guestCount: number,
): VenueComparison {
  const calcA = calculateQuoteTotal(quoteA, { guestCount });
  const calcB = calculateQuoteTotal(quoteB, { guestCount });
  const diff = roundMoney(Math.abs(calcA.knownSubtotal - calcB.knownSubtotal));

  let cheaperVenue: string | 'tie' = 'tie';
  let cheaperCalc = calcA;
  if (calcA.knownSubtotal < calcB.knownSubtotal) {
    cheaperVenue = quoteA.vendorName ?? 'Venue A';
    cheaperCalc = calcA;
  } else if (calcB.knownSubtotal < calcA.knownSubtotal) {
    cheaperVenue = quoteB.vendorName ?? 'Venue B';
    cheaperCalc = calcB;
  }

  let breakEvenNote: string | undefined;
  if (cheaperVenue !== 'tie' && cheaperCalc.unknownItems.length > 0 && diff > 0) {
    const fees = cheaperCalc.unknownItems.join(', ');
    breakEvenNote = `${cheaperVenue} is ${calcA.currency} ${diff} cheaper on known costs, but if ${fees} exceeds ${calcA.currency} ${diff}, the cost advantage flips.`;
  }

  return {
    guestCount,
    venueA: { name: quoteA.vendorName ?? 'Venue A', calc: calcA },
    venueB: { name: quoteB.vendorName ?? 'Venue B', calc: calcB },
    knownDifference: diff,
    cheaperVenue,
    breakEvenNote,
  };
}
