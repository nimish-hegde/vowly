import type {
  BudgetRow,
  PastelTone,
  PaymentMilestone,
  PercentageBasis,
  Quote,
  QuoteLineItem,
  QuotePackageOption,
  TaxHandling,
  Vendor,
  VendorCategory,
  WeddingEvent,
  WeddingWorkspace,
} from '../types/vowly';

export const ONTARIO_HST_RATE = 0.13;

const FOOD_ITEM_PATTERN =
  /\b(banquet|dinner|buffet|menu|catering|food|meal|entree|appetizer|dessert|plated|brunch|lunch|reception package|per[\s-]person|per[\s-]guest)\b/i;

export function resolveRelativeDeadlineDate(
  eventDateIso: string | undefined,
  relativeDaysBeforeEvent: number | undefined
): string | null {
  if (!eventDateIso || !/^\d{4}-\d{2}-\d{2}$/.test(eventDateIso)) return null;
  if (relativeDaysBeforeEvent === undefined || !Number.isFinite(relativeDaysBeforeEvent)) {
    return null;
  }
  const [y, m, d] = eventDateIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - Math.round(relativeDaysBeforeEvent));
  return dt.toISOString().slice(0, 10);
}

export interface LineItemBreakdown {
  id: string;
  label: string;
  amount: number | null;
  formulaText: string;
  negotiatedOriginalAmount?: number;
  negotiatedSavings?: number;
  isThirdParty?: boolean;
  thirdPartyProvider?: string;
  unresolvedBasis?: boolean;
}

export interface QuoteCalculationResult {
  currencyLabel: string;
  isCurrencyUnknown: boolean;
  baseSubtotal: number;
  selectedAddOnsPreTax: number;
  confirmedExtraFeesPreTax: number;
  paymentOptionAdjustment: number;
  preTaxTotal: number;
  gratuityAmount: number;
  gratuityUnresolved: boolean;
  gratuityBasisLabel?: string;
  taxRate: number;
  taxAmount: number;
  hstAssumed: boolean;
  hstIncluded: boolean;
  taxNotStated: boolean;
  taxStatusLabel: string;
  effectiveTaxHandling: TaxHandling;
  estimatedAllInTotal: number;
  effectiveGuestCountUsed: number | null;
  guestCountMissing: boolean;
  minGuestsApplied: boolean;
  appliedMinGuests: number | null;
  capacityExceeded: boolean;
  unresolvedPackageSelection: boolean;
  selectedPackageName?: string;
  legacyReviewReasons: string[];
  unresolvedMandatoryFeesCount: number;
  unresolvedConflictsCount: number;
  unresolvedPercentageCount: number;
  negotiatedSavings: number;
  isEstimateComplete: boolean;
  lineItemBreakdowns: LineItemBreakdown[];
  blockingReasons: string[];
  canApprove: boolean;
  addOnImpacts: Array<{
    id: string;
    label: string;
    description: string;
    pricePreTax: number;
    impactWithTax: number;
    selected: boolean;
  }>;
  brochureSavings: {
    comparable: boolean;
    brochurePreTax: number;
    personalizedPreTax: number;
    savingsPreTax: number;
    savingsWithTax: number;
    note: string;
  } | null;
  revisionSavings: {
    previousPreTax: number;
    currentPreTax: number;
    savingsPreTax: number;
    savingsWithTax: number;
    summary: string;
  } | null;
}

export function formatCurrency(
  amount: number | null | undefined,
  currency: string = 'CAD',
  options?: { decimals?: number }
): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return 'Unpriced / TBD';
  }
  const decimals = options?.decimals ?? 0;
  const code = currency === 'UNKNOWN' ? '' : `${currency} `;
  const formatted = new Intl.NumberFormat('en-CA', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Math.abs(amount));
  const sign = amount < 0 ? '-' : '';
  return `${sign}${code}$${formatted}`;
}

export function formatShortCad(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return 'TBD';
  }
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  return `${sign}$${new Intl.NumberFormat('en-CA', {
    maximumFractionDigits: 0,
  }).format(Math.round(abs))}`;
}

export function formatSignedCad(delta: number): string {
  const rounded = Math.round(delta);
  if (rounded === 0) return '$0';
  const sign = rounded > 0 ? '+' : '-';
  return `${sign}$${new Intl.NumberFormat('en-CA', {
    maximumFractionDigits: 0,
  }).format(Math.abs(rounded))}`;
}

function getEventGuestCountMap(events: WeddingEvent[]): Record<string, number | null> {
  const map: Record<string, number | null> = {};
  for (const evt of events) {
    map[evt.id] = evt.guestCount;
  }
  return map;
}

function resolveLineItemAmount(
  item: QuoteLineItem,
  guestMap: Record<string, number | null>,
  fallbackGuests: number | null,
  guestCountOverride?: number | null
): {
  amount: number;
  guestsUsed: number | null;
  minApplied: boolean;
  appliedMin: number | null;
  guestMissing: boolean;
} {
  const rawGuests =
    guestCountOverride !== undefined
      ? guestCountOverride
      : item.eventId && item.eventId in guestMap
        ? guestMap[item.eventId]
        : fallbackGuests;

  if (item.pricingModel === 'per_person') {
    const minFloor = item.minGuests ?? 0;
    if (rawGuests === null) {
      if (minFloor > 0) {
        return {
          amount: minFloor * item.unitPrice,
          guestsUsed: minFloor,
          minApplied: true,
          appliedMin: minFloor,
          guestMissing: true,
        };
      }
      return {
        amount: 0,
        guestsUsed: null,
        minApplied: false,
        appliedMin: null,
        guestMissing: true,
      };
    }
    const minApplied = minFloor > 0 && rawGuests < minFloor;
    const effective = Math.max(rawGuests, minFloor);
    return {
      amount: effective * item.unitPrice,
      guestsUsed: effective,
      minApplied,
      appliedMin: minApplied ? minFloor : null,
      guestMissing: false,
    };
  }

  if (item.pricingModel === 'per_extra_guest') {
    const threshold = item.guestThreshold ?? item.minGuests ?? 0;
    if (rawGuests === null) {
      return {
        amount: 0,
        guestsUsed: null,
        minApplied: false,
        appliedMin: null,
        guestMissing: true,
      };
    }
    const extraGuests = Math.max(0, rawGuests - threshold);
    return {
      amount: extraGuests * item.unitPrice,
      guestsUsed: rawGuests,
      minApplied: false,
      appliedMin: null,
      guestMissing: false,
    };
  }

  if (item.pricingModel === 'guest_ratio') {
    if (rawGuests === null) {
      return {
        amount: 0,
        guestsUsed: null,
        minApplied: false,
        appliedMin: null,
        guestMissing: true,
      };
    }
    const divisor = item.ratioDivisor && item.ratioDivisor > 0 ? item.ratioDivisor : 10;
    const units = Math.ceil(rawGuests / divisor);
    return {
      amount: units * item.unitPrice,
      guestsUsed: rawGuests,
      minApplied: false,
      appliedMin: null,
      guestMissing: false,
    };
  }

  if (item.pricingModel === 'hourly') {
    const hours = item.isConditionalOvertime ? (item.quantity ?? 0) : (item.quantity ?? 1);
    return {
      amount: hours * item.unitPrice,
      guestsUsed: null,
      minApplied: false,
      appliedMin: null,
      guestMissing: false,
    };
  }

  // flat
  const qty = item.quantity ?? 1;
  return {
    amount: qty * item.unitPrice,
    guestsUsed: null,
    minApplied: false,
    appliedMin: null,
    guestMissing: false,
  };
}

