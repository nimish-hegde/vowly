export type CurrencyCode = 'CAD' | 'USD' | 'UNKNOWN';

export type PricingType =
  | 'flat'
  | 'per_person'
  | 'per_extra_guest'
  | 'per_hour'
  | 'per_guest_ratio'
  | 'percentage'
  | 'included'
  | 'unknown';

export type PercentageBasis =
  | 'specific_line_items'
  | 'food_subtotal'
  | 'entire_subtotal'
  | 'custom_amount'
  | 'unknown';

export type ChargeRequirement = 'mandatory' | 'conditional' | 'optional';

export type TaxOrGratuityStatus = 'included' | 'excluded' | 'unknown';
export interface PriceOption {
  /** Short label distinguishing this price source (e.g., "Instagram DM", "PDF contract"). */
  sourceLabel: string;
  pricingType: PricingType;
  amount: number;
  /** Exact substring from the raw vendor message supporting this candidate price. */
  sourceExcerpt: string;
}

export interface LineItem {
  id?: string;
  eventId?: string;
  quantity?: number;
  conditionalOvertime?: boolean;
  includedPackageHours?: number;
  proposedPrice?: { amount: number; pricingType?: PricingType };
  label: string;
  pricingType: PricingType;
  /** Numeric price in the quote's currency, percentage value for 'percentage', or null when included or unknown/TBD. */
  amount: number | null;
  /** Minimum guest count that applies to this item (e.g., 150-person minimum). */
  minGuests?: number;
  /** Guest threshold above which per_extra_guest pricing applies (e.g., 150 for "$55/extra guest above 150"). */
  guestThreshold?: number;
  /** Optional package ID if this line item applies only when a specific package option is selected. */
  packageId?: string;
  /** Ratio denominator for per_guest_ratio items (e.g., 75 for "1 bartender per 75 guests"). */
  ratioGuests?: number;
  /** Plain-language unit label for ratio items (e.g., "bartender", "server", "table"). */
  unitLabel?: string;
  /** Default hours included if this is a per_hour item or duration-bound package. */
  hours?: number;
  /** Percentage rate (e.g., 10 for 10%) when pricingType is "percentage". */
  percentageRate?: number;
  /** Structured basis for percentage-based charges. */
  percentageBasis?: PercentageBasis;
  /** Target line item labels when percentageBasis is "specific_line_items". */
  percentageTargetLabels?: string[];
  /** User-confirmed custom taxable/applicable amount when percentageBasis is "custom_amount". */
  customBasisAmount?: number;
  /** Original/standard price when the vendor explicitly offered a negotiated discount (not a conflict). */
  originalAmount?: number;
  /** True when the charge is billed by or routed through a third-party supplier (e.g., preferred AV). */
  isThirdParty?: boolean;
  /** Optional third-party provider name or description. */
  thirdPartyProvider?: string;
  /** True when this line item is part of the food/catering subtotal for food-only gratuity bases. */
  isFoodItem?: boolean;
  /** Distinguishes mandatory, conditional, and explicitly optional charges. */
  chargeType?: ChargeRequirement;
  /** True only when the message explicitly says the item is an optional upgrade or add-on. */
  optionalAddon?: boolean;
  /**
   * Present when two or more conflicting prices refer to the same service.
   * Preserves every candidate price and its verbatim source without double-counting.
   */
  conflictingOptions?: PriceOption[];
  /** Exact substring or visible document snippet supporting this item. */
  sourceExcerpt: string;
  /** Optional document page or visual section reference for PDF/image extractions. */
  pageReference?: string;
}

export interface PackageInclusion {
  category?: string;
  name: string;
  quantity?: number;
  unit?: string;
  /** Separate coverage/service duration in hours when distinct from quantity (e.g., 1 second photographer for 5 hours). */
  durationHours?: number;
  /** Optional package ID when this inclusion belongs to a specific package tier. */
  packageId?: string;
  sourceExcerpt?: string;
}

