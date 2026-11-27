import type { Quote, QuotePackageOption, StructuredInclusion, Vendor, VendorCategory, WeddingWorkspace } from '../types/vowly.ts';
import { formatStructuredInclusion } from '../services/quoteExtractor.ts';
import { roundMoney } from '../../../shared/finance/calculator.ts';
import {
  calculateQuoteFinancials, formatCurrency, getSelectedPackageOption,
  type QuoteCalculationResult,
} from './financialCalculator.ts';

export interface ComparisonScenario {
  category: VendorCategory;
  eventId: string;
  guestCount?: number;
  coverageHours?: number;
  vendorId?: string;
  packageByVendor?: Readonly<Record<string, string>>;
}

export interface ComparisonValue {
  detail?: string;
  text: string;
  evidence?: string[];
}

export interface ComparisonOption {
  id: string;
  vendor: Vendor;
  quote: Quote | null;
  packageId?: string;
  title: string;
  calc: QuoteCalculationResult | null;
  rows: Record<string, ComparisonValue>;
  unresolved: string[];
  contractTotal?: number;
}

export interface ComparisonResult {
  entries: ComparisonOption[];
  unquotedVendors: Vendor[];
  difference: string | null;
}

const NOT_STATED = 'Not stated';
const NOT_INCLUDED = 'Not included';
const UNPRICED_EXTRA = 'Additional cost — TBD';
const DETAILS = {
  staffing: /\b(staff(?:ing)?|servers?|bartenders?|attendants?|assistants?|photographers?|videographers?|shooters?|DJs?|emcees?|crew|security|coordinators?)\b/i,
  equipment: /\b(equipment|cameras?|microphones?|mics?|speakers?|audio|sound|lighting|lights?|power|projectors?|stands?|screens?|mixers?|AV)\b/i,
  menu: /\b(menu|courses?|food|beverages?|buffet|bar|cocktails?|appetizers?|entrées?|entrees?|desserts?|meals?|dinner|hors d'oeuvres|tastings?)\b/i,
  setup: /\b(set[ -]?up|tear[ -]?down|breakdown|installation|strike|delivery|pick[ -]?up|removal|load[ -]?in)\b/i,
};

const AUXILIARY_HOURS = /\b(set[ -]?up|tear[ -]?down|travel|security|staff(?:ing)?|bartenders?|attendants?|assistants?|second|2nd|booth|equipment|rental)\b/i;
const COVERAGE_CATEGORIES: ReadonlySet<VendorCategory> = new Set(['photography', 'videography', 'dj', 'entertainment']);
export function supportsCoverageHours(category: VendorCategory): boolean {
  return COVERAGE_CATEGORIES.has(category);
}

const wholeHours = (hours: number) => `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
const money = (amount: number, currency: string) =>
  `${formatCurrency(amount, currency, { decimals: 2 })}${currency === 'UNKNOWN' ? ' (currency not stated)' : ''}`;

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function value(text: string, evidence: Array<string | undefined> = []): ComparisonValue {
  const excerpts = unique(evidence);
  return excerpts.length ? { text, evidence: excerpts } : { text };
}

function termValue(terms: Array<{ text: string; excerpt?: string }>, prefix = ''): ComparisonValue {
  const termsText = unique(terms.map((term) => term.text));
  return termsText.length ? value(`${prefix}${termsText.join(' · ')}`, terms.map((term) => term.excerpt)) : value(NOT_STATED);
}

function sourceExcerpt(quote: Quote, text: string): string | undefined {
  const phrase = text.trim().toLowerCase();
  return phrase && quote.evidenceSpans.find((span) => span.excerpt.toLowerCase().includes(phrase))?.excerpt || undefined;
}

function quoteForPackage(quote: Quote, selection?: string): Quote {
  const packages = quote.packages ?? [];
  if (packages.length < 2) return quote;

  const packageIds = new Set(packages.map((pkg) => pkg.id.toLowerCase()));
  const active = (id: string | undefined) => {
    const scope = id?.trim().toLowerCase();
    return !scope || !packageIds.has(scope) || scope === selection?.toLowerCase();
  };
  const lineItems = quote.lineItems.filter((item) => active(item.packageId));
  const inactiveLines = new Set([
    ...quote.lineItems.filter((item) => !active(item.packageId)).map((item) => item.id),
    ...packages.filter((pkg) => pkg.id !== selection).flatMap((pkg) => (pkg.fees ?? []).map((item) => item.id)),
  ]);
  const structuredInclusions = quote.structuredInclusions?.filter((item) => active(item.packageId));
  const siblingInclusions = new Set((quote.structuredInclusions ?? [])
    .filter((item) => !active(item.packageId)).flatMap((item) => [item.name, formatStructuredInclusion(item)]));
  const siblingDeliveryTerms = new Set(packages.filter((pkg) => pkg.id !== selection).flatMap((pkg) => pkg.deliveryTerms ?? []));

  return {
    ...quote,
    selectedPackageId: selection ?? null,
    // Older saves copied selected package constraints back to the quote level. An equal
    // value cannot establish a quote-wide constraint for a tier that did not state one.
    minGuests: packages.some((pkg) => pkg.minGuests === quote.minGuests && pkg.minGuests !== undefined) ? undefined : quote.minGuests,
    maxCapacity: packages.some((pkg) => pkg.maxCapacity === quote.maxCapacity && pkg.maxCapacity !== undefined) ? undefined : quote.maxCapacity,
    lineItems,
    includedPricingItems: quote.includedPricingItems?.filter((item) => active(item.packageId)),
    addOns: quote.addOns.filter((item) => active(item.packageId)),
    unconfirmedFees: quote.unconfirmedFees.filter((item) => active(item.packageId)),
    conflicts: quote.conflicts.filter((conflict) => !conflict.targetLineItemId || !inactiveLines.has(conflict.targetLineItemId)),
    inclusions: quote.inclusions.filter((term) => !siblingInclusions.has(term)),
    structuredInclusions,
    deliveryTerms: quote.deliveryTerms?.filter((term) => !siblingDeliveryTerms.has(term)),
  };
}

function inclusionTerms(quote: Quote, pkg?: QuotePackageOption) {
  const structured: StructuredInclusion[] = [
    ...(pkg?.structuredInclusions ?? []), ...(quote.structuredInclusions ?? []),
  ];
  const normalized = (text: string) => text.trim().toLowerCase();
  const structuredNames = new Set(structured.flatMap((item) => [
    normalized(item.name), normalized(formatStructuredInclusion(item)),
  ]));
  const terms = [
    ...structured.map((item) => ({
      text: formatStructuredInclusion(item), excerpt: item.sourceExcerpt ?? sourceExcerpt(quote, item.name),
    })),
    ...[...(pkg?.inclusions ?? []), ...quote.inclusions]
      .filter((text) => !structuredNames.has(normalized(text)))
      .map((text) => ({ text, excerpt: sourceExcerpt(quote, text) })),
  ];
  return terms.filter((term) => term.text.trim());
}

function compareCoverage(
  quote: Quote, pkg: QuotePackageOption | undefined, calc: QuoteCalculationResult, hours?: number,
): { includedHours?: number; scenarioQuote: Quote; unresolved?: string } {
  const hourlyRows = calc.lineItemBreakdowns.filter((item) => item.billableHours !== undefined);
  const includedHours = pkg?.hours ?? quote.serviceDurationHours
    ?? hourlyRows.find((item) => item.conditionalOvertime)?.includedServiceHours;
  if (hours === undefined || calc.unresolvedPackageSelection || calc.unresolvedPackagePrice) return { includedHours, scenarioQuote: quote };
  if (calc.legacyReviewReasons.length > 0) {
    return { includedHours, scenarioQuote: quote, unresolved: 'Confirm saved coverage and extra hours before comparing a new duration.' };
  }
  if (hourlyRows.length === 0 && includedHours !== undefined && hours <= includedHours) {
    return { includedHours, scenarioQuote: quote };
  }
  const hourly = hourlyRows.length === 1 ? hourlyRows[0] : undefined;
  const soleService = !pkg && includedHours === undefined &&
    calc.lineItemBreakdowns.every((line) => line.id === hourly?.id || line.amount === 0);
  if (hourly && !AUXILIARY_HOURS.test(hourly.label) &&
      (hourly.conditionalOvertime ? includedHours !== undefined : soleService)) {
    const lineId = hourly.id;
    const clearQuantity = <T extends { id: string; quantity?: number }>(line: T): T =>
      line.id === lineId ? { ...line, quantity: undefined } : line;
    // The scenario's total coverage replaces a saved quantity only on the line
    // that can represent it. The saved quote and explicit extra hours stay intact.
    return {
      includedHours,
      scenarioQuote: {
        ...quote,
        lineItems: quote.lineItems.map(clearQuantity),
        packages: quote.packages?.map((tier) => tier.id === pkg?.id ? {
          ...tier, fees: tier.fees?.map(clearQuantity),
        } : tier),
      },
    };
  }
  return {
    includedHours, scenarioQuote: quote,
    unresolved: hourlyRows.length === 0 && includedHours !== undefined
      ? `Price beyond ${wholeHours(includedHours)} is not stated.`
      : 'The quote does not establish how the requested coverage is priced.',
  };
}

export function describeComparisonDifference(entries: ComparisonOption[], guestCount?: number): string | null {
  if (entries.length < 2 || entries.some((entry) => {
    const { vendor, quote, calc, contractTotal } = entry;
    return entry.rows.total.text === NOT_STATED || !quote || !calc || calc.capacityExceeded || quote.currency === 'UNKNOWN' || contractTotal !== undefined || vendor.status === 'Booked';
  })) return null;
  const scope = [...entries[0].vendor.eventIds].sort().join('\0');
  const currency = entries[0].quote!.currency;
  if (entries.some(({ vendor, quote }) => [...vendor.eventIds].sort().join('\0') !== scope || quote?.currency !== currency)) return null;

  const byPrice = [...entries].sort((a, b) => a.calc!.estimatedAllInTotal - b.calc!.estimatedAllInTotal);
  const lower = byPrice[0];
  const higher = byPrice[byPrice.length - 1];
  const low = lower.calc!;
  const high = higher.calc!;
  if (entries.every((entry) => entry.calc!.isEstimateComplete && entry.unresolved.length === 0)) {
    const gap = roundMoney(high.estimatedAllInTotal - low.estimatedAllInTotal);
    if (gap === 0) return `Estimated totals are equal at ${money(low.estimatedAllInTotal, currency)}.`;
    if (entries.length === 2) return `Estimated totals differ by ${money(gap, currency)}.`;
    return `Estimated totals range from ${money(low.estimatedAllInTotal, currency)} to ${money(high.estimatedAllInTotal, currency)}.`;
  }

  const fees = lower.quote!.unconfirmedFees.filter((fee) => fee.mandatory && fee.status === 'unconfirmed');
  const hasPercentageFees = low.lineItemBreakdowns.some((line) => line.formulaText.includes('%')) ||
    lower.quote!.addOns.some((addOn) => addOn.selected && addOn.pricingModel === 'percentage');
  const pretaxGap = roundMoney(high.preTaxTotal - low.preTaxTotal);
  if (entries.length !== 2 || lower.vendor.category !== 'venue' || guestCount === undefined ||
      lower.unresolved.length !== 1 || !fees.length || !high.isEstimateComplete || higher.unresolved.length ||
      low.hstAssumed || high.hstAssumed || low.taxRate !== high.taxRate ||
      low.effectiveTaxHandling !== high.effectiveTaxHandling || low.gratuityAmount !== 0 ||
      high.gratuityAmount !== 0 || hasPercentageFees || pretaxGap <= 0) return null;

  return `${lower.title} and ${higher.title} break even at ${guestCount} guests if ${fees.map((fee) => fee.label).join(' and ')} totals ${money(pretaxGap, currency)} before tax, assuming the same tax treatment.`;
}

function buildOption(
  workspace: WeddingWorkspace, vendor: Vendor, quote: Quote | null, scenario: ComparisonScenario,
  packageId?: string,
): ComparisonOption {
  const id = scenario.vendorId && packageId ? `${vendor.id}:${packageId}` : vendor.id;
  const selected = quote ? quoteForPackage(quote, packageId) : null;
  const pkg = selected ? getSelectedPackageOption(selected).selectedPackage : undefined;
  const title = scenario.vendorId ? pkg?.name ?? vendor.name : vendor.name;
  const contractTotal = vendor.status === 'Booked' ? vendor.bookedContractTotal : undefined;
  const scope = vendor.eventIds.length
    ? workspace.events.filter((event) => vendor.eventIds.includes(event.id)).map((event) => event.name).join(' · ')
    : 'Whole wedding';
  const rows: Record<string, ComparisonValue> = { scope: value(scope || NOT_STATED) };
  if (!selected) {
    for (const key of ['base', 'extras', 'gratuity', 'tax', 'pricing', 'minimum', 'capacity', 'coverage', 'inclusions', 'exclusions', 'delivery', 'restrictions', 'unresolved', ...Object.keys(DETAILS)]) rows[key] = value(NOT_STATED);
    rows.total = value(NOT_STATED);
    return { id, vendor, quote: null, title, calc: null, rows, unresolved: [], contractTotal };
  }

  const events = workspace.events.map((event) => event.id === scenario.eventId && scenario.guestCount !== undefined
    ? { ...event, guestCount: scenario.guestCount } : event);
  const baseline = calculateQuoteFinancials(selected, events, vendor.eventIds);
  const coverage = compareCoverage(selected, pkg, baseline, supportsCoverageHours(vendor.category) ? scenario.coverageHours : undefined);
  const priced = coverage.scenarioQuote === selected
    ? baseline
    : calculateQuoteFinancials(coverage.scenarioQuote, events, vendor.eventIds, undefined, scenario.coverageHours);
  const maxCapacity = pkg?.maxCapacity ?? selected.maxCapacity;
  const eventGuests = events.find((event) => event.id === scenario.eventId)?.guestCount;
  const calc = {
    ...priced,
    capacityExceeded: maxCapacity !== undefined && eventGuests != null && eventGuests > maxCapacity,
  };
  const currency = selected.currency;
  const evidence = (id: string | undefined) => selected.evidenceSpans.find((span) => span.id === id)?.excerpt;
  const billableLines = [...selected.lineItems, ...(pkg?.fees ?? [])];
  const rowsByLineId = new Map(calc.lineItemBreakdowns.map((line) => [line.id, line]));
  // The workspace has a one-hour fallback for legacy hourly input. Comparison
  // only displays a price when the source or scenario supplies billable units.
  const unpricedHourlyLines = new Set(billableLines.filter((line) => {
    const pricedRow = rowsByLineId.get(line.id);
    return coverage.scenarioQuote === selected && pricedRow?.billableHours !== undefined
      && !pricedRow.conditionalOvertime && line.quantity === undefined && line.extractedHours === undefined;
  }).map((line) => line.id));
  const included = inclusionTerms(selected, pkg);
  const explicitExclusions = (selected.exclusions ?? []).map((text) => ({ text, excerpt: sourceExcerpt(selected, text) }));
  const unpricedFees = selected.unconfirmedFees.filter((fee) => fee.status === 'unconfirmed');
  const pendingFees = unpricedFees.filter((fee) => fee.mandatory);
  const packageBase = pkg ? rowsByLineId.get(`pkg-active-${pkg.id}`)?.amount : undefined;
  const ratedExtras = pkg
    ? calc.lineItemBreakdowns.filter((line) => line.amount !== null && !unpricedHourlyLines.has(line.id) && line.id !== `pkg-active-${pkg.id}`)
    : [];
  const extraCharges = [
    ...ratedExtras.map((line) => {
      const source = billableLines.find((item) => item.id === line.id);
      return { text: `${line.label} ${money(line.amount!, currency)}`, excerpt: source?.sourceExcerpt ?? evidence(source?.evidenceId) };
    }),
    ...calc.addOnImpacts.map((addOn) => ({
      text: `${addOn.label} ${money(addOn.pricePreTax, currency)}${addOn.selected ? ' selected' : ' optional'}`,
      excerpt: evidence(selected.addOns.find((item) => item.id === addOn.id)?.evidenceId),
    })),
    ...selected.unconfirmedFees.filter((fee) => fee.status === 'confirmed_amount' && typeof fee.confirmedAmount === 'number')
      .map((fee) => ({ text: `${fee.label} ${money(fee.confirmedAmount!, currency)}`, excerpt: evidence(fee.evidenceId) })),
    ...unpricedFees.map((fee) => ({ text: `${fee.label}: ${UNPRICED_EXTRA}${fee.mandatory ? '' : ' (optional)'}`, excerpt: evidence(fee.evidenceId) })),
  ];

  const unresolved = unique([
    calc.unresolvedPackageSelection ? 'Select a package to compare its price and terms.' : undefined,
    calc.unresolvedPackagePrice ? 'Package price is not stated.' : undefined,
    calc.isCurrencyUnknown ? 'Currency is not stated.' : undefined,
    calc.guestCountMissing ? 'Guest count is required.' : undefined,
    calc.capacityExceeded ? 'The selected guest count exceeds the stated capacity for this quote.' : undefined,
    pendingFees.length ? `${UNPRICED_EXTRA}: ${pendingFees.map((fee) => fee.label).join(', ')}.` : undefined,
    calc.unresolvedConflictsCount ? 'Conflicting prices need review.' : undefined,
    calc.unresolvedPercentageCount ? 'A percentage charge has an unresolved calculation basis.' : undefined,
    calc.gratuityUnresolved ? 'Gratuity rate or calculation basis is missing.' : undefined,
    calc.taxRateUnresolved ? 'Tax applies but its rate is not stated.' : undefined,
    calc.taxNotStated ? 'Tax treatment is not stated.' : undefined,
    calc.hstAssumed ? 'Tax rate is estimated.' : undefined,
    selected.sourceWarnings?.length && !selected.sourceWarningsAcknowledged ? 'Source warnings need review.' : undefined,
    ...calc.legacyReviewReasons,
    coverage.unresolved,
    unpricedHourlyLines.size ? 'Billable hours are not stated for an hourly charge.' : undefined,
  ]);

  const covered = coverage.includedHours;
  const hours = calc.lineItemBreakdowns.filter((line) => line.billableHours !== undefined && !unpricedHourlyLines.has(line.id));
  const coverageText = unique([
    covered !== undefined ? `${wholeHours(covered)} included` : undefined,
    ...hours.map((line) => line.conditionalOvertime
      ? (line.billableHours! > 0 ? `${wholeHours(line.billableHours!)} overtime` : undefined)
      : `${line.label}: ${wholeHours(line.billableHours!)} priced`),
  ]).join(' · ');
  const pricing = termValue([
    ...(pkg && pkg.unitPrice !== null ? [{
      text: `${pkg.name}: ${money(pkg.unitPrice, currency)}${pkg.pricingModel === 'per_person' ? ' per guest' : ' flat'}`,
      excerpt: evidence(pkg.evidenceId),
    }] : []),
    ...billableLines.flatMap((line) => {
      const row = rowsByLineId.get(line.id);
      if (unpricedHourlyLines.has(line.id)) {
        return [{ text: `${line.label}: ${money(line.unitPrice, currency)} per hour`, excerpt: line.sourceExcerpt ?? evidence(line.evidenceId) }];
      }
      return row ? [{ text: `${line.label}: ${row.formulaText}`, excerpt: line.sourceExcerpt ?? evidence(line.evidenceId) }] : [];
    }),
  ]);
  const quotedMinima = [...new Set(billableLines.flatMap((line) =>
    rowsByLineId.has(line.id) && line.pricingModel === 'per_person' && line.minGuests !== undefined ? [line.minGuests] : []))];
  const minimum = pkg?.minGuests ?? selected.minGuests ?? calc.appliedMinGuests
    ?? (quotedMinima.length === 1 ? quotedMinima[0] : undefined);
  const gratuityStatus = pkg?.gratuityStatus ?? selected.gratuityStatus;
  const explicitGratuity = calc.lineItemBreakdowns.find((line) =>
    line.amount !== null && /\b(gratuity|tip|service\s*charge)\b/i.test(line.label));
  const hasPrice = unpricedHourlyLines.size === 0 && !(calc.guestCountMissing && calc.preTaxTotal === 0)
    && !calc.unresolvedPackageSelection && !calc.unresolvedPackagePrice && (
    calc.lineItemBreakdowns.some((line) => line.amount !== null) || calc.preTaxTotal !== 0
  );

  Object.assign(rows, {
    base: value(hasPrice ? money(pkg ? packageBase ?? calc.baseSubtotal : calc.baseSubtotal, currency) : NOT_STATED,
      pkg ? [evidence(pkg.evidenceId)] : billableLines.map((line) => line.sourceExcerpt ?? evidence(line.evidenceId))),
    extras: termValue(extraCharges),
    gratuity: value(calc.gratuityUnresolved ? UNPRICED_EXTRA : !unpricedHourlyLines.size && calc.gratuityAmount > 0
      ? money(calc.gratuityAmount, currency) : explicitGratuity ? `${money(explicitGratuity.amount!, currency)} · in quote charges`
        : gratuityStatus === 'included' ? 'Included' :
        gratuityStatus === 'excluded' && !unpricedHourlyLines.size ? money(0, currency) : NOT_STATED),
    tax: value(calc.taxNotStated ? NOT_STATED : calc.taxRateUnresolved ? UNPRICED_EXTRA
      : !unpricedHourlyLines.size && calc.taxAmount > 0 ? `${money(calc.taxAmount, currency)} · ${calc.taxStatusLabel}` : calc.taxStatusLabel),
    total: hasPrice ? {
      text: money(calc.estimatedAllInTotal, currency),
      detail: calc.isEstimateComplete && unresolved.length === 0 ? 'Scenario estimate' : 'Incomplete · known costs',
    } : value(NOT_STATED),
    pricing,
    minimum: value(minimum === null || minimum === undefined ? NOT_STATED
      : `${minimum} guests${calc.minGuestsApplied ? ' · minimum applied' : ''}`),
    capacity: value(maxCapacity === undefined ? NOT_STATED : `${maxCapacity} guests${calc.capacityExceeded ? ' · over capacity' : ''}`),
    coverage: value(coverageText || NOT_STATED, [evidence(pkg?.evidenceId), ...included.filter((term) => /\bhours?\b/i.test(term.text)).map((term) => term.excerpt)]),
    inclusions: termValue(included),
    exclusions: termValue(explicitExclusions, `${NOT_INCLUDED}: `),
    delivery: termValue([...(pkg?.deliveryTerms ?? []), ...(selected.deliveryTerms ?? [])]
      .map((text) => ({ text, excerpt: sourceExcerpt(selected, text) }))),
    restrictions: termValue((selected.restrictions ?? []).map((text) => ({ text, excerpt: sourceExcerpt(selected, text) }))),
    unresolved: value(unresolved.length ? unresolved.join(' · ') : 'None flagged'),
  });
  for (const [key, pattern] of Object.entries(DETAILS)) {
    const summary = key === 'staffing' || key === 'equipment' ? selected.avAndStaffingSummary
      : key === 'menu' ? selected.cateringAndBarSummary : undefined;
    rows[key] = termValue([
      ...included.filter((term) => pattern.test(term.text)),
      ...billableLines.flatMap((item) => rowsByLineId.has(item.id) && pattern.test(item.label) ? [{
        text: unpricedHourlyLines.has(item.id)
          ? `${item.label}: ${money(item.unitPrice, currency)} per hour`
          : `${item.label}: ${rowsByLineId.get(item.id)!.formulaText}`,
        excerpt: item.sourceExcerpt ?? evidence(item.evidenceId),
      }] : []),
      ...explicitExclusions.filter((term) => pattern.test(term.text))
        .map((term) => ({ ...term, text: `${NOT_INCLUDED}: ${term.text}` })),
      ...unpricedFees.filter((fee) => pattern.test(fee.label))
        .map((fee) => ({ text: `${fee.label}: ${UNPRICED_EXTRA}`, excerpt: evidence(fee.evidenceId) })),
      ...(summary && pattern.test(summary) ? [{ text: summary, excerpt: sourceExcerpt(selected, summary) }] : []),
    ]);
  }
  return { id, vendor, quote: selected, packageId: pkg?.id, title, calc, rows, unresolved, contractTotal };
}

export function buildVendorComparison(workspace: WeddingWorkspace, scenario: ComparisonScenario): ComparisonResult {
  const event = workspace.events.find((item) => item.id === scenario.eventId);
  const entries: ComparisonOption[] = [];
  const unquotedVendors: Vendor[] = [];
  for (const vendor of workspace.vendors) {
    if (!event || vendor.status === 'Declined' || vendor.category !== scenario.category || !vendor.eventIds.includes(event.id) ||
        (scenario.vendorId && vendor.id !== scenario.vendorId)) continue;
    const active = vendor.quotes.find((quote) => quote.id === vendor.activeQuoteId && quote.approvalState === 'approved')
      ?? [...vendor.quotes].reverse().find((quote) => quote.approvalState === 'approved') ?? null;
    if (!active && (vendor.status !== 'Booked' || vendor.bookedContractTotal === undefined)) {
      unquotedVendors.push(vendor);
      continue;
    }
    if (scenario.vendorId && active?.packages?.length) {
      entries.push(...active.packages.map((pkg) => buildOption(workspace, vendor, active, scenario, pkg.id)));
    } else {
      const selection = active?.packages?.find((pkg) => pkg.id === scenario.packageByVendor?.[vendor.id])?.id
        ?? active?.selectedPackageId ?? undefined;
      entries.push(buildOption(workspace, vendor, active, scenario, selection));
    }
  }
  return { entries, unquotedVendors, difference: describeComparisonDifference(entries, scenario.guestCount ?? event?.guestCount ?? undefined) };
}
