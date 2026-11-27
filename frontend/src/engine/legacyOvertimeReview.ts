import type { Quote, QuoteLineItem } from '../types/vowly.ts';

const OVERTIME_LABEL =
  /\b(additional|extra|overtime|extension|extended|subsequent)\s*(hourly|hours?|hrs?)\b|\b(hourly|hours?|hrs?)\s*(extension|overtime)\b|\b(after|beyond)\s+\d+\s*(hours?|hrs?)\b|\bovertime\b/i;

/** Old quotes could bill one hour by default without recording whether the couple chose it. */
export function findAmbiguousLegacyOvertimeItems(quote: Quote): QuoteLineItem[] {
  const packages = quote.packages ?? [];
  const selectedPackage = packages.length === 1
    ? packages[0]
    : packages.find((pkg) => pkg.id === quote.selectedPackageId);
  const knownPackageIds = new Set(packages.map((pkg) => pkg.id.toLowerCase()));
  const activeLines = quote.lineItems.filter((item) => {
    const scope = item.packageId?.trim().toLowerCase();
    return packages.length < 2 || !scope || !knownPackageIds.has(scope)
      || scope === selectedPackage?.id.toLowerCase();
  });
  if (!selectedPackage && !activeLines.some((item) => item.pricingModel === 'flat')) return [];

  return [...activeLines, ...(selectedPackage?.fees ?? [])].filter((item) => {
    if (item.pricingModel !== 'hourly' || item.isConditionalOvertime !== undefined ||
      item.sourceExcerpt !== undefined || item.extractedHours !== undefined ||
      item.chargeType !== undefined || (item.quantity ?? 1) !== 1) return false;

    const excerpt = quote.evidenceSpans?.find((span) => span.id === item.evidenceId)?.excerpt;
    return OVERTIME_LABEL.test(item.label) || OVERTIME_LABEL.test(excerpt ?? '');
  });
}