export interface PackageOption {
  /** Stable slug identifier (e.g., "royal-package", "imperial-package"). */
  id: string;
  /** Display name of the mutually exclusive package tier. */
  name: string;
  pricingType: 'flat' | 'per_person' | 'unknown';
  amount: number | null;
  /** Minimum guest guarantee for this specific package (e.g., 150 for Royal, 100 for Imperial). */
  minGuests?: number;
  /** Included guest count covered by a flat package before extraGuestRate applies. */
  includedGuests?: number;
  /** Genuine incremental per-guest rate ONLY for guests above includedGuests / minGuests. */
  extraGuestRate?: number;
  maxCapacity?: number;
  /** Service hours included in this package option. */
  hours?: number;
  isFoodItem?: boolean;
  /** Package-specific mandatory or conditional fees when supported by the source. */
  fees?: LineItem[];
  /** Package-specific tax override when different from quote-level tax. */
  taxStatus?: TaxStatus;
  taxPercent?: number | null;
  /** Package-specific gratuity override when different from quote-level gratuity. */
  gratuityStatus?: TaxOrGratuityStatus;
  gratuityPercent?: number | null;
  gratuityBasis?: PercentageBasis;
  inclusions?: PackageInclusion[];
  sourceExcerpt: string;
  pageReference?: string;
}

export type TaxStatus = TaxOrGratuityStatus | 'exempt' | 'assumed';

export interface QuoteFacts {
  currency: CurrencyCode;
  lineItems: LineItem[];
  packages?: PackageOption[];
  inclusions?: PackageInclusion[];
  photographerDetails?: { hoursIncluded?: number; extraHourRate?: number };
  serviceDurationHours?: number;
  venueDetails?: { minGuests?: number; maxCapacity?: number };
  taxStatus: TaxStatus;
  taxPercent?: number | null;
  gratuityStatus?: TaxOrGratuityStatus;
  gratuityPercent?: number | null;
  gratuityBasis?: PercentageBasis;
}

export interface QuoteScenario {
  guestCount?: number;
  hours?: number;
  selectedPackageId?: string;
  guestCountsByEvent?: Readonly<Record<string, number | null>>;
  guestCountOverride?: number | null;
  primaryEventId?: string;
  addOns?: Array<{ item: LineItem & { id: string }; selected: boolean }>;
  fees?: Array<{ item: LineItem; unresolved: boolean }>;
  payment?: { adjustment: number; taxStatus: TaxStatus };
  unresolvedConflicts?: number;
  /** Compatibility defaults for the workspace's manually entered quantities and legacy tax treatment. */
  workspaceDefaults?: { taxPercent: number; ratioGuests: number };
}

interface LinePrice {
  total: number | null;
  note?: string;
  units?: number;
  guestsUsed?: number;
  minimum?: number;
  missingGuests?: boolean;
  threshold?: number;
  ratio?: number;
  conditional?: boolean;
  includedHours?: number;
}

