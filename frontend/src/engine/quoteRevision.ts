import type {
  IncludedPricingItem, Quote, QuoteAddOn, QuoteEvidenceSpan, QuoteLineItem,
  QuotePackageOption, QuoteUnconfirmedFee,
} from '../types/vowly.ts';

import type { RevisionChange, RevisionDecision } from '../types/vowly.ts';
export type { RevisionChange, RevisionDecision } from '../types/vowly.ts';

export interface QuoteRevisionResult {
  quote: Quote;
  changes: RevisionChange[];
  blockingReasons: string[];
}

type Cost = (
  | { type: 'line'; item: QuoteLineItem }
  | { type: 'fee'; item: QuoteUnconfirmedFee }
  | { type: 'optional'; item: QuoteAddOn }
  | { type: 'included'; item: IncludedPricingItem }
) & { key: string; packageId?: string; eventId?: string; nested: boolean };

const norm = (text: string) => text.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const uniqueList = <T>(old: T[] = [], incoming: T[] = []) =>
  [...old, ...incoming.filter((item) => !old.some((previous) => same(previous, item)))];

function supplied<T extends object>(old: T, incoming: T): T {
  return { ...old, ...Object.fromEntries(Object.entries(incoming).filter(([, value]) => value !== undefined)) };
}

function reserveId(preferred: string, used: Set<string>): string {
  let id = preferred;
  for (let suffix = 1; used.has(id); suffix++) id = 'revision-' + preferred + '-' + suffix;
  used.add(id);
  return id;
}

function evidence(quote: Quote, id?: string, excerpt?: string) {
  return quote.evidenceSpans.find((span) => span.id === id)?.excerpt ?? excerpt;
}

function evidenceForField(quote: Quote, field: string) {
  return quote.evidenceSpans.find((span) => norm(span.sourceLabel) === norm(field))?.excerpt;
}

function money(amount: number, currency: Quote['currency'], model?: QuoteLineItem['pricingModel']) {
  if (model === 'percentage') return amount + '%';
  const unit = model === 'per_person' ? '/person' : model === 'hourly' ? '/hour'
    : model === 'per_extra_guest' ? '/additional guest' : model === 'guest_ratio' ? '/staffing unit' : '';
  return (currency === 'UNKNOWN' ? '' : currency + ' ') + '$' +
    amount.toLocaleString('en-CA', { maximumFractionDigits: 2 }) + unit;
}

