import type { CurrencyCode, ExtractedQuote, LineItem, PriceOption, PricingType } from './types.ts';

export interface CalcContext {
  guestCount?: number;
  hours?: number;
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
}

export interface VenueComparison {
  guestCount: number;
  venueA: { name: string; calc: QuoteCalculation };
  venueB: { name: string; calc: QuoteCalculation };
  knownDifference: number;
  cheaperVenue: string | 'tie';
  breakEvenNote?: string;
}

function isOptionalItem(item: LineItem): boolean {
  return item.optionalAddon === true || item.chargeType === 'optional';
}

function samePriceCandidate(
  a: { pricingType: PricingType; amount: number },
  b: { pricingType: PricingType; amount: number },
): boolean {
  return a.pricingType === b.pricingType && Math.abs(a.amount - b.amount) < 0.01;
}

/**
 * Normalizes conflicting price candidates for a single line item so both
 * extraction shapes work identically:
 * 1) Primary price in `item.amount` + only alternative(s) in `item.conflictingOptions`
 * 2) All candidate prices explicitly listed in `item.conflictingOptions`
 *
 * Deduplicates equivalent candidates and returns an empty list if fewer than
 * two distinct price options remain.
 */
export function normalizeConflictingOptions(item: LineItem): PriceOption[] {
  const rawOptions = item.conflictingOptions;
  if (!rawOptions || rawOptions.length === 0) {
    return [];
  }

  const deduped: PriceOption[] = [];
  const hasPrimaryInOptions =
    item.amount !== null &&
    item.pricingType !== 'unknown' &&
    rawOptions.some((opt) =>
      samePriceCandidate(opt, { pricingType: item.pricingType, amount: item.amount! }),
    );

  // If the model placed the primary price only in item.amount and only the
  // alternative(s) in conflictingOptions, synthesize the primary candidate first.
  if (item.amount !== null && item.pricingType !== 'unknown' && !hasPrimaryInOptions) {
    deduped.push({
      sourceLabel: 'Primary quote',
      pricingType: item.pricingType,
      amount: item.amount,
      sourceExcerpt: item.sourceExcerpt,
    });
  }

  for (const opt of rawOptions) {
    if (!deduped.some((existing) => samePriceCandidate(existing, opt))) {
      deduped.push(opt);
    }
  }

  return deduped.length >= 2 ? deduped : [];
}

function calculateLineItem(
  item: LineItem,
  quote: ExtractedQuote,
  ctx: CalcContext,
): { total: number | null; note?: string; minApplied?: boolean } {
  if (isOptionalItem(item)) {
    return { total: null, note: 'Optional add-on (excluded from base subtotal)' };
  }

  if (item.pricingType === 'included') {
    return { total: 0, note: 'Included' };
  }

  if (item.pricingType === 'unknown' || item.amount === null) {
    return { total: null, note: 'Unknown / TBD' };
  }

  switch (item.pricingType) {
    case 'flat':
      return { total: item.amount };

    case 'per_person': {
      const requested = ctx.guestCount;
      if (requested === undefined) {
        return { total: null, note: 'Guest count required' };
      }
      const floor = item.minGuests ?? quote.venueDetails?.minGuests ?? 0;
      const billableGuests = Math.max(requested, floor);
      const minApplied = billableGuests > requested;
      return {
        total: roundMoney(item.amount * billableGuests),
        note: minApplied ? `Minimum ${floor} guests applied` : `${billableGuests} guests`,
        minApplied,
      };
    }

    case 'per_guest_ratio': {
      const requested = ctx.guestCount;
      const ratio = item.ratioGuests;
      if (requested === undefined || !ratio || ratio <= 0) {
        return { total: null, note: 'Guest count or ratio missing' };
      }
      const units = Math.ceil(requested / ratio);
      return {
        total: roundMoney(item.amount * units),
        note: `${units} × ${item.amount} (1 per ${ratio} guests)`,
      };
    }

    case 'per_hour': {
      const requestedHours = ctx.hours ?? item.hours ?? quote.photographerDetails?.hoursIncluded;
      if (requestedHours === undefined) {
        return { total: null, note: 'Hours required' };
      }
      return {
        total: roundMoney(item.amount * requestedHours),
        note: `${requestedHours} hours × ${item.amount}/hr`,
      };
    }
  }
}

