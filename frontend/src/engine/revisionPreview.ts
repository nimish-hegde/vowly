import { roundMoney } from '../../../shared/finance/calculator.ts';
import { calculateQuoteFinancials, calculateWorkspaceFinancials, getVendorActiveQuote } from './financialCalculator.ts';
import { reconcileQuoteRevision } from './quoteRevision.ts';
import type { Quote, Vendor, VendorCategory, WeddingWorkspace } from '../types/vowly.ts';

export function hasCompetingSelectedVendor(
  vendors: Vendor[],
  candidate: Pick<Vendor, 'category' | 'eventIds'>,
  excludeVendorId?: string,
): boolean {
  return vendors.some((vendor) => vendor.id !== excludeVendorId &&
    (vendor.status === 'Booked' || vendor.isPreferred) &&
    vendor.category === candidate.category &&
    (vendor.eventIds.some((id) => candidate.eventIds.includes(id)) ||
      (vendor.eventIds.length === 0 && candidate.eventIds.length === 0)));
}

export function getApprovedRevisionBaseline(vendor: Vendor): Quote | undefined {
  const active = getVendorActiveQuote(vendor);
  return active?.approvalState === 'approved' ? active : [...vendor.quotes].reverse().find((q) => q.approvalState === 'approved');
}

function stable(value: unknown, skip?: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => stable(item, skip));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key, field]) => !skip?.has(key) && field !== undefined && !(Array.isArray(field) && field.length === 0)).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, field]) => [key, stable(field, skip)]));
  }
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value;
}

function termsKey(quote: Quote): string {
  const transportKeys = new Set([
    'id', 'evidenceId', 'sourceExcerpt', 'pageReference', 'receivedDate', 'approvalState',
    'sourceType', 'sourceChannel', 'sourceText', 'revisions', 'revisionDraft', 'revisionSources',
    'evidenceSpans', 'attachmentPreview', 'legacyReviewAcknowledged',
    'targetLineItemId', 'resolvedOptionId', 'selectedPaymentOptionId',
  ]);
  const lines = [...quote.lineItems, ...(quote.packages ?? []).flatMap((pkg) => pkg.fees ?? [])];
  const conflictChoices = quote.conflicts.map((conflict) => {
    const target = lines.find((line) => line.id === conflict.targetLineItemId);
    return {
      target: target && [target.label, target.packageId, target.eventId],
      choice: conflict.options.find((option) => option.id === conflict.resolvedOptionId),
    };
  });
  const paymentSelection = quote.paymentOptions?.find((option) => option.id === quote.selectedPaymentOptionId);
  return JSON.stringify(stable({ quote, conflictChoices, paymentSelection }, transportKeys));
}

function fingerprint(value: string): string {
  let a = 2166136261;
  let b = 5381;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    a = Math.imul(a ^ code, 16777619);
    b = Math.imul(b, 33) ^ code;
  }
  return [value.length, a >>> 0, b >>> 0].map((part) => part.toString(36)).join('-');
}

