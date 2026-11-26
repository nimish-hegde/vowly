import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createDemoWorkspace } from '../data/demoWorkspace';
import {
  calculateWorkspaceFinancials,
  WorkspaceFinancialSummary,
} from '../engine/financialCalculator';
import {
  applyApproveQuote,
  applyConfirmBooking,
  applySaveDraftQuote,
} from './workspaceTransitions';
import {
  ActivityItem,
  FollowUpTask,
  ManualExpense,
  NavSection,
  Partner,
  PaymentMilestone,
  Quote,
  Vendor,
  WeddingEvent,
  WeddingWorkspace,
} from '../types/vowly';

const STORAGE_KEY = 'vowly_prototype_workspaces_v1';

interface StoredState {
  workspaces: WeddingWorkspace[];
  activeWorkspaceId: string;
}

export interface ToastMessage {
  id: string;
  text: string;
  tone?: 'sage' | 'amber' | 'neutral';
  actionLabel?: string;
  onAction?: () => void;
}

interface WorkspaceContextValue {
  workspaces: WeddingWorkspace[];
  activeWorkspace: WeddingWorkspace;
  financials: WorkspaceFinancialSummary;
  activeNav: NavSection;
  setActiveNav: (nav: NavSection) => void;
  showOnboarding: boolean;
  setShowOnboarding: (show: boolean) => void;
  hasExistingWorkspace: boolean;
  selectedVendorId: string | null;
  setSelectedVendorId: (id: string | null) => void;
  selectedEventId: string | null;
  setSelectedEventId: (id: string | null) => void;
  toasts: ToastMessage[];
  pushToast: (
    text: string,
    tone?: ToastMessage['tone'],
    action?: { label: string; onClick: () => void }
  ) => void;
  dismissToast: (id: string) => void;

  // Workspace management
  switchWorkspace: (workspaceId: string) => void;
  createWorkspace: (workspace: WeddingWorkspace) => void;
  enterDemoWorkspace: () => void;
  updateWorkspaceMeta: (
    patch: Partial<
      Pick<
        WeddingWorkspace,
        'name' | 'coupleNames' | 'location' | 'dateRangeLabel' | 'budgetTarget'
      >
    >
  ) => void;
  resetDemoWorkspace: () => void;

  // Events
  updateEventGuestCount: (eventId: string, guestCount: number | null) => void;
  upsertEvent: (event: WeddingEvent) => void;
  deleteEvent: (eventId: string) => void;

  // Vendors & Quotes
  addVendor: (vendor: Vendor, onViewVendor?: (vendorId: string) => void) => void;
  updateVendor: (vendorId: string, patch: Partial<Vendor>) => void;
  setPreferredVendor: (vendorId: string) => void;
  toggleVendorAddOn: (vendorId: string, quoteId: string, addOnId: string) => void;
  saveDraftQuote: (
    vendorId: string | null,
    newVendorPayload: Omit<Vendor, 'id' | 'quotes'> | null,
    draftQuote: Quote
  ) => string;
  approveQuote: (
    vendorId: string | null,
    newVendorPayload: Omit<Vendor, 'id' | 'quotes'> | null,
    approvedQuote: Quote,
    revisionNote?: string
  ) => string;
  confirmBooking: (payload: {
    vendorId: string;
    contractTotal: number;
    milestones: Omit<
      PaymentMilestone,
      'id' | 'vendorId' | 'vendorName' | 'isDemoVenue' | 'eventId' | 'eventLabel'
    >[];
  }) => void;

  // Manual Expenses
  upsertManualExpense: (expense: ManualExpense) => void;
  deleteManualExpense: (expenseId: string) => void;

  // Payments
  markPaymentPaid: (paymentId: string, paidBy: string) => void;
  undoPaymentPaid: (paymentId: string) => void;
  updatePaymentPayer: (paymentId: string, payer: string) => void;
  togglePaymentReminder: (paymentId: string) => void;

