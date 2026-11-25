import type {
  CurrencyCode,
  ExtractedQuote,
  LineItem,
  PercentageBasis,
  PriceOption,
  PricingType,
} from './types.ts';

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
  negotiatedSavings: number;
  gratuityAmount: number | null;
  gratuityUnresolved: boolean;
  taxAmount: number | null;
  knownAllInTotal: number;
  isEstimateComplete: boolean;
}

const FOOD_ITEM_PATTERN =
  /\b(banquet|dinner|buffet|menu|catering|food|meal|entree|appetizer|dessert|plated|brunch|lunch|reception package|per[\s-]person|per[\s-]guest)\b/i;

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

export function resolvePercentageBasisAmount(
  basis: PercentageBasis | undefined,
  baseItems: Array<{ item: LineItem; total: number | null }>,
  options?: { targetLabels?: string[]; customBasisAmount?: number },
): { amount: number | null; label: string } {
  const effectiveBasis = basis ?? 'unknown';
  if (effectiveBasis === 'unknown') {
    return { amount: null, label: 'calculation basis unresolved' };
  }
  if (effectiveBasis === 'custom_amount') {
    if (
      options?.customBasisAmount !== undefined &&
      Number.isFinite(options.customBasisAmount) &&
      options.customBasisAmount >= 0
    ) {
      return { amount: roundMoney(options.customBasisAmount), label: 'confirmed custom amount' };
    }
    return { amount: null, label: 'custom amount not confirmed' };
  }
  if (effectiveBasis === 'entire_subtotal') {
    const known = baseItems.reduce((sum, entry) => sum + (entry.total ?? 0), 0);
    return { amount: roundMoney(known), label: 'applicable subtotal' };
  }
  if (effectiveBasis === 'food_subtotal') {
    const foodMatches = baseItems.filter(
      (entry) =>
        entry.item.isFoodItem === true ||
        (entry.item.isFoodItem !== false &&
          !entry.item.isThirdParty &&
          entry.item.pricingType !== 'per_guest_ratio' &&
          FOOD_ITEM_PATTERN.test(entry.item.label)),
    );
    if (foodMatches.length === 0 || foodMatches.some((e) => e.total === null)) {
      return { amount: null, label: 'food subtotal unresolved' };
    }
    const sum = foodMatches.reduce((acc, entry) => acc + (entry.total ?? 0), 0);
    return { amount: roundMoney(sum), label: 'food subtotal' };
  }
  if (effectiveBasis === 'specific_line_items') {
    const targets = (options?.targetLabels ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean);
    if (targets.length === 0) {
      return { amount: null, label: 'target line items unresolved' };
    }
    const matched = baseItems.filter((entry) =>
      targets.some((t) => entry.item.label.toLowerCase().includes(t)),
    );
    if (matched.length === 0 || matched.some((e) => e.total === null)) {
      return { amount: null, label: 'target line items unresolved' };
    }
    const sum = matched.reduce((acc, entry) => acc + (entry.total ?? 0), 0);
    return { amount: roundMoney(sum), label: targets.join(', ') };
  }
  return { amount: null, label: 'calculation basis unresolved' };
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

const WORD_TO_HOURS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const OVERTIME_PATTERN =
  /\b(additional|extra|overtime|extension|extended|subsequent)\s*(hours?|hrs?)\b|\b(hours?|hrs?)\s*(extension|overtime)\b|\b(after|beyond)\s+\d+\s*(hours?|hrs?)\b|\bovertime\b/i;

function parseHoursFromText(text: string): number | undefined {
  const numMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(?:-|\s)?(?:hours?|hrs?)\b/i);
  if (numMatch) {
    const val = Number(numMatch[1]);
    if (Number.isFinite(val) && val > 0) return val;
  }
  const wordMatch = text.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:-|\s)?(?:hours?|hrs?)\b/i,
  );
  if (wordMatch) {
    return WORD_TO_HOURS[wordMatch[1]!.toLowerCase()];
  }
  return undefined;
}

/**
 * Finds the base package duration (in hours) covered by sibling flat/included
 * line items or photographerDetails so conditional overtime rates only bill
 * hours exceeding the included duration.
 */
