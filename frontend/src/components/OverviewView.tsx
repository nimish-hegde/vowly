import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  Check,
  FileUp,
  Users,
} from 'lucide-react';
import {
  formatCurrency,
  formatShortCad,
} from '../engine/financialCalculator';
import { useWorkspace } from '../store/workspaceStore';
import { getActivePlanningTasks } from '../store/workspaceTransitions';
import { PASTEL_TONES } from '../utils/pastelStyles';
import { DemoDataNote, StatusText } from './DemoLabel';

interface OverviewViewProps {
  onOpenQuoteImport: (presetId?: string, vendorId?: string) => void;
  onOpenEvent: (eventId: string) => void;
  onOpenVendor: (vendorId: string) => void;
  onOpenUnpricedBudget: () => void;
}

const TODAY_ISO = '2026-11-24';

function formatReadableDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function OverviewView({
  onOpenQuoteImport,
  onOpenEvent,
  onOpenVendor,
  onOpenUnpricedBudget,
}: OverviewViewProps) {
  const {
    activeWorkspace,
    financials,
    setActiveNav,
    updateWorkspaceMeta,
    reassignTask,
    toggleTaskStatus,
  } = useWorkspace();

  const [editingTarget, setEditingTarget] = useState(false);
  const [targetInput, setTargetInput] = useState(
    financials.budgetTarget !== null ? String(financials.budgetTarget) : ''
  );

  // Single highest-priority next action
  const openTasks = getActivePlanningTasks(activeWorkspace).filter((task) => task.status === 'Open');
  const nextAction = openTasks.find((task) => task.priority === 'high') ?? openTasks[0];

  // Next unpaid payment chronologically (overdue first, then soonest dated, then undated)
  const nextPayment = useMemo(() => {
    const unpaid = activeWorkspace.payments.filter((p) => p.status !== 'Paid');
    if (unpaid.length === 0) return null;
    const dated = unpaid
      .filter((p) => Boolean(p.dueDate))
      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
    return dated[0] ?? unpaid[0];
  }, [activeWorkspace.payments]);

  const isNextPaymentOverdue =
    Boolean(nextPayment?.dueDate) && (nextPayment?.dueDate ?? '') < TODAY_ISO;

  const progressPct =
    financials.budgetTarget && financials.budgetTarget > 0
      ? Math.min(
          100,
          Math.round((financials.projectedSpend / financials.budgetTarget) * 100)
        )
      : 0;

  const isOverTarget =
    financials.remainingBudget !== null && financials.remainingBudget < 0;

  const handleSaveTarget = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(targetInput);
    if (!Number.isNaN(parsed) && parsed > 0) {
      updateWorkspaceMeta({ budgetTarget: parsed });
      setEditingTarget(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Compact Header */}
      <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#6B655C]">
            <span>{activeWorkspace.dateRangeLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{activeWorkspace.location}</span>
            {activeWorkspace.isDemoWorkspace && (
              <>
                <span aria-hidden="true">·</span>
                <DemoDataNote />
              </>
            )}
          </div>
          <h1 className="mt-1 font-editorial text-2xl sm:text-3xl font-medium tracking-tight text-[#22201D]">
            {activeWorkspace.coupleNames}
          </h1>
        </div>

        <button
          type="button"
          onClick={() => onOpenQuoteImport()}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl bg-[#486755] text-white hover:bg-[#395344] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <FileUp className="w-4 h-4" />
          Import quote
        </button>
      </section>

      {/* Lead Budget Card: Projected Spend vs Target & Remaining Headroom */}
      <section className="rounded-2xl bg-white border border-[#E5DED2] p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 flex-1">
            {/* Projected Spend */}
            <div>
              <div className="text-xs font-medium text-[#6B655C]">
                Projected spend
              </div>
              <div className="mt-1 font-num text-2xl sm:text-3xl font-semibold text-[#22201D]">
                {formatShortCad(financials.projectedSpend)}
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-[#6B655C]">
                <span>{activeWorkspace.currency} incl. est. tax</span>
                {financials.unpricedExpenseCount > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={onOpenUnpricedBudget}
                      className="font-semibold text-[#9A4A06] hover:underline cursor-pointer"
                    >
                      {financials.unpricedExpenseCount} unpriced
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Target */}
            <div>
              <div className="text-xs font-medium text-[#6B655C]">
                Budget target
              </div>
              {editingTarget ? (
                <form
                  onSubmit={handleSaveTarget}
                  className="mt-1 flex items-center gap-1.5"
                >
                  <input
                    type="number"
                    min={1000}
                    step={500}
                    autoFocus
                    value={targetInput}
                    onChange={(e) => setTargetInput(e.target.value)}
                    placeholder="e.g. 100000"
                    className="w-32 rounded-lg border border-[#486755] px-2.5 py-1.5 font-num text-sm text-[#22201D]"
                  />
                  <button
                    type="submit"
                    className="px-2.5 py-1.5 rounded-lg bg-[#486755] text-white text-xs font-semibold cursor-pointer"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingTarget(false)}
                    className="px-2 py-1.5 text-xs text-[#6B655C] cursor-pointer"
                  >
                    Cancel
                  </button>
                </form>
              ) : financials.budgetTarget !== null ? (
                <>
                  <div className="mt-1 font-num text-2xl sm:text-3xl font-semibold text-[#22201D]">
                    {formatShortCad(financials.budgetTarget)}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setTargetInput(String(financials.budgetTarget));
                      setEditingTarget(true);
                    }}
                    className="mt-1 text-xs text-[#6B655C] hover:text-[#22201D] hover:underline cursor-pointer"
                  >
                    {progressPct}% projected · Edit target
                  </button>
                </>
              ) : (
                <div className="mt-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setTargetInput('');
                      setEditingTarget(true);
                    }}
                    className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-[#B6D7C0] bg-[#DFEFE4] text-[#234733] hover:bg-[#D1E7D8] cursor-pointer"
                  >
                    Set target
                  </button>
                  <div className="mt-1 text-xs text-[#6B655C]">
                    Target not set yet
                  </div>
                </div>
              )}
            </div>

            {/* Remaining Headroom */}
            <div>
              <div className="text-xs font-medium text-[#6B655C]">
                Remaining headroom
              </div>
              <div
                className={`mt-1 font-num text-2xl sm:text-3xl font-semibold ${
                  isOverTarget ? 'text-[#991B1B]' : 'text-[#234733]'
                }`}
              >
                {financials.remainingBudget !== null
                  ? formatShortCad(financials.remainingBudget)
                  : '—'}
              </div>
              <div className="mt-1 text-xs text-[#6B655C]">
                {financials.remainingBudget === null
                  ? 'Add target to see headroom'
                  : isOverTarget
                    ? 'Over target'
                    : 'Before unpriced items'}
              </div>
            </div>
          </div>

          {/* Quiet Navigation Links to Detailed Pages */}
          <div className="flex flex-wrap sm:flex-col items-start sm:items-end gap-2 text-xs shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-[#F0EAE0]">
            <button
              type="button"
              onClick={() => setActiveNav('budget')}
              className="font-semibold text-[#234733] hover:underline inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              Budget breakdown
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setActiveNav('payments')}
              className="font-medium text-[#6B655C] hover:text-[#22201D] hover:underline inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              Booked & paid ({formatShortCad(financials.committedSpend)})
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Clean Progress Bar when target exists */}
        {financials.budgetTarget !== null && financials.budgetTarget > 0 && (
          <div className="mt-4 h-2 w-full rounded-full bg-[#F3EFE8] overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                isOverTarget ? 'bg-[#C45555]' : 'bg-[#5F8E72]'
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}
      </section>

      {/* Pastel Event Cards — Promoted Higher */}
      <section aria-label="Wedding events">
        <div className="flex items-center justify-between gap-4 mb-3">
          <h2 className="text-sm font-semibold text-[#22201D]">
            Events ({activeWorkspace.events.length})
          </h2>
          <button
            type="button"
            onClick={() => setActiveNav('events')}
            className="text-xs font-medium text-[#486755] hover:underline cursor-pointer"
          >
            Manage events
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
          {activeWorkspace.events.map((evt) => {
            const tone = PASTEL_TONES[evt.tone] ?? PASTEL_TONES.sage;
            const summary = financials.eventSummaries[evt.id];
            return (
              <button
                key={evt.id}
                type="button"
                onClick={() => onOpenEvent(evt.id)}
                className={`text-left rounded-2xl border ${tone.border} ${tone.surfaceBg} ${tone.surfaceHover} transition-colors p-4 flex flex-col justify-between cursor-pointer`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className={`font-semibold ${tone.ink}`}>
                      {evt.dateDisplay}
                    </span>
                    <StatusText status={evt.status} />
                  </div>
                  <h3 className="mt-1.5 text-base font-semibold text-[#22201D] truncate">
                    {evt.name}
                  </h3>
                  <div className="mt-0.5 text-xs text-[#5A544C] truncate">
                    {evt.location}
                  </div>
                </div>

                <div className="mt-3.5 pt-2.5 border-t border-black/10 flex items-end justify-between gap-2">
                  <div className="text-xs text-[#5A544C]">
                    <span className="inline-flex items-center gap-1 font-num font-semibold text-[#22201D]">
                      <Users className="w-3.5 h-3.5 text-[#5A544C]" />
                      {evt.guestCount !== null ? evt.guestCount : 'TBD'}
                    </span>{' '}
                    <span>guests</span>
                    {summary && summary.sharedPackageCount > 0 && (
                      <div className="text-[11px] text-[#5A544C] mt-0.5">
                        +{summary.sharedPackageCount} shared
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="font-num text-base font-semibold text-[#22201D]">
                      {summary && summary.directProjected > 0
                        ? formatShortCad(summary.directProjected)
                        : 'TBD'}
                    </div>
                    <div className="text-[11px] text-[#5A544C]">Direct est.</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Bottom 2-Column Strip: One Next Action + Next Payment */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* One Next Action */}
        <section className="rounded-2xl bg-white border border-[#E5DED2] p-5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-[#6B655C]">
              Next action
            </h2>
            {openTasks.length > 1 && (
              <span className="text-[11px] text-[#6B655C]">
                {openTasks.length} open
              </span>
            )}
          </div>

          {!nextAction ? (
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-[#22201D]">
                No open follow-ups
              </div>
              <button
                type="button"
                onClick={() => onOpenQuoteImport()}
                className="text-xs font-semibold text-[#486755] hover:underline cursor-pointer"
              >
                Import quote →
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <div className="flex items-start gap-2">
                  {(nextAction.kind === 'unresolved_fee' ||
                    nextAction.kind === 'draft_quote') && (
                    <AlertTriangle className="w-4 h-4 text-[#9A4A06] mt-0.5 shrink-0" />
                  )}
                  <div className="text-sm font-semibold text-[#22201D]">
                    {nextAction.title}
                  </div>
                </div>
                <div className="mt-0.5 text-xs text-[#6B655C]">
                  {nextAction.description}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#F0EAE0] text-xs">
                <div className="flex items-center gap-1.5">
                  <label
                    htmlFor="overview-next-owner"
                    className="text-[#6B655C]"
                  >
                    Owner:
                  </label>
                  <select
                    id="overview-next-owner"
                    value={nextAction.assigneePartnerId}
                    onChange={(e) => reassignTask(nextAction.id, e.target.value)}
                    className="rounded-lg border border-[#E5DED2] bg-[#FAF8F4] px-2 py-1 text-xs font-medium text-[#22201D]"
                  >
                    {activeWorkspace.partners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-3">
                  {nextAction.vendorId ? (
                    <button
                      type="button"
                      onClick={() => onOpenVendor(nextAction.vendorId!)}
                      className="font-semibold text-[#486755] hover:underline cursor-pointer"
                    >
                      Open vendor
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpenQuoteImport()}
                      className="font-semibold text-[#486755] hover:underline cursor-pointer"
                    >
                      Import quote
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleTaskStatus(nextAction.id)}
                    className="inline-flex items-center gap-1 text-[#6B655C] hover:text-[#22201D] cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Done
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Next Payment */}
        <section className="rounded-2xl bg-white border border-[#E5DED2] p-5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-[#6B655C]">
              Next payment
            </h2>
            <button
              type="button"
              onClick={() => setActiveNav('payments')}
              className="text-xs font-semibold text-[#486755] hover:underline cursor-pointer"
            >
              All payments →
            </button>
          </div>

          {!nextPayment ? (
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm text-[#6B655C]">
                No unpaid booked installments
              </div>
              <button
                type="button"
                onClick={() => setActiveNav('vendors')}
                className="text-xs font-semibold text-[#486755] hover:underline cursor-pointer"
              >
                Review vendors
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold text-[#22201D]">
                      {nextPayment.vendorName}
                    </span>
                    {nextPayment.isDemoVenue && <DemoDataNote compact />}
                  </div>
                  <div className="mt-0.5 text-xs text-[#6B655C] truncate">
                    {nextPayment.label}
                    {nextPayment.eventLabel ? ` · ${nextPayment.eventLabel}` : ''}
                  </div>
                </div>
                <div className="font-num text-lg font-semibold text-[#22201D] shrink-0">
                  {formatCurrency(nextPayment.amount, activeWorkspace.currency)}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#F0EAE0] text-xs">
                <span
                  className={`inline-flex items-center gap-1 font-medium ${
                    isNextPaymentOverdue ? 'text-[#991B1B]' : 'text-[#22201D]'
                  }`}
                >
                  {isNextPaymentOverdue ? (
                    <AlertTriangle className="w-3.5 h-3.5" />
                  ) : (
                    <Calendar className="w-3.5 h-3.5 text-[#6B655C]" />
                  )}
                  {nextPayment.dueDate
                    ? `${isNextPaymentOverdue ? 'Overdue · ' : 'Due '}${formatReadableDate(
                        nextPayment.dueDate
                      )}`
                    : nextPayment.relativeDueLabel ?? 'Date TBD'}
                </span>
                <span className="text-[#6B655C]">
                  Payer:{' '}
                  <strong className="font-medium text-[#22201D]">
                    {nextPayment.payer ?? 'Unassigned'}
                  </strong>
                </span>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
