import {
  calculateQuoteFinancials,
  getVendorActiveQuote,
  getVendorBookingEligibility,
} from '../engine/financialCalculator.ts';
import { findAmbiguousLegacyOvertimeItems } from '../engine/legacyOvertimeReview.ts';
import type {
  FollowUpTask,
  PaymentMilestone,
  Quote,
  QuoteRevisionRecord,
  Vendor,
  WeddingEvent,
  WeddingWorkspace,
} from '../types/vowly';

import { buildQuoteRevisionPreview, hasCompetingSelectedVendor } from '../engine/revisionPreview.ts';

export { hasCompetingSelectedVendor } from '../engine/revisionPreview.ts';

export function applySaveDraftQuote(
  ws: WeddingWorkspace,
  vendorId: string | null,
  newVendorPayload: Omit<Vendor, 'id' | 'quotes'> | null,
  draftQuote: Quote,
  targetId: string
): { workspace: WeddingWorkspace; vendorName: string } {
  const cleanDraft: Quote = { ...draftQuote, approvalState: 'draft' };
  const existingVendor = vendorId
    ? ws.vendors.find((v) => v.id === vendorId)
    : undefined;
  const vendorName =
    existingVendor?.name || newVendorPayload?.name?.trim() || 'Vendor';

  let nextVendors: Vendor[];
  if (existingVendor && vendorId) {
    // Keep existing vendor's approved metadata, event associations, and budget status
    // untouched until the draft revision is explicitly approved.
    const stagedMetadata = newVendorPayload
      ? {
          name: newVendorPayload.name.trim() || existingVendor.name,
          category: newVendorPayload.category,
          eventIds: [...newVendorPayload.eventIds],
          location: newVendorPayload.location,
          isDemoVenue: newVendorPayload.isDemoVenue ?? existingVendor.isDemoVenue,
        }
      : existingVendor.draftVendorMetadata;

    nextVendors = ws.vendors.map((v) =>
      v.id === vendorId
        ? {
            ...v,
            status: v.status === 'Booked' ? 'Booked' : 'Revision pending',
            draftQuote: cleanDraft,
            draftVendorMetadata: stagedMetadata,
          }
        : v
    );
  } else {
    const created: Vendor = {
      ...(newVendorPayload ?? {
        name: vendorName,
        category: 'other',
        eventIds: ws.events[0] ? [ws.events[0].id] : [],
        location: cleanDraft.locationContext ?? ws.location,
        contactName: '',
        contactEmail: '',
        contactPhone: '',
        status: 'Revision pending',
        isPreferred: false,
        notes: '',
      }),
      id: targetId,
      status: 'Revision pending',
      isPreferred: false,
      quotes: [],
      draftQuote: cleanDraft,
    };
    nextVendors = [created, ...ws.vendors];
  }

  const taskId = `task-draft-${targetId}`;
  const existingTask = ws.tasks.some((t) => t.id === taskId);
  const draftTask: FollowUpTask = {
    id: taskId,
    title: `Resolve draft quote for ${vendorName}`,
    description: 'Unresolved fees, conflicts, or currency pending.',
    vendorId: targetId,
    assigneePartnerId: ws.partners[0]?.id ?? 'p-meera',
    priority: 'high',
    kind: 'draft_quote',
    status: 'Open',
    dueLabel: 'Draft pending approval',
  };

  return {
    vendorName,
    workspace: {
      ...ws,
      vendors: nextVendors,
      tasks: existingTask
        ? ws.tasks.map((t) => (t.id === taskId ? draftTask : t))
        : [draftTask, ...ws.tasks],
    },
  };
}

export interface ApproveQuoteTransitionResult {
  duplicate?: boolean;
  approved: boolean;
  blockingReasons: string[];
  workspace: WeddingWorkspace;
  vendorName: string;
}