function findIncludedPackageHours(quote: ExtractedQuote, excludeIndex: number): number | undefined {
  let hasSiblingFlat = false;
  for (let i = 0; i < quote.lineItems.length; i++) {
    if (i === excludeIndex) continue;
    const sibling = quote.lineItems[i]!;
    if (isOptionalItem(sibling)) continue;
    if (sibling.pricingType === 'flat' || sibling.pricingType === 'included') {
      hasSiblingFlat = true;
      if (sibling.hours !== undefined && sibling.hours > 0) {
        return sibling.hours;
      }
    }
  }

  if (hasSiblingFlat && quote.photographerDetails?.hoursIncluded && quote.photographerDetails.hoursIncluded > 0) {
    return quote.photographerDetails.hoursIncluded;
  }

  for (let i = 0; i < quote.lineItems.length; i++) {
    if (i === excludeIndex) continue;
    const sibling = quote.lineItems[i]!;
    if (isOptionalItem(sibling)) continue;
    if (sibling.pricingType === 'flat' || sibling.pricingType === 'included') {
      const fromLabel = parseHoursFromText(sibling.label);
      if (fromLabel !== undefined) return fromLabel;
      const fromExcerpt = parseHoursFromText(sibling.sourceExcerpt);
      if (fromExcerpt !== undefined) return fromExcerpt;
    }
  }

  return undefined;
}

function isConditionalOvertimeItem(
  item: LineItem,
  quote: ExtractedQuote,
  includedPackageHours: number | undefined,
): boolean {
  if (item.pricingType !== 'per_hour' || includedPackageHours === undefined) {
    return false;
  }
  if (item.hours !== undefined && item.hours > 0) {
    return false;
  }
  const matchesExtraHourRate =
    item.amount !== null &&
    quote.photographerDetails?.extraHourRate !== undefined &&
    Math.abs(item.amount - quote.photographerDetails.extraHourRate) < 0.01;
  return (
    matchesExtraHourRate ||
    OVERTIME_PATTERN.test(item.label) ||
    OVERTIME_PATTERN.test(item.sourceExcerpt)
  );
}