interface PricedLine extends LinePrice {
  item: LineItem;
  percentageBasis?: { amount: number | null; label: string };
  originalTotal?: number;
  savings?: number;
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

const FOOD_ITEM_PATTERN =
  /\b(banquet|dinner|buffet|menu|catering|food|meal|entree|appetizer|dessert|plated|brunch|lunch|reception package|per[\s-]person|per[\s-]guest)\b/i;

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
  /\b(additional|extra|overtime|extension|extended|subsequent)\s*(hourly|hours?|hrs?)\b|\b(hourly|hours?|hrs?)\s*(extension|overtime)\b|\b(after|beyond)\s+\d+\s*(hours?|hrs?)\b|\bovertime\b/i;

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

const EXTRA_GUEST_LABEL_PATTERN =
  /\b(extra|additional)\s+(guests?|persons?|people|plates?)\b|\bguests?\s+(over|above|beyond)\b/i;

export function findSelectedPackage(
  quote: QuoteFacts,
  ctx: QuoteScenario,
): { hasMultiplePackages: boolean; selectedPackage?: PackageOption } {
  const pkgs = quote.packages ?? [];
  if (pkgs.length < 2) {
    return { hasMultiplePackages: false, selectedPackage: pkgs[0] };
  }
  const chosenId = ctx.selectedPackageId;
  if (!chosenId) {
    return { hasMultiplePackages: true, selectedPackage: undefined };
  }
  const norm = chosenId.trim().toLowerCase();
  const matched = ctx.workspaceDefaults ? pkgs.find((p) => p.id === chosenId) : pkgs.find(
    (p) => p.id.toLowerCase() === norm || p.name.toLowerCase() === norm,
  );
  return { hasMultiplePackages: true, selectedPackage: matched };
}

function isRedundantExtraGuestItem(
  item: LineItem,
  activeItems: LineItem[],
  quote: QuoteFacts,
  selectedPackage?: PackageOption,
): boolean {
  if (item.amount === null) return false;
  // Never filter out the selected package's own primary line item
  if (selectedPackage && item.id === `pkg-active-${selectedPackage.id}`) return false;
  const isExtraGuestCandidate =
    item.pricingType === 'per_extra_guest' ||
    (item.pricingType === 'per_person' && EXTRA_GUEST_LABEL_PATTERN.test(item.label));
  if (!isExtraGuestCandidate) return false;

  // When a quote has per_person package tiers, any un-scoped extra-guest line matching
  // the selected package's rate OR any package tier's per_person rate is redundant
  // (all guests are already billed by the chosen per_person package).
  if (
    selectedPackage &&
    selectedPackage.pricingType === 'per_person' &&
    selectedPackage.amount !== null &&
    Math.abs(selectedPackage.amount - item.amount) < 0.01
  ) {
    return true;
  }
  if (
    !item.packageId &&
    (quote.packages ?? []).some(
      (p) =>
        p.pricingType === 'per_person' &&
        p.amount !== null &&
        Math.abs(p.amount - item.amount!) < 0.01,
    )
  ) {
    return true;
  }

  // Check if a non-extra-guest per_person sibling already bills all guests at the same rate
  return activeItems.some(
    (sibling) =>
      sibling !== item &&
      !isOptionalItem(sibling) &&
      sibling.pricingType === 'per_person' &&
      sibling.amount !== null &&
      !EXTRA_GUEST_LABEL_PATTERN.test(sibling.label) &&
      Math.abs(sibling.amount - item.amount!) < 0.01,
  );
}

/**
 * Finds the base package duration (in hours) covered by sibling flat/included
 * line items, selected package, photographerDetails, or inclusions so conditional
 * overtime rates only bill hours exceeding the included duration.
 */
function findIncludedPackageHours(
  quote: QuoteFacts,
  activeItems: LineItem[],
  excludeIndex: number,
  selectedPackage?: PackageOption,
): number | undefined {
  let hasSiblingFlat = Boolean(selectedPackage && selectedPackage.pricingType === 'flat');
  if (selectedPackage?.hours !== undefined && selectedPackage.hours > 0) {
    return selectedPackage.hours;
  }

  for (let i = 0; i < activeItems.length; i++) {
    if (i === excludeIndex) continue;
    const sibling = activeItems[i]!;
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
  if (hasSiblingFlat && quote.serviceDurationHours && quote.serviceDurationHours > 0) {
    return quote.serviceDurationHours;
  }

  for (let i = 0; i < activeItems.length; i++) {
    if (i === excludeIndex) continue;
    const sibling = activeItems[i]!;
    if (isOptionalItem(sibling)) continue;
    if (sibling.pricingType === 'flat' || sibling.pricingType === 'included') {
      const fromLabel = parseHoursFromText(sibling.label);
      if (fromLabel !== undefined) return fromLabel;
      const fromExcerpt = parseHoursFromText(sibling.sourceExcerpt);
      if (fromExcerpt !== undefined) return fromExcerpt;
    }
  }

  if (hasSiblingFlat) {
    const allInclusions = [...(selectedPackage?.inclusions ?? []), ...(quote.inclusions ?? [])];
    for (const inc of allInclusions) {
      if (
        inc.durationHours !== undefined &&
        inc.durationHours > 0 &&
        !/\b(second|2nd|assistant|booth)\b/i.test(inc.name)
      ) {
        return inc.durationHours;
      }
      if (
        inc.quantity !== undefined &&
        inc.quantity > 0 &&
        inc.unit &&
        /\b(hours?|hrs?)\b/i.test(inc.unit) &&
        !/\b(second|2nd|assistant|booth)\b/i.test(inc.name)
      ) {
        return inc.quantity;
      }
      const fromInc = parseHoursFromText(inc.name);
      if (fromInc !== undefined && !/\b(second|2nd|assistant|booth)\b/i.test(inc.name)) {
        return fromInc;
      }
    }
  }

  return undefined;
}

function isConditionalOvertimeItem(
  item: LineItem,
  quote: QuoteFacts,
  includedPackageHours: number | undefined,
): boolean {
  if (item.pricingType !== 'per_hour' || includedPackageHours === undefined) {
    return false;
  }
  const matchesExtraHourRate =
    item.amount !== null &&
    quote.photographerDetails?.extraHourRate !== undefined &&
    Math.abs(item.amount - quote.photographerDetails.extraHourRate) < 0.01;
  const matchesOvertimeText =
    OVERTIME_PATTERN.test(item.label) || OVERTIME_PATTERN.test(item.sourceExcerpt);

  if (!matchesExtraHourRate && !matchesOvertimeText) {
    return false;
  }
  // Only treat as explicitly requested overtime hours when hours > 1;
  // models frequently emit hours: 1 for "$250 per additional hour" unit rates.
  if (item.hours !== undefined && item.hours > 1) {
    return false;
  }
  return true;
}

function isDuplicateGratuityPercentageItem(item: LineItem, quote: QuoteFacts): boolean {
  if (item.pricingType !== 'percentage') return false;
  if (!/\b(gratuity|tip|service\s*charge)\b/i.test(item.label)) return false;
  if (quote.gratuityStatus !== 'excluded') return false;
  if (quote.gratuityPercent === undefined || quote.gratuityPercent === null) return false;
  const rate = item.percentageRate ?? item.amount;
  return rate !== null && Math.abs(rate - quote.gratuityPercent) < 0.01;
}

function calculateLineItem(
  item: LineItem,
  quote: QuoteFacts,
  ctx: QuoteScenario,
  activeItems: LineItem[],
  selectedPackage?: PackageOption,
): LinePrice {
  if (item.pricingType === 'included') return { total: 0, note: 'Included' };
  if (item.pricingType === 'unknown' || item.amount === null) {
    return { total: null, note: 'Unknown / TBD' };
  }

  const workspace = ctx.workspaceDefaults;
  const guestMap = ctx.guestCountsByEvent ?? {};
  const requested = ctx.guestCountOverride !== undefined
    ? ctx.guestCountOverride ?? undefined
    : item.eventId && Object.hasOwn(guestMap, item.eventId)
      ? guestMap[item.eventId] ?? undefined
      : ctx.guestCount;
  const total = (units: number) =>
    workspace ? item.amount! * units : roundMoney(item.amount! * units);
  switch (item.pricingType) {
    case 'flat': {
      const units = item.quantity ?? 1;
      return { total: workspace ? total(units) : item.amount, units };
    }
    case 'per_person': {
      const floor = item.minGuests ?? selectedPackage?.minGuests ?? quote.venueDetails?.minGuests ?? 0;
      if (requested === undefined && (!workspace || floor <= 0)) {
        return { total: null, missingGuests: true, note: 'Guest count required' };
      }
      const units = Math.max(requested ?? 0, floor);
      const minimum = floor > (requested ?? 0) ? floor : undefined;
      return {
        total: total(units), units, guestsUsed: units, minimum,
        missingGuests: requested === undefined,
        note: minimum ? `Minimum ${minimum} guests applied` : `${units} guests`,
      };
    }
    case 'per_extra_guest': {
      const threshold = item.guestThreshold ?? item.minGuests ??
        (workspace ? selectedPackage?.minGuests ?? quote.venueDetails?.minGuests ?? 0
          : selectedPackage?.includedGuests ?? selectedPackage?.minGuests ?? quote.venueDetails?.minGuests);
      if (requested === undefined) {
        return { total: null, threshold, missingGuests: true, note: 'Guest count required' };
      }
      if (threshold === undefined) return { total: null, note: 'Included guest threshold missing' };
      const units = Math.max(0, requested - threshold);
      return {
        total: total(units), units, threshold, guestsUsed: requested,
        note: units > 0
          ? `${units} extra guest${units === 1 ? '' : 's'} above ${threshold} × ${item.amount}`
          : `0 extra guests (up to ${threshold} covered)`,
      };
    }
    case 'per_guest_ratio': {
      const ratio = item.ratioGuests && item.ratioGuests > 0 ? item.ratioGuests : workspace?.ratioGuests;
      if (requested === undefined || ratio === undefined) {
        return { total: null, ratio, missingGuests: requested === undefined, note: 'Guest count or ratio missing' };
      }
      const units = Math.ceil(requested / ratio);
      const unitWord = item.unitLabel ? ` ${item.unitLabel}${units === 1 ? '' : 's'}` : '';
      return {
        total: total(units), units, ratio, guestsUsed: requested,
        note: `${requested} guests → ${units}${unitWord} × ${item.amount} (1 per ${ratio} guests)`,
      };
    }
    case 'per_hour': {
      const includedHours = findIncludedPackageHours(quote, activeItems, activeItems.indexOf(item), selectedPackage)
        ?? item.includedPackageHours;
      const conditional = item.conditionalOvertime ?? (
        isConditionalOvertimeItem(item, quote, includedHours) ||
        (item.chargeType === 'conditional' &&
          (OVERTIME_PATTERN.test(item.label) || OVERTIME_PATTERN.test(item.sourceExcerpt)) &&
          !(item.hours !== undefined && item.hours > 1))
      );
      if (conditional) {
        const units = item.quantity ?? (includedHours === undefined ? 0 : Math.max(0, (ctx.hours ?? includedHours) - includedHours));
        const above = includedHours === undefined ? '' : ` (above ${includedHours} included hrs)`;
        return {
          total: total(units), units, conditional, includedHours,
          note: `${units} overtime hr${units === 1 ? '' : 's'} × ${item.amount}/hr${above}`,
        };
      }
      const units = item.quantity ?? ctx.hours ?? item.hours ?? quote.photographerDetails?.hoursIncluded ?? (workspace ? 1 : undefined);
      if (units === undefined) return { total: null, note: 'Hours required' };
      return { total: total(units), units, conditional, note: `${units} hours × ${item.amount}/hr` };
    }
    case 'percentage':
      return { total: null, note: 'Percentage basis pending' };
  }
}

function percentagePrice(item: LineItem, bases: Array<{ item: LineItem; total: number | null }>): LinePrice & Pick<PricedLine, 'percentageBasis'> {
  const rate = item.percentageRate ?? item.amount;
  if (rate === null || !Number.isFinite(rate)) return { total: null, note: 'Percentage rate unknown' };
  const percentageBasis = resolvePercentageBasisAmount(item.percentageBasis, bases, {
    targetLabels: item.percentageTargetLabels,
    customBasisAmount: item.customBasisAmount,
  });
  return {
    total: percentageBasis.amount === null ? null : roundMoney(percentageBasis.amount * (rate / 100)),
    percentageBasis,
    note: percentageBasis.amount === null
      ? `${rate}% (${percentageBasis.label})`
      : `${rate}% of ${percentageBasis.label} (${percentageBasis.amount})`,
  };
}

/** Resolve quote pricing from source facts and the current user scenario. */
export function calculateQuote(quote: QuoteFacts, ctx: QuoteScenario = {}) {
  const workspace = ctx.workspaceDefaults;
  const { hasMultiplePackages, selectedPackage } = findSelectedPackage(quote, ctx);
  const unresolvedPackageSelection = hasMultiplePackages && !selectedPackage;
  const unresolvedPackagePrice = Boolean(selectedPackage &&
    (selectedPackage.amount === null || selectedPackage.pricingType === 'unknown'));
  const activeItems: LineItem[] = [];
  if (selectedPackage) {
    activeItems.push({
      id: `pkg-active-${selectedPackage.id}`,
      label: selectedPackage.name,
      pricingType: selectedPackage.pricingType,
      amount: selectedPackage.amount,
      minGuests: selectedPackage.minGuests,
      hours: selectedPackage.hours,
      isFoodItem: selectedPackage.isFoodItem,
      eventId: ctx.primaryEventId,
      sourceExcerpt: selectedPackage.sourceExcerpt,
    });
    const threshold = selectedPackage.includedGuests ?? selectedPackage.minGuests;
    if (!unresolvedPackagePrice && selectedPackage.pricingType === 'flat' &&
        selectedPackage.extraGuestRate !== undefined && selectedPackage.extraGuestRate > 0 &&
        threshold !== undefined) {
      activeItems.push({
        id: `pkg-extra-${selectedPackage.id}`,
        label: `${selectedPackage.name} extra guests`,
        pricingType: 'per_extra_guest',
        amount: selectedPackage.extraGuestRate,
        guestThreshold: threshold,
        isFoodItem: selectedPackage.isFoodItem,
        eventId: ctx.primaryEventId,
        sourceExcerpt: selectedPackage.sourceExcerpt,
      });
    }
    activeItems.push(...(selectedPackage.fees ?? []));
  }

  const packageIds = new Set(quote.packages?.map((pkg) => pkg.id.toLowerCase()));
  for (const item of quote.lineItems) {
    const scope = item.packageId?.trim().toLowerCase();
    if (hasMultiplePackages && scope && packageIds.has(scope) && scope !== selectedPackage?.id.toLowerCase()) {
      continue;
    }
    if (!hasMultiplePackages && selectedPackage?.pricingType === item.pricingType &&
        item.amount !== null && selectedPackage.amount !== null &&
        Math.abs(item.amount - selectedPackage.amount) < 0.01) {
      continue;
    }
    activeItems.push(item);
  }

  const lines: PricedLine[] = [];
  const bases: Array<{ item: LineItem; total: number | null }> = [];
  const percentageItems: LineItem[] = [];
  const optionalAddons: string[] = [];
  const priceConflicts: PriceConflict[] = [];
  let baseSubtotal = 0;
  let negotiatedSavings = 0;
  let unresolvedPercentageCount = 0;
  const price = (item: LineItem) => calculateLineItem(item, quote, ctx, activeItems, selectedPackage);
  const addToBase = (amount: number) => {
    baseSubtotal += amount;
    if (!workspace) baseSubtotal = roundMoney(baseSubtotal);
  };

  for (const [index, item] of activeItems.entries()) {
    if (isOptionalItem(item)) {
      optionalAddons.push(item.label);
      continue;
    }
    if (isRedundantExtraGuestItem(item, activeItems, quote, selectedPackage)) continue;

    const candidates = normalizeConflictingOptions(item);
    if (candidates.length >= 2) {
      const options = candidates.map((candidate) => ({
        sourceLabel: candidate.sourceLabel,
        pricingType: candidate.pricingType,
        unitAmount: candidate.amount,
        calculatedTotal: price({ ...item, pricingType: candidate.pricingType, amount: candidate.amount }).total,
        sourceExcerpt: candidate.sourceExcerpt,
      }));
      const totals = options.flatMap((option) => option.calculatedTotal === null ? [] : [option.calculatedTotal]);
      const minTotal = totals.length ? Math.min(...totals) : null;
      const maxTotal = totals.length ? Math.max(...totals) : null;
      priceConflicts.push({
        lineItemIndex: index, label: item.label, options, minTotal, maxTotal,
        discrepancy: minTotal !== null && maxTotal !== null ? roundMoney(maxTotal - minTotal) : null,
      });
    }

    if (item.pricingType === 'percentage') {
      percentageItems.push(item);
      continue;
    }
    const effectiveItem = item.proposedPrice ? {
      ...item,
      pricingType: item.proposedPrice.pricingType ?? item.pricingType,
      amount: item.proposedPrice.amount,
    } : item;
    const result = price(effectiveItem);
    const line: PricedLine = { item: effectiveItem, ...result };
    if (!item.proposedPrice && candidates.length < 2 &&
        item.originalAmount !== undefined && item.amount !== null && item.originalAmount > item.amount) {
      const original = price({ ...item, amount: item.originalAmount }).total;
      if (original !== null && result.total !== null && original > result.total) {
        line.originalTotal = roundMoney(original);
        line.savings = roundMoney(original - result.total);
        negotiatedSavings = roundMoney(negotiatedSavings + line.savings);
      }
    }
    lines.push(line);
    bases.push({ item: effectiveItem, total: result.total });
    addToBase(result.total ?? 0);
  }

  const appliesToSelection = (item: LineItem) => !item.packageId || item.packageId === selectedPackage?.id;
  let confirmedExtraFeesPreTax = 0;
  let unresolvedMandatoryFeesCount = 0;
  for (const fee of ctx.fees ?? []) {
    if (!appliesToSelection(fee.item)) continue;
    if (fee.unresolved) unresolvedMandatoryFeesCount += 1;
    if (fee.item.amount !== null) {
      confirmedExtraFeesPreTax += fee.item.amount;
      bases.push({ item: fee.item, total: fee.item.amount });
    }
  }

  const addOns = ctx.addOns?.filter(({ item }) => appliesToSelection(item)) ?? [];
  let selectedAddOnsPreTax = 0;
  const addOnAmounts = new Map<string, number>();
  function recordAddOn(item: LineItem & { id: string }, selected: boolean, amount: number | null) {
    addOnAmounts.set(item.id, amount ?? 0);
    if (selected) selectedAddOnsPreTax = roundMoney(selectedAddOnsPreTax + (amount ?? 0));
  }
  for (const { item, selected } of addOns) {
    if (item.pricingType === 'percentage') continue;
    const result = price(item);
    const amount = item.pricingType === 'flat' ? item.amount : roundMoney(result.total ?? 0);
    recordAddOn(item, selected, amount);
    if (selected) bases.push({ item, total: amount });
  }
  for (const { item, selected } of addOns) {
    if (item.pricingType !== 'percentage') continue;
    const result = percentagePrice(item, bases);
    if (selected && result.total === null) unresolvedPercentageCount += 1;
    recordAddOn(item, selected, result.total);
  }

  for (const item of percentageItems) {
    if (isDuplicateGratuityPercentageItem(item, quote)) continue;
    const result = percentagePrice(item, bases);
    if (result.total === null) unresolvedPercentageCount += 1;
    lines.push({ item, ...result });
    baseSubtotal = roundMoney(baseSubtotal + (result.total ?? 0));
  }

  const paymentOptionAdjustment = ctx.payment?.adjustment ?? 0;
  const subtotal = baseSubtotal + paymentOptionAdjustment + confirmedExtraFeesPreTax + selectedAddOnsPreTax;
  const knownSubtotal = workspace ? Math.max(0, roundMoney(subtotal)) : subtotal;

  const gratuityStatus = selectedPackage?.gratuityStatus ?? quote.gratuityStatus;
  const gratuityPercent = selectedPackage?.gratuityPercent === undefined
    ? quote.gratuityPercent : selectedPackage.gratuityPercent;
  const gratuityBasis = selectedPackage?.gratuityBasis ?? quote.gratuityBasis ?? 'entire_subtotal';
  const hasGratuityLine = activeItems.some((item) => !isOptionalItem(item) &&
    !isDuplicateGratuityPercentageItem(item, quote) && /\b(gratuity|tip|service\s*charge)\b/i.test(item.label));
  let gratuityAmount: number | null = 0;
  let gratuityBasisLabel: string | undefined;
  if (!hasGratuityLine) {
    if (gratuityStatus === 'excluded' && gratuityPercent == null) {
      gratuityAmount = null;
      gratuityBasisLabel = 'percentage unknown';
    } else if (gratuityPercent != null &&
               (workspace ? gratuityPercent > 0 && gratuityStatus !== 'included' : gratuityStatus === 'excluded')) {
      const basis = gratuityBasis === 'entire_subtotal'
        ? { amount: knownSubtotal, label: 'applicable subtotal' }
        : resolvePercentageBasisAmount(gratuityBasis, bases);
      gratuityBasisLabel = basis.label;
      gratuityAmount = basis.amount === null ? null : roundMoney(basis.amount * (gratuityPercent / 100));
    }
  }

  const taxStatus = ctx.payment?.taxStatus ?? selectedPackage?.taxStatus ?? quote.taxStatus;
  const taxPercent = selectedPackage?.taxPercent === undefined ? quote.taxPercent : selectedPackage.taxPercent;
  const hasTaxLine = activeItems.some((item) => !isOptionalItem(item) && /\b(hst|gst|pst|sales\s*tax|tax)\b/i.test(item.label));
  const taxNotStated = !hasTaxLine && taxStatus === 'unknown';
  const taxApplies = !hasTaxLine && (taxStatus === 'excluded' || taxStatus === 'assumed');
  const defaultTax = taxPercent === undefined || taxStatus === 'assumed' ? workspace?.taxPercent : undefined;
  const rate = typeof taxPercent === 'number' && Number.isFinite(taxPercent) ? taxPercent : defaultTax;
  const taxRate = taxApplies && rate !== undefined ? rate / 100 : 0;
  const taxableBase = roundMoney(knownSubtotal + (gratuityAmount ?? 0));
  const taxAmount = taxApplies && rate === undefined ? null : roundMoney(taxableBase * taxRate);
  const knownAllInTotal = roundMoney(taxableBase + (taxAmount ?? 0));

  const unknownItems = lines.filter((line) => line.total === null).map(({ item }) => item.label);
  const unresolvedConflictsCount = ctx.unresolvedConflicts ?? priceConflicts.length;
  const maxCapacity = selectedPackage?.maxCapacity ?? quote.venueDetails?.maxCapacity;
  const capacityExceeded = maxCapacity !== undefined && ctx.guestCount !== undefined && ctx.guestCount > maxCapacity;
  const guestCountMissing = lines.some((line) => line.missingGuests);
  const appliedMinGuests = lines.reduce<number | null>((minimum, line) => line.minimum ?? minimum, null);
  const effectiveGuestCountUsed = lines.reduce<number | null>((guests, line) => line.guestsUsed ?? guests, null);

  const blockers = [
    ...(unresolvedPackageSelection ? ['package_selection' as const] : []),
    ...(unresolvedPackagePrice ? ['package_price' as const] : []),
    ...(quote.currency === 'UNKNOWN' ? ['currency' as const] : []),
    ...(unresolvedConflictsCount ? ['price_conflict' as const] : []),
    ...(unresolvedMandatoryFeesCount ? ['mandatory_fee' as const] : []),
    ...(gratuityAmount === null ? ['gratuity' as const] : []),
    ...(unresolvedPercentageCount ? ['percentage_basis' as const] : []),
  ];

  return {
    currency: quote.currency, lines, unknownItems, optionalAddons, priceConflicts, blockers,
    baseSubtotal, knownSubtotal, knownAllInTotal, selectedAddOnsPreTax,
    confirmedExtraFeesPreTax, paymentOptionAdjustment, addOnAmounts,
    unresolvedMandatoryFeesCount, unresolvedConflictsCount, unresolvedPercentageCount,
    negotiatedSavings, gratuityAmount, gratuityBasisLabel, taxAmount, taxRate, taxStatus,
    taxNotStated, hasTaxLine, capacityExceeded, guestCountMissing, appliedMinGuests,
    effectiveGuestCountUsed, unresolvedPackageSelection, unresolvedPackagePrice,
    selectedPackage, selectedPackageName: selectedPackage?.name,
    isEstimateComplete: blockers.length === 0 && !guestCountMissing && unknownItems.length === 0 &&
      !taxNotStated && taxAmount !== null,
  };
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