export function applyApproveQuote(
  ws: WeddingWorkspace,
  vendorId: string | null,
  newVendorPayload: Omit<Vendor, 'id' | 'quotes'> | null,
  approvedQuote: Quote,
  targetId: string,
  revisionNote?: string
): ApproveQuoteTransitionResult {
  const existingVendor = vendorId
    ? ws.vendors.find((v) => v.id === vendorId)
    : undefined;
  const vendorName =
    newVendorPayload?.name?.trim() ||
    existingVendor?.draftVendorMetadata?.name?.trim() ||
    existingVendor?.name ||
    'Vendor';

  const isRevision = approvedQuote.revisionDraft !== undefined;
  const effectiveMeta = newVendorPayload ?? existingVendor?.draftVendorMetadata;
  const eventIds = isRevision && existingVendor?.status === 'Booked'
    ? existingVendor.eventIds
    : effectiveMeta?.eventIds ?? existingVendor?.eventIds ?? (ws.events[0] ? [ws.events[0].id] : []);
  const revision = isRevision && existingVendor
    ? buildQuoteRevisionPreview(ws, existingVendor, approvedQuote, eventIds, effectiveMeta?.category)
    : null;
  if (revision?.duplicate) {
    if (existingVendor && vendorId && existingVendor.draftQuote?.id === approvedQuote.id) {
      const nextVendors = ws.vendors.map((v) =>
        v.id === vendorId
          ? {
              ...v,
              status: v.status === 'Revision pending' ? ('Quoted' as const) : v.status,
              draftQuote: undefined,
              draftVendorMetadata: undefined,
            }
          : v
      );
      const nextTasks = ws.tasks.map((t) =>
        t.vendorId === targetId && t.kind === 'draft_quote'
          ? { ...t, status: 'Done' as const }
          : t
      );
      return {
        approved: true,
        duplicate: true,
        blockingReasons: [],
        vendorName,
        workspace: {
          ...ws,
          vendors: nextVendors,
          tasks: nextTasks,
        },
      };
    }
    return { approved: true, duplicate: true, blockingReasons: [], workspace: ws, vendorName };
  }
  if (isRevision && !revision) {
    return { approved: false, blockingReasons: ['The previous approved quote is no longer available.'], workspace: ws, vendorName };
  }
  const proposedQuote = revision?.quote ?? approvedQuote;
  const nextCalc = revision?.proposedCalc ?? calculateQuoteFinancials(proposedQuote, ws.events, eventIds);
  const blockingReasons = [...(revision?.blockingReasons ?? nextCalc.blockingReasons)];
  if (findAmbiguousLegacyOvertimeItems(proposedQuote).length > 0) {
    blockingReasons.push('Confirm the hourly quantity or mark the rate as conditional before approving.');
  }
  if (existingVendor?.draftQuote && existingVendor.draftQuote.id !== approvedQuote.id) {
    blockingReasons.push('Resolve the pending draft quote before approving a different quote.');
  }
  if (blockingReasons.length > 0) {
    return { approved: false, blockingReasons, workspace: ws, vendorName };
  }

  let cleanQuote: Quote = {
    ...proposedQuote,
    revisionDraft: undefined,
    approvalState: 'approved',
    legacyReviewAcknowledged: true,
  };

  let nextVendors: Vendor[];
  if (existingVendor && vendorId) {
    nextVendors = ws.vendors.map((v) => {
      if (v.id !== vendorId) return v;
      const previousActive = revision?.baseline ?? getVendorActiveQuote(v);
      const isEditingExistingApproved =
        previousActive !== undefined && previousActive.approvalState === 'approved';

      // Preserve prior approved quote versions in v.quotes[] (never destructively overwrite)
      const alreadyExists = v.quotes.some((q) => q.id === cleanQuote.id);
      if (revision) {
        cleanQuote = { ...cleanQuote, id: `quote-revision-${revision.revisionKey}` };
      }
      if (!revision && alreadyExists && isEditingExistingApproved) {
        cleanQuote = {
          ...cleanQuote,
          id: `${cleanQuote.id}-rev-${Date.now()}`,
        };
      }

      if (isEditingExistingApproved && previousActive) {
        const prevCalc = revision?.previousCalc ?? calculateQuoteFinancials(previousActive, ws.events, v.eventIds);
        const revRecord: QuoteRevisionRecord = {
          id: revision ? `rev-${revision.revisionKey}` : `rev-${Date.now()}`,
          date: new Date().toISOString().slice(0, 10),
          summary: revisionNote?.trim() || approvedQuote.revisionDraft?.note?.trim() || (revision?.quote ? 'Quote revision' : 'Manual quote edit'),
          previousPreTaxTotal: prevCalc.preTaxTotal,
          newPreTaxTotal: nextCalc.preTaxTotal,
          ...(revision ? {
            revisionKey: revision.revisionKey,
            baselineQuoteId: previousActive.id,
            previousCurrency: previousActive.currency,
            newCurrency: proposedQuote.currency,
            previousAllInTotal: prevCalc.isEstimateComplete ? prevCalc.estimatedAllInTotal : null,
            newAllInTotal: nextCalc.isEstimateComplete ? nextCalc.estimatedAllInTotal : null,
            projectedDelta: revision.projectedDelta,
            changes: revision.changes.flatMap((change) =>
              change.kind === 'added' || change.kind === 'changed' || change.kind === 'removed' ? [{
                id: change.id, field: change.field, scope: change.scope, kind: change.kind,
                previous: change.previous, proposed: change.proposed,
                previousEvidence: change.previousEvidence, proposedEvidence: change.proposedEvidence,
              }] : []),
          } : {}),
          note:
            revisionNote?.trim() || approvedQuote.revisionDraft?.note?.trim() ||
            `Updated quote from ${prevCalc.currencyLabel} $${prevCalc.preTaxTotal.toLocaleString('en-CA')} to $${nextCalc.preTaxTotal.toLocaleString('en-CA')} pre-tax.`,
        };
        cleanQuote = {
          ...cleanQuote,
          revisions: [...(previousActive.revisions ?? []), revRecord],
        };
      }

      const preservedQuotes = alreadyExists && !isEditingExistingApproved
        ? v.quotes.filter((q) => q.id !== cleanQuote.id)
        : v.quotes;

      const effectiveMeta = isRevision && v.status === 'Booked' ? undefined : newVendorPayload ?? v.draftVendorMetadata;
      const updatedCategory = effectiveMeta ? effectiveMeta.category : v.category;
      const updatedEventIds = effectiveMeta ? [...effectiveMeta.eventIds] : v.eventIds;
      const hasComp = hasCompetingSelectedVendor(
        ws.vendors,
        { category: updatedCategory, eventIds: updatedEventIds },
        v.id
      );
      return {
        ...v,
        ...(effectiveMeta
          ? {
              name: effectiveMeta.name.trim() || v.name,
              category: updatedCategory,
              eventIds: updatedEventIds,
              location: effectiveMeta.location,
              isDemoVenue: effectiveMeta.isDemoVenue ?? v.isDemoVenue,
            }
          : {}),
        // Never silently alter booked status, bookedContractTotal, or paid milestones
        isPreferred: v.status === 'Booked' ? v.isPreferred : v.isPreferred && !hasComp,
        status: v.status === 'Booked' ? 'Booked' : 'Quoted',
        quotes: [...preservedQuotes, cleanQuote],
        activeQuoteId: cleanQuote.id,
        draftQuote: undefined,
        draftVendorMetadata: undefined,
      };
    });
  } else {
    const basePayload = newVendorPayload ?? {
      name: vendorName,
      category: 'other' as const,
      eventIds: ws.events[0] ? [ws.events[0].id] : [],
      location: cleanQuote.locationContext ?? ws.location,
      contactName: '',
      contactEmail: '',
      contactPhone: '',
      status: 'Quoted' as const,
      isPreferred: true,
      notes: '',
    };
    const hasComp = hasCompetingSelectedVendor(ws.vendors, basePayload);
    const created: Vendor = {
      ...basePayload,
      id: targetId,
      status: 'Quoted',
      isPreferred: hasComp ? false : basePayload.isPreferred,
      quotes: [cleanQuote],
      activeQuoteId: cleanQuote.id,
      draftQuote: undefined,
      draftVendorMetadata: undefined,
    };
    nextVendors = [created, ...ws.vendors];
  }

  const nextTasks = ws.tasks.map((t) =>
    t.vendorId === targetId &&
    (t.kind === 'draft_quote' ||
      t.kind === 'missing_quote' ||
      t.kind === 'unresolved_fee')
      ? { ...t, status: 'Done' as const }
      : t
  );

  return {
    approved: true,
    blockingReasons: [],
    vendorName,
    workspace: {
      ...ws,
      vendors: nextVendors,
      tasks: nextTasks,
    },
  };
}