function resolvePercentageBasis(
  basis: PercentageBasis | undefined,
  baseItems: Array<{ item: QuoteLineItem; amount: number | null }>,
  options?: { targetLabels?: string[]; customBasisAmount?: number }
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
      return {
        amount: Math.round(options.customBasisAmount * 100) / 100,
        label: 'confirmed custom amount',
      };
    }
    return { amount: null, label: 'custom amount not confirmed' };
  }
  if (effectiveBasis === 'entire_subtotal') {
    const sum = baseItems.reduce((acc, e) => acc + (e.amount ?? 0), 0);
    return { amount: Math.round(sum * 100) / 100, label: 'applicable subtotal' };
  }
  if (effectiveBasis === 'food_subtotal') {
    const foodItems = baseItems.filter(
      (e) =>
        e.item.isFoodItem === true ||
        (e.item.isFoodItem !== false &&
          !e.item.isThirdParty &&
          e.item.pricingModel !== 'guest_ratio' &&
          FOOD_ITEM_PATTERN.test(e.item.label))
    );
    if (foodItems.length === 0 || foodItems.some((e) => e.amount === null)) {
      return { amount: null, label: 'food subtotal unresolved' };
    }
    const sum = foodItems.reduce((acc, e) => acc + (e.amount ?? 0), 0);
    return { amount: Math.round(sum * 100) / 100, label: 'food subtotal' };
  }
  if (effectiveBasis === 'specific_line_items') {
    const targets = (options?.targetLabels ?? [])
      .map((t) => t.toLowerCase().trim())
      .filter(Boolean);
    if (targets.length === 0) {
      return { amount: null, label: 'target line items unresolved' };
    }
    const matched = baseItems.filter((e) =>
      targets.some((t) => e.item.label.toLowerCase().includes(t))
    );
    if (matched.length === 0 || matched.some((e) => e.amount === null)) {
      return { amount: null, label: 'target line items unresolved' };
    }
    const sum = matched.reduce((acc, e) => acc + (e.amount ?? 0), 0);
    return { amount: Math.round(sum * 100) / 100, label: targets.join(', ') };
  }
  return { amount: null, label: 'calculation basis unresolved' };
}

function isDuplicateGratuityPercentageItem(item: QuoteLineItem, quote: Quote): boolean {
  if (item.pricingModel !== 'percentage') return false;
  if (!/\b(gratuity|tip|service\s*charge)\b/i.test(item.label)) return false;
  if (quote.gratuityStatus !== 'excluded') return false;
  if (quote.gratuityPercent === undefined || quote.gratuityPercent === null) return false;
  return Math.abs(item.unitPrice - quote.gratuityPercent) < 0.01;
}

const EXTRA_GUEST_LABEL_PATTERN =
  /\b(extra|additional)\s+(guests?|persons?|people|plates?)\b|\bguests?\s+(over|above|beyond)\b/i;

const LEGACY_OVERTIME_PATTERN =
  /\b(additional|extra|overtime|extension|extended|subsequent)\s*(hours?|hrs?)\b|\b(hours?|hrs?)\s*(extension|overtime)\b|\bovertime\b/i;

const MULTI_TIER_PACKAGE_PATTERN =
  /\b(package|menu|tier|plan|royal|imperial|silver|gold|platinum|diamond|classic|deluxe|premium)\b/i;

export function getSelectedPackageOption(quote: Quote): {
  hasMultiplePackages: boolean;
  selectedPackage?: QuotePackageOption;
} {
  const pkgs = quote.packages ?? [];
  if (pkgs.length < 2) {
    return { hasMultiplePackages: false, selectedPackage: pkgs[0] };
  }
  if (!quote.selectedPackageId) {
    return { hasMultiplePackages: true, selectedPackage: undefined };
  }
  const chosen = pkgs.find((p) => p.id === quote.selectedPackageId);
  return { hasMultiplePackages: true, selectedPackage: chosen };
}

export function getEffectiveQuoteInclusions(quote: Quote): string[] {
  const { selectedPackage } = getSelectedPackageOption(quote);
  if (selectedPackage) {
    return Array.from(new Set([...selectedPackage.inclusions, ...quote.inclusions]));
  }
  return quote.inclusions;
}

export function getEffectiveQuoteDeliveryTerms(quote: Quote): string[] {
  const { selectedPackage } = getSelectedPackageOption(quote);
  const pkgTerms = selectedPackage?.deliveryTerms ?? [];
  const quoteTerms = quote.deliveryTerms ?? [];
  return Array.from(new Set([...pkgTerms, ...quoteTerms]));
}

export function getTaxStatusLabel(taxHandling: TaxHandling, taxRate: number): string {
  switch (taxHandling) {
    case 'included':
      return 'Tax / HST included';
    case 'excluded_plus_hst':
      return taxRate > 0 ? `Plus ${Math.round(taxRate * 100)}% HST / tax` : 'Plus tax';
    case 'unspecified_ontario_assumed':
      return `Est. +${Math.round(taxRate * 100)}% HST (assumed)`;
    case 'tax_exempt':
      return 'Confirmed no tax charged (0%)';
    case 'unspecified':
    default:
      return 'Tax not stated — excluded from estimate.';
  }
}

function isRedundantExtraGuestLineItem(
  item: QuoteLineItem,
  activeItems: QuoteLineItem[],
  quote: Quote,
  selectedPackage?: QuotePackageOption
): boolean {
  if (selectedPackage && item.id === `pkg-active-${selectedPackage.id}`) return false;
  const isExtraGuestCandidate =
    item.pricingModel === 'per_extra_guest' ||
    (item.pricingModel === 'per_person' && EXTRA_GUEST_LABEL_PATTERN.test(item.label));
  if (!isExtraGuestCandidate) return false;

  if (
    selectedPackage &&
    selectedPackage.pricingModel === 'per_person' &&
    Math.abs(selectedPackage.unitPrice - item.unitPrice) < 0.01
  ) {
    return true;
  }
  if (
    !item.packageId &&
    (quote.packages ?? []).some(
      (p) =>
        p.pricingModel === 'per_person' &&
        Math.abs(p.unitPrice - item.unitPrice) < 0.01
    )
  ) {
    return true;
  }

  return activeItems.some(
    (sibling) =>
      sibling.id !== item.id &&
      sibling.pricingModel === 'per_person' &&
      !EXTRA_GUEST_LABEL_PATTERN.test(sibling.label) &&
      Math.abs(sibling.unitPrice - item.unitPrice) < 0.01
  );
}

/**
 * Flags legacy saved quotes that exhibit known pre-fix calculation failure patterns
 * so they are never silently retained as bookable without user re-review.
 */
export function detectLegacyQuoteReviewReasons(quote: Quote): string[] {
  if (quote.legacyReviewAcknowledged) return [];
  const reasons: string[] = [];

  // 1. Multiple per_person package/tier items summed in a legacy quote without packages[]
  if (!quote.packages || quote.packages.length === 0) {
    const perPersonBaseItems = quote.lineItems.filter(
      (li) => li.pricingModel === 'per_person' && !EXTRA_GUEST_LABEL_PATTERN.test(li.label)
    );
    const tierNamedItems = perPersonBaseItems.filter((li) =>
      MULTI_TIER_PACKAGE_PATTERN.test(li.label)
    );
    if (tierNamedItems.length >= 2) {
      reasons.push(
        'Multiple per-person package options appear summed together — re-review and choose one package.'
      );
    }

    const extraGuestPerPerson = quote.lineItems.filter(
      (li) => li.pricingModel === 'per_person' && EXTRA_GUEST_LABEL_PATTERN.test(li.label)
    );
    if (perPersonBaseItems.length >= 1 && extraGuestPerPerson.length >= 1) {
      reasons.push(
        'Extra-guest pricing may be applied across all guests instead of incremental guests — re-review line items.'
      );
    }
  }

  // 2. Conditional overtime hourly rate billed by default alongside a flat package
  const hasFlatBase = quote.lineItems.some((li) => li.pricingModel === 'flat');
  if (hasFlatBase) {
    const suspiciousOvertime = quote.lineItems.find(
      (li) =>
        li.pricingModel === 'hourly' &&
        !li.isConditionalOvertime &&
        (li.quantity ?? 1) >= 1 &&
        LEGACY_OVERTIME_PATTERN.test(li.label)
    );
    if (suspiciousOvertime) {
      reasons.push(
        `Additional hourly rate ("${suspiciousOvertime.label}") is billed by default — verify whether extra hours are needed.`
      );
    }
  }

  // 3. Unknown tax previously auto-mapped to tax_exempt
  if (
    quote.taxHandling === 'tax_exempt' &&
    quote.sourceText.trim().length > 0 &&
    !/\b(tax[\s-]*exempt|no\s*tax|tax[\s-]*free|0%\s*tax|zero\s*tax)\b/i.test(quote.sourceText)
  ) {
    reasons.push(
      'Tax was previously marked tax-exempt without explicit source wording — confirm actual tax handling.'
    );
  }

  return reasons;
}