export function calculateQuoteTotal(
  quote: ExtractedQuote,
  ctx: CalcContext = {},
): QuoteCalculation {
  let knownSubtotal = 0;
  let minGuestsApplied = false;
  const itemTotals: LineItemTotal[] = [];
  const unknownItems: string[] = [];
  const optionalAddons: string[] = [];
  const priceConflicts: PriceConflict[] = [];

  for (let idx = 0; idx < quote.lineItems.length; idx++) {
    const item = quote.lineItems[idx]!;
    if (isOptionalItem(item)) {
      optionalAddons.push(item.label);
      continue;
    }

    const normalizedOptions = normalizeConflictingOptions(item);
    if (normalizedOptions.length >= 2) {
      const evaluated = normalizedOptions.map((opt) => {
        const optionRes = calculateLineItem(
          {
            ...item,
            pricingType: opt.pricingType,
            amount: opt.amount,
            optionalAddon: false,
            chargeType: item.chargeType === 'optional' ? 'mandatory' : item.chargeType,
          },
          quote,
          ctx,
        );
        return {
          sourceLabel: opt.sourceLabel,
          pricingType: opt.pricingType,
          unitAmount: opt.amount,
          calculatedTotal: optionRes.total,
          sourceExcerpt: opt.sourceExcerpt,
        };
      });

      const numericTotals = evaluated
        .map((o) => o.calculatedTotal)
        .filter((v): v is number => v !== null);
      const minTotal = numericTotals.length > 0 ? Math.min(...numericTotals) : null;
      const maxTotal = numericTotals.length > 0 ? Math.max(...numericTotals) : null;
      const discrepancy =
        minTotal !== null && maxTotal !== null ? roundMoney(maxTotal - minTotal) : null;

      priceConflicts.push({
        lineItemIndex: idx,
        label: item.label,
        options: evaluated,
        minTotal,
        maxTotal,
        discrepancy,
      });
    }

    const res = calculateLineItem(item, quote, ctx);
    if (res.minApplied) {
      minGuestsApplied = true;
    }

    if (res.total === null) {
      unknownItems.push(item.label);
      itemTotals.push({ label: item.label, amount: null, note: res.note });
    } else {
      knownSubtotal = roundMoney(knownSubtotal + res.total);
      itemTotals.push({ label: item.label, amount: res.total, note: res.note });
    }
  }

  const maxCap = quote.venueDetails?.maxCapacity;
  const capacityExceeded =
    ctx.guestCount !== undefined && maxCap !== undefined && ctx.guestCount > maxCap;

  return {
    currency: quote.currency,
    knownSubtotal,
    itemTotals,
    unknownItems,
    optionalAddons,
    priceConflicts,
    capacityExceeded,
    capacityWarning: capacityExceeded
      ? `Guest count (${ctx.guestCount}) exceeds room capacity (${maxCap}).`
      : undefined,
    minGuestsApplied,
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
    cheaperVenue = quoteA.vendorName;
    cheaperCalc = calcA;
  } else if (calcB.knownSubtotal < calcA.knownSubtotal) {
    cheaperVenue = quoteB.vendorName;
    cheaperCalc = calcB;
  }

  let breakEvenNote: string | undefined;
  if (cheaperVenue !== 'tie' && cheaperCalc.unknownItems.length > 0 && diff > 0) {
    const fees = cheaperCalc.unknownItems.join(', ');
    breakEvenNote = `${cheaperVenue} is ${calcA.currency} ${diff} cheaper on known costs, but if ${fees} exceeds ${calcA.currency} ${diff}, the cost advantage flips.`;
  }

  return {
    guestCount,
    venueA: { name: quoteA.vendorName, calc: calcA },
    venueB: { name: quoteB.vendorName, calc: calcB },
    knownDifference: diff,
    cheaperVenue,
    breakEvenNote,
  };
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