export interface ConfirmBookingTransitionInput {
  vendorId: string;
  contractTotal: number;
  milestones: Array<
    Omit<PaymentMilestone, 'id' | 'vendorId' | 'vendorName' | 'eventId' | 'eventLabel'>
  >;
  today?: string;
  timestamp?: number;
}

export interface ConfirmBookingTransitionResult {
  booked: boolean;
  blockingReasons: string[];
  workspace: WeddingWorkspace;
  vendorName?: string;
}

export function applyConfirmBooking(
  ws: WeddingWorkspace,
  input: ConfirmBookingTransitionInput
): ConfirmBookingTransitionResult {
  const vendor = ws.vendors.find((v) => v.id === input.vendorId);
  if (!vendor) {
    return {
      booked: false,
      blockingReasons: ['Vendor not found.'],
      workspace: ws,
    };
  }

  if (vendor.status === 'Booked') {
    return {
      booked: false,
      blockingReasons: ['This vendor is already booked.'],
      workspace: ws,
      vendorName: vendor.name,
    };
  }

  const eligibility = getVendorBookingEligibility(vendor, ws.events);
  if (!eligibility.canBook) {
    return {
      booked: false,
      blockingReasons: eligibility.blockingReasons,
      workspace: ws,
      vendorName: vendor.name,
    };
  }

  if (!Number.isFinite(input.contractTotal) || input.contractTotal <= 0) {
    return {
      booked: false,
      blockingReasons: ['Agreed contract total must be greater than zero.'],
      workspace: ws,
      vendorName: vendor.name,
    };
  }

  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const ts = input.timestamp ?? Date.now();
  const linkedEvents = vendor.eventIds
    .map((id) => ws.events.find((e) => e.id === id))
    .filter(Boolean) as WeddingEvent[];
  const eventId = linkedEvents.length === 1 ? linkedEvents[0].id : undefined;
  const eventLabel =
    linkedEvents.length === 0
      ? 'Whole wedding'
      : linkedEvents.length === 1
        ? linkedEvents[0].name
        : `Shared (${linkedEvents.length} events)`;

  const existingPaidForVendor = ws.payments.filter(
    (p) => p.vendorId === input.vendorId && p.status === 'Paid'
  );

  const scheduledAmounts = [...existingPaidForVendor, ...input.milestones].map((p) => p.amount);
  const scheduledCents = scheduledAmounts.reduce((total, amount) => total + Math.round(amount * 100), 0);
  if (
    scheduledAmounts.some((amount) => !Number.isFinite(amount) || amount < 0) ||
    scheduledCents !== Math.round(input.contractTotal * 100)
  ) {
    return {
      booked: false,
      blockingReasons: ['Existing payments and new installments must add up to the agreed contract total.'],
      workspace: ws,
      vendorName: vendor.name,
    };
  }

  const createdMilestones: PaymentMilestone[] = input.milestones.map((m, idx) => ({
    ...m,
    id: `pay-${input.vendorId}-${ts}-${idx}`,
    vendorId: input.vendorId,
    vendorName: vendor.name,
    isDemoVenue: vendor.isDemoVenue,
    eventId,
    eventLabel,
    payer: m.payer ?? 'Unassigned',
  }));

  return {
    booked: true,
    blockingReasons: [],
    vendorName: vendor.name,
    workspace: {
      ...ws,
      vendors: ws.vendors.map((v) => {
        if (v.id === input.vendorId) {
          return {
            ...v,
            status: 'Booked',
            isPreferred: true,
            bookedContractTotal: input.contractTotal,
            bookedDate: today,
          };
        }
        const sameCategory = v.category === vendor.category;
        const overlaps =
          v.eventIds.some((eid) => vendor.eventIds.includes(eid)) ||
          (v.eventIds.length === 0 && vendor.eventIds.length === 0);
        if (sameCategory && overlaps && v.status !== 'Booked') {
          return { ...v, isPreferred: false };
        }
        return v;
      }),
      payments: [
        ...ws.payments.filter((p) => p.vendorId !== input.vendorId),
        ...existingPaidForVendor,
        ...createdMilestones,
      ],
    },
  };
}