/**
 * Pure deterministic calculator for any vendor quote.
 * Guarantees consistent tax/gratuity handling, structured percentage bases,
 * minimum guest floors, staffing ratios, optional add-ons, negotiated savings,
 * conflict checks, and approval blockers.
 */
export function calculateQuoteFinancials(
  quote: Quote,
  events: WeddingEvent[],
  vendorEventIds: string[],
  guestCountOverride?: number | null
): QuoteCalculationResult {
  const guestMap = getEventGuestCountMap(events);
  const primaryEventGuests =
    guestCountOverride !== undefined
      ? guestCountOverride
      : vendorEventIds.length > 0 && vendorEventIds[0] in guestMap
        ? guestMap[vendorEventIds[0]]
        : null;

  let baseSubtotal = 0;
  let minGuestsApplied = false;
  let appliedMinGuests: number | null = null;
  let effectiveGuestCountUsed: number | null = null;
  let guestCountMissing = false;
  let negotiatedSavings = 0;
  let unresolvedPercentageCount = 0;
  const lineItemBreakdowns: LineItemBreakdown[] = [];
  const resolvedBaseItems: Array<{ item: QuoteLineItem; amount: number | null }> = [];
  const percentageItems: QuoteLineItem[] = [];

  const resolvedConflictPriceByLineItem: Record<string, number> = {};
  for (const conflict of quote.conflicts) {
    if (conflict.targetLineItemId) {
      const chosen =
        conflict.options.find((o) => o.id === conflict.resolvedOptionId) ??
        conflict.options[0];
      if (chosen) {
        resolvedConflictPriceByLineItem[conflict.targetLineItemId] = chosen.amount;
      }
    }
  }

  const { hasMultiplePackages, selectedPackage } = getSelectedPackageOption(quote);
  const unresolvedPackageSelection = hasMultiplePackages && !selectedPackage;

  const activeItems: QuoteLineItem[] = [];
  if (selectedPackage) {
    activeItems.push({
      id: `pkg-active-${selectedPackage.id}`,
      label: selectedPackage.name,
      pricingModel: selectedPackage.pricingModel,
      unitPrice: selectedPackage.unitPrice,
      minGuests: selectedPackage.minGuests,
      isFoodItem: selectedPackage.isFoodItem,
      eventId: vendorEventIds[0],
      evidenceId: selectedPackage.evidenceId,
      pageReference: selectedPackage.pageReference,
    });

    if (
      selectedPackage.pricingModel === 'flat' &&
      selectedPackage.extraGuestRate !== undefined &&
      selectedPackage.extraGuestRate > 0 &&
      (selectedPackage.includedGuests !== undefined || selectedPackage.minGuests !== undefined)
    ) {
      activeItems.push({
        id: `pkg-extra-${selectedPackage.id}`,
        label: `${selectedPackage.name} extra guests`,
        pricingModel: 'per_extra_guest',
        unitPrice: selectedPackage.extraGuestRate,
        guestThreshold: selectedPackage.includedGuests ?? selectedPackage.minGuests,
        isFoodItem: selectedPackage.isFoodItem,
        eventId: vendorEventIds[0],
        evidenceId: selectedPackage.evidenceId,
      });
    }

    if (selectedPackage.fees && selectedPackage.fees.length > 0) {
      activeItems.push(...selectedPackage.fees);
    }
  }

  const knownPackageIds = new Set((quote.packages ?? []).map((p) => p.id.toLowerCase()));
  for (const li of quote.lineItems) {
    const liPkgId = li.packageId?.trim().toLowerCase();
    if (hasMultiplePackages && liPkgId && knownPackageIds.has(liPkgId)) {
      if (!selectedPackage || liPkgId !== selectedPackage.id.toLowerCase()) {
        continue;
      }
    }
    if (
      selectedPackage &&
      !hasMultiplePackages &&
      li.pricingModel === selectedPackage.pricingModel &&
      Math.abs(li.unitPrice - selectedPackage.unitPrice) < 0.01
    ) {
      continue;
    }
    activeItems.push(li);
  }

  for (const item of activeItems) {
    if (isRedundantExtraGuestLineItem(item, activeItems, quote, selectedPackage)) {
      continue;
    }
    if (item.pricingModel === 'percentage') {
      percentageItems.push(item);
      continue;
    }
    const overriddenUnitPrice =
      resolvedConflictPriceByLineItem[item.id] !== undefined
        ? resolvedConflictPriceByLineItem[item.id]
        : item.unitPrice;
    const effectiveItem: QuoteLineItem = {
      ...item,
      unitPrice: overriddenUnitPrice,
      minGuests: item.minGuests ?? selectedPackage?.minGuests ?? quote.minGuests,
    };
    const res = resolveLineItemAmount(
      effectiveItem,
      guestMap,
      primaryEventGuests,
      guestCountOverride
    );
    baseSubtotal += res.amount;
    if (res.minApplied) {
      minGuestsApplied = true;
      appliedMinGuests = res.appliedMin;
    }
    if (res.guestsUsed !== null) effectiveGuestCountUsed = res.guestsUsed;
    if (res.guestMissing) guestCountMissing = true;

    let itemSavings: number | undefined;
    let itemOriginalTotal: number | undefined;
    if (
      item.originalUnitPrice !== undefined &&
      item.originalUnitPrice > overriddenUnitPrice &&
      !quote.conflicts.some((c) => c.targetLineItemId === item.id)
    ) {
      const origRes = resolveLineItemAmount(
        { ...effectiveItem, unitPrice: item.originalUnitPrice },
        guestMap,
        primaryEventGuests,
        guestCountOverride
      );
      if (origRes.amount > res.amount) {
        itemOriginalTotal = Math.round(origRes.amount * 100) / 100;
        itemSavings = Math.round((origRes.amount - res.amount) * 100) / 100;
        negotiatedSavings = Math.round((negotiatedSavings + itemSavings) * 100) / 100;
      }
    }

    let formulaText = `$${overriddenUnitPrice.toLocaleString('en-CA')} fixed`;
    if (effectiveItem.pricingModel === 'per_person') {
      formulaText =
        res.guestsUsed !== null
          ? `$${overriddenUnitPrice.toLocaleString('en-CA')}/guest × ${res.guestsUsed} guests${
              res.minApplied && res.appliedMin ? ` (min ${res.appliedMin} applied)` : ''
            }`
          : `$${overriddenUnitPrice.toLocaleString('en-CA')}/guest (guest count needed)`;
    } else if (effectiveItem.pricingModel === 'per_extra_guest') {
      const threshold = effectiveItem.guestThreshold ?? effectiveItem.minGuests ?? 0;
      if (res.guestsUsed !== null) {
        const extra = Math.max(0, res.guestsUsed - threshold);
        formulaText = `$${overriddenUnitPrice.toLocaleString('en-CA')}/extra guest above ${threshold} × ${extra} extra guest${extra === 1 ? '' : 's'}`;
      } else {
        formulaText = `$${overriddenUnitPrice.toLocaleString('en-CA')}/extra guest above ${threshold} (guest count needed)`;
      }
    } else if (effectiveItem.pricingModel === 'guest_ratio') {
      const divisor = effectiveItem.ratioDivisor && effectiveItem.ratioDivisor > 0 ? effectiveItem.ratioDivisor : 10;
      const unitWord = effectiveItem.unitLabel || 'unit';
      if (res.guestsUsed !== null) {
        const units = Math.ceil(res.guestsUsed / divisor);
        formulaText = `$${overriddenUnitPrice.toLocaleString('en-CA')} per ${unitWord} · 1 per ${divisor} guests · ${res.guestsUsed} guests → ${units} ${unitWord}${units === 1 ? '' : 's'}`;
      } else {
        formulaText = `$${overriddenUnitPrice.toLocaleString('en-CA')} per ${unitWord} (1 per ${divisor} guests)`;
      }
    } else if (effectiveItem.pricingModel === 'hourly') {
      if (effectiveItem.isConditionalOvertime) {
        const overtimeHrs = effectiveItem.quantity ?? 0;
        const includedText = effectiveItem.includedPackageHours
          ? ` (above ${effectiveItem.includedPackageHours} included hrs)`
          : '';
        formulaText = `${overtimeHrs} overtime hr${overtimeHrs === 1 ? '' : 's'} × $${overriddenUnitPrice.toLocaleString('en-CA')}/hr${includedText}`;
      } else {
        const hrs = effectiveItem.quantity ?? 1;
        formulaText = `$${overriddenUnitPrice.toLocaleString('en-CA')}/hr × ${hrs} hr${hrs === 1 ? '' : 's'}`;
      }
    }

    resolvedBaseItems.push({ item: effectiveItem, amount: res.guestMissing && res.amount === 0 ? null : res.amount });
    lineItemBreakdowns.push({
      id: item.id,
      label: item.label,
      amount: Math.round(res.amount * 100) / 100,
      formulaText,
      negotiatedOriginalAmount: itemOriginalTotal,
      negotiatedSavings: itemSavings,
      isThirdParty: item.isThirdParty,
      thirdPartyProvider: item.thirdPartyProvider,
    });
  }

  let paymentOptionAdjustment = 0;
  let effectiveTaxHandling: TaxHandling = selectedPackage?.taxHandling ?? quote.taxHandling;
  if (quote.paymentOptions && quote.paymentOptions.length > 0) {
    const activeOpt =
      quote.paymentOptions.find((o) => o.id === quote.selectedPaymentOptionId) ??
      quote.paymentOptions[0];
    paymentOptionAdjustment = activeOpt.adjustmentDelta;
    effectiveTaxHandling = activeOpt.taxHandling;
  }

  // Resolve confirmed extra fees BEFORE evaluating whole-subtotal percentage charges
  let confirmedExtraFeesPreTax = 0;
  let unresolvedMandatoryFeesCount = 0;
  for (const fee of quote.unconfirmedFees) {
    if (fee.status === 'confirmed_amount' && typeof fee.confirmedAmount === 'number') {
      confirmedExtraFeesPreTax += fee.confirmedAmount;
      resolvedBaseItems.push({
        item: {
          id: fee.id,
          label: fee.label,
          pricingModel: 'flat',
          unitPrice: fee.confirmedAmount,
          isFoodItem: false,
        },
        amount: fee.confirmedAmount,
      });
    } else if (fee.mandatory && fee.status === 'unconfirmed') {
      unresolvedMandatoryFeesCount += 1;
    }
  }

  const hstIncluded = effectiveTaxHandling === 'included';
  const hstAssumed = effectiveTaxHandling === 'unspecified_ontario_assumed';
  const effectiveTaxPercentValue =
    selectedPackage?.taxPercent !== undefined ? selectedPackage.taxPercent : quote.taxPercent;
  const explicitTaxRate =
    effectiveTaxPercentValue !== undefined && Number.isFinite(effectiveTaxPercentValue)
      ? effectiveTaxPercentValue / 100
      : ONTARIO_HST_RATE;
  const hasExplicitTaxLineItem = activeItems.some((li) =>
    /\b(hst|gst|pst|sales\s*tax|tax)\b/i.test(li.label)
  );
  const taxNotStated = !hasExplicitTaxLineItem && effectiveTaxHandling === 'unspecified';
  const taxRate =
    hasExplicitTaxLineItem ||
    effectiveTaxHandling === 'included' ||
    effectiveTaxHandling === 'tax_exempt' ||
    effectiveTaxHandling === 'unspecified'
      ? 0
      : explicitTaxRate;
  const taxStatusLabel = hasExplicitTaxLineItem
    ? 'Tax listed in line items'
    : getTaxStatusLabel(effectiveTaxHandling, taxRate);

  // Evaluate optional add-ons using their preserved pricing models (per_person, hourly, guest_ratio, percentage, flat)
  let selectedAddOnsPreTax = 0;
  const addOnImpacts = quote.addOns.map((addon) => {
    const model = addon.pricingModel ?? 'flat';
    let computedPreTax = addon.pricePreTax;
    if (model === 'percentage') {
      const basis = resolvePercentageBasis(addon.percentageBasis, resolvedBaseItems, {
        targetLabels: addon.percentageTargetLabels,
        customBasisAmount: addon.customBasisAmount,
      });
      computedPreTax =
        basis.amount !== null
          ? Math.round(basis.amount * (addon.pricePreTax / 100) * 100) / 100
          : 0;
    } else if (model !== 'flat') {
      const addonRes = resolveLineItemAmount(
        {
          id: addon.id,
          label: addon.label,
          pricingModel: model,
          unitPrice: addon.pricePreTax,
          quantity: addon.quantity,
          ratioDivisor: addon.ratioDivisor,
          unitLabel: addon.unitLabel,
          minGuests: addon.minGuests,
          eventId: addon.eventId,
        },
        guestMap,
        primaryEventGuests,
        guestCountOverride
      );
      computedPreTax = Math.round(addonRes.amount * 100) / 100;
    }

    if (addon.selected) {
      selectedAddOnsPreTax = Math.round((selectedAddOnsPreTax + computedPreTax) * 100) / 100;
      if (model !== 'percentage') {
        resolvedBaseItems.push({
          item: {
            id: addon.id,
            label: addon.label,
            pricingModel: model,
            unitPrice: addon.pricePreTax,
            isFoodItem: false,
          },
          amount: computedPreTax,
        });
      }
    }
    const impactWithTax = Math.round(computedPreTax * (1 + taxRate) * 100) / 100;
    return {
      id: addon.id,
      label: addon.label,
      description: addon.description,
      pricePreTax: computedPreTax,
      impactWithTax,
      selected: addon.selected,
    };
  });

  // Evaluate non-duplicate percentage-based line items AFTER confirmed fees & selected non-percentage add-ons
  for (const pctItem of percentageItems) {
    if (isDuplicateGratuityPercentageItem(pctItem, quote)) {
      continue;
    }
    const rate = pctItem.unitPrice;
    const basis = resolvePercentageBasis(pctItem.percentageBasis, resolvedBaseItems, {
      targetLabels: pctItem.percentageTargetLabels,
      customBasisAmount: pctItem.customBasisAmount,
    });
    if (basis.amount === null) {
      unresolvedPercentageCount += 1;
      lineItemBreakdowns.push({
        id: pctItem.id,
        label: pctItem.label,
        amount: null,
        formulaText: `${rate}% (${basis.label})`,
        isThirdParty: pctItem.isThirdParty,
        thirdPartyProvider: pctItem.thirdPartyProvider,
        unresolvedBasis: true,
      });
    } else {
      const charge = Math.round(basis.amount * (rate / 100) * 100) / 100;
      baseSubtotal = Math.round((baseSubtotal + charge) * 100) / 100;
      lineItemBreakdowns.push({
        id: pctItem.id,
        label: pctItem.label,
        amount: charge,
        formulaText: `${rate}% of ${basis.label} ($${basis.amount.toLocaleString('en-CA')})`,
        isThirdParty: pctItem.isThirdParty,
        thirdPartyProvider: pctItem.thirdPartyProvider,
      });
    }
  }

  const preTaxTotal = Math.max(
    0,
    Math.round(
      (baseSubtotal + paymentOptionAdjustment + confirmedExtraFeesPreTax + selectedAddOnsPreTax) *
        100
    ) / 100
  );

  // Gratuity calculation (prevent duplicate application; support package-specific overrides & structured bases)
  const effectiveGratuityStatus = selectedPackage?.gratuityStatus ?? quote.gratuityStatus;
  const effectiveGratuityPercent =
    selectedPackage?.gratuityPercent !== undefined
      ? selectedPackage.gratuityPercent
      : quote.gratuityPercent;
  const effectiveGratuityBasis = selectedPackage?.gratuityBasis ?? quote.gratuityBasis;

  const hasExplicitGratuityLineItem = activeItems.some(
    (li) =>
      !isDuplicateGratuityPercentageItem(li, quote) &&
      /\b(gratuity|tip|service\s*charge)\b/i.test(li.label)
  );
  let gratuityAmount = 0;
  let gratuityUnresolved = false;
  let gratuityBasisLabel: string | undefined;

  if (!hasExplicitGratuityLineItem) {
    if (
      effectiveGratuityStatus === 'excluded' &&
      (effectiveGratuityPercent === undefined || effectiveGratuityPercent === null)
    ) {
      gratuityUnresolved = true;
      gratuityBasisLabel = 'percentage unknown';
    } else if (
      effectiveGratuityPercent !== undefined &&
      effectiveGratuityPercent !== null &&
      effectiveGratuityPercent > 0 &&
      effectiveGratuityStatus !== 'included'
    ) {
      const basisType = effectiveGratuityBasis ?? 'entire_subtotal';
      if (basisType === 'entire_subtotal') {
        gratuityAmount = Math.round(preTaxTotal * (effectiveGratuityPercent / 100) * 100) / 100;
        gratuityBasisLabel = 'applicable subtotal';
      } else {
        const basis = resolvePercentageBasis(basisType, resolvedBaseItems);
        if (basis.amount === null) {
          gratuityUnresolved = true;
          gratuityBasisLabel = basis.label;
        } else {
          gratuityAmount = Math.round(basis.amount * (effectiveGratuityPercent / 100) * 100) / 100;
          gratuityBasisLabel = basis.label;
        }
      }
    }
  }

  const taxableBase = preTaxTotal + gratuityAmount;
  const taxAmount = Math.round(taxableBase * taxRate * 100) / 100;
  const estimatedAllInTotal = Math.round((taxableBase + taxAmount) * 100) / 100;

  const effectiveMaxCap = selectedPackage?.maxCapacity ?? quote.maxCapacity;
  const capacityExceeded =
    effectiveMaxCap !== undefined &&
    primaryEventGuests !== null &&
    primaryEventGuests > effectiveMaxCap;

  const unresolvedConflictsCount = quote.conflicts.filter((c) => !c.resolvedOptionId).length;
  const isCurrencyUnknown = quote.currency === 'UNKNOWN';
  const legacyReviewReasons = detectLegacyQuoteReviewReasons(quote);

  const blockingReasons: string[] = [];
  if (unresolvedPackageSelection) {
    blockingReasons.push(
      'Select one package option before approving this quote, or Save as Draft to keep all options.'
    );
  }
  if (isCurrencyUnknown) {
    blockingReasons.push('Confirm currency (CAD or USD) before approving.');
  }
  if (unresolvedConflictsCount > 0) {
    blockingReasons.push(
      `Resolve ${unresolvedConflictsCount} conflicting price ${
        unresolvedConflictsCount === 1 ? 'figure' : 'figures'
      } before approving.`
    );
  }
  if (unresolvedMandatoryFeesCount > 0) {
    blockingReasons.push(
      `Resolve ${unresolvedMandatoryFeesCount} unconfirmed mandatory ${
        unresolvedMandatoryFeesCount === 1 ? 'fee' : 'fees'
      } (enter confirmed amount or mark included/waived), or Save as Draft.`
    );
  }
  if (gratuityUnresolved) {
    blockingReasons.push(
      'Confirm the mandatory gratuity percentage and calculation basis before approving, or Save as Draft.'
    );
  }
  if (unresolvedPercentageCount > 0) {
    blockingReasons.push(
      `Confirm the calculation basis for ${unresolvedPercentageCount} percentage-based ${
        unresolvedPercentageCount === 1 ? 'charge' : 'charges'
      } before approving, or Save as Draft.`
    );
  }
  if (quote.sourceWarnings && quote.sourceWarnings.length > 0 && !quote.sourceWarningsAcknowledged) {
    blockingReasons.push(
      'Review flagged source evidence warnings against the original document before approving.'
    );
  }

  let brochureSavings: QuoteCalculationResult['brochureSavings'] = null;
  if (quote.brochureReference) {
    const ref = quote.brochureReference;
    const personalizedBase = baseSubtotal + paymentOptionAdjustment;
    const diff = ref.publishedPricePreTax - personalizedBase;
    brochureSavings = {
      comparable: ref.isComparable,
      brochurePreTax: ref.publishedPricePreTax,
      personalizedPreTax: personalizedBase,
      savingsPreTax: ref.isComparable ? diff : 0,
      savingsWithTax: ref.isComparable ? Math.round(diff * (1 + taxRate) * 100) / 100 : 0,
      note: ref.comparabilityNote,
    };
  }

  let revisionSavings: QuoteCalculationResult['revisionSavings'] = null;
  if (quote.revisions && quote.revisions.length > 0) {
    const latest = quote.revisions[quote.revisions.length - 1];
    const diff = latest.previousPreTaxTotal - latest.newPreTaxTotal;
    if (diff > 0) {
      revisionSavings = {
        previousPreTax: latest.previousPreTaxTotal,
        currentPreTax: latest.newPreTaxTotal,
        savingsPreTax: diff,
        savingsWithTax: Math.round(diff * (1 + taxRate) * 100) / 100,
        summary: latest.summary,
      };
    }
  }

  return {
    currencyLabel: quote.currency === 'UNKNOWN' ? 'Currency TBD' : quote.currency,
    isCurrencyUnknown,
    baseSubtotal,
    selectedAddOnsPreTax,
    confirmedExtraFeesPreTax,
    paymentOptionAdjustment,
    preTaxTotal,
    gratuityAmount,
    gratuityUnresolved,
    gratuityBasisLabel,
    taxRate,
    taxAmount,
    hstAssumed,
    hstIncluded,
    taxNotStated,
    taxStatusLabel,
    effectiveTaxHandling,
    estimatedAllInTotal,
    effectiveGuestCountUsed,
    guestCountMissing,
    minGuestsApplied,
    appliedMinGuests,
    capacityExceeded,
    unresolvedPackageSelection,
    selectedPackageName: selectedPackage?.name,
    legacyReviewReasons,
    unresolvedMandatoryFeesCount,
    unresolvedConflictsCount,
    unresolvedPercentageCount,
    negotiatedSavings,
    isEstimateComplete: blockingReasons.length === 0 && !guestCountMissing && !taxNotStated,
    lineItemBreakdowns,
    blockingReasons,
    canApprove: blockingReasons.length === 0,
    addOnImpacts,
    brochureSavings,
    revisionSavings,
  };
}