function calculateLineItem(
  item: LineItem,
  quote: ExtractedQuote,
  ctx: CalcContext,
  itemIndex = -1,
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
      const unitWord = item.unitLabel ? ` ${item.unitLabel}${units === 1 ? '' : 's'}` : '';
      return {
        total: roundMoney(item.amount * units),
        note: `${requested} guests → ${units}${unitWord} × ${item.amount} (1 per ${ratio} guests)`,
      };
    }

    case 'percentage': {
      // Calculated in second pass once non-percentage base items are resolved
      return { total: null, note: `${item.percentageRate ?? item.amount}% (percentage basis pending)` };
    }

    case 'per_hour': {
      const includedPackageHours = findIncludedPackageHours(quote, itemIndex);
      if (isConditionalOvertimeItem(item, quote, includedPackageHours)) {
        const requestedHours = ctx.hours ?? includedPackageHours!;
        const overtimeHours = Math.max(0, requestedHours - includedPackageHours!);
        return {
          total: roundMoney(item.amount * overtimeHours),
          note:
            overtimeHours > 0
              ? `${overtimeHours} overtime hr${overtimeHours === 1 ? '' : 's'} × ${item.amount}/hr (above ${includedPackageHours} included hrs)`
              : `0 overtime hrs (${includedPackageHours} hrs included in base package)`,
        };
      }

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
  let negotiatedSavings = 0;
  const itemTotals: LineItemTotal[] = [];
  const unknownItems: string[] = [];
  const optionalAddons: string[] = [];
  const priceConflicts: PriceConflict[] = [];
  const resolvedBaseItems: Array<{ item: LineItem; total: number | null }> = [];
  const percentageItems: Array<{ idx: number; item: LineItem }> = [];

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
          idx,
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

    if (item.pricingType === 'percentage') {
      percentageItems.push({ idx, item });
      continue;
    }

    const res = calculateLineItem(item, quote, ctx, idx);
    if (res.minApplied) {
      minGuestsApplied = true;
    }

    if (
      item.originalAmount !== undefined &&
      item.amount !== null &&
      item.originalAmount > item.amount &&
      normalizedOptions.length < 2
    ) {
      const origRes = calculateLineItem(
        { ...item, amount: item.originalAmount },
        quote,
        ctx,
        idx,
      );
      if (origRes.total !== null && res.total !== null && origRes.total > res.total) {
        negotiatedSavings = roundMoney(negotiatedSavings + (origRes.total - res.total));
      }
    }

    resolvedBaseItems.push({ item, total: res.total });
    if (res.total === null) {
      unknownItems.push(item.label);
      itemTotals.push({ label: item.label, amount: null, note: res.note });
    } else {
      knownSubtotal = roundMoney(knownSubtotal + res.total);
      itemTotals.push({ label: item.label, amount: res.total, note: res.note });
    }
  }

  // Second pass: evaluate percentage-based line items against structured bases
  for (const { item } of percentageItems) {
    const rate = item.percentageRate ?? item.amount;
    if (rate === null || rate === undefined || !Number.isFinite(rate)) {
      unknownItems.push(item.label);
      itemTotals.push({ label: item.label, amount: null, note: 'Percentage rate unknown' });
      continue;
    }
    const basis = resolvePercentageBasisAmount(item.percentageBasis, resolvedBaseItems, {
      targetLabels: item.percentageTargetLabels,
      customBasisAmount: item.customBasisAmount,
    });
    if (basis.amount === null) {
      unknownItems.push(item.label);
      itemTotals.push({
        label: item.label,
        amount: null,
        note: `${rate}% (${basis.label})`,
      });
    } else {
      const charge = roundMoney(basis.amount * (rate / 100));
      knownSubtotal = roundMoney(knownSubtotal + charge);
      itemTotals.push({
        label: item.label,
        amount: charge,
        note: `${rate}% of ${basis.label} (${basis.amount})`,
      });
    }
  }

  // Gratuity calculation (prevent duplicate application if already included as a line item)
  const hasExplicitGratuityLineItem = quote.lineItems.some(
    (li) => !isOptionalItem(li) && /\b(gratuity|tip|service\s*charge)\b/i.test(li.label),
  );
  let gratuityAmount: number | null = 0;
  let gratuityUnresolved = false;
  if (!hasExplicitGratuityLineItem && quote.gratuityStatus === 'excluded') {
    if (quote.gratuityPercent === undefined || quote.gratuityPercent === null) {
      gratuityAmount = null;
      gratuityUnresolved = true;
    } else {
      const basis = resolvePercentageBasisAmount(
        quote.gratuityBasis ?? 'entire_subtotal',
        resolvedBaseItems,
      );
      if (basis.amount === null) {
        gratuityAmount = null;
        gratuityUnresolved = true;
      } else {
        gratuityAmount = roundMoney(basis.amount * (quote.gratuityPercent / 100));
      }
    }
  }

  // Tax calculation (never inferred from payment method, never duplicated)
  const hasExplicitTaxLineItem = quote.lineItems.some(
    (li) => !isOptionalItem(li) && /\b(hst|gst|pst|sales\s*tax|tax)\b/i.test(li.label),
  );
  let taxAmount: number | null = 0;
  if (!hasExplicitTaxLineItem && quote.taxStatus === 'excluded') {
    if (quote.taxPercent !== undefined && quote.taxPercent !== null) {
      const taxableBase = roundMoney(knownSubtotal + (gratuityAmount ?? 0));
      taxAmount = roundMoney(taxableBase * (quote.taxPercent / 100));
    } else {
      taxAmount = null;
    }
  }

  const knownAllInTotal = roundMoney(
    knownSubtotal + (gratuityAmount ?? 0) + (taxAmount ?? 0),
  );
  const isEstimateComplete =
    unknownItems.length === 0 &&
    priceConflicts.length === 0 &&
    !gratuityUnresolved &&
    quote.currency !== 'UNKNOWN';

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
    negotiatedSavings,
    gratuityAmount,
    gratuityUnresolved,
    taxAmount,
    knownAllInTotal,
    isEstimateComplete,
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

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
