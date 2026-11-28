import type {
  BudgetRow,
  PastelTone,
  PaymentMilestone,
  Quote,
  QuoteLineItem,
  QuotePackageOption,
  TaxHandling,
  Vendor,
  VendorCategory,
  WeddingEvent,
  WeddingWorkspace,
} from '../types/vowly';

import { findAmbiguousLegacyOvertimeItems } from './legacyOvertimeReview.ts';
import { hasIncompleteManualPricing } from './manualQuoteDraft.ts';
import { calculateQuote, roundMoney, type LineItem, type PackageOption, type PricingType, type TaxStatus } from '../../../shared/finance/calculator.ts';

export const ONTARIO_HST_RATE = 0.13;

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
  conditionalOvertime?: boolean;
  billableHours?: number;
  includedServiceHours?: number;
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
  taxRateUnresolved: boolean;
  taxStatusLabel: string;
  effectiveTaxHandling: TaxHandling;
  estimatedAllInTotal: number;
  effectiveGuestCountUsed: number | null;
  guestCountMissing: boolean;
  minGuestsApplied: boolean;
  appliedMinGuests: number | null;
  capacityExceeded: boolean;
  unresolvedPackageSelection: boolean;
  unresolvedPackagePrice: boolean;
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
    savingsWithTax: number | null;
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

/**
 * Flags legacy saved quotes that exhibit known pre-fix calculation failure patterns
 * so they are never silently retained as bookable without user re-review.
 */