export function getVendorActiveQuote(vendor: Vendor): Quote | undefined {
  if (!vendor.quotes.length) return undefined;
  if (vendor.activeQuoteId) {
    const found = vendor.quotes.find((q) => q.id === vendor.activeQuoteId);
    if (found) return found;
  }
  return vendor.quotes[vendor.quotes.length - 1];
}

export interface BookingEligibilityResult {
  canBook: boolean;
  blockingReasons: string[];
}

/**
 * Centralized booking eligibility validation enforced across every booking UI
 * entry point and inside confirmBooking.
 */
export function getVendorBookingEligibility(
  vendor: Vendor,
  events: WeddingEvent[]
): BookingEligibilityResult {
  const blockingReasons: string[] = [];
  const activeQuote = getVendorActiveQuote(vendor);

  if (!activeQuote || activeQuote.approvalState !== 'approved') {
    blockingReasons.push('An approved quote is required before booking.');
  }

  if (vendor.draftQuote) {
    blockingReasons.push(
      'Resolve or approve the pending draft quote before confirming a booking.'
    );
  }

  if (activeQuote) {
    const calc = calculateQuoteFinancials(activeQuote, events, vendor.eventIds);
    if (calc.unresolvedPackageSelection) {
      blockingReasons.push('Select one package option before confirming a booking.');
    }
    if (calc.isCurrencyUnknown) {
      blockingReasons.push('Confirm quote currency (CAD or USD) before booking.');
    }
    if (calc.taxNotStated) {
      blockingReasons.push(
        'Confirm tax handling before booking (tax is not stated on this quote).'
      );
    }
    if (calc.legacyReviewReasons.length > 0) {
      blockingReasons.push(
        `Re-review this quote before booking: ${calc.legacyReviewReasons[0]}`
      );
    }
    if (calc.unresolvedMandatoryFeesCount > 0) {
      blockingReasons.push(
        `Resolve ${calc.unresolvedMandatoryFeesCount} unconfirmed mandatory ${
          calc.unresolvedMandatoryFeesCount === 1 ? 'fee' : 'fees'
        } before booking.`
      );
    }
    if (calc.unresolvedConflictsCount > 0) {
      blockingReasons.push(
        `Resolve ${calc.unresolvedConflictsCount} conflicting price ${
          calc.unresolvedConflictsCount === 1 ? 'figure' : 'figures'
        } before booking.`
      );
    }
    if (calc.gratuityUnresolved) {
      blockingReasons.push(
        'Confirm the mandatory gratuity percentage and calculation basis before booking.'
      );
    }
    if (calc.unresolvedPercentageCount > 0) {
      blockingReasons.push(
        `Confirm the calculation basis for ${calc.unresolvedPercentageCount} percentage-based ${
          calc.unresolvedPercentageCount === 1 ? 'charge' : 'charges'
        } before booking.`
      );
    }
  }

  return {
    canBook: blockingReasons.length === 0,
    blockingReasons,
  };
}

