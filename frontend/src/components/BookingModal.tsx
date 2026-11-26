import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';
import {
  buildBookingMilestones,
  calculateQuoteFinancials,
  DEFAULT_DEPOSIT_ALREADY_PAID,
  deriveBookingScheduleDefaults,
  formatCurrency,
  getVendorActiveQuote,
  getVendorBookingEligibility,
} from '../engine/financialCalculator';
import { useWorkspace } from '../store/workspaceStore';
import { DemoDataNote } from './DemoLabel';

interface BookingModalProps {
  vendorId: string | null;
  onClose: () => void;
}

export function BookingModal({ vendorId, onClose }: BookingModalProps) {
  const { activeWorkspace, confirmBooking } = useWorkspace();
  const vendor = activeWorkspace.vendors.find((v) => v.id === vendorId);
  const activeQuote = vendor ? getVendorActiveQuote(vendor) : undefined;
  const eligibility = vendor
    ? getVendorBookingEligibility(vendor, activeWorkspace.events)
    : null;
  const calc =
    vendor && activeQuote
      ? calculateQuoteFinancials(
          activeQuote,
          activeWorkspace.events,
          vendor.eventIds
        )
      : null;

  const [contractTotal, setContractTotal] = useState<string>('');
  const [depositAmount, setDepositAmount] = useState<string>('');
  const [depositAlreadyPaid, setDepositAlreadyPaid] = useState<boolean>(
    DEFAULT_DEPOSIT_ALREADY_PAID
  );
  const [depositHasKnownDate, setDepositHasKnownDate] = useState<boolean>(false);
  const [depositDate, setDepositDate] = useState<string>('');
  const [depositRelativeLabel, setDepositRelativeLabel] = useState<string>(
    'Due upon signing / date TBD'
  );
  const [balanceHasKnownDate, setBalanceHasKnownDate] = useState<boolean>(false);
  const [balanceDueDate, setBalanceDueDate] = useState<string>('');
  const [balanceRelativeLabel, setBalanceRelativeLabel] = useState<string>(
    'Balance due date TBD'
  );
  const [depositPayer, setDepositPayer] = useState<string>('Unassigned');
  const [balancePayer, setBalancePayer] = useState<string>('Unassigned');

  const existingPaidAmount = vendor
    ? activeWorkspace.payments
        .filter((p) => p.vendorId === vendor.id && p.status === 'Paid')
        .reduce((sum, p) => sum + p.amount, 0)
    : 0;

  useEffect(() => {
    if (!vendor) return;
    const defaultTotal =
      vendor.bookedContractTotal ?? calc?.estimatedAllInTotal ?? 0;
    const schedule = deriveBookingScheduleDefaults(
      activeQuote,
      activeWorkspace.events,
      vendor.eventIds,
      defaultTotal
    );

    setContractTotal(defaultTotal > 0 ? String(Math.round(defaultTotal * 100) / 100) : '');
    setDepositAmount(schedule.depositAmount > 0 ? String(schedule.depositAmount) : '');
    setDepositAlreadyPaid(DEFAULT_DEPOSIT_ALREADY_PAID);
    setDepositHasKnownDate(schedule.depositHasKnownDate);
    setDepositDate(schedule.depositDate);
    setDepositRelativeLabel(schedule.depositRelativeLabel);
    setBalanceHasKnownDate(schedule.balanceHasKnownDate);
    setBalanceDueDate(schedule.balanceDueDate);
    setBalanceRelativeLabel(schedule.balanceRelativeLabel);
    setDepositPayer(activeWorkspace.coupleNames || 'Unassigned');
    setBalancePayer('Unassigned');
  }, [vendor?.id]);

  if (!vendor) return null;

  const canBook = eligibility?.canBook ?? false;
  const totalNum = parseFloat(contractTotal) || 0;
  const schedulableTotal = Math.max(0, Math.round((totalNum - existingPaidAmount) * 100) / 100);
  const depositNum = Math.min(schedulableTotal, Math.max(0, parseFloat(depositAmount) || 0));
  const remainingNum = Math.max(0, Math.round((schedulableTotal - depositNum) * 100) / 100);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canBook || totalNum <= 0) return;

    const milestones = buildBookingMilestones({
      contractTotal: totalNum,
      existingPaidAmount,
      depositAmount: depositNum,
      depositAlreadyPaid,
      depositHasKnownDate: depositAlreadyPaid ? true : depositHasKnownDate,
      depositDate,
      depositRelativeLabel,
      depositPayer,
      coupleNames: activeWorkspace.coupleNames,
      balanceHasKnownDate,
      balanceDueDate,
      balanceRelativeLabel,
      balancePayer,
    });

    confirmBooking({
      vendorId: vendor.id,
      contractTotal: totalNum,
      milestones,
    });
    onClose();
  };

  const payerOptions = Array.from(
    new Set([
      'Unassigned',
      activeWorkspace.coupleNames,
      ...activeWorkspace.partners.map((p) => p.name),
      ...(activeWorkspace.isDemoWorkspace
        ? ['Gill Family', 'Sharma Family']
        : ['Bride’s Family', 'Groom’s Family']),
    ])
  ).filter(Boolean);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm vendor booking"
    >
      <div className="bg-white border border-[#E5DED2] rounded-2xl w-full max-w-lg overflow-hidden shadow-xl">
        <div className="px-6 py-4 bg-[#F3F8F5] border-b border-[#C6DEC9] flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-[#1F3A2B]">
                Confirm Booking — {vendor.name}
              </h2>
              {vendor.isDemoVenue && <DemoDataNote compact />}
            </div>
            <p className="text-xs text-[#2D4F3C] mt-0.5">
              Moves this contract into Committed Spend without double-counting Projected Spend.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#2D4F3C] hover:bg-white/60 cursor-pointer"
            aria-label="Close booking confirmation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {!canBook && eligibility && eligibility.blockingReasons.length > 0 && (
            <div className="rounded-xl bg-[#FEF3C7] border border-[#F59E0B]/60 p-3.5 space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#92400E]">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Booking blocked until unresolved items are cleared
              </div>
              <ul className="list-disc pl-5 text-xs text-[#92400E] space-y-0.5">
                {eligibility.blockingReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#22201D] mb-1">
                Agreed contract total ({activeWorkspace.currency}, incl. tax)
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={contractTotal}
                onChange={(e) => setContractTotal(e.target.value)}
                className="w-full rounded-xl border border-[#E5DED2] px-3 py-2 font-num text-sm font-semibold text-[#22201D] focus:outline-none focus:border-[#486755]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#22201D] mb-1">
                Deposit required ({activeWorkspace.currency})
              </label>
              <input
                type="number"
                step="0.01"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                className="w-full rounded-xl border border-[#E5DED2] px-3 py-2 font-num text-sm font-semibold text-[#22201D] focus:outline-none focus:border-[#486755]"
              />
            </div>
          </div>

          <div className="rounded-xl bg-[#FAF8F4] border border-[#E5DED2] p-3.5 space-y-3">
            <label className="flex items-center gap-2 text-xs font-medium text-[#22201D] cursor-pointer">
              <input
                type="checkbox"
                checked={depositAlreadyPaid}
                onChange={(e) => setDepositAlreadyPaid(e.target.checked)}
                className="accent-[#486755]"
              />
              Deposit has already been paid
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] text-[#6B655C]">
                    {depositAlreadyPaid ? 'Date deposit paid' : 'Deposit due date'}
                  </label>
                  {!depositAlreadyPaid && (
                    <button
                      type="button"
                      onClick={() => setDepositHasKnownDate((v) => !v)}
                      className="text-[10px] font-medium text-[#486755] hover:underline cursor-pointer"
                    >
                      {depositHasKnownDate ? 'Use relative / TBD' : 'Set exact date'}
                    </button>
                  )}
                </div>
                {depositAlreadyPaid || depositHasKnownDate ? (
                  <input
                    type="date"
                    value={depositDate}
                    onChange={(e) => setDepositDate(e.target.value)}
                    className="w-full rounded-lg border border-[#E5DED2] bg-white px-3 py-1.5 text-xs text-[#22201D]"
                  />
                ) : (
                  <input
                    type="text"
                    value={depositRelativeLabel}
                    onChange={(e) => setDepositRelativeLabel(e.target.value)}
                    placeholder="e.g. Due upon signing"
                    className="w-full rounded-lg border border-[#E5DED2] bg-white px-3 py-1.5 text-xs text-[#22201D]"
                  />
                )}
              </div>
              <div>
                <label className="block text-[11px] text-[#6B655C] mb-1">
                  {depositAlreadyPaid ? 'Paid by' : 'Payer'}
                </label>
                <select
                  value={depositPayer}
                  onChange={(e) => setDepositPayer(e.target.value)}
                  className="w-full rounded-lg border border-[#E5DED2] bg-white px-3 py-1.5 text-xs text-[#22201D]"
                >
                  {payerOptions.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {remainingNum > 0 && (
            <div className="rounded-xl bg-[#FAF8F4] border border-[#E5DED2] p-3.5 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-[#22201D]">
                  Remaining balance
                </span>
                <span className="font-num font-semibold text-[#22201D]">
                  {formatCurrency(remainingNum, activeWorkspace.currency, {
                    decimals: 2,
                  })}
                </span>
              </div>

              <div className="flex items-center gap-3 text-xs">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    checked={balanceHasKnownDate}
                    onChange={() => setBalanceHasKnownDate(true)}
                    className="accent-[#486755]"
                  />
                  Concrete due date
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    checked={!balanceHasKnownDate}
                    onChange={() => setBalanceHasKnownDate(false)}
                    className="accent-[#486755]"
                  />
                  Relative to unknown date
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  {balanceHasKnownDate ? (
                    <input
                      type="date"
                      value={balanceDueDate}
                      onChange={(e) => setBalanceDueDate(e.target.value)}
                      className="w-full rounded-lg border border-[#E5DED2] bg-white px-3 py-1.5 text-xs text-[#22201D]"
                    />
                  ) : (
                    <input
                      type="text"
                      value={balanceRelativeLabel}
                      onChange={(e) => setBalanceRelativeLabel(e.target.value)}
                      placeholder="e.g., 30 days prior to event (date TBD)"
                      className="w-full rounded-lg border border-[#E5DED2] bg-white px-3 py-1.5 text-xs text-[#22201D]"
                    />
                  )}
                </div>
                <div>
                  <select
                    aria-label="Balance payer"
                    value={balancePayer}
                    onChange={(e) => setBalancePayer(e.target.value)}
                    className="w-full rounded-lg border border-[#E5DED2] bg-white px-3 py-1.5 text-xs text-[#22201D]"
                  >
                    {payerOptions.map((p) => (
                      <option key={p} value={p}>
                        Payer: {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-xl border border-[#E5DED2] text-[#6B655C] hover:text-[#22201D] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canBook || totalNum <= 0}
              className={`inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold rounded-xl ${
                !canBook || totalNum <= 0
                  ? 'bg-[#E5DED2] text-[#7A7368] cursor-not-allowed'
                  : 'bg-[#486755] text-white hover:bg-[#395344] cursor-pointer'
              }`}
            >
              <Check className="w-3.5 h-3.5" />
              {canBook ? 'Confirm Booking & Activate Schedule' : 'Resolve Blockers First'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
