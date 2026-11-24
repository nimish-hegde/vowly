import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  RotateCcw,
} from 'lucide-react';
import {
  formatCurrency,
  formatShortCad,
} from '../engine/financialCalculator';
import { useWorkspace } from '../store/workspaceStore';
import { PaymentMilestone } from '../types/vowly';
import { PASTEL_TONES } from '../utils/pastelStyles';
import { DemoDataNote, StatusText } from './DemoLabel';

interface PaymentsViewProps {
  onOpenVendor: (vendorId: string) => void;
  onOpenBookingFromVendors: () => void;
}

const TODAY_ISO = '2026-11-24';

function formatReadableDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function PaymentsView({
  onOpenVendor,
  onOpenBookingFromVendors,
}: PaymentsViewProps) {
  const {
    activeWorkspace,
    financials,
    markPaymentPaid,
    undoPaymentPaid,
    updatePaymentPayer,
  } = useWorkspace();

  const [showPaidHistory, setShowPaidHistory] = useState(false);
  const [confirmingPaidId, setConfirmingPaidId] = useState<string | null>(null);
  const [actualPayerDraft, setActualPayerDraft] = useState<string>('');
  const [customPayerId, setCustomPayerId] = useState<string | null>(null);
  const [customPayerText, setCustomPayerText] = useState<string>('');

  const payerPresets = useMemo(() => {
    const partnerNames = activeWorkspace.partners.map((p) => p.name.split(' ')[0]);
    const list = [
      'Unassigned',
      activeWorkspace.coupleNames,
      ...partnerNames,
      'Gill Family',
      'Sharma Family',
    ];
    return Array.from(new Set(list));
  }, [activeWorkspace.partners, activeWorkspace.coupleNames]);

  // Confirmed bookings gate: only show payments linked to booked vendors
  const bookedVendorIds = useMemo(
    () =>
      new Set(
        activeWorkspace.vendors
          .filter((v) => v.status === 'Booked')
          .map((v) => v.id)
      ),
    [activeWorkspace.vendors]
  );

  const gatedPayments = useMemo(
    () => activeWorkspace.payments.filter((p) => bookedVendorIds.has(p.vendorId)),
    [activeWorkspace.payments, bookedVendorIds]
  );

  const paidPayments = useMemo(
    () =>
      gatedPayments
        .filter((p) => p.status === 'Paid')
        .sort((a, b) => (b.paidDate ?? '').localeCompare(a.paidDate ?? '')),
    [gatedPayments]
  );

  const unpaidPayments = useMemo(
    () => gatedPayments.filter((p) => p.status !== 'Paid'),
    [gatedPayments]
  );

  const overduePayments = useMemo(
    () =>
      unpaidPayments
        .filter((p) => Boolean(p.dueDate) && (p.dueDate ?? '') < TODAY_ISO)
        .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '')),
    [unpaidPayments]
  );

  const undatedPayments = useMemo(
    () => unpaidPayments.filter((p) => !p.dueDate),
    [unpaidPayments]
  );

  // Upcoming dated payments grouped chronologically by dueDate with day total
  const chronologicalGroups = useMemo(() => {
    const upcoming = unpaidPayments
      .filter((p) => Boolean(p.dueDate) && (p.dueDate ?? '') >= TODAY_ISO)
      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));

    const groups: Array<{
      date: string;
      readableDate: string;
      dayTotal: number;
      items: PaymentMilestone[];
    }> = [];

    for (const item of upcoming) {
      const dateKey = item.dueDate!;
      let group = groups.find((g) => g.date === dateKey);
      if (!group) {
        group = {
          date: dateKey,
          readableDate: formatReadableDate(dateKey),
          dayTotal: 0,
          items: [],
        };
        groups.push(group);
      }
      group.items.push(item);
      group.dayTotal = Math.round((group.dayTotal + item.amount) * 100) / 100;
    }
    return groups;
  }, [unpaidPayments]);

  // Lead hero: next unpaid due date & amount
  const nextDueLead = useMemo(() => {
    if (overduePayments.length > 0) {
      const total = overduePayments.reduce((s, p) => s + p.amount, 0);
      return {
        isOverdue: true,
        dateLabel: formatReadableDate(overduePayments[0].dueDate!),
        amount: total,
        count: overduePayments.length,
      };
    }
    if (chronologicalGroups.length > 0) {
      const first = chronologicalGroups[0];
      return {
        isOverdue: false,
        dateLabel: first.readableDate,
        amount: first.dayTotal,
        count: first.items.length,
      };
    }
    if (undatedPayments.length > 0) {
      return {
        isOverdue: false,
        dateLabel: 'Date TBD',
        amount: undatedPayments.reduce((s, p) => s + p.amount, 0),
        count: undatedPayments.length,
      };
    }
    return null;
  }, [overduePayments, chronologicalGroups, undatedPayments]);

  const getEventMeta = (pay: PaymentMilestone) => {
    const vendor = activeWorkspace.vendors.find((v) => v.id === pay.vendorId);
    const evtId = pay.eventId ?? (vendor?.eventIds.length === 1 ? vendor.eventIds[0] : undefined);
    const evt = evtId
      ? activeWorkspace.events.find((e) => e.id === evtId)
      : undefined;
    if (evt) {
      return {
        label: evt.name,
        dot: (PASTEL_TONES[evt.tone] ?? PASTEL_TONES.sage).dot,
      };
    }
    if (pay.eventLabel) {
      return { label: pay.eventLabel, dot: 'bg-[#725BA0]' };
    }
    if (vendor && vendor.eventIds.length > 1) {
      return {
        label: `Shared (${vendor.eventIds.length} events)`,
        dot: 'bg-[#725BA0]',
      };
    }
    return { label: 'Whole wedding', dot: 'bg-[#9A9388]' };
  };

  const renderUnpaidRow = (pay: PaymentMilestone) => {
    const evtMeta = getEventMeta(pay);
    const currentPayer = pay.payer ?? 'Unassigned';
    const isConfirming = confirmingPaidId === pay.id;
    const isCustomPayer = customPayerId === pay.id;
    const isPreset = payerPresets.includes(currentPayer);

    return (
      <div key={pay.id} className="px-4 sm:px-5 py-3.5 bg-white space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Left: Vendor, Event/Shared, Label */}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <button
                type="button"
                onClick={() => onOpenVendor(pay.vendorId)}
                className="text-sm font-semibold text-[#22201D] hover:text-[#486755] cursor-pointer text-left"
              >
                {pay.vendorName}
              </button>
              <span className="text-xs text-[#6B655C]">· {pay.label}</span>
              {pay.isDemoVenue && <DemoDataNote compact />}
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#6B655C]">
              <span className="inline-flex items-center gap-1.5 text-[#22201D]">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${evtMeta.dot}`}
                />
                <span>{evtMeta.label}</span>
              </span>
              {!pay.dueDate && pay.relativeDueLabel && (
                <span className="inline-flex items-center gap-1 text-[#9A4A06] font-medium">
                  <Clock className="w-3 h-3" />
                  {pay.relativeDueLabel}
                </span>
              )}
            </div>
          </div>

          {/* Right: Payer selector, Amount, Mark paid */}
          <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3 shrink-0">
            {/* Editable Payer */}
            {isCustomPayer ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  updatePaymentPayer(pay.id, customPayerText);
                  setCustomPayerId(null);
                }}
                className="flex items-center gap-1"
              >
                <input
                  type="text"
                  autoFocus
                  value={customPayerText}
                  onChange={(e) => setCustomPayerText(e.target.value)}
                  placeholder="Payer name..."
                  className="w-28 rounded-lg border border-[#486755] px-2 py-1 text-xs"
                />
                <button
                  type="submit"
                  className="px-2 py-1 rounded-lg bg-[#486755] text-white text-[11px] font-semibold cursor-pointer"
                >
                  Save
                </button>
              </form>
            ) : (
              <div className="flex items-center gap-1.5 text-xs">
                <label htmlFor={`payer-${pay.id}`} className="text-[#6B655C]">
                  Payer:
                </label>
                <select
                  id={`payer-${pay.id}`}
                  value={isPreset ? currentPayer : '__existing_custom__'}
                  onChange={(e) => {
                    if (e.target.value === '__add_custom__') {
                      setCustomPayerText(
                        currentPayer === 'Unassigned' ? '' : currentPayer
                      );
                      setCustomPayerId(pay.id);
                    } else {
                      updatePaymentPayer(pay.id, e.target.value);
                    }
                  }}
                  className={`rounded-lg border px-2 py-1 text-xs font-medium ${
                    currentPayer === 'Unassigned'
                      ? 'border-[#F59E0B]/60 bg-[#FEF3C7]/40 text-[#9A4A06]'
                      : 'border-[#E5DED2] bg-[#FAF8F4] text-[#22201D]'
                  }`}
                >
                  {!isPreset && (
                    <option value="__existing_custom__">{currentPayer}</option>
                  )}
                  {payerPresets.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                  <option value="__add_custom__">Custom payer…</option>
                </select>
              </div>
            )}

            <div className="font-num text-sm font-semibold text-[#22201D] min-w-[92px] text-right">
              {formatCurrency(pay.amount, activeWorkspace.currency, {
                decimals: 2,
              })}
            </div>

            <button
              type="button"
              onClick={() => {
                setConfirmingPaidId(isConfirming ? null : pay.id);
                setActualPayerDraft(
                  currentPayer === 'Unassigned'
                    ? activeWorkspace.coupleNames
                    : currentPayer
                );
              }}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#B6D7C0] bg-[#EAF5EE] text-[#234733] hover:bg-[#DFEFE4] whitespace-nowrap cursor-pointer"
            >
              Mark paid
            </button>
          </div>
        </div>

        {/* Inline Payment Confirmation: Confirm Who Actually Paid */}
        {isConfirming && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              markPaymentPaid(pay.id, actualPayerDraft);
              setConfirmingPaidId(null);
            }}
            className="rounded-xl bg-[#EAF5EE] border border-[#B6D7C0] p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs"
          >
            <div className="flex flex-wrap items-center gap-2">
              <label
                htmlFor={`paidby-${pay.id}`}
                className="font-semibold text-[#234733]"
              >
                Paid by:
              </label>
              <input
                id={`paidby-${pay.id}`}
                type="text"
                required
                value={actualPayerDraft}
                onChange={(e) => setActualPayerDraft(e.target.value)}
                list={`payer-list-${pay.id}`}
                placeholder="Who actually paid?"
                className="rounded-lg border border-[#B6D7C0] bg-white px-2.5 py-1.5 text-xs font-medium text-[#22201D] w-44"
              />
              <datalist id={`payer-list-${pay.id}`}>
                {payerPresets
                  .filter((p) => p !== 'Unassigned')
                  .map((p) => (
                    <option key={p} value={p} />
                  ))}
              </datalist>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmingPaidId(null)}
                className="px-2.5 py-1.5 rounded-lg text-[#5A544C] hover:text-[#22201D] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#486755] text-white font-semibold hover:bg-[#395344] cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                Confirm paid
              </button>
            </div>
          </form>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#22201D]">
            Payments
          </h1>
          <p className="mt-0.5 text-xs text-[#6B655C]">
            Confirmed bookings only · Unpaid installments grouped by due date
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenBookingFromVendors}
          className="px-4 py-2 text-xs font-semibold rounded-xl border border-[#B6D7C0] bg-[#DFEFE4] text-[#234733] hover:bg-[#D1E7D8] whitespace-nowrap shrink-0 cursor-pointer"
        >
          Book a quoted vendor
        </button>
      </div>

      {/* Lead Card: Next Unpaid Due Date & Amount + Booked/Paid Totals */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
        <div
          className={`lg:col-span-5 rounded-2xl border p-5 flex flex-col justify-between ${
            nextDueLead?.isOverdue
              ? 'bg-[#FEF2F2] border-[#FECACA]'
              : 'bg-white border-[#E5DED2]'
          }`}
        >
          <div className="flex items-center justify-between text-xs">
            <span
              className={`font-semibold inline-flex items-center gap-1.5 ${
                nextDueLead?.isOverdue ? 'text-[#991B1B]' : 'text-[#6B655C]'
              }`}
            >
              {nextDueLead?.isOverdue ? (
                <>
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Overdue payment
                </>
              ) : (
                <>
                  <Calendar className="w-3.5 h-3.5" />
                  Next unpaid due date
                </>
              )}
            </span>
            {nextDueLead && (
              <span className="text-[11px] text-[#6B655C]">
                {nextDueLead.count}{' '}
                {nextDueLead.count === 1 ? 'installment' : 'installments'}
              </span>
            )}
          </div>

          {nextDueLead ? (
            <div className="mt-2.5 flex items-baseline justify-between gap-3">
              <div className="text-base font-semibold text-[#22201D]">
                {nextDueLead.dateLabel}
              </div>
              <div
                className={`font-num text-2xl font-semibold ${
                  nextDueLead.isOverdue ? 'text-[#991B1B]' : 'text-[#22201D]'
                }`}
              >
                {formatCurrency(nextDueLead.amount, activeWorkspace.currency, {
                  decimals: 2,
                })}
              </div>
            </div>
          ) : (
            <div className="mt-2 text-sm text-[#6B655C]">
              All booked payments settled
            </div>
          )}
        </div>

        {/* Booked & Paid Detail (Moved here cleanly from Overview) */}
        <div className="lg:col-span-7 rounded-2xl bg-white border border-[#E5DED2] p-5 grid grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-[#6B655C]">Booked total</div>
            <div className="mt-1 font-num text-lg sm:text-xl font-semibold text-[#22201D]">
              {formatShortCad(financials.committedSpend)}
            </div>
            <div className="text-[11px] text-[#6B655C]">
              {bookedVendorIds.size}{' '}
              {bookedVendorIds.size === 1 ? 'contract' : 'contracts'}
            </div>
          </div>
          <div>
            <div className="text-xs text-[#6B655C]">Paid to date</div>
            <div className="mt-1 font-num text-lg sm:text-xl font-semibold text-[#234733]">
              {formatShortCad(financials.paidToDate)}
            </div>
            <div className="text-[11px] text-[#6B655C]">
              {paidPayments.length} paid
            </div>
          </div>
          <div>
            <div className="text-xs text-[#6B655C]">Owed on bookings</div>
            <div className="mt-1 font-num text-lg sm:text-xl font-semibold text-[#22201D]">
              {formatShortCad(financials.remainingToPay)}
            </div>
            <div className="text-[11px] text-[#6B655C]">
              {unpaidPayments.length} unpaid
            </div>
          </div>
        </div>
      </div>

      {/* Empty Gate State */}
      {bookedVendorIds.size === 0 ? (
        <div className="rounded-2xl bg-white border border-[#E5DED2] p-10 text-center space-y-2">
          <div className="text-sm font-semibold text-[#22201D]">
            No confirmed bookings yet
          </div>
          <p className="text-xs text-[#6B655C]">
            Confirm a booking from any quoted vendor to activate its payment schedule.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* 1. OVERDUE GROUP */}
          {overduePayments.length > 0 && (
            <section className="rounded-2xl border border-[#FCA5A5] bg-white overflow-hidden">
              <div className="px-4 sm:px-5 py-3 bg-[#FEF2F2] border-b border-[#FCA5A5] flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#991B1B]">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    Overdue ({overduePayments.length}) ·{' '}
                    {formatReadableDate(overduePayments[0].dueDate!)}
                  </span>
                </div>
                <div className="font-num text-xs font-semibold text-[#991B1B]">
                  {formatCurrency(
                    overduePayments.reduce((s, p) => s + p.amount, 0),
                    activeWorkspace.currency,
                    { decimals: 2 }
                  )}
                </div>
              </div>
              <div className="divide-y divide-[#F0EAE0]">
                {overduePayments.map(renderUnpaidRow)}
              </div>
            </section>
          )}

          {/* 2. CHRONOLOGICAL DATE GROUPS WITH DAY TOTAL */}
          {chronologicalGroups.map((group) => (
            <section
              key={group.date}
              className="rounded-2xl border border-[#E5DED2] bg-white overflow-hidden"
            >
              <div className="px-4 sm:px-5 py-3 bg-[#F6F2EA] border-b border-[#E5DED2] flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#22201D]">
                  <Calendar className="w-3.5 h-3.5 text-[#486755]" />
                  <span>{group.readableDate}</span>
                  {group.items.length > 1 && (
                    <span className="font-normal text-[#6B655C]">
                      · {group.items.length} installments due same day
                    </span>
                  )}
                </div>
                <div className="font-num text-xs font-semibold text-[#22201D]">
                  Day total:{' '}
                  {formatCurrency(group.dayTotal, activeWorkspace.currency, {
                    decimals: 2,
                  })}
                </div>
              </div>
              <div className="divide-y divide-[#F0EAE0]">
                {group.items.map(renderUnpaidRow)}
              </div>
            </section>
          ))}

          {/* 3. UNDATED / RELATIVE DEADLINES GROUP */}
          {undatedPayments.length > 0 && (
            <section className="rounded-2xl border border-[#E5DED2] bg-white overflow-hidden">
              <div className="px-4 sm:px-5 py-3 bg-[#FDF1EA] border-b border-[#ECC4AC] flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#733B20]">
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  <span>Undated / relative deadlines ({undatedPayments.length})</span>
                </div>
                <div className="font-num text-xs font-semibold text-[#733B20]">
                  {formatCurrency(
                    undatedPayments.reduce((s, p) => s + p.amount, 0),
                    activeWorkspace.currency,
                    { decimals: 2 }
                  )}
                </div>
              </div>
              <div className="divide-y divide-[#F0EAE0]">
                {undatedPayments.map(renderUnpaidRow)}
              </div>
            </section>
          )}

          {/* 4. COLLAPSED PAID HISTORY WITH UNDO */}
          <section className="rounded-2xl border border-[#E5DED2] bg-white overflow-hidden">
            <button
              type="button"
              aria-expanded={showPaidHistory}
              onClick={() => setShowPaidHistory((v) => !v)}
              className="w-full px-4 sm:px-5 py-3.5 flex items-center justify-between text-xs font-semibold text-[#22201D] hover:bg-[#FAF8F4] cursor-pointer"
            >
              <span className="inline-flex items-center gap-2">
                {showPaidHistory ? (
                  <ChevronDown className="w-4 h-4 text-[#6B655C]" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-[#6B655C]" />
                )}
                <span>Paid history ({paidPayments.length})</span>
              </span>
              <span className="font-num text-[#234733]">
                {formatCurrency(financials.paidToDate, activeWorkspace.currency, {
                  decimals: 2,
                })}
              </span>
            </button>

            {showPaidHistory && (
              <div className="divide-y divide-[#F0EAE0] border-t border-[#E5DED2]">
                {paidPayments.length === 0 ? (
                  <div className="p-5 text-xs text-[#6B655C]">
                    No payments recorded yet.
                  </div>
                ) : (
                  paidPayments.map((pay) => {
                    const evtMeta = getEventMeta(pay);
                    return (
                      <div
                        key={pay.id}
                        className="px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs bg-[#FAF8F4]/60"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2">
                            <span className="font-semibold text-[#22201D]">
                              {pay.vendorName}
                            </span>
                            <span className="text-[#6B655C]">· {pay.label}</span>
                            {pay.isDemoVenue && <DemoDataNote compact />}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[#6B655C]">
                            <span className="inline-flex items-center gap-1">
                              <span
                                className={`w-2 h-2 rounded-full ${evtMeta.dot}`}
                              />
                              {evtMeta.label}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="text-[#234733] font-medium">
                              Paid by {pay.paidBy ?? pay.payer ?? 'Couple'} on{' '}
                              {pay.paidDate
                                ? formatReadableDate(pay.paidDate)
                                : 'recorded date'}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                          <span className="font-num font-semibold text-[#234733]">
                            {formatCurrency(pay.amount, activeWorkspace.currency, {
                              decimals: 2,
                            })}
                          </span>
                          <StatusText status="Paid" />
                          <button
                            type="button"
                            onClick={() => undoPaymentPaid(pay.id)}
                            className="inline-flex items-center gap-1 font-medium text-[#6B655C] hover:text-[#22201D] cursor-pointer"
                          >
                            <RotateCcw className="w-3 h-3" />
                            Undo
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