export const DEFAULT_DEPOSIT_ALREADY_PAID = false;

export interface BuildBookingMilestonesInput {
  contractTotal: number;
  depositAmount: number;
  depositAlreadyPaid?: boolean;
  depositDate: string;
  depositPayer: string;
  coupleNames: string;
  balanceHasKnownDate: boolean;
  balanceDueDate: string;
  balanceRelativeLabel: string;
  balancePayer: string;
}

export function buildBookingMilestones(
  input: BuildBookingMilestonesInput
): Array<
  Omit<PaymentMilestone, 'id' | 'vendorId' | 'vendorName' | 'eventId' | 'eventLabel'>
> {
  const totalNum = Math.max(0, input.contractTotal);
  const depositNum = Math.min(totalNum, Math.max(0, input.depositAmount));
  const remainingNum = Math.max(0, Math.round((totalNum - depositNum) * 100) / 100);
  const depositPaid = input.depositAlreadyPaid ?? DEFAULT_DEPOSIT_ALREADY_PAID;

  const milestones: Array<
    Omit<PaymentMilestone, 'id' | 'vendorId' | 'vendorName' | 'eventId' | 'eventLabel'>
  > = [];

  if (depositNum > 0) {
    milestones.push({
      label: 'Booking Deposit',
      amount: depositNum,
      dueDate: input.depositDate || null,
      status: depositPaid ? 'Paid' : 'Upcoming',
      paidDate: depositPaid ? input.depositDate : undefined,
      payer: input.depositPayer,
      paidBy: depositPaid
        ? input.depositPayer === 'Unassigned'
          ? input.coupleNames
          : input.depositPayer
        : undefined,
      reminderEnabled: !depositPaid && Boolean(input.depositDate),
    });
  }

  if (remainingNum > 0) {
    milestones.push({
      label: 'Final Balance',
      amount: remainingNum,
      dueDate: input.balanceHasKnownDate ? input.balanceDueDate || null : null,
      relativeDueLabel: input.balanceHasKnownDate
        ? undefined
        : input.balanceRelativeLabel,
      status: input.balanceHasKnownDate ? 'Upcoming' : 'Date TBD',
      payer: input.balancePayer,
      reminderEnabled: input.balanceHasKnownDate && Boolean(input.balanceDueDate),
    });
  }

  return milestones;
}