function showCost(cost: Cost, currency: Quote['currency']): string {
  switch (cost.type) {
    case 'line': {
      const base = money(cost.item.unitPrice, currency, cost.item.pricingModel);
      if (cost.item.pricingModel === 'hourly') {
        const hours = cost.item.quantity ?? cost.item.extractedHours;
        if (hours !== undefined) return `${base} · ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
      }
      return base;
    }
    case 'optional':
      return money(cost.item.pricePreTax, currency, cost.item.pricingModel) +
        (cost.item.selected ? ' · optional (selected)' : ' · optional');
    case 'included': return 'Included';
    case 'fee':
      if (cost.item.status === 'waived_or_included') return 'Waived or included';
      if (cost.item.status === 'confirmed_amount' && typeof cost.item.confirmedAmount === 'number') {
        return money(cost.item.confirmedAmount, currency);
      }
      return cost.item.mandatory ? 'Mandatory fee · amount TBD' : 'Optional fee · amount TBD';
  }
}

function costEvidence(quote: Quote, cost: Cost) {
  if (cost.type === 'included') return cost.item.sourceExcerpt;
  return evidence(quote, cost.item.evidenceId, cost.type === 'line' ? cost.item.sourceExcerpt : undefined);
}

function costRows(quote: Quote): Cost[] {
  const line = (item: QuoteLineItem, packageId?: string): Cost => ({
    type: 'line', item, key: item.id, packageId: packageId ?? item.packageId, eventId: item.eventId, nested: Boolean(packageId),
  });
  const included = (item: IncludedPricingItem, index: number, packageId?: string): Cost => ({
    type: 'included', item, key: 'included:' + (packageId ?? 'quote') + ':' + index,
    packageId: packageId ?? item.packageId, nested: Boolean(packageId),
  });
  return [
    ...quote.lineItems.map((item) => line(item)),
    ...quote.addOns.map((item): Cost => ({
      type: 'optional', item, key: item.id, packageId: item.packageId, eventId: item.eventId, nested: false,
    })),
    ...quote.unconfirmedFees.map((item): Cost => ({
      type: 'fee', item, key: item.id, packageId: item.packageId, nested: false,
    })),
    ...(quote.includedPricingItems ?? []).map((item, index) => included(item, index)),
    ...(quote.packages ?? []).flatMap((pkg) => [
      ...(pkg.fees ?? []).map((item) => line(item, pkg.id)),
      ...(pkg.includedPricingItems ?? []).map((item, index) => included(item, index, pkg.id)),
    ]),
  ];
}

function withScope(cost: Cost, key: string, packageId?: string, eventId?: string, evidenceId?: string): Cost {
  const scope = { key, packageId, eventId, nested: cost.nested && Boolean(packageId) };
  switch (cost.type) {
    case 'line': return { type: 'line', ...scope, item: { ...cost.item, id: key, packageId, eventId, evidenceId } };
    case 'optional': return { type: 'optional', ...scope, item: { ...cost.item, id: key, packageId, eventId, evidenceId } };
    case 'fee': return { type: 'fee', ...scope, item: { ...cost.item, id: key, packageId, evidenceId } };
    case 'included': return { type: 'included', ...scope, item: { ...cost.item, packageId } };
  }
}

function amendCost(previous: Cost, incoming: Cost): Cost {
  if (previous.type === 'line' && incoming.type === 'line' && previous.item.pricingModel === incoming.item.pricingModel) {
    const merged = supplied(previous.item, incoming.item);
    if (previous.item.pricingModel === 'hourly') {
      const hoursChanged =
        incoming.item.extractedHours !== undefined &&
        incoming.item.extractedHours !== (previous.item.extractedHours ?? previous.item.quantity);
      if (incoming.item.quantity === undefined && previous.item.quantity !== undefined && hoursChanged) {
        merged.quantity = undefined;
      }
      if (
        incoming.item.isConditionalOvertime === undefined &&
        previous.item.isConditionalOvertime === true &&
        ((incoming.item.extractedHours !== undefined && incoming.item.extractedHours > 1) ||
          (incoming.item.chargeType === 'mandatory' && previous.item.chargeType !== 'mandatory'))
      ) {
        merged.isConditionalOvertime = undefined;
        if (incoming.item.quantity === undefined && previous.item.quantity === 0) {
          merged.quantity = undefined;
        }
      }
    }
    return { ...incoming, item: merged };
  }
  if (previous.type === 'optional' && incoming.type === 'optional') {
    const item = previous.item.pricingModel === incoming.item.pricingModel ? supplied(previous.item, incoming.item) : incoming.item;
    const explicitSelection = incoming.item.selectionConfirmed === true || incoming.item.selected === true;
    const { selectionConfirmed: _ignored, ...cleanItem } = item;
    return {
      ...incoming,
      item: {
        ...cleanItem,
        selected: explicitSelection ? incoming.item.selected : previous.item.selected,
      },
    };
  }
  return incoming;
}

function costFacts(cost: Cost) {
  const { id, evidenceId, sourceExcerpt, pageReference, ...facts } = cost.item as QuoteLineItem;
  return [cost.type, cost.packageId, cost.eventId, Object.entries(facts).filter(([, value]) => value !== undefined).sort()];
}

function editAmount(cost: Cost, decision: RevisionDecision | undefined): Cost | undefined {
  if (decision?.action !== 'manual') return cost;
  const entered = decision.value.trim();
  const amount = Number(entered);
  if (!/^\d+(?:\.\d{1,2})?$/.test(entered) || !Number.isFinite(amount) || cost.type === 'included') return undefined;
  if (cost.type === 'line') return { ...cost, item: { ...cost.item, unitPrice: amount } };
  if (cost.type === 'optional') return { ...cost, item: { ...cost.item, pricePreTax: amount } };
  return { ...cost, item: { ...cost.item, status: 'confirmed_amount', confirmedAmount: amount } };
}

function taxLabel(quote: Pick<Quote, 'taxHandling' | 'taxPercent'> | QuotePackageOption) {
  if (quote.taxHandling === 'included') return 'Tax included';
  if (quote.taxHandling === 'tax_exempt') return 'Tax exempt';
  if (quote.taxHandling === 'excluded_plus_hst') return quote.taxPercent == null ? 'Plus tax · rate TBD' : 'Plus ' + quote.taxPercent + '% tax';
  if (quote.taxHandling === 'unspecified_ontario_assumed') return 'Tax estimated';
  return 'Tax not stated';
}

function gratuityLabel(quote: Pick<Quote, 'gratuityStatus' | 'gratuityPercent' | 'gratuityBasis'> | QuotePackageOption) {
  if (quote.gratuityStatus === 'included') return 'Gratuity included';
  if (quote.gratuityStatus !== 'excluded' && quote.gratuityPercent == null) return 'Gratuity not stated';
  return quote.gratuityPercent == null ? 'Gratuity · rate TBD'
    : quote.gratuityPercent + '% gratuity' + (quote.gratuityBasis ? ' · ' + quote.gratuityBasis.replaceAll('_', ' ') : '');
}

function paymentLabel(source: Quote | QuotePackageOption, currency: Quote['currency']): string | null {
  return [
    source.paymentTermsSummary,
    source.depositAmount === undefined ? undefined : 'Deposit ' + money(source.depositAmount, currency),
    source.depositPercent === undefined ? undefined : 'Deposit ' + source.depositPercent + '%',
    ...(source.paymentMilestones ?? []).map((item) => [
      item.label,
      item.amount !== undefined ? money(item.amount, currency) : item.percent !== undefined ? item.percent + '%' : undefined,
      item.dueDate ?? item.relativeDeadlineText,
      item.relativeDaysBeforeEvent === undefined ? undefined : item.relativeDaysBeforeEvent + ' days before event',
    ].filter(Boolean).join(' · ')),
  ].filter(Boolean).join(' · ') || null;
}

function paymentAmendment<T extends Quote | QuotePackageOption>(old: T, incoming: T) {
  const amendments = incoming.paymentMilestones ?? [];
  const touched = new Set<string>();
  const milestones = (old.paymentMilestones ?? []).map((milestone) => {
    const candidates = amendments.filter((item) => norm(item.label) === norm(milestone.label));
    if (candidates.length !== 1) return milestone;
    const next = candidates[0];
    touched.add(norm(next.label));
    return {
      ...supplied(milestone, next),
      amount: next.percent !== undefined && next.amount === undefined ? undefined : next.amount ?? milestone.amount,
      percent: next.amount !== undefined && next.percent === undefined ? undefined : next.percent ?? milestone.percent,
      dueDate: next.relativeDaysBeforeEvent !== undefined && next.dueDate === undefined ? undefined : next.dueDate ?? milestone.dueDate,
      relativeDaysBeforeEvent: next.dueDate !== undefined && next.relativeDaysBeforeEvent === undefined ? undefined
        : next.relativeDaysBeforeEvent ?? milestone.relativeDaysBeforeEvent,
    };
  });
  return {
    paymentTermsSummary: incoming.paymentTermsSummary?.trim() && incoming.paymentTermsSummary !== 'Confirm deposit and payment schedule with vendor.'
      ? incoming.paymentTermsSummary : old.paymentTermsSummary,
    paymentMilestones: [...milestones, ...amendments.filter((item) => !touched.has(norm(item.label)))],
    depositAmount: incoming.depositPercent !== undefined && incoming.depositAmount === undefined ? undefined
      : incoming.depositAmount ?? old.depositAmount,
    depositPercent: incoming.depositAmount !== undefined && incoming.depositPercent === undefined ? undefined
      : incoming.depositPercent ?? old.depositPercent,
  };
}

function packageLabel(pkg: QuotePackageOption, currency: Quote['currency']): string {
  return [
    pkg.name,
    pkg.unitPrice === null ? 'Base price TBD' : money(pkg.unitPrice, currency, pkg.pricingModel === 'unknown' ? undefined : pkg.pricingModel),
    pkg.minGuests === undefined ? undefined : pkg.minGuests + ' guest minimum',
    pkg.maxCapacity === undefined ? undefined : pkg.maxCapacity + ' guest capacity',
    pkg.hours === undefined ? undefined : pkg.hours + ' hours',
    pkg.includedGuests === undefined ? undefined : pkg.includedGuests + ' guests included',
    pkg.extraGuestRate === undefined ? undefined : money(pkg.extraGuestRate, currency, 'per_extra_guest'),
    pkg.taxHandling ? taxLabel(pkg) : undefined,
    pkg.gratuityStatus ? gratuityLabel(pkg) : undefined,
    paymentLabel(pkg, currency),
    ...pkg.inclusions,
    ...(pkg.deliveryTerms ?? []),
  ].filter(Boolean).join(' · ');
}

type RevisionContext = {
  previous: Quote;
  incoming: Quote;
  decisions: Readonly<Record<string, RevisionDecision>>;
  partial: boolean;
  defaultEventId?: string;
  changes: RevisionChange[];
  blockingReasons: string[];
  mapEvidenceId: (id?: string) => string | undefined;
};

function revisePackages(context: RevisionContext) {
  const { previous, incoming, decisions, partial, changes, blockingReasons, mapEvidenceId } = context;
  const before = previous.packages ?? [];
  const proposed = incoming.packages ?? [];
  const result = new Map(before.map((pkg) => [pkg.id, pkg]));
  const used = new Set(result.keys());
  const touched = new Set<string>();
  const mapped = new Map<string, string | undefined>();
  for (const pkg of proposed) {
    const id = 'package:' + pkg.id;
    const decision = decisions[id];
    const matching = before.filter((item) => norm(item.name) === norm(pkg.name));
    const uniqueName = matching.length === 1 && proposed.filter((item) => norm(item.name) === norm(pkg.name)).length === 1;
    const old = decision?.action === 'replace' ? result.get(decision.targetId)
      : partial ? uniqueName ? matching[0] : undefined : result.get(pkg.id);
    const unknown = partial && !old && decision?.action !== 'retain' && (
      decision?.action === 'replace' ||
      (decision?.action !== 'accept' && (before.length > 0 || previous.lineItems.length > 0)));
    if (unknown || (old && touched.has(old.id))) {
      changes.push({
        id, field: pkg.name, scope: 'Package', previous: null, proposed: packageLabel(pkg, incoming.currency),
        kind: 'ambiguous', proposedEvidence: evidence(incoming, pkg.evidenceId), canAccept: true, needsDecision: true,
        candidates: before.filter((item) => !touched.has(item.id)).map((item) => ({
          id: item.id, label: item.name, value: packageLabel(item, previous.currency), evidence: evidence(previous, item.evidenceId),
        })),
      });
      blockingReasons.push('Confirm whether "' + pkg.name + '" changes an existing package or adds another option.');
      mapped.set(pkg.id, undefined);
      continue;
    }
    if (old) touched.add(old.id);
    const removed = decision?.action === 'remove' && Boolean(old);
    const retained = decision?.action === 'retain';
    const revised = old && partial ? {
      ...supplied(old, pkg),
      unitPrice: pkg.unitPrice ?? old.unitPrice,
      pricingModel: pkg.pricingModel === 'unknown' ? old.pricingModel : pkg.pricingModel,
      inclusions: uniqueList(old.inclusions, pkg.inclusions),
      structuredInclusions: uniqueList(old.structuredInclusions, pkg.structuredInclusions),
      deliveryTerms: uniqueList(old.deliveryTerms, pkg.deliveryTerms),
      ...paymentAmendment(old, pkg),
    } : pkg;
    const packageId = old?.id ?? reserveId(pkg.id, used);
    if (removed) result.delete(packageId);
    else if (!retained) result.set(packageId, {
      ...revised, id: packageId, evidenceId: mapEvidenceId(pkg.evidenceId) ?? old?.evidenceId,
      structuredInclusions: revised.structuredInclusions?.map((item) =>
        item.packageId === pkg.id ? { ...item, packageId } : item),
    });
    mapped.set(pkg.id, retained || removed ? undefined : packageId);
    const previousValue = old ? packageLabel(old, previous.currency) : null;
    const proposedValue = removed || (retained && !old) ? null
      : retained ? previousValue : packageLabel(revised, incoming.currency === 'UNKNOWN' ? previous.currency : incoming.currency);
    if (previousValue !== proposedValue || retained) changes.push({
      id, field: pkg.name, scope: 'Package', previous: previousValue, proposed: proposedValue,
      kind: removed ? 'removed' : retained ? 'carried' : old ? 'changed' : 'added',
      previousEvidence: evidence(previous, old?.evidenceId), proposedEvidence: evidence(incoming, pkg.evidenceId),
      canRemove: Boolean(old),
    });
  }
  for (const pkg of before) {
    if (touched.has(pkg.id)) continue;
    const id = 'package:previous:' + pkg.id;
    const remove = decisions[id]?.action === 'remove' || (!partial && decisions[id]?.action !== 'retain');
    if (remove) result.delete(pkg.id);
    const label = packageLabel(pkg, previous.currency);
    changes.push({
      id, field: pkg.name, scope: 'Package', previous: label, proposed: remove ? null : label,
      kind: remove ? 'removed' : 'carried', previousEvidence: evidence(previous, pkg.evidenceId), canRemove: true, canAccept: false,
    });
  }
  return { result, mapped };
}

function reviseCosts(context: RevisionContext, packages: ReturnType<typeof revisePackages>, currency: Quote['currency']) {
  const { previous, incoming, decisions, partial, changes, blockingReasons, mapEvidenceId } = context;
  const oldRows = costRows(previous).filter((row) =>
    !row.packageId || !previous.packages?.some((pkg) => pkg.id === row.packageId) || packages.result.has(row.packageId));
  const proposed = costRows(incoming).flatMap((row) => {
    if (row.packageId && packages.mapped.has(row.packageId) && packages.mapped.get(row.packageId) === undefined) return [];
    return [{ ...row, packageId: row.packageId ? packages.mapped.get(row.packageId) ?? row.packageId : undefined }];
  });
  const result = new Map(oldRows.map((row) => [row.key, row]));
  const used = new Set(result.keys());
  const touched = new Set<string>();
  const preserved = new Set<string>();
  const mapped = new Map<string, string>();
  const repriced = new Set<string>();
  const scope = (row: Cost) => row.packageId ? packages.result.get(row.packageId)?.name ?? row.packageId : row.eventId;
  const exact = (left: Cost, right: Cost) => left.packageId === right.packageId && (left.eventId ?? context.defaultEventId) === (right.eventId ?? context.defaultEventId) && norm(left.item.label) === norm(right.item.label);
  for (const row of proposed) {
    const id = 'cost:' + row.key;
    const decision = decisions[id];
    const matching = oldRows.filter((item) => exact(item, row));
    const occurrences = proposed.filter((item) => exact(item, row)).length;
    const related = oldRows.filter((item) =>
      (!item.packageId || !row.packageId || item.packageId === row.packageId) &&
      (!item.eventId || !row.eventId || item.eventId === row.eventId));
    const candidates = related.filter((item) => !touched.has(item.key));
    const old = decision?.action === 'replace' ? candidates.find((item) => item.key === decision.targetId)
      : partial ? matching.length === 1 && occurrences === 1 ? matching[0] : undefined : result.get(row.key);
    const invalidScope = Boolean(row.packageId && !packages.result.has(row.packageId));
    const ambiguous = partial && !old && decision?.action !== 'retain' && (
      decision?.action === 'replace' || invalidScope ||
      (decision?.action !== 'accept' && (related.length > 0 || occurrences > 1)));
    if (ambiguous || (old && touched.has(old.key))) {
      changes.push({
        id, field: row.item.label, scope: scope(row), previous: null, proposed: showCost(row, currency),
        kind: 'ambiguous', proposedEvidence: costEvidence(incoming, row), canAccept: !invalidScope, needsDecision: true,
        candidates: candidates.map((item) => ({
          id: item.key, label: item.item.label, value: showCost(item, previous.currency), evidence: costEvidence(previous, item),
        })),
      });
      blockingReasons.push('Confirm how "' + row.item.label + '" relates to the previous quote before approving.');
      continue;
    }
    if (old) {
      touched.add(old.key);
      if (decision) preserved.add(old.key);
    }
    const removed = decision?.action === 'remove' && Boolean(old);
    const retained = decision?.action === 'retain';
    const key = old?.key ?? reserveId(row.key, used);
    const carriedEvidence = old && old.type !== 'included' && old.type === row.type ? old.item.evidenceId : undefined;
    const proposedEvidence = row.type === 'included' ? undefined : mapEvidenceId(row.item.evidenceId);
    const scoped = withScope(row, key, partial ? old?.packageId ?? row.packageId : row.packageId,
      partial ? old?.eventId ?? row.eventId : row.eventId, proposedEvidence ?? carriedEvidence);
    const amended = old && partial ? amendCost(old, { ...scoped, nested: old.nested || scoped.nested }) : scoped;
    const reviewed = editAmount(amended, decision);
    if (!reviewed) blockingReasons.push('Enter a valid amount for "' + row.item.label + '".');
    const next = reviewed ?? amended;
    if (removed) result.delete(key);
    else if (!retained) {
      result.set(key, next);
      if (next.type === 'line') mapped.set(row.key, key);
    }
    const changed = !old || !same(costFacts(old), costFacts(next));
    if (changed && old && !retained && !removed) repriced.add(old.key);
    if (changed || decision) changes.push({
      id, field: row.item.label, scope: scope(next), previous: old ? showCost(old, previous.currency) : null,
      proposed: removed || (retained && !old) ? null : retained && old ? showCost(old, previous.currency) : showCost(next, currency),
      kind: removed ? 'removed' : retained ? 'carried' : old ? 'changed' : 'added',
      previousEvidence: old ? costEvidence(previous, old) : undefined, proposedEvidence: costEvidence(incoming, row),
      canEditAmount: next.type !== 'included', canRemove: Boolean(old),
    });
  }
  for (const row of oldRows) {
    if (touched.has(row.key)) continue;
    const id = 'cost:previous:' + row.key;
    const decision = decisions[id];
    const removed = decision?.action === 'remove' || (!partial && decision?.action !== 'retain' && decision?.action !== 'manual');
    if (decision?.action === 'retain' || decision?.action === 'manual') preserved.add(row.key);
    const manual = decision?.action === 'manual';
    const edited = editAmount(row, decision);
    if (!edited) blockingReasons.push('Enter a valid amount for "' + row.item.label + '".');
    if (removed) result.delete(row.key);
    else if (manual && edited) {
      result.set(row.key, edited);
      repriced.add(row.key);
    }
    changes.push({
      id, field: row.item.label, scope: scope(row), previous: showCost(row, previous.currency),
      proposed: removed ? null : showCost(edited ?? row, currency),
      kind: removed ? 'removed' : manual && edited ? 'changed' : 'carried', previousEvidence: costEvidence(previous, row), canAccept: false,
      canEditAmount: row.type !== 'included', canRemove: true,
    });
  }
  if (partial && !previous.packages?.length && packages.result.size > 0 &&
      oldRows.some((row) => row.type === 'line' && result.has(row.key) &&
        !preserved.has(row.key))) {
    blockingReasons.push('Review which previous charges still apply alongside the new package to avoid billing them twice.');
  }
  return { rows: [...result.values()], mapped, repriced };
}

export function reconcileQuoteRevision(
  previous: Quote, incoming: Quote, decisions: Readonly<Record<string, RevisionDecision>> = {},
  mode: 'partial' | 'manual' = 'partial',
  defaultEventId?: string,
): QuoteRevisionResult {
  const changes: RevisionChange[] = [];
  const blockingReasons: string[] = [];
  const partial = mode === 'partial';
  const evidenceSpans: QuoteEvidenceSpan[] = [...previous.evidenceSpans];
  const usedEvidenceIds = new Set(evidenceSpans.map((span) => span.id));
  const evidenceIds = new Map<string, string>();
  for (const span of incoming.evidenceSpans) {
    const duplicate = evidenceSpans.find((item) => item.excerpt === span.excerpt && item.sourceLabel === span.sourceLabel);
    const id = duplicate?.id ?? reserveId(span.id, usedEvidenceIds);
    if (!duplicate) evidenceSpans.push({ ...span, id });
    evidenceIds.set(span.id, id);
  }
  const mapEvidenceId = (id?: string) => id === undefined ? undefined : evidenceIds.get(id) ?? id;
  const context = { previous, incoming, decisions, partial, defaultEventId, changes, blockingReasons, mapEvidenceId };
  const quote = partial ? supplied(previous, incoming) : { ...incoming };

  function preferIncoming(key: string, field: string, before: string | null, after: string | null, provided: boolean) {
    const id = 'quote:' + key;
    const retain = !provided || decisions[id]?.action === 'retain';
    if (before !== after || (retain && before !== null)) changes.push({
      id, field, previous: before, proposed: retain ? before : after,
      kind: retain ? 'carried' : after === null ? 'removed' : before === null ? 'added' : 'changed',
      previousEvidence: evidenceForField(previous, field), proposedEvidence: evidenceForField(incoming, field), canAccept: provided,
    });
    return !retain;
  }
  const incompatibleCurrency = partial && incoming.currency !== 'UNKNOWN' && previous.currency !== incoming.currency;
  if (incompatibleCurrency) blockingReasons.push('Review the complete quote before changing its currency. Previous and new charges cannot be combined across currencies.');
  if (!preferIncoming('currency', 'Currency', previous.currency, incoming.currency,
    !partial || (incoming.currency !== 'UNKNOWN' && !incompatibleCurrency))) {
    quote.currency = previous.currency;
    quote.currencySource = previous.currencySource;
  }
  if (!preferIncoming('tax', 'Tax', taxLabel(previous), taxLabel(incoming), !partial || incoming.taxHandling !== 'unspecified')) {
    quote.taxHandling = previous.taxHandling;
    quote.taxPercent = previous.taxPercent;
  } else if (partial && incoming.taxPercent === undefined && incoming.taxHandling !== previous.taxHandling) quote.taxPercent = undefined;
  if (!preferIncoming('gratuity', 'Gratuity', gratuityLabel(previous), gratuityLabel(incoming),
    !partial || (incoming.gratuityStatus && incoming.gratuityStatus !== 'unknown') || incoming.gratuityPercent != null)) {
    quote.gratuityStatus = previous.gratuityStatus;
    quote.gratuityPercent = previous.gratuityPercent;
    quote.gratuityBasis = previous.gratuityBasis;
  }
  for (const [key, field] of [
    ['minGuests', 'Guest minimum'], ['maxCapacity', 'Capacity'],
    ['serviceDurationHours', 'Coverage hours'], ['extraHourRate', 'Extra hour rate'],
  ] as const) {
    // Package selection in the quote editor mirrors some constraints at quote level.
    // Treat those values as package-scoped when applying a partial revision.
    const mirrored = partial && (key === 'minGuests' || key === 'maxCapacity') &&
      incoming.packages?.some((pkg) => incoming[key] !== undefined && pkg[key] === incoming[key]);
    if (!preferIncoming(key, field, previous[key]?.toString() ?? null, incoming[key]?.toString() ?? null,
      !partial || (!mirrored && incoming[key] !== undefined))) quote[key] = previous[key];
  }
  const hasPayment = Boolean(incoming.paymentTermsSummary?.trim() &&
    incoming.paymentTermsSummary !== 'Confirm deposit and payment schedule with vendor.') ||
    Boolean(incoming.paymentMilestones?.length) || incoming.depositAmount !== undefined || incoming.depositPercent !== undefined;
  if (!preferIncoming('payment', 'Payment terms', paymentLabel(previous, previous.currency),
    paymentLabel(incoming, quote.currency), !partial || hasPayment)) {
    quote.paymentTermsSummary = previous.paymentTermsSummary;
    quote.paymentMilestones = previous.paymentMilestones;
    quote.depositAmount = previous.depositAmount;
    quote.depositPercent = previous.depositPercent;
  } else if (partial) {
    const payment = paymentAmendment(previous, incoming);
    Object.assign(quote, payment);
  }

  const packages = revisePackages(context);
  const { rows, mapped, repriced } = reviseCosts(context, packages, quote.currency);
  quote.lineItems = rows.flatMap((row) => row.type === 'line' && !row.nested ? [row.item] : []);
  quote.addOns = rows.flatMap((row) => {
    if (row.type !== 'optional') return [];
    const { selectionConfirmed: _ignored, ...cleanItem } = row.item;
    return [cleanItem];
  });
  quote.unconfirmedFees = rows.flatMap((row) => row.type === 'fee' ? [row.item] : []);
  quote.includedPricingItems = rows.flatMap((row) => row.type === 'included' && !row.nested ? [row.item] : []);
  quote.packages = packages.result.size ? [...packages.result.values()].map((pkg) => ({
    ...pkg,
    fees: rows.flatMap((row) => row.type === 'line' && row.nested && row.packageId === pkg.id ? [row.item] : []),
    includedPricingItems: rows.flatMap((row) => row.type === 'included' && row.nested && row.packageId === pkg.id ? [row.item] : []),
  })) : undefined;
  const requested = incoming.selectedPackageId ?? undefined;
  const nextSelection = requested && packages.mapped.has(requested) ? packages.mapped.get(requested) : requested;
  const oldSelection = previous.selectedPackageId ?? (previous.packages?.length === 1 ? previous.packages[0].id : undefined);
  const validOld = oldSelection && packages.result.has(oldSelection) ? oldSelection : undefined;
  if (partial && validOld && nextSelection && nextSelection !== validOld && packages.result.has(nextSelection)) {
    const id = 'quote:package-selection';
    const accept = decisions[id]?.action === 'accept';
    changes.push({
      id, field: 'Selected package', kind: accept ? 'changed' : 'carried',
      previous: packages.result.get(validOld)!.name, proposed: packages.result.get(nextSelection)!.name, canAccept: true,
    });
    quote.selectedPackageId = accept ? nextSelection : validOld;
  } else {
    const selection = nextSelection ?? (partial ? validOld : undefined);
    quote.selectedPackageId = selection && packages.result.has(selection) ? selection : null;
  }

  const retainedLineIds = new Set(rows.filter((row) => row.type === 'line').map((row) => row.key));
  const newConflicts = incoming.conflicts.flatMap((conflict) => {
    const targetLineItemId = conflict.targetLineItemId ? mapped.get(conflict.targetLineItemId) : undefined;
    if (conflict.targetLineItemId && !targetLineItemId) return [];
    return [{
      ...conflict, targetLineItemId, options: conflict.options.map((option) => ({ ...option, evidenceId: mapEvidenceId(option.evidenceId) })),
    }];
  });
  quote.conflicts = partial ? [
    ...previous.conflicts.filter((conflict) =>
      (!conflict.targetLineItemId || retainedLineIds.has(conflict.targetLineItemId)) &&
      !newConflicts.some((item) => conflict.targetLineItemId
        ? item.targetLineItemId === conflict.targetLineItemId
        : !item.targetLineItemId && norm(item.fieldLabel) === norm(conflict.fieldLabel)) &&
      !(conflict.targetLineItemId && repriced.has(conflict.targetLineItemId) && conflict.resolvedOptionId)),
    ...newConflicts,
  ] : newConflicts;

  const termsFields = [
    ['inclusions', 'Inclusions'], ['deliveryTerms', 'Delivery terms'],
    ['exclusions', 'Exclusions'], ['restrictions', 'Restrictions'],
  ] as const;
  for (const [key, label] of termsFields) {
    const proposed = partial ? uniqueList(previous[key], incoming[key]) : incoming[key];
    if (preferIncoming(key, label, previous[key]?.join(' · ') || null, proposed?.join(' · ') || null,
      !partial || Boolean(incoming[key]?.length))) {
      if (key === 'inclusions') quote.inclusions = proposed ?? [];
      else quote[key] = proposed;
    } else if (key === 'inclusions') quote.inclusions = previous.inclusions;
    else quote[key] = previous[key];
  }
  if (partial) {
    const reviewInclusions = decisions['quote:inclusions']?.action !== 'retain';
    quote.structuredInclusions = uniqueList(previous.structuredInclusions, reviewInclusions ? incoming.structuredInclusions?.flatMap((item) => {
      if (!item.packageId) return [item];
      const scope = packages.mapped.has(item.packageId) ? packages.mapped.get(item.packageId) : item.packageId;
      return scope && packages.result.has(scope) ? [{ ...item, packageId: scope }] : [];
    }) : undefined);
    quote.clarificationQuestions = uniqueList(previous.clarificationQuestions, incoming.clarificationQuestions);
    quote.paymentOptions = previous.paymentOptions ?? incoming.paymentOptions;
    quote.selectedPaymentOptionId = previous.selectedPaymentOptionId ?? incoming.selectedPaymentOptionId;
  }
  quote.paymentOptions = quote.paymentOptions?.map((option) => previous.paymentOptions?.includes(option)
    ? option : { ...option, evidenceId: mapEvidenceId(option.evidenceId) });
  quote.evidenceSpans = evidenceSpans;
  quote.sourceWarnings = uniqueList(previous.sourceWarnings, incoming.sourceWarnings);
  const acknowledgedPrevious = !previous.sourceWarnings?.length || Boolean(previous.sourceWarningsAcknowledged) ||
    (!partial && incoming.sourceWarningsAcknowledged &&
      previous.sourceWarnings.every((warning) => incoming.sourceWarnings?.includes(warning)));
  quote.sourceWarningsAcknowledged =
    acknowledgedPrevious &&
    (!incoming.sourceWarnings?.length || Boolean(incoming.sourceWarningsAcknowledged));
  return { quote, changes, blockingReasons: [...new Set(blockingReasons)] };
}
