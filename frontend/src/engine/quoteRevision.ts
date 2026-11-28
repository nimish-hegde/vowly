import type {
  IncludedPricingItem, PercentageBasis, Quote, QuoteAddOn, QuoteEvidenceSpan, QuoteLineItem,
  QuotePackageOption, QuotePaymentMilestone, QuoteUnconfirmedFee, TaxHandling,
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

type TaxTerms = { taxHandling?: TaxHandling; taxPercent?: number | null };
type GratuityTerms = {
  gratuityStatus?: 'included' | 'excluded' | 'unknown';
  gratuityPercent?: number | null;
  gratuityBasis?: PercentageBasis;
};

/**
 * Tax terms after a partial amendment. An unstated treatment keeps the confirmed one, and a restated
 * treatment without a rate keeps the confirmed rate. A different treatment never inherits a stale rate.
 */
function mergeTax(old: TaxTerms, next: TaxTerms): TaxTerms {
  if (next.taxHandling === undefined || next.taxHandling === 'unspecified') {
    return { taxHandling: old.taxHandling, taxPercent: old.taxPercent };
  }
  if (next.taxPercent != null) return { taxHandling: next.taxHandling, taxPercent: next.taxPercent };
  return { taxHandling: next.taxHandling, taxPercent: next.taxHandling === old.taxHandling ? old.taxPercent : next.taxPercent };
}

/**
 * Gratuity status, rate and basis move together. Unknowns keep the confirmed terms, an unstated basis
 * keeps the confirmed basis, and included gratuity carries no rate or basis.
 */
function mergeGratuity(old: GratuityTerms, next: GratuityTerms): GratuityTerms {
  const stated = (next.gratuityStatus !== undefined && next.gratuityStatus !== 'unknown') || next.gratuityPercent != null;
  if (!stated) {
    return { gratuityStatus: old.gratuityStatus, gratuityPercent: old.gratuityPercent, gratuityBasis: old.gratuityBasis };
  }
  const explicitStatus = next.gratuityStatus !== undefined && next.gratuityStatus !== 'unknown' ? next.gratuityStatus : undefined;
  const status = explicitStatus ?? (next.gratuityPercent != null && old.gratuityStatus === 'included' ? 'excluded' : old.gratuityStatus ?? next.gratuityStatus);
  if (status === 'included') return { gratuityStatus: status, gratuityPercent: undefined, gratuityBasis: undefined };
  const percent = next.gratuityPercent != null ? next.gratuityPercent
    : status === old.gratuityStatus ? old.gratuityPercent : next.gratuityPercent;
  const basis = next.gratuityBasis !== undefined && next.gratuityBasis !== 'unknown' ? next.gratuityBasis
    : old.gratuityStatus === 'excluded' ? old.gratuityBasis ?? next.gratuityBasis : next.gratuityBasis;
  return { gratuityStatus: status, gratuityPercent: percent, gratuityBasis: basis };
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
      if (cost.item.pricingModel === 'per_person' && cost.item.minGuests !== undefined) {
        return `${base} · min ${cost.item.minGuests} guests`;
      }
      if (cost.item.pricingModel === 'per_extra_guest' && cost.item.guestThreshold !== undefined) {
        return `${base} · above ${cost.item.guestThreshold} guests`;
      }
      if (cost.item.pricingModel === 'hourly') {
        const above = cost.item.includedPackageHours !== undefined ? ` (above ${cost.item.includedPackageHours}h)` : '';
        if (cost.item.isConditionalOvertime === true && cost.item.quantity === undefined) {
          return `${base} · conditional${above}`;
        }
        const hours = cost.item.quantity ?? cost.item.extractedHours;
        if (hours !== undefined) return `${base} · ${hours} ${hours === 1 ? 'hour' : 'hours'}${above}`;
        if (above) return `${base}${above}`;
      }
      if (cost.item.pricingModel === 'flat' && cost.item.extractedHours !== undefined) {
        return `${base} · ${cost.item.extractedHours}h`;
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

/** Charge classification implied by an hourly line: true is conditional overtime, false is billed hours. */
function hourlyConditionality(item: QuoteLineItem): boolean | undefined {
  if (item.isConditionalOvertime !== undefined) return item.isConditionalOvertime;
  return item.chargeType === 'conditional' ? true : item.chargeType === 'mandatory' ? false : undefined;
}

function amendLine(previous: QuoteLineItem, incoming: QuoteLineItem): QuoteLineItem {
  const merged = supplied(previous, incoming);
  // A new price invalidates a negotiated "normally X" figure unless the source restates it.
  if (incoming.unitPrice !== previous.unitPrice && incoming.originalUnitPrice === undefined) merged.originalUnitPrice = undefined;

  if (previous.pricingModel === 'percentage') {
    if (incoming.percentageBasis === 'unknown' && previous.percentageBasis) {
      merged.percentageBasis = previous.percentageBasis;
    } else if (incoming.percentageBasis !== undefined && incoming.percentageBasis !== previous.percentageBasis) {
      if (incoming.customBasisAmount === undefined) merged.customBasisAmount = undefined;
      if (incoming.percentageTargetLabels === undefined) merged.percentageTargetLabels = undefined;
    }
  }

  if (previous.pricingModel === 'hourly') {
    // The source decides the classification only when it states one; more than one hour means billed hours.
    const stated = incoming.isConditionalOvertime !== undefined ? undefined
      : incoming.chargeType === 'conditional' ? true
        : incoming.chargeType === 'mandatory' || (incoming.extractedHours ?? 0) > 1 ? false : undefined;
    const before = hourlyConditionality(previous);
    const flipped = stated !== undefined && before !== undefined && stated !== before;
    if (flipped) {
      // The confirmed override and quantity described the old classification.
      merged.isConditionalOvertime = undefined;
      merged.quantity = incoming.quantity;
    } else if (incoming.quantity === undefined && previous.quantity !== undefined) {
      // A single noisy hour on a conditional rate says nothing about confirmed overtime hours.
      const conditional = merged.isConditionalOvertime ?? (incoming.chargeType ?? previous.chargeType) === 'conditional';
      const hoursChanged = incoming.extractedHours !== undefined &&
        incoming.extractedHours !== (previous.extractedHours ?? previous.quantity);
      if (!conditional && hoursChanged) merged.quantity = undefined;
    }
  }
  return merged;
}

/** A restated unknown amount never discards what the reviewer already confirmed or waived. */
function amendFee(previous: QuoteUnconfirmedFee, incoming: QuoteUnconfirmedFee): QuoteUnconfirmedFee {
  const restatedUnknown = incoming.status === 'unconfirmed' && previous.status !== 'unconfirmed' &&
    incoming.mandatory === previous.mandatory;
  if (!restatedUnknown) return incoming;
  return {
    ...incoming,
    description: incoming.description.trim() ? incoming.description : previous.description,
    status: previous.status,
    confirmedAmount: previous.confirmedAmount,
  };
}

function amendCost(previous: Cost, incoming: Cost): Cost {
  if (previous.type === 'line' && incoming.type === 'line' && previous.item.pricingModel === incoming.item.pricingModel) {
    return { ...incoming, item: amendLine(previous.item, incoming.item) };
  }
  if (previous.type === 'fee' && incoming.type === 'fee') {
    return { ...incoming, item: amendFee(previous.item, incoming.item) };
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

const DEPOSIT_LABEL = /\b(deposit|retainer|booking|signing|initial)\b/i;
const BALANCE_LABEL = /\b(balance|remaining|final|rest|due)\b/i;
const milestoneSlot = (label: string) => DEPOSIT_LABEL.test(label) ? 'deposit' : BALANCE_LABEL.test(label) ? 'balance' : undefined;

function paymentAmendment(
  old: Pick<QuotePackageOption, 'paymentTermsSummary' | 'paymentMilestones' | 'depositAmount' | 'depositPercent'>,
  incoming: Pick<QuotePackageOption, 'paymentTermsSummary' | 'paymentMilestones' | 'depositAmount' | 'depositPercent'>,
) {
  const amendments = incoming.paymentMilestones ?? [];
  const previous = old.paymentMilestones ?? [];
  const claimed = new Set<QuotePaymentMilestone>();
  const matchFor = (milestone: QuotePaymentMilestone) => {
    const exact = amendments.filter((item) => norm(item.label) === norm(milestone.label));
    if (exact.length > 0) return exact.length === 1 ? exact[0] : undefined;
    const slot = milestoneSlot(milestone.label);
    if (!slot || previous.filter((item) => milestoneSlot(item.label) === slot).length !== 1) return undefined;
    // A differently worded deposit or balance amends the one on file instead of adding a second.
    const sameSlot = amendments.filter((item) => milestoneSlot(item.label) === slot &&
      !previous.some((other) => other !== milestone && norm(other.label) === norm(item.label)));
    return sameSlot.length === 1 ? sameSlot[0] : undefined;
  };
  const milestones = previous.map((milestone) => {
    const next = matchFor(milestone);
    if (!next) return milestone;
    claimed.add(next);
    const hasTextualDeadline = Boolean(next.relativeDeadlineText?.trim()) &&
      next.dueDate === undefined && next.relativeDaysBeforeEvent === undefined;
    return {
      ...supplied(milestone, next),
      amount: next.percent !== undefined && next.amount === undefined ? undefined : next.amount ?? milestone.amount,
      percent: next.amount !== undefined && next.percent === undefined ? undefined : next.percent ?? milestone.percent,
      dueDate: (next.relativeDaysBeforeEvent !== undefined || hasTextualDeadline) && next.dueDate === undefined
        ? undefined : next.dueDate ?? milestone.dueDate,
      relativeDaysBeforeEvent: (next.dueDate !== undefined || hasTextualDeadline) && next.relativeDaysBeforeEvent === undefined
        ? undefined : next.relativeDaysBeforeEvent ?? milestone.relativeDaysBeforeEvent,
      relativeDeadlineText: (next.dueDate !== undefined || next.relativeDaysBeforeEvent !== undefined) && next.relativeDeadlineText === undefined
        ? undefined : next.relativeDeadlineText ?? milestone.relativeDeadlineText,
    };
  });
  const schedule = [...milestones, ...amendments.filter((item) => !claimed.has(item))];
  let depositAmount = incoming.depositPercent !== undefined && incoming.depositAmount === undefined ? undefined
    : incoming.depositAmount ?? old.depositAmount;
  let depositPercent = incoming.depositAmount !== undefined && incoming.depositPercent === undefined ? undefined
    : incoming.depositPercent ?? old.depositPercent;

  // The booking flow reads the deposit milestone before the deposit fields, so keep the two in agreement.
  const index = schedule.findIndex((item) => milestoneSlot(item.label) === 'deposit');
  const statedField = incoming.depositAmount !== undefined || incoming.depositPercent !== undefined;
  const statedMilestone = amendments.some((item) => milestoneSlot(item.label) === 'deposit');
  if (index >= 0 && statedField && !statedMilestone) {
    schedule[index] = { ...schedule[index], amount: depositAmount, percent: depositPercent };
  } else if (index >= 0 && statedMilestone && !statedField &&
      (old.depositAmount !== undefined || old.depositPercent !== undefined)) {
    depositAmount = schedule[index].amount;
    depositPercent = schedule[index].percent;
  }
  return {
    paymentTermsSummary: incoming.paymentTermsSummary?.trim() && incoming.paymentTermsSummary !== 'Confirm deposit and payment schedule with vendor.'
      ? incoming.paymentTermsSummary : old.paymentTermsSummary,
    paymentMilestones: schedule,
    depositAmount,
    depositPercent,
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
  const retainedPackages = new Set<string>();
  const mapped = new Map<string, string | undefined>();
  const explicit = new Map<string, { tax: boolean; gratuity: boolean; minGuests: boolean; hours: boolean; payment: boolean }>();
  const beforeMap = new Map(before.map((pkg) => [pkg.id, pkg]));
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
      ...mergeTax(old, pkg),
      ...mergeGratuity(old, pkg),
      ...paymentAmendment(old, pkg),
    } : pkg;
    const packageId = old?.id ?? reserveId(pkg.id, used);
    if (removed) result.delete(packageId);
    else if (retained && old) retainedPackages.add(old.id);
    else if (!retained) {
      result.set(packageId, {
        ...revised, id: packageId, evidenceId: mapEvidenceId(pkg.evidenceId) ?? old?.evidenceId,
        structuredInclusions: revised.structuredInclusions?.map((item) =>
          item.packageId === pkg.id ? { ...item, packageId } : item),
      });
      explicit.set(packageId, {
        tax: pkg.taxHandling !== undefined && pkg.taxHandling !== 'unspecified',
        gratuity: (pkg.gratuityStatus !== undefined && pkg.gratuityStatus !== 'unknown') || pkg.gratuityPercent != null,
        minGuests: pkg.minGuests !== undefined,
        hours: pkg.hours !== undefined,
        payment: Boolean(pkg.paymentMilestones?.length) || pkg.depositAmount !== undefined || pkg.depositPercent !== undefined ||
          Boolean(pkg.paymentTermsSummary?.trim() && pkg.paymentTermsSummary !== 'Confirm deposit and payment schedule with vendor.'),
      });
    }
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
    else if (!partial && decisions[id]?.action === 'retain') retainedPackages.add(pkg.id);
    const label = packageLabel(pkg, previous.currency);
    changes.push({
      id, field: pkg.name, scope: 'Package', previous: label, proposed: remove ? null : label,
      kind: remove ? 'removed' : 'carried', previousEvidence: evidence(previous, pkg.evidenceId), canRemove: true, canAccept: false,
    });
  }
  return { result, mapped, retained: retainedPackages, explicit, beforeMap };
}

function reconcilePackageInheritance(
  context: RevisionContext,
  quote: Quote,
  packages: ReturnType<typeof revisePackages>,
  quotePaymentChanged: boolean,
) {
  const { previous, incoming, decisions, changes, blockingReasons } = context;
  const resolveScope = (
    pkg: QuotePackageOption,
    key: 'tax' | 'gratuity' | 'minGuests' | 'hours' | 'payment',
    field: string,
    blockerMessage: string,
    previousText: string,
    proposedText: string,
    inherited: boolean,
    apply: (target: QuotePackageOption) => QuotePackageOption,
    evidenceLabel: string,
  ) => {
    if (inherited) {
      packages.result.set(pkg.id, apply(pkg));
      return;
    }
    const id = 'package:' + pkg.id + ':' + key;
    const action = decisions[id]?.action;
    if (action === 'accept') {
      packages.result.set(pkg.id, apply(pkg));
      changes.push({
        id, field, scope: pkg.name, previous: previousText, proposed: proposedText, kind: 'changed',
        previousEvidence: evidence(previous, pkg.evidenceId), proposedEvidence: evidenceForField(incoming, evidenceLabel),
        canAccept: true,
      });
    } else if (action === 'retain') {
      changes.push({
        id, field, scope: pkg.name, previous: previousText, proposed: previousText, kind: 'carried',
        previousEvidence: evidence(previous, pkg.evidenceId), proposedEvidence: evidenceForField(incoming, evidenceLabel),
        canAccept: true,
      });
    } else {
      changes.push({
        id, field, scope: pkg.name, previous: previousText, proposed: proposedText, kind: 'ambiguous',
        needsDecision: true, canAccept: true,
        previousEvidence: evidence(previous, pkg.evidenceId), proposedEvidence: evidenceForField(incoming, evidenceLabel),
      });
      blockingReasons.push(blockerMessage);
    }
  };

  const quoteTaxChanged =
    quote.taxHandling !== previous.taxHandling || (quote.taxPercent ?? undefined) !== (previous.taxPercent ?? undefined);
  const quoteGratChanged =
    quote.gratuityStatus !== previous.gratuityStatus ||
    (quote.gratuityPercent ?? undefined) !== (previous.gratuityPercent ?? undefined) ||
    quote.gratuityBasis !== previous.gratuityBasis;
  const quoteMinChanged = quote.minGuests !== undefined && quote.minGuests !== previous.minGuests;
  const quoteHoursChanged =
    quote.serviceDurationHours !== undefined && quote.serviceDurationHours !== previous.serviceDurationHours;

  for (const pkg of [...packages.result.values()]) {
    if (packages.retained.has(pkg.id)) continue;
    const exp = packages.explicit.get(pkg.id);

    if (quoteTaxChanged && !exp?.tax && pkg.taxHandling === 'unspecified') {
      packages.result.set(pkg.id, { ...pkg, taxHandling: undefined, taxPercent: undefined });
    } else if (
      quoteTaxChanged &&
      !exp?.tax &&
      pkg.taxHandling &&
      pkg.taxHandling !== 'unspecified' &&
      (pkg.taxHandling !== quote.taxHandling || (pkg.taxPercent ?? undefined) !== (quote.taxPercent ?? undefined))
    ) {
      const inherited =
        previous.taxHandling !== 'unspecified' &&
        pkg.taxHandling === previous.taxHandling &&
        (pkg.taxPercent ?? undefined) === (previous.taxPercent ?? undefined);
      resolveScope(
        pkg,
        'tax',
        'Tax',
        `Confirm whether the updated tax terms also apply to package "${pkg.name}".`,
        taxLabel(pkg),
        taxLabel(quote),
        inherited,
        (target) => ({ ...target, taxHandling: quote.taxHandling, taxPercent: quote.taxPercent }),
        'Tax',
      );
    }

    const currentPkg = packages.result.get(pkg.id)!;
    const hasPkgGrat = (currentPkg.gratuityStatus !== undefined && currentPkg.gratuityStatus !== 'unknown') ||
      currentPkg.gratuityPercent != null;
    if (quoteGratChanged && !exp?.gratuity && currentPkg.gratuityStatus === 'unknown' && currentPkg.gratuityPercent == null) {
      packages.result.set(currentPkg.id, {
        ...currentPkg,
        gratuityStatus: undefined,
        gratuityPercent: undefined,
        gratuityBasis: undefined,
      });
    } else if (
      quoteGratChanged &&
      !exp?.gratuity &&
      hasPkgGrat &&
      (currentPkg.gratuityStatus !== quote.gratuityStatus ||
        (currentPkg.gratuityPercent ?? undefined) !== (quote.gratuityPercent ?? undefined) ||
        currentPkg.gratuityBasis !== quote.gratuityBasis)
    ) {
      const prevHasGrat = (previous.gratuityStatus !== undefined && previous.gratuityStatus !== 'unknown') ||
        previous.gratuityPercent != null;
      const inherited =
        prevHasGrat &&
        currentPkg.gratuityStatus === previous.gratuityStatus &&
        (currentPkg.gratuityPercent ?? undefined) === (previous.gratuityPercent ?? undefined) &&
        currentPkg.gratuityBasis === previous.gratuityBasis;
      resolveScope(
        currentPkg,
        'gratuity',
        'Gratuity',
        `Confirm whether the updated gratuity terms also apply to package "${currentPkg.name}".`,
        gratuityLabel(currentPkg),
        gratuityLabel(quote),
        inherited,
        (target) => ({
          ...target,
          gratuityStatus: quote.gratuityStatus,
          gratuityPercent: quote.gratuityPercent,
          gratuityBasis: quote.gratuityBasis,
        }),
        'Gratuity',
      );
    }

    const pkgForMin = packages.result.get(pkg.id)!;
    if (quoteMinChanged && !exp?.minGuests && pkgForMin.minGuests !== undefined && pkgForMin.minGuests !== quote.minGuests) {
      const inherited = previous.minGuests !== undefined && pkgForMin.minGuests === previous.minGuests;
      resolveScope(
        pkgForMin,
        'minGuests',
        'Guest minimum',
        `Confirm whether the updated guest minimum also applies to package "${pkgForMin.name}".`,
        `${pkgForMin.minGuests} guest minimum`,
        `${quote.minGuests} guest minimum`,
        inherited,
        (target) => ({ ...target, minGuests: quote.minGuests }),
        'Guest minimum',
      );
    }

    const pkgForHours = packages.result.get(pkg.id)!;
    if (
      quoteHoursChanged &&
      !exp?.hours &&
      pkgForHours.hours !== undefined &&
      pkgForHours.hours !== quote.serviceDurationHours
    ) {
      const inherited = previous.serviceDurationHours !== undefined && pkgForHours.hours === previous.serviceDurationHours;
      resolveScope(
        pkgForHours,
        'hours',
        'Coverage hours',
        `Confirm whether the updated coverage hours also apply to package "${pkgForHours.name}".`,
        `${pkgForHours.hours} hours`,
        `${quote.serviceDurationHours} hours`,
        inherited,
        (target) => ({ ...target, hours: quote.serviceDurationHours }),
        'Coverage hours',
      );
    }

    const pkgForPay = packages.result.get(pkg.id)!;
    const hasPkgPayment = Boolean(pkgForPay.paymentMilestones?.length) || pkgForPay.depositAmount !== undefined ||
      pkgForPay.depositPercent !== undefined || Boolean(pkgForPay.paymentTermsSummary?.trim());
    if (quotePaymentChanged && !exp?.payment && hasPkgPayment) {
      const amendedPkgPay = paymentAmendment(pkgForPay, incoming);
      const prevPayLabel = paymentLabel(pkgForPay, previous.currency);
      const nextPayLabel = paymentLabel({ ...pkgForPay, ...amendedPkgPay }, quote.currency);
      if (prevPayLabel !== nextPayLabel) {
        resolveScope(
          pkgForPay,
          'payment',
          'Payment terms',
          `Confirm whether the updated payment terms also apply to package "${pkgForPay.name}".`,
          prevPayLabel ?? 'Existing payment terms',
          nextPayLabel ?? 'Updated payment terms',
          false,
          (target) => ({ ...target, ...amendedPkgPay }),
          'Payment terms',
        );
      }
    }
  }
}

function reviseCosts(
  context: RevisionContext,
  packages: ReturnType<typeof revisePackages>,
  quote: Pick<Quote, 'currency' | 'minGuests' | 'serviceDurationHours'>,
) {
  const { previous, incoming, decisions, partial, changes, blockingReasons, mapEvidenceId } = context;
  const currency = quote.currency;
  const reconcileInheritedItem = (cost: Cost, incomingRow?: Cost): Cost => {
    if (!partial) return cost;
    if (cost.type !== 'line' && cost.type !== 'optional') return cost;
    const oldPkg = cost.packageId ? packages.beforeMap.get(cost.packageId) : undefined;
    const newPkg = cost.packageId ? packages.result.get(cost.packageId) : undefined;
    const oldMin = oldPkg?.minGuests ?? previous.minGuests;
    const newMin = newPkg?.minGuests ?? quote.minGuests;
    const oldThreshold = oldPkg ? (oldPkg.includedGuests ?? oldPkg.minGuests ?? previous.minGuests) : previous.minGuests;
    const newThreshold = newPkg ? (newPkg.includedGuests ?? newPkg.minGuests ?? quote.minGuests) : quote.minGuests;
    const oldHours = oldPkg?.hours ?? previous.serviceDurationHours;
    const newHours = newPkg?.hours ?? quote.serviceDurationHours;

    if (cost.type === 'optional') {
      const incomingOpt = incomingRow?.type === 'optional' ? incomingRow.item : undefined;
      if (incomingOpt?.minGuests === undefined && oldMin !== undefined && newMin !== undefined && oldMin !== newMin && cost.item.minGuests === oldMin) {
        return { ...cost, item: { ...cost.item, minGuests: newMin } };
      }
      return cost;
    }

    const incomingLine = incomingRow?.type === 'line' ? incomingRow.item : undefined;
    let nextItem = cost.item;
    if (incomingLine?.minGuests === undefined && oldMin !== undefined && newMin !== undefined && oldMin !== newMin && nextItem.minGuests === oldMin) {
      nextItem = { ...nextItem, minGuests: newMin };
    }
    if (
      nextItem.pricingModel === 'per_extra_guest' &&
      incomingLine?.guestThreshold === undefined &&
      oldThreshold !== undefined &&
      newThreshold !== undefined &&
      oldThreshold !== newThreshold &&
      nextItem.guestThreshold === oldThreshold
    ) {
      nextItem = { ...nextItem, guestThreshold: newThreshold };
    }
    if (oldHours !== undefined && newHours !== undefined && oldHours !== newHours) {
      if (nextItem.pricingModel === 'hourly' && incomingLine?.includedPackageHours === undefined && nextItem.includedPackageHours === oldHours) {
        nextItem = { ...nextItem, includedPackageHours: newHours };
      } else if (nextItem.pricingModel === 'flat' && incomingLine?.extractedHours === undefined && nextItem.extractedHours === oldHours) {
        nextItem = { ...nextItem, extractedHours: newHours };
      }
    }
    return nextItem === cost.item ? cost : { ...cost, item: nextItem };
  };
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
  // A resolved conflict, not the stored price, is what the previous quote actually charged.
  const effective = (row: Cost): Cost => {
    if (row.type !== 'line') return row;
    const conflict = previous.conflicts.find((item) => item.targetLineItemId === row.key && item.resolvedOptionId);
    const option = conflict?.options.find((item) => item.id === conflict.resolvedOptionId);
    return option ? { ...row, item: { ...row.item, unitPrice: option.amount, pricingModel: option.pricingModel ?? row.item.pricingModel } } : row;
  };
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
    const charged = old ? effective(old) : undefined;
    const amended = old && charged && partial
      ? reconcileInheritedItem(amendCost(charged, { ...scoped, nested: old.nested || scoped.nested }), row)
      : scoped;
    const reviewed = editAmount(amended, decision);
    if (!reviewed) blockingReasons.push('Enter a valid amount for "' + row.item.label + '".');
    const next = reviewed ?? amended;
    if (removed) result.delete(key);
    else if (!retained) {
      result.set(key, next);
      if (next.type === 'line') mapped.set(row.key, key);
    }
    const changed = !charged || !same(costFacts(charged), costFacts(next));
    if (changed && old && !retained && !removed) repriced.add(old.key);
    if (changed || decision) changes.push({
      id, field: row.item.label, scope: scope(next), previous: charged ? showCost(charged, previous.currency) : null,
      proposed: removed || (retained && !old) ? null : retained && charged ? showCost(charged, previous.currency) : showCost(next, currency),
      kind: removed ? 'removed' : retained ? 'carried' : old ? 'changed' : 'added',
      previousEvidence: old ? costEvidence(previous, old) : undefined, proposedEvidence: costEvidence(incoming, row),
      canEditAmount: next.type !== 'included', canRemove: Boolean(old),
    });
  }
  for (const row of oldRows) {
    if (touched.has(row.key)) continue;
    const retainedByPackage = Boolean(row.packageId && packages.retained.has(row.packageId));
    const id = 'cost:previous:' + row.key;
    const decision = decisions[id];
    const removed = decision?.action === 'remove' || (!partial && !retainedByPackage && decision?.action !== 'retain' && decision?.action !== 'manual');
    if (decision?.action === 'retain' || decision?.action === 'manual' || retainedByPackage) preserved.add(row.key);
    const manual = decision?.action === 'manual';
    const edited = editAmount(row, decision);
    if (!edited) blockingReasons.push('Enter a valid amount for "' + row.item.label + '".');
    const inherited = !removed && !manual && decision?.action !== 'retain' ? reconcileInheritedItem(row) : row;
    const inheritedChanged = !removed && !manual && !same(costFacts(row), costFacts(inherited));
    if (removed) result.delete(row.key);
    else if (manual && edited) {
      result.set(row.key, edited);
      repriced.add(row.key);
    } else if (inheritedChanged) {
      result.set(row.key, inherited);
      repriced.add(row.key);
    }
    changes.push({
      id, field: row.item.label, scope: scope(row), previous: showCost(row, previous.currency),
      proposed: removed ? null : showCost(edited ?? inherited, currency),
      kind: removed ? 'removed' : (manual && edited) || inheritedChanged ? 'changed' : 'carried',
      previousEvidence: costEvidence(previous, row), canAccept: false,
      canEditAmount: row.type !== 'included', canRemove: true,
    });
  }
  if (partial && !previous.packages?.length && packages.result.size > 0 &&
      oldRows.some((row) => row.type === 'line' && result.has(row.key) &&
        !preserved.has(row.key))) {
    blockingReasons.push('Review which previous charges still apply alongside the new package to avoid billing them twice.');
  }
  return { rows: [...result.values()], mapped, repriced, touched };
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
  const tax = partial ? mergeTax(previous, incoming) : incoming;
  if (!preferIncoming('tax', 'Tax', taxLabel(previous), taxLabel(tax as Pick<Quote, 'taxHandling' | 'taxPercent'>),
    !partial || incoming.taxHandling !== 'unspecified')) {
    quote.taxHandling = previous.taxHandling;
    quote.taxPercent = previous.taxPercent;
  } else {
    quote.taxHandling = tax.taxHandling ?? previous.taxHandling;
    quote.taxPercent = tax.taxPercent;
  }
  const gratuity = partial ? mergeGratuity(previous, incoming) : incoming;
  if (!preferIncoming('gratuity', 'Gratuity', gratuityLabel(previous), gratuityLabel(gratuity),
    !partial || (incoming.gratuityStatus && incoming.gratuityStatus !== 'unknown') || incoming.gratuityPercent != null)) {
    quote.gratuityStatus = previous.gratuityStatus;
    quote.gratuityPercent = previous.gratuityPercent;
    quote.gratuityBasis = previous.gratuityBasis;
  } else {
    quote.gratuityStatus = gratuity.gratuityStatus;
    quote.gratuityPercent = gratuity.gratuityPercent;
    quote.gratuityBasis = gratuity.gratuityBasis;
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
  const quotePaymentChanged = partial && hasPayment && decisions['quote:payment']?.action !== 'retain' &&
    paymentLabel(quote, quote.currency) !== paymentLabel(previous, previous.currency);
  if (partial) reconcilePackageInheritance(context, quote, packages, quotePaymentChanged);
  const { rows: costRowsResult, mapped, repriced, touched } = reviseCosts(context, packages, quote);
  let rows = costRowsResult;
  const quoteGratChanged = partial && (
    quote.gratuityStatus !== previous.gratuityStatus ||
    (quote.gratuityPercent ?? undefined) !== (previous.gratuityPercent ?? undefined) ||
    quote.gratuityBasis !== previous.gratuityBasis
  );
  if (quoteGratChanged) {
    const GRATUITY_LINE_PATTERN = /\b(gratuity|tip|service\s*charge)\b/i;
    const supersededKeys = new Set<string>();
    let retainedCount = 0;
    let totalMatching = 0;
    for (const row of rows) {
      if (row.type !== 'line' || touched.has(row.key)) continue;
      if (!GRATUITY_LINE_PATTERN.test(row.item.label)) continue;
      const differs = row.item.pricingModel !== 'percentage' || quote.gratuityStatus === 'included' ||
        quote.gratuityPercent == null || Math.abs(row.item.unitPrice - quote.gratuityPercent) >= 0.01;
      if (!differs) continue;
      totalMatching++;
      const id = 'gratuity-line:' + row.key;
      const action = decisions[id]?.action;
      const rowScope = row.packageId ? packages.result.get(row.packageId)?.name ?? row.packageId : row.eventId;
      if (action === 'accept') {
        supersededKeys.add(row.key);
        changes.push({
          id, field: row.item.label, scope: rowScope,
          previous: showCost(row, previous.currency), proposed: gratuityLabel(quote), kind: 'changed',
          previousEvidence: costEvidence(previous, row), proposedEvidence: evidenceForField(incoming, 'Gratuity'),
          canAccept: true,
        });
      } else if (action === 'retain') {
        retainedCount++;
        changes.push({
          id, field: row.item.label, scope: rowScope,
          previous: showCost(row, previous.currency), proposed: showCost(row, previous.currency), kind: 'carried',
          previousEvidence: costEvidence(previous, row), proposedEvidence: evidenceForField(incoming, 'Gratuity'),
          canAccept: true,
        });
      } else {
        changes.push({
          id, field: row.item.label, scope: rowScope,
          previous: showCost(row, previous.currency), proposed: gratuityLabel(quote), kind: 'ambiguous',
          needsDecision: true, canAccept: true,
          previousEvidence: costEvidence(previous, row), proposedEvidence: evidenceForField(incoming, 'Gratuity'),
        });
        blockingReasons.push(`Confirm whether "${row.item.label}" is replaced by the updated gratuity terms or kept as-is.`);
      }
    }
    if (totalMatching > 0 && retainedCount === totalMatching) {
      quote.gratuityStatus = previous.gratuityStatus;
      quote.gratuityPercent = previous.gratuityPercent;
      quote.gratuityBasis = previous.gratuityBasis;
    }
    if (supersededKeys.size > 0) {
      rows = rows.filter((row) => !supersededKeys.has(row.key));
    }
  }
  const quoteTaxChanged = partial && (
    quote.taxHandling !== previous.taxHandling || (quote.taxPercent ?? undefined) !== (previous.taxPercent ?? undefined)
  );
  if (quoteTaxChanged) {
    const TAX_LINE_PATTERN = /\b(hst|gst|pst|sales\s*tax|tax)\b/i;
    const supersededTaxKeys = new Set<string>();
    let retainedTaxCount = 0;
    let totalTaxMatching = 0;
    for (const row of rows) {
      if (row.type !== 'line' || touched.has(row.key)) continue;
      if (!TAX_LINE_PATTERN.test(row.item.label)) continue;
      totalTaxMatching++;
      const id = 'tax-line:' + row.key;
      const action = decisions[id]?.action;
      const rowScope = row.packageId ? packages.result.get(row.packageId)?.name ?? row.packageId : row.eventId;
      if (action === 'accept') {
        supersededTaxKeys.add(row.key);
        changes.push({
          id, field: row.item.label, scope: rowScope,
          previous: showCost(row, previous.currency), proposed: taxLabel(quote), kind: 'changed',
          previousEvidence: costEvidence(previous, row), proposedEvidence: evidenceForField(incoming, 'Tax'),
          canAccept: true,
        });
      } else if (action === 'retain') {
        retainedTaxCount++;
        changes.push({
          id, field: row.item.label, scope: rowScope,
          previous: showCost(row, previous.currency), proposed: showCost(row, previous.currency), kind: 'carried',
          previousEvidence: costEvidence(previous, row), proposedEvidence: evidenceForField(incoming, 'Tax'),
          canAccept: true,
        });
      } else {
        changes.push({
          id, field: row.item.label, scope: rowScope,
          previous: showCost(row, previous.currency), proposed: taxLabel(quote), kind: 'ambiguous',
          needsDecision: true, canAccept: true,
          previousEvidence: costEvidence(previous, row), proposedEvidence: evidenceForField(incoming, 'Tax'),
        });
        blockingReasons.push(`Confirm whether "${row.item.label}" is replaced by the updated tax terms or kept as-is.`);
      }
    }
    if (totalTaxMatching > 0 && retainedTaxCount === totalTaxMatching) {
      quote.taxHandling = previous.taxHandling;
      quote.taxPercent = previous.taxPercent;
    }
    if (supersededTaxKeys.size > 0) {
      rows = rows.filter((row) => !supersededTaxKeys.has(row.key));
    }
  }
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
    const selection = nextSelection ?? (partial || (validOld && packages.retained.has(validOld)) ? validOld : undefined);
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
  const activeNewConflicts = newConflicts.filter((conflict) => {
    // A manually entered or edited price supersedes a resolved conflict choice.
    const line = rows.find((row) => row.type === 'line' && row.key === conflict.targetLineItemId)?.item as QuoteLineItem | undefined;
    const option = conflict.options.find((item) => item.id === conflict.resolvedOptionId);
    return !line || !option || line.unitPrice === option.amount;
  });
  quote.conflicts = partial ? [
    ...previous.conflicts.filter((conflict) =>
      (!conflict.targetLineItemId || retainedLineIds.has(conflict.targetLineItemId)) &&
      !activeNewConflicts.some((item) => conflict.targetLineItemId
        ? item.targetLineItemId === conflict.targetLineItemId
        : !item.targetLineItemId && norm(item.fieldLabel) === norm(conflict.fieldLabel)) &&
      !(conflict.targetLineItemId && repriced.has(conflict.targetLineItemId) && conflict.resolvedOptionId)),
    ...activeNewConflicts,
  ] : activeNewConflicts;

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
  quote.sourceWarningsAcknowledged = quote.sourceWarnings.length === 0 ? previous.sourceWarningsAcknowledged :
    acknowledgedPrevious &&
    (!incoming.sourceWarnings?.length || Boolean(incoming.sourceWarningsAcknowledged));
  return { quote, changes, blockingReasons: [...new Set(blockingReasons)] };
}