export function buildQuoteRevisionPreview(
  workspace: WeddingWorkspace,
  vendor: Vendor,
  incoming: Quote,
  proposedEventIds: string[] = vendor.eventIds,
  proposedCategory: VendorCategory = vendor.category,
) {
  const draft = incoming.revisionDraft;
  const current = getApprovedRevisionBaseline(vendor);
  if (!draft || !current) return null;

  const baseline = vendor.quotes.find((q) => q.id === draft.baselineQuoteId && q.approvalState === 'approved') ?? current;
  const stale = current.id !== draft.baselineQuoteId;
  const booked = vendor.status === 'Booked';
  const eventIds = booked ? vendor.eventIds : proposedEventIds;
  const category = booked ? vendor.category : proposedCategory;
  // The mapper assigns the selected event to line items. A legacy quote can
  // express the same single-event scope through its vendor association alone.
  const defaultEventId = vendor.eventIds.length === 1 && eventIds.length === 1 &&
    vendor.eventIds[0] === eventIds[0] ? eventIds[0] : undefined;
  const reconciliation = reconcileQuoteRevision(baseline, incoming, draft.decisions, draft.mode, defaultEventId);
  const quote = reconciliation.quote;

  // A partial source can be re-imported with new generated IDs. Manual reversals
  // are evaluated against the explicitly reviewed baseline.
  const revisionKey = fingerprint(JSON.stringify(stable({
    vendorId: vendor.id,
    mode: draft.mode,
    source: incoming.sourceText,
    terms: termsKey(incoming),
    decisions: draft.decisions ?? {},
    baseline: draft.mode === 'manual' ? draft.baselineQuoteId : undefined,
    eventIds,
    category,
  })));
  const replay = current.revisions?.some((revision) => revision.revisionKey === revisionKey) ?? false;
  const alreadyApplied = !stale && reconciliation.blockingReasons.length === 0 &&
    category === vendor.category && eventIds.join('\0') === vendor.eventIds.join('\0') &&
    termsKey(current) === termsKey(quote);
  const duplicate = replay || alreadyApplied;

  const previousCalc = calculateQuoteFinancials(baseline, workspace.events, vendor.eventIds);
  const proposedCalc = calculateQuoteFinancials(quote, workspace.events, eventIds);
  const sameCurrency = baseline.currency === quote.currency && quote.currency !== 'UNKNOWN';
  const currencyConflict = draft.mode === 'partial' && incoming.currency !== 'UNKNOWN' && incoming.currency !== baseline.currency;
  const comparable = !currencyConflict && sameCurrency && !previousCalc.unresolvedPackageSelection && !proposedCalc.unresolvedPackageSelection &&
    !previousCalc.unresolvedPackagePrice && !proposedCalc.unresolvedPackagePrice;
  const preTaxDelta = comparable ? roundMoney(proposedCalc.preTaxTotal - previousCalc.preTaxTotal) : null;
  const allInDelta = comparable && previousCalc.isEstimateComplete && proposedCalc.isEstimateComplete
    ? roundMoney(proposedCalc.estimatedAllInTotal - previousCalc.estimatedAllInTotal) : null;
  const blockingReasons = [
    ...reconciliation.blockingReasons,
    ...proposedCalc.blockingReasons,
    ...(stale && !duplicate ? ['The approved quote changed. Review a new comparison before approving.'] : []),
    ...(booked && !sameCurrency ? ['The booked contract currency cannot change through quote review.'] : []),
    ...(booked && vendor.bookedContractTotal == null ? ['Confirm the existing booking amount before approving a quote revision.'] : []),
  ];

  const budgetCurrencyMatches = quote.currency === workspace.currency;
  let projectedDelta: number | null = null;
  if (duplicate || (booked && vendor.bookedContractTotal != null)) {
    projectedDelta = 0;
  } else if (budgetCurrencyMatches && !stale && comparable && blockingReasons.length === 0) {
    const isPreferred = vendor.isPreferred && !hasCompetingSelectedVendor(workspace.vendors, { category, eventIds }, vendor.id);
    const candidate: Vendor = { ...vendor, category, eventIds, isPreferred, status: 'Quoted', quotes: [quote], activeQuoteId: quote.id };
    const projected = calculateWorkspaceFinancials({
      ...workspace,
      vendors: workspace.vendors.map((item) => item.id === vendor.id ? candidate : item),
    });
    projectedDelta = roundMoney(projected.projectedSpend - calculateWorkspaceFinancials(workspace).projectedSpend);
  }
  return {
    ...reconciliation,
    blockingReasons,
    baseline,
    previousCalc,
    proposedCalc,
    currencyConflict,
    preTaxDelta,
    allInDelta,
    projectedDelta,
    bookedContractTotal: booked ? vendor.bookedContractTotal : undefined,
    duplicate,
    stale,
    revisionKey,
  };
}