/**
 * Computes the deterministic reason why an event's projected total did not change
 * (or changed by a specific signed CAD delta) when guest count changed.
 */
export function explainEventGuestCountImpact(
  workspace: WeddingWorkspace,
  eventId: string,
  previousGuests: number | null,
  currentGuests: number | null
): {
  currentEventTotal: number;
  previousEventTotal: number;
  signedDelta: number;
  unchangedReason: string | null;
} {
  const computeTotalForGuestCount = (guests: number | null): {
    total: number;
    hasPerGuestItems: boolean;
    activeMinFloor: number | null;
    hasLockedBookedPerPerson: boolean;
  } => {
    const simulatedEvents = workspace.events.map((e) =>
      e.id === eventId ? { ...e, guestCount: guests } : e
    );
    let total = 0;
    let hasPerGuestItems = false;
    let activeMinFloor: number | null = null;
    let hasLockedBookedPerPerson = false;

    const activeVendors = workspace.vendors.filter(
      (v) =>
        v.eventIds.includes(eventId) &&
        (v.status === 'Booked' || (v.isPreferred && v.status !== 'Declined'))
    );

    for (const v of activeVendors) {
      const q = getVendorActiveQuote(v);
      if (!q) continue;
      const affectsThisEvent = q.lineItems.some(
        (li) =>
          (li.pricingModel === 'per_person' || li.pricingModel === 'guest_ratio') &&
          (!li.eventId || li.eventId === eventId)
      );
      if (affectsThisEvent) hasPerGuestItems = true;

      if (v.status === 'Booked' && v.bookedContractTotal !== undefined) {
        total += v.bookedContractTotal;
        if (affectsThisEvent) hasLockedBookedPerPerson = true;
      } else {
        const calc = calculateQuoteFinancials(q, simulatedEvents, v.eventIds);
        // Include single-event vendors AND guest-linked line items of shared vendors in event sensitivity
        if (v.eventIds.length === 1) {
          total += calc.estimatedAllInTotal;
          if (calc.minGuestsApplied && calc.appliedMinGuests) {
            activeMinFloor = calc.appliedMinGuests;
          }
        } else if (affectsThisEvent) {
          // Only add the event-specific scaling delta contribution for shared vendors (e.g., Marigold reception centerpieces)
          const eventSpecificItems = q.lineItems.filter(
            (li) => li.eventId === eventId
          );
          const subQuote: Quote = {
            ...q,
            lineItems: eventSpecificItems,
            addOns: [],
            unconfirmedFees: [],
            conflicts: [],
          };
          const subCalc = calculateQuoteFinancials(
            subQuote,
            simulatedEvents,
            [eventId]
          );
          total += subCalc.estimatedAllInTotal;
        }
      }
    }

    for (const m of workspace.manualExpenses) {
      if (m.eventIds.includes(eventId) && m.eventIds.length === 1 && m.estimatedAmount !== null) {
        total += m.estimatedAmount;
      }
    }

    return {
      total: Math.round(total * 100) / 100,
      hasPerGuestItems,
      activeMinFloor,
      hasLockedBookedPerPerson,
    };
  };

  const prev = computeTotalForGuestCount(previousGuests);
  const curr = computeTotalForGuestCount(currentGuests);
  const signedDelta = Math.round((curr.total - prev.total) * 100) / 100;

  let unchangedReason: string | null = null;
  if (Math.round(signedDelta) === 0 && previousGuests !== currentGuests) {
    if (curr.total === 0 && !curr.hasPerGuestItems) {
      unchangedReason = 'No priced per-guest quotes yet';
    } else if (curr.activeMinFloor !== null) {
      unchangedReason = `${curr.activeMinFloor}-guest minimum applies`;
    } else if (curr.hasLockedBookedPerPerson) {
      unchangedReason = 'Booked contract total is locked';
    } else if (!curr.hasPerGuestItems) {
      unchangedReason = 'Fixed costs only';
    } else {
      unchangedReason = 'Within same pricing tier';
    }
  } else if (Math.round(signedDelta) === 0) {
    if (curr.activeMinFloor !== null) {
      unchangedReason = `${curr.activeMinFloor}-guest minimum applies`;
    } else if (curr.hasLockedBookedPerPerson) {
      unchangedReason = 'Booked contract total is locked';
    } else if (!curr.hasPerGuestItems && curr.total > 0) {
      unchangedReason = 'Fixed costs only';
    }
  }

  return {
    currentEventTotal: curr.total,
    previousEventTotal: prev.total,
    signedDelta,
    unchangedReason,
  };
}