export function detectLegacyQuoteReviewReasons(quote: Quote): string[] {
  const ambiguousOvertime = findAmbiguousLegacyOvertimeItems(quote);
  const reasons = ambiguousOvertime.map((item) =>
    `Additional hourly rate ("${item.label}") is billed by default — verify whether extra hours are needed.`
  );
  if (quote.legacyReviewAcknowledged) return reasons;

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
        li.sourceExcerpt === undefined &&
        li.isConditionalOvertime === undefined &&
        !ambiguousOvertime.includes(li) &&
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

const taxStatusFromWorkspace: Record<TaxHandling, TaxStatus> = {
  included: 'included',
  excluded_plus_hst: 'excluded',
  unspecified: 'unknown',
  unspecified_ontario_assumed: 'assumed',
  tax_exempt: 'exempt',
};

const workspaceTaxFromStatus: Record<TaxStatus, TaxHandling> = {
  included: 'included',
  excluded: 'excluded_plus_hst',
  unknown: 'unspecified',
  assumed: 'unspecified_ontario_assumed',
  exempt: 'tax_exempt',
};

function toPricingType(model: QuoteLineItem['pricingModel']): PricingType {
  if (model === 'hourly') return 'per_hour';
  if (model === 'guest_ratio') return 'per_guest_ratio';
  return model;
}

function normalizeLine(item: QuoteLineItem): LineItem {
  const hasImportedFacts = item.sourceExcerpt !== undefined ||
    item.extractedHours !== undefined || item.chargeType !== undefined;
  return {
    id: item.id,
    label: item.label,
    pricingType: toPricingType(item.pricingModel),
    amount: item.unitPrice,
    quantity: item.quantity,
    hours: item.extractedHours,
    conditionalOvertime: item.isConditionalOvertime ?? (hasImportedFacts ? undefined : false),
    includedPackageHours: item.includedPackageHours,
    ratioGuests: item.ratioDivisor,
    unitLabel: item.unitLabel,
    percentageBasis: item.percentageBasis,
    percentageTargetLabels: item.percentageTargetLabels,
    customBasisAmount: item.customBasisAmount,
    originalAmount: item.originalUnitPrice,
    isThirdParty: item.isThirdParty,
    thirdPartyProvider: item.thirdPartyProvider,
    isFoodItem: item.isFoodItem,
    eventId: item.eventId,
    minGuests: item.minGuests,
    guestThreshold: item.guestThreshold,
    packageId: item.packageId,
    sourceExcerpt: item.sourceExcerpt ?? '',
    pageReference: item.pageReference,
    chargeType: item.chargeType,
  };
}

function formatPricedLine(line: ReturnType<typeof calculateQuote>['lines'][number]): string {
  const { item, units, guestsUsed, minimum, threshold, ratio, includedHours } = line;
  const price = `$${item.amount?.toLocaleString('en-CA') ?? '—'}`;
  switch (item.pricingType) {
    case 'included':
      return 'Included';
    case 'unknown':
      return 'Base package price unconfirmed (TBD)';
    case 'per_person':
      return guestsUsed === undefined
        ? `${price}/guest (guest count needed)`
        : `${price}/guest × ${guestsUsed} guests${minimum ? ` (min ${minimum} applied)` : ''}`;
    case 'per_extra_guest':
      return units === undefined
        ? `${price}/extra guest above ${threshold} (guest count needed)`
        : `${price}/extra guest above ${threshold} × ${units} extra guest${units === 1 ? '' : 's'}`;
    case 'per_guest_ratio': {
      const unit = item.unitLabel || 'unit';
      const rate = `${price} per ${unit}`;
      return units === undefined
        ? `${rate} (1 per ${ratio} guests)`
        : `${rate} · 1 per ${ratio} guests · ${guestsUsed} guests → ${units} ${unit}${units === 1 ? '' : 's'}`;
    }
    case 'per_hour':
      if (line.conditional) {
        const included = includedHours ? ` (above ${includedHours} included hrs)` : '';
        return `${units} overtime hr${units === 1 ? '' : 's'} × ${price}/hr${included}`;
      }
      return `${price}/hr × ${units} hr${units === 1 ? '' : 's'}`;
    case 'percentage': {
      const basis = line.percentageBasis;
      return basis?.amount == null
        ? line.note ?? 'Percentage basis unresolved'
        : `${item.amount}% of ${basis.label} ($${basis.amount.toLocaleString('en-CA')})`;
    }
    case 'flat':
      return item.amount === null ? 'Base package price unconfirmed (TBD)' : `${price} fixed`;
  }
}

/** Adapt the saved workspace and project the shared price result for the UI. */
export function calculateQuoteFinancials(
  quote: Quote,
  events: WeddingEvent[],
  vendorEventIds: string[],
  guestCountOverride?: number | null,
  requestedServiceHours?: number,
): QuoteCalculationResult {
  const guestMap = getEventGuestCountMap(events);
  const primaryEventId = vendorEventIds[0];
  const primaryEventGuests = guestCountOverride !== undefined
    ? guestCountOverride : guestMap[primaryEventId];
  const conflicts = new Map(quote.conflicts.map((conflict) => [conflict.targetLineItemId, conflict]));
  const mapLine = (item: QuoteLineItem): LineItem => {
    const conflict = conflicts.get(item.id);
    const option = conflict?.options.find((candidate) => candidate.id === conflict.resolvedOptionId)
      ?? conflict?.options[0];
    return {
      ...normalizeLine(item),
      proposedPrice: option ? {
        amount: option.amount,
        pricingType: option.pricingModel ? toPricingType(option.pricingModel) : undefined,
      } : undefined,
    };
  };
  const mapIncluded = (item: NonNullable<Quote['includedPricingItems']>[number]): LineItem => ({
    label: item.label,
    pricingType: 'included',
    amount: null,
    hours: item.extractedHours,
    packageId: item.packageId,
    sourceExcerpt: item.sourceExcerpt,
  });
  const packages = quote.packages?.map((pkg): PackageOption => ({
    id: pkg.id,
    name: pkg.name,
    pricingType: pkg.pricingModel,
    amount: pkg.unitPrice,
    minGuests: pkg.minGuests,
    includedGuests: pkg.includedGuests,
    extraGuestRate: pkg.extraGuestRate,
    maxCapacity: pkg.maxCapacity,
    hours: pkg.hours,
    isFoodItem: pkg.isFoodItem,
    fees: [...(pkg.fees ?? []).map(mapLine), ...(pkg.includedPricingItems ?? []).map(mapIncluded)],
    taxStatus: pkg.taxHandling ? taxStatusFromWorkspace[pkg.taxHandling] : undefined,
    taxPercent: pkg.taxPercent,
    gratuityStatus: pkg.gratuityStatus,
    gratuityPercent: pkg.gratuityPercent,
    gratuityBasis: pkg.gratuityBasis,
    inclusions: pkg.structuredInclusions,
    sourceExcerpt: '',
    pageReference: pkg.pageReference,
  }));
  const payment = quote.paymentOptions?.find((option) => option.id === quote.selectedPaymentOptionId)
    ?? quote.paymentOptions?.[0];
  const result = calculateQuote({
    currency: quote.currency,
    lineItems: [...quote.lineItems.map(mapLine), ...(quote.includedPricingItems ?? []).map(mapIncluded)],
    packages,
    inclusions: quote.structuredInclusions,
    photographerDetails: { extraHourRate: quote.extraHourRate },
    serviceDurationHours: quote.serviceDurationHours,
    venueDetails: { minGuests: quote.minGuests, maxCapacity: quote.maxCapacity },
    taxStatus: taxStatusFromWorkspace[quote.taxHandling],
    taxPercent: quote.taxPercent,
    gratuityStatus: quote.gratuityStatus,
    gratuityPercent: quote.gratuityPercent,
    gratuityBasis: quote.gratuityBasis,
  }, {
    guestCount: primaryEventGuests ?? undefined,
    guestCountsByEvent: guestMap,
    guestCountOverride,
    primaryEventId,
    hours: requestedServiceHours,
    selectedPackageId: quote.selectedPackageId ?? undefined,
    workspaceDefaults: { taxPercent: ONTARIO_HST_RATE * 100, ratioGuests: 10 },
    unresolvedConflicts: quote.conflicts.filter((conflict) =>
      !conflict.options.some((option) => option.id === conflict.resolvedOptionId)).length,
    payment: payment ? {
      adjustment: payment.adjustmentDelta,
      taxStatus: taxStatusFromWorkspace[payment.taxHandling],
    } : undefined,
    fees: quote.unconfirmedFees.map((fee) => ({
      unresolved: fee.mandatory && fee.status === 'unconfirmed',
      item: {
        id: fee.id,
        label: fee.label,
        pricingType: 'flat',
        amount: fee.status === 'confirmed_amount' && typeof fee.confirmedAmount === 'number'
          ? fee.confirmedAmount : null,
        packageId: fee.packageId,
        isFoodItem: false,
        sourceExcerpt: '',
      },
    })),
    addOns: quote.addOns.map((addOn) => ({
      selected: addOn.selected,
      item: {
        id: addOn.id,
        label: addOn.label,
        pricingType: toPricingType(addOn.pricingModel ?? 'flat'),
        amount: addOn.pricePreTax,
        quantity: addOn.quantity,
        ratioGuests: addOn.ratioDivisor,
        unitLabel: addOn.unitLabel,
        minGuests: addOn.minGuests ?? 0,
        guestThreshold: addOn.minGuests ?? 0,
        eventId: addOn.eventId,
        packageId: addOn.packageId,
        percentageBasis: addOn.percentageBasis,
        percentageTargetLabels: addOn.percentageTargetLabels,
        customBasisAmount: addOn.customBasisAmount,
        isFoodItem: false,
        sourceExcerpt: '',
      },
    })),
  });

  const lineItemBreakdowns = result.lines.flatMap((line): LineItemBreakdown[] => {
    const { item } = line;
    if (item.id === undefined) return [];
    const unresolvedBasis = item.pricingType === 'percentage' && line.total === null;
    return [{
      id: item.id,
      label: item.label,
      amount: line.missingGuests ? roundMoney(line.total ?? 0) :
        line.total === null ? null : roundMoney(line.total),
      formulaText: formatPricedLine(line),
      negotiatedOriginalAmount: line.originalTotal,
      negotiatedSavings: line.savings,
      isThirdParty: item.isThirdParty,
      thirdPartyProvider: item.thirdPartyProvider,
      unresolvedBasis: unresolvedBasis || undefined,
      conditionalOvertime: item.pricingType === 'per_hour' ? line.conditional : undefined,
      billableHours: item.pricingType === 'per_hour' ? line.units : undefined,
      includedServiceHours: item.pricingType === 'per_hour' ? line.includedHours : undefined,
    }];
  });
  const {
    baseSubtotal, selectedAddOnsPreTax, confirmedExtraFeesPreTax, paymentOptionAdjustment,
    taxRate, taxNotStated, unresolvedPackageSelection, unresolvedPackagePrice,
    unresolvedConflictsCount, unresolvedMandatoryFeesCount, unresolvedPercentageCount,
  } = result;
  const isCurrencyUnknown = quote.currency === 'UNKNOWN';
  const gratuityUnresolved = result.gratuityAmount === null;
  const taxRateUnresolved = result.taxAmount === null;
  const effectiveTaxHandling = workspaceTaxFromStatus[result.taxStatus];
  const hstIncluded = result.taxStatus === 'included';
  const hstAssumed = result.taxStatus === 'assumed';
  const taxStatusLabel = result.hasTaxLine
    ? 'Tax listed in line items'
    : taxRateUnresolved
      ? 'Plus tax (rate not stated — excluded from estimate.)'
      : getTaxStatusLabel(effectiveTaxHandling, taxRate);
  const legacyReviewReasons = detectLegacyQuoteReviewReasons(quote);
  const addOnImpacts = quote.addOns.flatMap((addOn) => {
    const pricePreTax = result.addOnAmounts.get(addOn.id);
    if (pricePreTax === undefined) return [];
    return [{
      id: addOn.id,
      label: addOn.label,
      description: addOn.description,
      pricePreTax,
      impactWithTax: roundMoney(pricePreTax * (1 + taxRate)),
      selected: addOn.selected,
    }];
  });
  const blockingReasons: string[] = [];
  if (hasIncompleteManualPricing(quote)) {
    blockingReasons.push('Enter and name the quoted charges before approving, or Save as Draft.');
  }
  if (unresolvedPackageSelection) {
    blockingReasons.push(
      'Select one package option before approving this quote, or Save as Draft to keep all options.'
    );
  }
  if (unresolvedPackagePrice) {
    blockingReasons.push(
      `Confirm the base price for "${result.selectedPackageName}" before approving, or Save as Draft.`
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
    if (diff > 0 && (!latest.previousCurrency || latest.previousCurrency === latest.newCurrency)) {
      revisionSavings = {
        previousPreTax: latest.previousPreTaxTotal,
        currentPreTax: latest.newPreTaxTotal,
        savingsPreTax: diff,
        savingsWithTax: latest.previousAllInTotal === undefined
          ? Math.round(diff * (1 + taxRate) * 100) / 100
          : latest.previousAllInTotal != null && latest.newAllInTotal != null && latest.previousAllInTotal > latest.newAllInTotal
            ? Math.round((latest.previousAllInTotal - latest.newAllInTotal) * 100) / 100
            : null,
        summary: latest.summary,
      };
    }
  }


  return {
    currencyLabel: isCurrencyUnknown ? 'Currency TBD' : quote.currency,
    isCurrencyUnknown,
    baseSubtotal,
    selectedAddOnsPreTax,
    confirmedExtraFeesPreTax,
    paymentOptionAdjustment,
    preTaxTotal: result.knownSubtotal,
    gratuityAmount: result.gratuityAmount ?? 0,
    gratuityUnresolved,
    gratuityBasisLabel: result.gratuityBasisLabel,
    taxRate,
    taxAmount: result.taxAmount ?? 0,
    hstAssumed,
    hstIncluded,
    taxNotStated,
    taxRateUnresolved,
    taxStatusLabel,
    effectiveTaxHandling,
    estimatedAllInTotal: result.knownAllInTotal,
    effectiveGuestCountUsed: result.effectiveGuestCountUsed,
    guestCountMissing: result.guestCountMissing,
    minGuestsApplied: result.appliedMinGuests !== null,
    appliedMinGuests: result.appliedMinGuests,
    capacityExceeded: result.capacityExceeded,
    unresolvedPackageSelection,
    unresolvedPackagePrice,
    selectedPackageName: result.selectedPackageName,
    legacyReviewReasons,
    unresolvedMandatoryFeesCount,
    unresolvedConflictsCount,
    unresolvedPercentageCount,
    negotiatedSavings: result.negotiatedSavings,
    isEstimateComplete: result.isEstimateComplete && blockingReasons.length === 0,
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
    if (activeQuote.sourceWarnings?.length && !activeQuote.sourceWarningsAcknowledged) {
      blockingReasons.push('Review flagged source evidence warnings against the original document before booking.');
    }
    if (calc.unresolvedPackageSelection) {
      blockingReasons.push('Select one package option before confirming a booking.');
    }
    if (calc.unresolvedPackagePrice) {
      blockingReasons.push(
        `Confirm the base price for "${calc.selectedPackageName ?? 'selected package'}" before booking.`
      );
    }
    if (calc.isCurrencyUnknown) {
      blockingReasons.push('Confirm quote currency (CAD or USD) before booking.');
    }
    if (calc.taxNotStated) {
      blockingReasons.push(
        'Confirm tax handling before booking (tax is not stated on this quote).'
      );
    }
    if (calc.taxRateUnresolved) {
      blockingReasons.push(
        'Confirm the tax percentage before booking (quote states plus tax without a rate).'
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

const MONTH_MAP: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/**
 * Parses an ISO date ("2027-08-13") or human-readable date ("August 13, 2027",
 * "Aug 13, 2027", "13 August 2027") into a canonical YYYY-MM-DD string.
 * Returns null if the input is empty or not a concrete calendar date.
 */
export function normalizeIsoDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  const slashMatch = trimmed.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (slashMatch) {
    const y = Number(slashMatch[1]);
    const m = Number(slashMatch[2]);
    const d = Number(slashMatch[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // "August 13, 2027" or "Aug 13 2027"
  const mdyMatch = trimmed.match(/^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  if (mdyMatch) {
    const m = MONTH_MAP[mdyMatch[1].toLowerCase()];
    const d = Number(mdyMatch[2]);
    const y = Number(mdyMatch[3]);
    if (m && d >= 1 && d <= 31) {
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // "13 August 2027"
  const dmyMatch = trimmed.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?,?\s+(\d{4})$/);
  if (dmyMatch) {
    const d = Number(dmyMatch[1]);
    const m = MONTH_MAP[dmyMatch[2].toLowerCase()];
    const y = Number(dmyMatch[3]);
    if (m && d >= 1 && d <= 31) {
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  return null;
}

export interface BookingScheduleDefaults {
  depositAmount: number;
  depositHasKnownDate: boolean;
  depositDate: string;
  depositRelativeLabel: string;
  balanceHasKnownDate: boolean;
  balanceDueDate: string;
  balanceRelativeLabel: string;
}

/**
 * Derives booking schedule defaults directly from the approved quote (or its
 * selected package's payment terms), strictly prioritizing:
 *   1) Explicit extracted calendar dates (e.g., "August 13, 2027" -> "2027-08-13"),
 *   2) Explicit extracted relative deadlines resolved against the event date,
 *   3) Unresolved / TBD (never fabricating hardcoded dates or assumed 30-day offsets).
 */
export function deriveBookingScheduleDefaults(
  quote: Quote | undefined,
  events: WeddingEvent[],
  vendorEventIds: string[],
  contractTotal: number
): BookingScheduleDefaults {
  const { selectedPackage } = quote ? getSelectedPackageOption(quote) : { selectedPackage: undefined };
  const milestones =
    selectedPackage?.paymentMilestones && selectedPackage.paymentMilestones.length > 0
      ? selectedPackage.paymentMilestones
      : quote?.paymentMilestones ?? [];

  const primaryEvent = events.find((e) => vendorEventIds.includes(e.id));

  const depositMilestone = milestones.find((m) =>
    /\b(deposit|retainer|booking|signing|initial)\b/i.test(m.label)
  );
  const balanceMilestone = milestones.find(
    (m) =>
      m !== depositMilestone &&
      /\b(balance|remaining|final|rest|due)\b/i.test(m.label)
  ) ?? (milestones.length >= 2 ? milestones[milestones.length - 1] : undefined);

  // Deposit amount: selected package milestone/deposit -> quote milestone/deposit -> 0
  let depositAmount = 0;
  if (depositMilestone?.amount !== undefined && depositMilestone.amount > 0) {
    depositAmount = depositMilestone.amount;
  } else if (depositMilestone?.percent !== undefined && depositMilestone.percent > 0 && contractTotal > 0) {
    depositAmount = Math.round(contractTotal * (depositMilestone.percent / 100) * 100) / 100;
  } else if (selectedPackage?.depositAmount !== undefined && selectedPackage.depositAmount > 0) {
    depositAmount = selectedPackage.depositAmount;
  } else if (
    selectedPackage?.depositPercent !== undefined &&
    selectedPackage.depositPercent > 0 &&
    contractTotal > 0
  ) {
    depositAmount = Math.round(contractTotal * (selectedPackage.depositPercent / 100) * 100) / 100;
  } else if (quote?.depositAmount !== undefined && quote.depositAmount > 0) {
    depositAmount = quote.depositAmount;
  } else if (quote?.depositPercent !== undefined && quote.depositPercent > 0 && contractTotal > 0) {
    depositAmount = Math.round(contractTotal * (quote.depositPercent / 100) * 100) / 100;
  }
  depositAmount = Math.min(Math.max(0, contractTotal), Math.max(0, depositAmount));

  // Deposit due date: explicit dueDate -> relativeDaysBeforeEvent -> relativeDeadlineText -> unresolved
  let depositHasKnownDate = false;
  let depositDate = '';
  let depositRelativeLabel = 'Due upon signing / date TBD';
  const explicitDepositIso = normalizeIsoDate(depositMilestone?.dueDate);
  if (explicitDepositIso) {
    depositHasKnownDate = true;
    depositDate = explicitDepositIso;
    depositRelativeLabel = '';
  } else if (depositMilestone?.relativeDaysBeforeEvent !== undefined) {
    const computed = resolveRelativeDeadlineDate(
      primaryEvent?.date,
      depositMilestone.relativeDaysBeforeEvent
    );
    if (computed) {
      depositHasKnownDate = true;
      depositDate = computed;
      depositRelativeLabel = '';
    } else {
      depositRelativeLabel =
        depositMilestone.relativeDeadlineText ||
        `${depositMilestone.relativeDaysBeforeEvent} days prior to ${primaryEvent?.name ?? 'event'} (date TBD)`;
    }
  } else if (depositMilestone?.relativeDeadlineText) {
    depositRelativeLabel = depositMilestone.relativeDeadlineText;
  } else if (depositMilestone?.dueDate && depositMilestone.dueDate.trim()) {
    depositRelativeLabel = depositMilestone.dueDate.trim();
  }

  // Balance due date: explicit dueDate -> relativeDaysBeforeEvent -> relativeDeadlineText -> unresolved
  let balanceHasKnownDate = false;
  let balanceDueDate = '';
  let balanceRelativeLabel = 'Balance due date TBD';
  const explicitBalanceIso = normalizeIsoDate(balanceMilestone?.dueDate);
  if (explicitBalanceIso) {
    balanceHasKnownDate = true;
    balanceDueDate = explicitBalanceIso;
    balanceRelativeLabel = '';
  } else if (balanceMilestone?.relativeDaysBeforeEvent !== undefined) {
    const computed = resolveRelativeDeadlineDate(
      primaryEvent?.date,
      balanceMilestone.relativeDaysBeforeEvent
    );
    if (computed) {
      balanceHasKnownDate = true;
      balanceDueDate = computed;
      balanceRelativeLabel = '';
    } else {
      balanceRelativeLabel =
        balanceMilestone.relativeDeadlineText ||
        `${balanceMilestone.relativeDaysBeforeEvent} days prior to ${primaryEvent?.name ?? 'event'} (date TBD)`;
    }
  } else if (balanceMilestone?.relativeDeadlineText) {
    balanceRelativeLabel = balanceMilestone.relativeDeadlineText;
  } else if (balanceMilestone?.dueDate && balanceMilestone.dueDate.trim()) {
    balanceRelativeLabel = balanceMilestone.dueDate.trim();
  }

  return {
    depositAmount,
    depositHasKnownDate,
    depositDate,
    depositRelativeLabel,
    balanceHasKnownDate,
    balanceDueDate,
    balanceRelativeLabel,
  };
}

export interface BuildBookingMilestonesInput {
  contractTotal: number;
  existingPaidAmount?: number;
  depositAmount: number;
  depositAlreadyPaid?: boolean;
  depositHasKnownDate?: boolean;
  depositDate: string;
  depositRelativeLabel?: string;
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
  const alreadyPaid = Math.max(0, input.existingPaidAmount ?? 0);
  const schedulableTotal = Math.max(0, Math.round((input.contractTotal - alreadyPaid) * 100) / 100);
  const depositNum = Math.min(schedulableTotal, Math.max(0, input.depositAmount));
  const remainingNum = Math.max(0, Math.round((schedulableTotal - depositNum) * 100) / 100);
  const depositPaid = input.depositAlreadyPaid ?? DEFAULT_DEPOSIT_ALREADY_PAID;
  const depositKnownDate =
    input.depositHasKnownDate !== undefined ? input.depositHasKnownDate : Boolean(input.depositDate);

  const milestones: Array<
    Omit<PaymentMilestone, 'id' | 'vendorId' | 'vendorName' | 'eventId' | 'eventLabel'>
  > = [];

  if (depositNum > 0) {
    milestones.push({
      label: 'Booking Deposit',
      amount: depositNum,
      dueDate: depositKnownDate ? input.depositDate || null : null,
      relativeDueLabel:
        !depositPaid && !depositKnownDate
          ? input.depositRelativeLabel || 'Due upon signing'
          : undefined,
      status: depositPaid ? 'Paid' : depositKnownDate && input.depositDate ? 'Upcoming' : 'Date TBD',
      paidDate: depositPaid ? input.depositDate || new Date().toISOString().slice(0, 10) : undefined,
      payer: input.depositPayer,
      paidBy: depositPaid
        ? input.depositPayer === 'Unassigned'
          ? input.coupleNames
          : input.depositPayer
        : undefined,
      reminderEnabled: !depositPaid && depositKnownDate && Boolean(input.depositDate),
    });
  }

  if (remainingNum > 0) {
    const balanceKnown = input.balanceHasKnownDate && Boolean(input.balanceDueDate);
    milestones.push({
      label: 'Final Balance',
      amount: remainingNum,
      dueDate: balanceKnown ? input.balanceDueDate : null,
      relativeDueLabel: balanceKnown
        ? undefined
        : input.balanceRelativeLabel || 'Balance due date TBD',
      status: balanceKnown ? 'Upcoming' : 'Date TBD',
      payer: input.balancePayer,
      reminderEnabled: balanceKnown,
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