  // Tasks & Collaboration
  reassignTask: (taskId: string, partnerId: string) => void;
  toggleTaskStatus: (taskId: string) => void;
  addTask: (task: Omit<FollowUpTask, 'id'>) => void;
  invitePartner: (name: string, email: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function normalizeWorkspace(ws: WeddingWorkspace): WeddingWorkspace {
  return {
    ...ws,
    events: (ws.events ?? []).map((e) => ({
      ...e,
      guestCount:
        typeof e.guestCount === 'number' && !Number.isNaN(e.guestCount)
          ? e.guestCount
          : null,
    })),
    payments: (ws.payments ?? []).map((p) => ({
      ...p,
      payer: p.payer ?? 'Unassigned',
    })),
  };
}

function loadInitialState(): {
  stored: StoredState;
  isFirstTimeVisitor: boolean;
} {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredState;
      if (parsed && Array.isArray(parsed.workspaces) && parsed.workspaces.length > 0) {
        return {
          stored: {
            workspaces: parsed.workspaces.map(normalizeWorkspace),
            activeWorkspaceId: parsed.activeWorkspaceId,
          },
          isFirstTimeVisitor: false,
        };
      }
    }
  } catch {
    // Fallback cleanly
  }
  const demo = createDemoWorkspace();
  return {
    stored: {
      workspaces: [demo],
      activeWorkspaceId: demo.id,
    },
    isFirstTimeVisitor: true,
  };
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const initial = useMemo(() => loadInitialState(), []);
  const [store, setStore] = useState<StoredState>(initial.stored);
  const [hasSavedSession, setHasSavedSession] = useState<boolean>(
    !initial.isFirstTimeVisitor
  );
  const [showOnboarding, setShowOnboarding] = useState<boolean>(
    initial.isFirstTimeVisitor
  );
  const [activeNav, setActiveNav] = useState<NavSection>('overview');
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Only persist once the user has chosen/created/resumed a workspace so first-time onboarding stays accurate
  useEffect(() => {
    if (!hasSavedSession) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // Ignore storage quota errors
    }
  }, [store, hasSavedSession]);

  const activeWorkspace = useMemo(() => {
    return (
      store.workspaces.find((w) => w.id === store.activeWorkspaceId) ??
      store.workspaces[0]
    );
  }, [store]);

  const financials = useMemo(
    () => calculateWorkspaceFinancials(activeWorkspace),
    [activeWorkspace]
  );

  const pushToast: WorkspaceContextValue['pushToast'] = (
    text,
    tone = 'sage',
    action
  ) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [
      ...prev,
      {
        id,
        text,
        tone,
        actionLabel: action?.label,
        onAction: action?.onClick,
      },
    ]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5200);
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const mutateActive = (
    updater: (ws: WeddingWorkspace) => WeddingWorkspace,
    activitySummary?: { summary: string; category: ActivityItem['category'] }
  ) => {
    setHasSavedSession(true);
    setStore((prev) => ({
      ...prev,
      workspaces: prev.workspaces.map((ws) => {
        if (ws.id !== prev.activeWorkspaceId) return ws;
        const next = updater(ws);
        if (!activitySummary) return next;
        const actor = next.partners[0]?.name ?? 'Couple';
        const act: ActivityItem = {
          id: `act-${Date.now()}`,
          timestampLabel: 'Just now',
          actorName: actor,
          summary: activitySummary.summary,
          category: activitySummary.category,
        };
        return {
          ...next,
          activities: [act, ...next.activities].slice(0, 18),
        };
      }),
    }));
  };

  const switchWorkspace = (workspaceId: string) => {
    setHasSavedSession(true);
    setStore((prev) => ({ ...prev, activeWorkspaceId: workspaceId }));
    setShowOnboarding(false);
    setSelectedVendorId(null);
    setSelectedEventId(null);
    setActiveNav('overview');
  };

  const createWorkspace = (workspace: WeddingWorkspace) => {
    setHasSavedSession(true);
    setStore((prev) => ({
      workspaces: [workspace, ...prev.workspaces],
      activeWorkspaceId: workspace.id,
    }));
    setShowOnboarding(false);
    setSelectedVendorId(null);
    setSelectedEventId(null);
    setActiveNav('overview');
    pushToast(`Created workspace "${workspace.name}"`);
  };

  const enterDemoWorkspace = () => {
    setHasSavedSession(true);
    const existingDemo = store.workspaces.find((w) => w.id === 'ws-meera-kabir-gta');
    if (existingDemo) {
      setStore((prev) => ({ ...prev, activeWorkspaceId: existingDemo.id }));
    } else {
      const freshDemo = createDemoWorkspace();
      setStore((prev) => ({
        workspaces: [freshDemo, ...prev.workspaces],
        activeWorkspaceId: freshDemo.id,
      }));
    }
    setShowOnboarding(false);
    setSelectedVendorId(null);
    setSelectedEventId(null);
    setActiveNav('overview');
  };

  const updateWorkspaceMeta = (
    patch: Partial<
      Pick<
        WeddingWorkspace,
        'name' | 'coupleNames' | 'location' | 'dateRangeLabel' | 'budgetTarget'
      >
    >
  ) => {
    mutateActive((ws) => ({ ...ws, ...patch }));
    pushToast('Workspace details updated');
  };

  const resetDemoWorkspace = () => {
    setHasSavedSession(true);
    const freshDemo = createDemoWorkspace();
    setStore((prev) => {
      const others = prev.workspaces.filter((w) => w.id !== freshDemo.id);
      return {
        workspaces: [freshDemo, ...others],
        activeWorkspaceId: freshDemo.id,
      };
    });
    setSelectedVendorId(null);
    setSelectedEventId(null);
    setShowOnboarding(false);
    setActiveNav('overview');
    pushToast('Demo workspace reset to initial GTA dataset');
  };

  const updateEventGuestCount = (eventId: string, guestCount: number | null) => {
    const normalized =
      guestCount === null
        ? null
        : Math.max(1, Math.min(2000, Math.round(guestCount)));
    mutateActive((ws) => ({
      ...ws,
      events: ws.events.map((e) =>
        e.id === eventId ? { ...e, guestCount: normalized } : e
      ),
    }));
  };

  const upsertEvent = (event: WeddingEvent) => {
    const exists = activeWorkspace.events.some((e) => e.id === event.id);
    mutateActive(
      (ws) => ({
        ...ws,
        events: exists
          ? ws.events.map((e) => (e.id === event.id ? event : e))
          : [...ws.events, event],
      }),
      {
        summary: exists
          ? `Updated event "${event.name}".`
          : `Created event "${event.name}".`,
        category: 'event',
      }
    );
    pushToast(exists ? `Saved changes to ${event.name}` : `Added event ${event.name}`);
  };

  const deleteEvent = (eventId: string) => {
    const target = activeWorkspace.events.find((e) => e.id === eventId);
    mutateActive(
      (ws) => ({
        ...ws,
        events: ws.events.filter((e) => e.id !== eventId),
        vendors: ws.vendors.map((v) => ({
          ...v,
          eventIds: v.eventIds.filter((id) => id !== eventId),
        })),
        manualExpenses: ws.manualExpenses
          .map((m) => ({
            ...m,
            eventIds: m.eventIds.filter((id) => id !== eventId),
          }))
          .filter((m) => m.eventIds.length > 0),
      }),
      target
        ? {
            summary: `Removed event "${target.name}".`,
            category: 'event',
          }
        : undefined
    );
    if (selectedEventId === eventId) setSelectedEventId(null);
    pushToast(target ? `Removed ${target.name}` : 'Event removed', 'neutral');
  };

  const addVendor = (
    vendor: Vendor,
    onViewVendor?: (vendorId: string) => void
  ) => {
    const linkedEventNames = vendor.eventIds
      .map((id) => activeWorkspace.events.find((e) => e.id === id)?.name)
      .filter(Boolean) as string[];
    const eventText =
      linkedEventNames.length === 0
        ? 'Whole wedding'
        : linkedEventNames.join(', ');

    mutateActive(
      (ws) => ({
        ...ws,
        vendors: [vendor, ...ws.vendors],
      }),
      {
        summary: `Added "${vendor.name}" to ${eventText}.`,
        category: 'quote',
      }
    );
    pushToast(
      `Saved ${vendor.name} to ${eventText}`,
      'sage',
      onViewVendor
        ? {
            label: 'View vendor',
            onClick: () => onViewVendor(vendor.id),
          }
        : undefined
    );
  };

  const updateVendor = (vendorId: string, patch: Partial<Vendor>) => {
    mutateActive((ws) => ({
      ...ws,
      vendors: ws.vendors.map((v) => (v.id === vendorId ? { ...v, ...patch } : v)),
    }));
  };

  const setPreferredVendor = (vendorId: string) => {
    const target = activeWorkspace.vendors.find((v) => v.id === vendorId);
    if (!target) return;
    mutateActive(
      (ws) => ({
        ...ws,
        vendors: ws.vendors.map((v) => {
          const sameCategory = v.category === target.category;
          const overlapsEvent =
            v.eventIds.some((eid) => target.eventIds.includes(eid)) ||
            (v.eventIds.length === 0 && target.eventIds.length === 0);
          if (v.id === vendorId) {
            return { ...v, isPreferred: true };
          }
          if (sameCategory && overlapsEvent && v.status !== 'Booked') {
            return { ...v, isPreferred: false };
          }
          return v;
        }),
      }),
      {
        summary: `Selected ${target.name} as preferred estimate.`,
        category: 'quote',
      }
    );
    pushToast(`${target.name} selected for projected budget`);
  };

  const toggleVendorAddOn = (vendorId: string, quoteId: string, addOnId: string) => {
    mutateActive((ws) => ({
      ...ws,
      vendors: ws.vendors.map((v) => {
        if (v.id !== vendorId) return v;
        return {
          ...v,
          quotes: v.quotes.map((q) => {
            if (q.id !== quoteId) return q;
            return {
              ...q,
              addOns: q.addOns.map((a) =>
                a.id === addOnId ? { ...a, selected: !a.selected } : a
              ),
            };
          }),
        };
      }),
    }));
  };

  const saveDraftQuote = (
    vendorId: string | null,
    newVendorPayload: Omit<Vendor, 'id' | 'quotes'> | null,
    draftQuote: Quote
  ): string => {
    const targetId = vendorId ?? `ven-${Date.now()}`;
    const existingVendor = vendorId
      ? activeWorkspace.vendors.find((v) => v.id === vendorId)
      : undefined;
    const vendorName =
      existingVendor?.name || newVendorPayload?.name?.trim() || 'Vendor';

    mutateActive(
      (ws) =>
        applySaveDraftQuote(ws, vendorId, newVendorPayload, draftQuote, targetId)
          .workspace,
      {
        summary: `Saved draft quote for ${vendorName}.`,
        category: 'quote',
      }
    );

    pushToast(`Saved ${vendorName} quote as Draft — totals unchanged`, 'amber');
    return targetId;
  };

  const approveQuote = (
    vendorId: string | null,
    newVendorPayload: Omit<Vendor, 'id' | 'quotes'> | null,
    approvedQuote: Quote,
    revisionNote?: string
  ): string => {
    const cleanQuote: Quote = { ...approvedQuote, approvalState: 'approved' };
    const targetId = vendorId ?? `ven-${Date.now()}`;
    const existingVendor = vendorId
      ? activeWorkspace.vendors.find((v) => v.id === vendorId)
      : undefined;
    const vendorName =
      newVendorPayload?.name?.trim() ||
      existingVendor?.draftVendorMetadata?.name?.trim() ||
      existingVendor?.name ||
      'Vendor';

    mutateActive(
      (ws) =>
        applyApproveQuote(ws, vendorId, newVendorPayload, cleanQuote, targetId, revisionNote)
          .workspace,
      {
        summary: `Approved quote "${cleanQuote.title}" for ${vendorName}.`,
        category:
          cleanQuote.revisions && cleanQuote.revisions.length > 0
            ? 'revision'
            : 'quote',
      }
    );

    pushToast(`Approved quote for ${vendorName}`);
    return targetId;
  };

  const confirmBooking: WorkspaceContextValue['confirmBooking'] = ({
    vendorId,
    contractTotal,
    milestones,
  }) => {
    const result = applyConfirmBooking(activeWorkspace, {
      vendorId,
      contractTotal,
      milestones,
    });
    if (!result.booked) {
      pushToast(
        result.blockingReasons[0] ?? 'Cannot confirm booking until blockers are resolved.',
        'amber'
      );
      return;
    }

    const vendorName = result.vendorName ?? 'Vendor';
    mutateActive(
      (ws) => {
        const checked = applyConfirmBooking(ws, {
          vendorId,
          contractTotal,
          milestones,
        });
        return checked.booked ? checked.workspace : ws;
      },
      {
        summary: `Confirmed booking with ${vendorName} (CAD $${Math.round(
          contractTotal
        ).toLocaleString()}).`,
        category: 'booking',
      }
    );

    pushToast(`Booking confirmed for ${vendorName}`);
  };

  const upsertManualExpense = (expense: ManualExpense) => {
    const exists = activeWorkspace.manualExpenses.some((e) => e.id === expense.id);
    mutateActive(
      (ws) => ({
        ...ws,
        manualExpenses: exists
          ? ws.manualExpenses.map((e) => (e.id === expense.id ? expense : e))
          : [expense, ...ws.manualExpenses],
      }),
      {
        summary: exists
          ? `Updated budget expense "${expense.name}".`
          : `Added budget expense "${expense.name}".`,
        category: 'event',
      }
    );
    pushToast(exists ? `Updated ${expense.name}` : `Added ${expense.name}`);
  };

  const deleteManualExpense = (expenseId: string) => {
    mutateActive((ws) => ({
      ...ws,
      manualExpenses: ws.manualExpenses.filter((e) => e.id !== expenseId),
    }));
    pushToast('Expense removed', 'neutral');
  };

  const markPaymentPaid = (paymentId: string, paidBy: string) => {
    const payment = activeWorkspace.payments.find((p) => p.id === paymentId);
    if (!payment) return;
    const today = new Date().toISOString().slice(0, 10);
    const actualPayer = paidBy.trim() || payment.payer || 'Couple';

    mutateActive(
      (ws) => ({
        ...ws,
        payments: ws.payments.map((p) =>
          p.id === paymentId
            ? {
                ...p,
                status: 'Paid',
                paidDate: today,
                paidBy: actualPayer,
                payer: actualPayer,
                reminderEnabled: false,
              }
            : p
        ),
      }),
      {
        summary: `Marked ${payment.vendorName} — ${payment.label} paid by ${actualPayer}.`,
        category: 'payment',
      }
    );

    pushToast(`Marked paid by ${actualPayer}`, 'sage', {
      label: 'Undo',
      onClick: () => undoPaymentPaid(paymentId),
    });
  };

  const undoPaymentPaid = (paymentId: string) => {
    const payment = activeWorkspace.payments.find((p) => p.id === paymentId);
    if (!payment) return;
    mutateActive(
      (ws) => ({
        ...ws,
        payments: ws.payments.map((p) =>
          p.id === paymentId
            ? {
                ...p,
                status: p.dueDate ? 'Upcoming' : 'Date TBD',
                paidDate: undefined,
                paidBy: undefined,
                reminderEnabled: Boolean(p.dueDate),
              }
            : p
        ),
      }),
      {
        summary: `Moved ${payment.vendorName} — ${payment.label} back to unpaid.`,
        category: 'payment',
      }
    );
    pushToast(`Restored ${payment.label} to unpaid`, 'neutral');
  };

  const updatePaymentPayer = (paymentId: string, payer: string) => {
    mutateActive((ws) => ({
      ...ws,
      payments: ws.payments.map((p) =>
        p.id === paymentId ? { ...p, payer: payer.trim() || 'Unassigned' } : p
      ),
    }));
  };

  const togglePaymentReminder = (paymentId: string) => {
    mutateActive((ws) => ({
      ...ws,
      payments: ws.payments.map((p) =>
        p.id === paymentId && p.dueDate && p.status !== 'Paid'
          ? { ...p, reminderEnabled: !p.reminderEnabled }
          : p
      ),
    }));
  };

  const reassignTask = (taskId: string, partnerId: string) => {
    mutateActive((ws) => ({
      ...ws,
      tasks: ws.tasks.map((t) =>
        t.id === taskId ? { ...t, assigneePartnerId: partnerId } : t
      ),
    }));
  };

  const toggleTaskStatus = (taskId: string) => {
    mutateActive((ws) => ({
      ...ws,
      tasks: ws.tasks.map((t) =>
        t.id === taskId ? { ...t, status: t.status === 'Open' ? 'Done' : 'Open' } : t
      ),
    }));
  };

  const addTask = (task: Omit<FollowUpTask, 'id'>) => {
    mutateActive((ws) => ({
      ...ws,
      tasks: [{ ...task, id: `task-${Date.now()}` }, ...ws.tasks],
    }));
    pushToast('Follow-up task added');
  };

  const invitePartner = (name: string, email: string) => {
    const cleanName = name.trim();
    const cleanEmail = email.trim();
    if (!cleanName || !cleanEmail) return;
    const initials = cleanName
      .split(' ')
      .map((s) => s[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
    const partner: Partner = {
      id: `p-${Date.now()}`,
      name: cleanName,
      email: cleanEmail,
      initials: initials || 'PT',
      roleLabel: 'Partner',
      status: 'Invited',
      tone: 'peach',
    };
    mutateActive(
      (ws) => ({
        ...ws,
        partners: [...ws.partners.slice(0, 1), partner],
      }),
      {
        summary: `Sent partner invitation to ${cleanName}.`,
        category: 'partner',
      }
    );
    pushToast(`Invitation sent to ${cleanName}`);
  };

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces: store.workspaces,
        activeWorkspace,
        financials,
        activeNav,
        setActiveNav,
        showOnboarding,
        setShowOnboarding,
        hasExistingWorkspace: hasSavedSession,
        selectedVendorId,
        setSelectedVendorId,
        selectedEventId,
        setSelectedEventId,
        toasts,
        pushToast,
        dismissToast,
        switchWorkspace,
        createWorkspace,
        enterDemoWorkspace,
        updateWorkspaceMeta,
        resetDemoWorkspace,
        updateEventGuestCount,
        upsertEvent,
        deleteEvent,
        addVendor,
        updateVendor,
        setPreferredVendor,
        toggleVendorAddOn,
        saveDraftQuote,
        approveQuote,
        confirmBooking,
        upsertManualExpense,
        deleteManualExpense,
        markPaymentPaid,
        undoPaymentPaid,
        updatePaymentPayer,
        togglePaymentReminder,
        reassignTask,
        toggleTaskStatus,
        addTask,
        invitePartner,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspace must be used inside WorkspaceProvider');
  }
  return ctx;
}