export interface CategoryBreakdownItem {
  category: VendorCategory;
  label: string;
  projected: number;
  committed: number;
  paid: number;
  sharePercent: number;
  tone: PastelTone;
}

export interface EventFinancialSummary {
  eventId: string;
  directProjected: number;
  directCommitted: number;
  sharedPackageCount: number;
  sharedPackageNames: string[];
  unpricedCount: number;
  vendorCount: number;
}

export interface WorkspaceFinancialSummary {
  budgetTarget: number | null;
  projectedSpend: number;
  committedSpend: number;
  paidToDate: number;
  remainingBudget: number | null;
  remainingToPay: number;
  pricedExpenseCount: number;
  totalExpenseCount: number;
  unpricedExpenseCount: number;
  completenessPercent: number;
  budgetRows: BudgetRow[];
  categoryBreakdown: CategoryBreakdownItem[];
  eventSummaries: Record<string, EventFinancialSummary>;
  insights: string[];
}

export const CATEGORY_META: Record<
  VendorCategory,
  { label: string; tone: PastelTone }
> = {
  venue: { label: 'Venue & Banquet', tone: 'sage' },
  catering: { label: 'Catering & Food', tone: 'peach' },
  photography: { label: 'Photography', tone: 'lavender' },
  videography: { label: 'Videography', tone: 'blue' },
  decor: { label: 'Decor & Florals', tone: 'blush' },
  dj: { label: 'DJ & Sound', tone: 'blue' },
  entertainment: { label: 'Entertainment', tone: 'lavender' },
  beauty: { label: 'Hair & Makeup', tone: 'blush' },
  transportation: { label: 'Transportation', tone: 'blue' },
  other: { label: 'Ceremony & Other', tone: 'sage' },
};

/**
 * Centralized deterministic calculation across the entire workspace.
 * - Counts shared multi-event packages strictly ONCE in total wedding spend.
 * - Counts ONLY booked or preferred vendors (competing vendors are never summed).
 * - Never double-counts booked costs in projected spend.
 * - Never treats Unpriced / TBD items as $0.
 */
export function calculateWorkspaceFinancials(
  workspace: WeddingWorkspace
): WorkspaceFinancialSummary {
  const budgetRows: BudgetRow[] = [];

  const paidByVendor: Record<string, number> = {};
  for (const payment of workspace.payments) {
    if (payment.status === 'Paid') {
      paidByVendor[payment.vendorId] = (paidByVendor[payment.vendorId] ?? 0) + payment.amount;
    }
  }

  const budgetVendors = workspace.vendors.filter(
    (v) => v.status === 'Booked' || (v.isPreferred && v.status !== 'Declined')
  );

  for (const vendor of budgetVendors) {
    const activeQuote = getVendorActiveQuote(vendor);
    const calc = activeQuote
      ? calculateQuoteFinancials(activeQuote, workspace.events, vendor.eventIds)
      : null;

    const isBooked = vendor.status === 'Booked';
    const paidAmount = paidByVendor[vendor.id] ?? 0;

    let projectedCost: number | null = null;
    let committedAmount = 0;
    let priceSource: BudgetRow['priceSource'] = 'Unpriced / TBD';

    if (isBooked) {
      committedAmount =
        vendor.bookedContractTotal ?? calc?.estimatedAllInTotal ?? 0;
      projectedCost = committedAmount;
      priceSource = 'Confirmed booking';
    } else if (activeQuote && calc) {
      projectedCost =
        calc.guestCountMissing && calc.estimatedAllInTotal === 0
          ? null
          : calc.estimatedAllInTotal;
      priceSource = projectedCost === null ? 'Unpriced / TBD' : 'Vendor quote';
    } else {
      projectedCost = null;
      priceSource = 'Unpriced / TBD';
    }

    const remainingBalance =
      projectedCost !== null ? Math.max(0, projectedCost - paidAmount) : null;

    budgetRows.push({
      id: `row-vendor-${vendor.id}`,
      sourceType: 'vendor',
      vendorId: vendor.id,
      name: vendor.name,
      subtitle: activeQuote
        ? activeQuote.title
        : `${CATEGORY_META[vendor.category].label} · No quote`,
      isDemoVenue: vendor.isDemoVenue,
      eventIds: vendor.eventIds,
      isSharedMultiEvent: vendor.eventIds.length > 1,
      category: vendor.category,
      budgetAllowance: null,
      projectedCost,
      committedAmount,
      paidAmount,
      remainingBalance,
      statusLabel: activeQuote || isBooked ? vendor.status : 'No quote',
      priceSource,
      hasUnconfirmedFees: (calc?.unresolvedMandatoryFeesCount ?? 0) > 0,
      hasDraftQuote: Boolean(vendor.draftQuote),
      hstAssumed: Boolean(calc?.hstAssumed),
      addOns: calc?.addOnImpacts.map((a) => ({
        id: a.id,
        label: a.label,
        selected: a.selected,
        impactWithTax: a.impactWithTax,
      })),
    });
  }

  for (const exp of workspace.manualExpenses) {
    const projectedCost =
      exp.estimatedAmount !== null
        ? exp.estimatedAmount
        : exp.budgetAllowance !== null && exp.priceSource === 'User-entered allowance'
          ? exp.budgetAllowance
          : null;
    const remainingBalance =
      projectedCost !== null ? Math.max(0, projectedCost - exp.paidAmount) : null;

    budgetRows.push({
      id: `row-manual-${exp.id}`,
      sourceType: 'manual',
      manualExpenseId: exp.id,
      name: exp.name,
      subtitle: exp.notes,
      eventIds: exp.eventIds,
      isSharedMultiEvent: exp.eventIds.length > 1,
      category: exp.category,
      budgetAllowance: exp.budgetAllowance,
      projectedCost,
      committedAmount: exp.committedAmount,
      paidAmount: exp.paidAmount,
      remainingBalance,
      statusLabel: exp.status,
      priceSource: exp.priceSource,
      hasUnconfirmedFees: false,
      hasDraftQuote: false,
      hstAssumed: false,
    });
  }

  let projectedSpend = 0;
  let committedSpend = 0;
  let paidToDate = 0;
  let pricedExpenseCount = 0;
  let unpricedExpenseCount = 0;

  const categoryMap: Record<
    VendorCategory,
    { projected: number; committed: number; paid: number }
  > = {
    venue: { projected: 0, committed: 0, paid: 0 },
    catering: { projected: 0, committed: 0, paid: 0 },
    photography: { projected: 0, committed: 0, paid: 0 },
    videography: { projected: 0, committed: 0, paid: 0 },
    decor: { projected: 0, committed: 0, paid: 0 },
    dj: { projected: 0, committed: 0, paid: 0 },
    entertainment: { projected: 0, committed: 0, paid: 0 },
    beauty: { projected: 0, committed: 0, paid: 0 },
    transportation: { projected: 0, committed: 0, paid: 0 },
    other: { projected: 0, committed: 0, paid: 0 },
  };

  for (const row of budgetRows) {
    committedSpend += row.committedAmount;
    paidToDate += row.paidAmount;
    if (row.projectedCost !== null) {
      projectedSpend += row.projectedCost;
      pricedExpenseCount += 1;
      categoryMap[row.category].projected += row.projectedCost;
    } else {
      unpricedExpenseCount += 1;
    }
    categoryMap[row.category].committed += row.committedAmount;
    categoryMap[row.category].paid += row.paidAmount;
  }

  projectedSpend = Math.round(projectedSpend * 100) / 100;
  committedSpend = Math.round(committedSpend * 100) / 100;
  paidToDate = Math.round(paidToDate * 100) / 100;

  const totalExpenseCount = budgetRows.length;
  const completenessPercent =
    totalExpenseCount > 0
      ? Math.round((pricedExpenseCount / totalExpenseCount) * 100)
      : 0;

  const remainingBudget =
    workspace.budgetTarget !== null
      ? Math.round((workspace.budgetTarget - projectedSpend) * 100) / 100
      : null;

  const remainingToPay = Math.max(
    0,
    Math.round((committedSpend - paidToDate) * 100) / 100
  );

  const categoryBreakdown: CategoryBreakdownItem[] = (
    Object.keys(categoryMap) as VendorCategory[]
  )
    .map((cat) => ({
      category: cat,
      label: CATEGORY_META[cat].label,
      projected: Math.round(categoryMap[cat].projected * 100) / 100,
      committed: Math.round(categoryMap[cat].committed * 100) / 100,
      paid: Math.round(categoryMap[cat].paid * 100) / 100,
      sharePercent:
        projectedSpend > 0
          ? Math.round((categoryMap[cat].projected / projectedSpend) * 1000) / 10
          : 0,
      tone: CATEGORY_META[cat].tone,
    }))
    .filter((item) => item.projected > 0)
    .sort((a, b) => b.projected - a.projected);

  const eventSummaries: Record<string, EventFinancialSummary> = {};
  for (const evt of workspace.events) {
    let directProjected = 0;
    let directCommitted = 0;
    let sharedPackageCount = 0;
    const sharedPackageNames: string[] = [];
    let unpricedCount = 0;

    for (const row of budgetRows) {
      if (!row.eventIds.includes(evt.id)) continue;
      if (row.isSharedMultiEvent) {
        sharedPackageCount += 1;
        sharedPackageNames.push(row.name);
        if (row.projectedCost === null) unpricedCount += 1;
      } else {
        if (row.projectedCost !== null) {
          directProjected += row.projectedCost;
        } else {
          unpricedCount += 1;
        }
        directCommitted += row.committedAmount;
      }
    }

    const vendorCount = workspace.vendors.filter(
      (v) => v.eventIds.includes(evt.id) && v.status !== 'Declined'
    ).length;

    eventSummaries[evt.id] = {
      eventId: evt.id,
      directProjected: Math.round(directProjected * 100) / 100,
      directCommitted: Math.round(directCommitted * 100) / 100,
      sharedPackageCount,
      sharedPackageNames,
      unpricedCount,
      vendorCount,
    };
  }

  const insights: string[] = [];
  if (categoryBreakdown.length > 0) {
    const largest = categoryBreakdown[0];
    insights.push(
      `${largest.label} is your largest category (${formatShortCad(largest.projected)}).`
    );
  }
  const vendorsWithUnconfirmed = workspace.vendors.filter((v) => {
    const q = getVendorActiveQuote(v);
    if (!q || v.status === 'Declined') return false;
    return q.unconfirmedFees.some((f) => f.mandatory && f.status === 'unconfirmed');
  });
  if (vendorsWithUnconfirmed.length > 0) {
    insights.push(
      `${vendorsWithUnconfirmed.length} shortlisted ${
        vendorsWithUnconfirmed.length === 1 ? 'vendor has' : 'vendors have'
      } unconfirmed fees.`
    );
  }

  return {
    budgetTarget: workspace.budgetTarget,
    projectedSpend,
    committedSpend,
    paidToDate,
    remainingBudget,
    remainingToPay,
    pricedExpenseCount,
    totalExpenseCount,
    unpricedExpenseCount,
    completenessPercent,
    budgetRows,
    categoryBreakdown,
    eventSummaries,
    insights,
  };
}

export interface ComparisonEntry {
  vendor: Vendor;
  quote: Quote;
  calc: QuoteCalculationResult;
  perPersonRate: number | null;
  flatFeesPreTax: number;
  unconfirmedMandatoryLabels: string[];
}

export interface ComparisonAnalysis {
  entries: ComparisonEntry[];
  unquotedVendors: Vendor[];
  hasComparableQuotes: boolean;
  lowestKnownVendorId: string | null;
  breakEvenNote: string | null;
  aiTradeoffSummary: string | null;
}

/**
 * Side-by-side comparison calculator for multiple vendors at a unified guest count.
 * Keeps notes-only / unquoted vendors out of priced columns and surfaces them separately.
 * Returns null for aiTradeoffSummary when fewer than 2 comparable quoted vendors exist.
 */
export function calculateVendorComparison(
  vendors: Vendor[],
  events: WeddingEvent[],
  hypotheticalGuestCount: number
): ComparisonAnalysis {
  const entries: ComparisonEntry[] = [];
  const unquotedVendors: Vendor[] = [];

  for (const vendor of vendors) {
    const quote = getVendorActiveQuote(vendor);
    if (!quote) {
      unquotedVendors.push(vendor);
      continue;
    }
    const calc = calculateQuoteFinancials(
      quote,
      events,
      vendor.eventIds,
      hypotheticalGuestCount
    );
    const perPersonItem = quote.lineItems.find((li) => li.pricingModel === 'per_person');
    const flatFeesPreTax = quote.lineItems
      .filter((li) => li.pricingModel === 'flat')
      .reduce((acc, li) => acc + li.unitPrice * (li.quantity ?? 1), 0);
    const unconfirmedMandatoryLabels = quote.unconfirmedFees
      .filter((f) => f.mandatory && f.status === 'unconfirmed')
      .map((f) => f.label);

    entries.push({
      vendor,
      quote,
      calc,
      perPersonRate: perPersonItem ? perPersonItem.unitPrice : null,
      flatFeesPreTax,
      unconfirmedMandatoryLabels,
    });
  }

  const hasComparableQuotes = entries.length >= 2;

  const eligibleWithinCapacity = entries.filter((e) => !e.calc.capacityExceeded);
  const sortedByTotal = [...eligibleWithinCapacity].sort(
    (a, b) => a.calc.estimatedAllInTotal - b.calc.estimatedAllInTotal
  );

  const lowest = sortedByTotal[0] ?? null;
  const secondLowest = sortedByTotal[1] ?? null;

  let breakEvenNote: string | null = null;
  let aiTradeoffSummary: string | null = null;

  if (hasComparableQuotes) {
    const summaryParts: string[] = [];

    if (lowest && secondLowest) {
      const diffAllIn = Math.round(
        secondLowest.calc.estimatedAllInTotal - lowest.calc.estimatedAllInTotal
      );
      const diffPreTax = Math.round(
        secondLowest.calc.preTaxTotal - lowest.calc.preTaxTotal
      );

      if (lowest.unconfirmedMandatoryLabels.length > 0) {
        breakEvenNote = `${lowest.vendor.name} is ${formatShortCad(
          diffAllIn
        )} lower incl. HST than ${secondLowest.vendor.name} at ${hypotheticalGuestCount} guests, but its ${lowest.unconfirmedMandatoryLabels.join(
          ' & '
        )} is unconfirmed. Above ${formatShortCad(diffPreTax)} pre-tax (${formatShortCad(
          diffAllIn
        )} incl. HST), ${secondLowest.vendor.name} is lower.`;
        summaryParts.push(breakEvenNote);
      } else {
        summaryParts.push(
          `${lowest.vendor.name} is lowest at ${formatShortCad(
            lowest.calc.estimatedAllInTotal
          )} for ${hypotheticalGuestCount} guests (${formatShortCad(
            diffAllIn
          )} below ${secondLowest.vendor.name}).`
        );
      }
    } else if (lowest) {
      summaryParts.push(
        `Only ${lowest.vendor.name} fits ${hypotheticalGuestCount} guests (${formatShortCad(
          lowest.calc.estimatedAllInTotal
        )} est.).`
      );
    }

    const minFloorVendors = entries.filter((e) => e.calc.minGuestsApplied);
    if (minFloorVendors.length > 0) {
      summaryParts.push(
        `Minimum floor active: ${minFloorVendors
          .map((e) => `${e.vendor.name} (${e.quote.minGuests} min)`)
          .join(', ')}.`
      );
    }

    const overCapVendors = entries.filter((e) => e.calc.capacityExceeded);
    if (overCapVendors.length > 0) {
      summaryParts.push(
        `Over capacity: ${overCapVendors
          .map((e) => `${e.vendor.name} (max ${e.quote.maxCapacity})`)
          .join(', ')}.`
      );
    }

    aiTradeoffSummary = summaryParts.join(' ');
  }

  return {
    entries,
    unquotedVendors,
    hasComparableQuotes,
    lowestKnownVendorId: hasComparableQuotes ? lowest?.vendor.id ?? null : null,
    breakEvenNote,
    aiTradeoffSummary,
  };
}
