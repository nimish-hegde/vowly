import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  FileUp,
  Layers,
  Mail,
  MapPin,
  Phone,
  Users,
  X,
} from 'lucide-react';
import {
  calculateQuoteFinancials,
  CATEGORY_META,
  formatCurrency,
  formatShortCad,
  formatSignedCad,
  getVendorActiveQuote,
} from '../engine/financialCalculator';
import { useWorkspace } from '../store/workspaceStore';
import { VendorStatus } from '../types/vowly';
import { PASTEL_TONES } from '../utils/pastelStyles';
import { DemoDataNote, StatusText } from './DemoLabel';

interface VendorDetailDrawerProps {
  vendorId: string | null;
  onClose: () => void;
  onOpenQuoteImport: (presetId?: string, vendorId?: string) => void;
  onResumeDraft: (vendorId: string) => void;
  onOpenBooking: (vendorId: string) => void;
}

const STATUS_OPTIONS: VendorStatus[] = [
  'Researching',
  'Shortlisted',
  'Quoted',
  'Revision pending',
  'Booked',
  'Declined',
];

export function VendorDetailDrawer({
  vendorId,
  onClose,
  onOpenQuoteImport,
  onResumeDraft,
  onOpenBooking,
}: VendorDetailDrawerProps) {
  const {
    activeWorkspace,
    updateVendor,
    updateEventGuestCount,
    setPreferredVendor,
    toggleVendorAddOn,
  } = useWorkspace();

  const vendor = activeWorkspace.vendors.find((v) => v.id === vendorId);
  const [notesDraft, setNotesDraft] = useState(vendor?.notes ?? '');

  // Collapsed by default: inclusions, evidence, history
  const [showInclusions, setShowInclusions] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Track last total for subtle change highlight and signed delta
  const prevTotalRef = useRef<number | null>(null);
  const [lastDelta, setLastDelta] = useState<number>(0);
  const [flashKey, setFlashKey] = useState(0);

  // Single-event guest editing directly inside drawer (with incomplete input preserved)
  const primaryEvent =
    vendor && vendor.eventIds.length === 1
      ? activeWorkspace.events.find((e) => e.id === vendor.eventIds[0])
      : undefined;
  const [drawerGuestText, setDrawerGuestText] = useState<string>(
    primaryEvent?.guestCount !== null && primaryEvent?.guestCount !== undefined
      ? String(primaryEvent.guestCount)
      : ''
  );

  useEffect(() => {
    setNotesDraft(vendor?.notes ?? '');
    setShowInclusions(false);
    setShowEvidence(false);
    setShowHistory(false);
    setLastDelta(0);
    prevTotalRef.current = null;
  }, [vendor?.id]);

  useEffect(() => {
    if (!primaryEvent) return;
    setDrawerGuestText(
      primaryEvent.guestCount !== null ? String(primaryEvent.guestCount) : ''
    );
  }, [primaryEvent?.id, primaryEvent?.guestCount]);

  const activeQuote = vendor ? getVendorActiveQuote(vendor) : undefined;
  const calc =
    vendor && activeQuote
      ? calculateQuoteFinancials(
          activeQuote,
          activeWorkspace.events,
          vendor.eventIds
        )
      : null;

  const displayedTotal =
    vendor?.status === 'Booked' && vendor.bookedContractTotal !== undefined
      ? vendor.bookedContractTotal
      : calc
        ? calc.estimatedAllInTotal
        : null;

  useEffect(() => {
    if (displayedTotal === null) return;
    if (prevTotalRef.current !== null && prevTotalRef.current !== displayedTotal) {
      setLastDelta(displayedTotal - prevTotalRef.current);
      setFlashKey((k) => k + 1);
    }
    prevTotalRef.current = displayedTotal;
  }, [displayedTotal]);

  if (!vendor) return null;

  const linkedEvents = vendor.eventIds
    .map((id) => activeWorkspace.events.find((e) => e.id === id))
    .filter((e): e is NonNullable<typeof e> => Boolean(e));

  const hasPerPersonItems = Boolean(
    activeQuote?.lineItems.some(
      (li) => li.pricingModel === 'per_person' || li.pricingModel === 'guest_ratio'
    )
  );

  const unchangedDrawerReason =
    primaryEvent && activeQuote && lastDelta === 0
      ? vendor.status === 'Booked'
        ? 'Booked contract total is locked'
        : calc?.minGuestsApplied && calc.appliedMinGuests
          ? `${calc.appliedMinGuests}-guest minimum applies`
          : !hasPerPersonItems
            ? 'Fixed costs only'
            : null
      : null;

  const hasUnresolvedBlockers =
    Boolean(vendor.draftQuote) ||
    (calc?.unresolvedMandatoryFeesCount ?? 0) > 0 ||
    (calc?.unresolvedConflictsCount ?? 0) > 0;

  const handleDrawerGuestInput = (raw: string) => {
    if (!/^\d*$/.test(raw)) return;
    setDrawerGuestText(raw);
    if (!primaryEvent || raw === '') return;
    const parsed = parseInt(raw, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      updateEventGuestCount(primaryEvent.id, parsed);
    }
  };

  const handleDrawerGuestBlur = () => {
    if (!primaryEvent) return;
    if (drawerGuestText.trim() === '') {
      updateEventGuestCount(primaryEvent.id, null);
      return;
    }
    const parsed = parseInt(drawerGuestText, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      setDrawerGuestText(
        primaryEvent.guestCount !== null ? String(primaryEvent.guestCount) : ''
      );
      return;
    }
    const clamped = Math.max(1, Math.min(2000, parsed));
    setDrawerGuestText(String(clamped));
    updateEventGuestCount(primaryEvent.id, clamped);
  };

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/30 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label={`${vendor.name} details`}
    >
      <div className="w-full max-w-2xl bg-[#FAF8F4] border-l border-[#E5DED2] h-full flex flex-col shadow-2xl">
        {/* Top Drawer Header */}
        <div className="px-5 sm:px-6 py-4 bg-white border-b border-[#E5DED2] flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#6B655C]">
              <span>{CATEGORY_META[vendor.category].label}</span>
              <span aria-hidden="true">·</span>
              <StatusText
                status={
                  activeQuote || vendor.status === 'Booked'
                    ? vendor.status
                    : 'No quote'
                }
              />
              {vendor.isDemoVenue && (
                <>
                  <span aria-hidden="true">·</span>
                  <DemoDataNote compact />
                </>
              )}
            </div>
            <h2 className="mt-1 text-lg sm:text-xl font-semibold text-[#22201D] truncate">
              {vendor.name}
            </h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[#6B655C]">
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                {vendor.location}
              </span>
              {linkedEvents.length > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true">·</span>
                  {linkedEvents.map((e) => (
                    <span
                      key={e.id}
                      className="inline-flex items-center gap-1 text-[#22201D]"
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          (PASTEL_TONES[e.tone] ?? PASTEL_TONES.sage).dot
                        }`}
                      />
                      {e.name}
                    </span>
                  ))}
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-[#6B655C] hover:text-[#22201D] hover:bg-[#F3EFE8] cursor-pointer shrink-0"
            aria-label="Close vendor drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sticky Compact All-In Total Bar (Always Visible While Scrolling) */}
        <div
          aria-live="polite"
          className="px-5 sm:px-6 py-3 bg-[#F3EFE8] border-b border-[#E5DED2] flex flex-wrap items-center justify-between gap-3 shrink-0"
        >
          <div className="flex items-baseline gap-3">
            <div>
              <div className="text-[11px] font-medium text-[#6B655C]">
                {vendor.status === 'Booked' ? 'Booked all-in' : 'Estimated all-in'}
              </div>
              <div
                key={flashKey}
                className="font-num text-xl font-semibold text-[#22201D] amount-changed-flash px-1 -ml-1"
              >
                {displayedTotal !== null
                  ? formatCurrency(
                      displayedTotal,
                      calc?.currencyLabel ?? activeWorkspace.currency,
                      { decimals: 2 }
                    )
                  : 'No quote'}
              </div>
            </div>

            {lastDelta !== 0 && (
              <span
                className={`font-num text-xs font-semibold ${
                  lastDelta > 0 ? 'text-[#9A4A06]' : 'text-[#234733]'
                }`}
              >
                {formatSignedCad(lastDelta)} CAD
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {calc && (
              <span className="text-[11px] text-[#6B655C] hidden sm:inline">
                HST {calc.hstAssumed ? '13% est.' : '13%'} ·{' '}
                {formatShortCad(calc.taxAmount)}
              </span>
            )}
            {vendor.status !== 'Booked' && activeQuote && (
              <button
                type="button"
                disabled={hasUnresolvedBlockers}
                onClick={() => onOpenBooking(vendor.id)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap ${
                  hasUnresolvedBlockers
                    ? 'bg-[#E5DED2] text-[#7A7368] cursor-not-allowed'
                    : 'bg-[#486755] text-white hover:bg-[#395344] cursor-pointer'
                }`}
              >
                <Check className="w-3.5 h-3.5" />
                {hasUnresolvedBlockers ? 'Resolve blockers' : 'Confirm booking'}
              </button>
            )}
          </div>
        </div>

        {/* Scrollable Drawer Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
          {/* Always Visible: Draft / Unresolved Fees / Booking Blockers */}
          {vendor.draftQuote && (
            <div className="rounded-xl bg-[#FEF3C7] border border-[#F59E0B]/60 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-[#92400E] mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs font-semibold text-[#92400E]">
                    Saved draft blocks approval
                  </div>
                  <div className="text-xs text-[#92400E]/90 mt-0.5">
                    “{vendor.draftQuote.title}” has unresolved items.
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onResumeDraft(vendor.id)}
                className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-[#92400E] text-white hover:bg-[#78350F] whitespace-nowrap shrink-0 cursor-pointer"
              >
                Resolve draft
              </button>
            </div>
          )}

          {activeQuote &&
            activeQuote.unconfirmedFees.some(
              (f) => f.mandatory && f.status === 'unconfirmed'
            ) && (
              <div className="rounded-xl bg-[#FEF3C7] border border-[#F59E0B]/60 p-4 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#92400E]">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  Unresolved mandatory fee (booking blocker)
                </div>
                {activeQuote.unconfirmedFees
                  .filter((f) => f.mandatory && f.status === 'unconfirmed')
                  .map((f) => (
                    <div key={f.id} className="text-xs text-[#92400E]">
                      <strong>{f.label}:</strong> {f.description}
                    </div>
                  ))}
              </div>
            )}

          {calc?.capacityExceeded && activeQuote?.maxCapacity && (
            <div className="rounded-xl bg-[#FEE2E2] border border-[#FCA5A5] p-3.5 flex items-center gap-2 text-xs font-semibold text-[#991B1B]">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Saved guest count exceeds {activeQuote.maxCapacity} max capacity.
            </div>
          )}

          {/* Shared Multi-Event Callout */}
          {vendor.eventIds.length > 1 && (
            <div className="rounded-xl bg-[#F2ECFA] border border-[#CBBCE8] px-4 py-2.5 flex items-center gap-2 text-xs text-[#42306B]">
              <Layers className="w-4 h-4 shrink-0" />
              <span>
                Shared across {vendor.eventIds.length} events · counted once in total budget.
              </span>
            </div>
          )}

          {/* Saved Guest Count Control (Single-Event Quoted Vendors) */}
          {primaryEvent && activeQuote && (
            <div className="rounded-xl bg-white border border-[#E5DED2] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-[#22201D] inline-flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-[#486755]" />
                  {primaryEvent.name} saved attendance
                </div>
                <div className="text-[11px] text-[#6B655C] mt-0.5">
                  {unchangedDrawerReason ??
                    (hasPerPersonItems
                      ? 'Updates saved event & budget totals immediately'
                      : 'Fixed costs only')}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <input
                  type="text"
                  inputMode="numeric"
                  value={drawerGuestText}
                  onChange={(e) => handleDrawerGuestInput(e.target.value)}
                  onBlur={handleDrawerGuestBlur}
                  placeholder="TBD"
                  aria-label={`${primaryEvent.name} saved guest count`}
                  className="w-20 rounded-lg border border-[#E5DED2] px-2.5 py-1.5 text-center font-num text-sm font-semibold text-[#22201D]"
                />
                <span className="text-xs text-[#6B655C]">guests</span>
              </div>
            </div>
          )}

          {/* Notes-Only / No Quote State */}
          {!activeQuote ? (
            <div className="rounded-2xl bg-white border border-[#E5DED2] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[#22201D]">
                  {vendor.name} has no quote yet
                </div>
                <div className="text-xs text-[#6B655C] mt-0.5">
                  Preserved as unpriced until you import or enter a quote.
                </div>
              </div>
              <button
                type="button"
                onClick={() => onOpenQuoteImport(undefined, vendor.id)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-[#486755] text-white hover:bg-[#395344] whitespace-nowrap cursor-pointer"
              >
                <FileUp className="w-3.5 h-3.5" />
                Add quote
              </button>
            </div>
          ) : (
            <>
              {/* Quick Controls Row */}
              <div className="rounded-2xl bg-white border border-[#E5DED2] p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs">
                  <label htmlFor="drawer-status" className="text-[#6B655C]">
                    Status:
                  </label>
                  <select
                    id="drawer-status"
                    value={vendor.status}
                    onChange={(e) => {
                      const nextStatus = e.target.value as VendorStatus;
                      if (nextStatus === 'Booked') {
                        if (vendor.status !== 'Booked' && !hasUnresolvedBlockers) {
                          onOpenBooking(vendor.id);
                        }
                        return;
                      }
                      updateVendor(vendor.id, {
                        status: nextStatus,
                      });
                    }}
                    className="rounded-lg border border-[#E5DED2] bg-[#FAF8F4] px-2.5 py-1.5 text-xs font-medium text-[#22201D]"
                  >
                    {STATUS_OPTIONS.map((st) => (
                      <option
                        key={st}
                        value={st}
                        disabled={
                          st === 'Booked' &&
                          vendor.status !== 'Booked' &&
                          hasUnresolvedBlockers
                        }
                      >
                        {st === 'Booked' && vendor.status !== 'Booked'
                          ? hasUnresolvedBlockers
                            ? 'Booked (resolve blockers first)'
                            : 'Booked (confirm booking...)'
                          : st}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {vendor.status !== 'Booked' && !vendor.isPreferred && (
                    <button
                      type="button"
                      onClick={() => setPreferredVendor(vendor.id)}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#B6D7C0] bg-[#DFEFE4] text-[#234733] hover:bg-[#D1E7D8] cursor-pointer"
                    >
                      Use for budget
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onOpenQuoteImport(undefined, vendor.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[#E5DED2] bg-white text-[#22201D] hover:bg-[#FAF8F4] cursor-pointer"
                  >
                    <FileUp className="w-3.5 h-3.5" />
                    Import revision
                  </button>
                </div>
              </div>

              {/* Line Items & Optional Add-Ons (Tax-Inclusive Change Shown Beside Each) */}
              {calc && (
                <div className="rounded-2xl bg-white border border-[#E5DED2] p-5 space-y-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[#22201D]">
                      {activeQuote.title}
                    </span>
                    <span className="text-[#6B655C]">
                      {activeQuote.receivedDate}
                    </span>
                  </div>

                  <div className="divide-y divide-[#F0EAE0] border-t border-[#F0EAE0]">
                    {activeQuote.lineItems.map((li) => (
                      <div
                        key={li.id}
                        className="py-2.5 flex items-center justify-between gap-4 text-xs"
                      >
                        <div>
                          <div className="font-medium text-[#22201D]">
                            {li.label}
                          </div>
                          <div className="text-[11px] text-[#6B655C]">
                            {li.pricingModel === 'per_person'
                              ? `$${li.unitPrice}/guest${
                                  li.minGuests ? ` · ${li.minGuests} min` : ''
                                }`
                              : li.pricingModel === 'guest_ratio'
                                ? `$${li.unitPrice} per ${li.ratioDivisor ?? 10} guests`
                                : li.pricingModel === 'hourly'
                                  ? `$${li.unitPrice}/hr × ${li.quantity ?? 1} hrs`
                                  : 'Fixed fee'}
                          </div>
                        </div>
                        <div className="font-num font-semibold text-[#22201D]">
                          {formatShortCad(li.unitPrice)}
                          {li.pricingModel === 'per_person' ? '/pp' : ''}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Optional Add-Ons with Tax-Inclusive Change */}
                  {calc.addOnImpacts.length > 0 && (
                    <div className="pt-3 border-t border-[#F0EAE0] space-y-2">
                      <div className="text-xs font-semibold text-[#22201D]">
                        Optional add-ons
                      </div>
                      {calc.addOnImpacts.map((addon) => (
                        <label
                          key={addon.id}
                          className={`flex items-start justify-between gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                            addon.selected
                              ? 'bg-[#EAF5EE] border-[#B6D7C0]'
                              : 'bg-[#FAF8F4] border-[#E5DED2] hover:bg-white'
                          }`}
                        >
                          <div className="flex items-start gap-2.5 min-w-0">
                            <input
                              type="checkbox"
                              checked={addon.selected}
                              onChange={() =>
                                toggleVendorAddOn(
                                  vendor.id,
                                  activeQuote.id,
                                  addon.id
                                )
                              }
                              className="mt-0.5 accent-[#486755]"
                            />
                            <div className="min-w-0">
                              <div className="text-xs font-medium text-[#22201D]">
                                {addon.label}
                              </div>
                              <div className="text-[11px] text-[#6B655C]">
                                {addon.description}
                              </div>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-num text-xs font-semibold text-[#22201D]">
                              {addon.selected ? '-' : '+'}
                              {formatShortCad(addon.impactWithTax)}
                            </div>
                            <div className="text-[10px] text-[#6B655C]">
                              incl. HST
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}

                  {/* Brochure vs Personalized Comparison */}
                  {activeQuote.brochureReference && calc.brochureSavings && (
                    <div className="pt-3 border-t border-[#F0EAE0] flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-[#6B655C]">
                        Brochure ref:{' '}
                        <span className="font-num line-through">
                          {formatShortCad(calc.brochureSavings.brochurePreTax)}
                        </span>{' '}
                        + HST
                      </span>
                      {calc.brochureSavings.comparable &&
                        calc.brochureSavings.savingsWithTax > 0 && (
                          <span className="font-semibold text-[#234733]">
                            Saves {formatShortCad(calc.brochureSavings.savingsWithTax)}{' '}
                            incl. HST (not double-counted)
                          </span>
                        )}
                    </div>
                  )}
                </div>
              )}

              {/* COLLAPSED BY DEFAULT: Package Inclusions */}
              <div className="rounded-xl bg-white border border-[#E5DED2] overflow-hidden">
                <button
                  type="button"
                  aria-expanded={showInclusions}
                  onClick={() => setShowInclusions((v) => !v)}
                  className="w-full px-4 py-3 flex items-center justify-between text-xs font-semibold text-[#22201D] hover:bg-[#FAF8F4] cursor-pointer"
                >
                  <span>
                    Package inclusions & terms ({activeQuote.inclusions.length})
                  </span>
                  {showInclusions ? (
                    <ChevronDown className="w-4 h-4 text-[#6B655C]" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-[#6B655C]" />
                  )}
                </button>
                {showInclusions && (
                  <div className="px-4 pb-4 pt-1 border-t border-[#F0EAE0] space-y-3 text-xs text-[#6B655C]">
                    <ul className="list-disc pl-4 space-y-1">
                      {activeQuote.inclusions.map((inc, idx) => (
                        <li key={idx}>{inc}</li>
                      ))}
                    </ul>
                    <div>
                      <span className="font-semibold text-[#22201D]">
                        Payment terms:{' '}
                      </span>
                      {activeQuote.paymentTermsSummary}
                    </div>
                  </div>
                )}
              </div>

              {/* COLLAPSED BY DEFAULT: Source Evidence */}
              <div className="rounded-xl bg-white border border-[#E5DED2] overflow-hidden">
                <button
                  type="button"
                  aria-expanded={showEvidence}
                  onClick={() => setShowEvidence((v) => !v)}
                  className="w-full px-4 py-3 flex items-center justify-between text-xs font-semibold text-[#22201D] hover:bg-[#FAF8F4] cursor-pointer"
                >
                  <span>
                    Source evidence ({activeQuote.sourceChannel})
                  </span>
                  {showEvidence ? (
                    <ChevronDown className="w-4 h-4 text-[#6B655C]" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-[#6B655C]" />
                  )}
                </button>
                {showEvidence && (
                  <div className="px-4 pb-4 pt-2 border-t border-[#F0EAE0] space-y-2 text-xs">
                    <pre className="whitespace-pre-wrap font-sans bg-[#FAF8F4] border border-[#E5DED2] rounded-lg p-3 text-[#22201D] leading-relaxed">
                      {activeQuote.sourceText}
                    </pre>
                  </div>
                )}
              </div>

              {/* COLLAPSED BY DEFAULT: Revision History */}
              {activeQuote.revisions && activeQuote.revisions.length > 0 && (
                <div className="rounded-xl bg-white border border-[#E5DED2] overflow-hidden">
                  <button
                    type="button"
                    aria-expanded={showHistory}
                    onClick={() => setShowHistory((v) => !v)}
                    className="w-full px-4 py-3 flex items-center justify-between text-xs font-semibold text-[#22201D] hover:bg-[#FAF8F4] cursor-pointer"
                  >
                    <span>
                      Negotiation & revision history ({activeQuote.revisions.length})
                    </span>
                    {showHistory ? (
                      <ChevronDown className="w-4 h-4 text-[#6B655C]" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-[#6B655C]" />
                    )}
                  </button>
                  {showHistory && (
                    <div className="px-4 pb-4 pt-2 border-t border-[#F0EAE0] space-y-2 text-xs">
                      {activeQuote.revisions.map((rev) => (
                        <div
                          key={rev.id}
                          className="rounded-lg bg-[#FAF8F4] border border-[#E5DED2] p-3 space-y-1"
                        >
                          <div className="flex items-center justify-between font-medium text-[#22201D]">
                            <span>{rev.summary}</span>
                            <span className="text-[#6B655C]">{rev.date}</span>
                          </div>
                          <div className="font-num text-[11px] flex items-center gap-3">
                            <span className="text-[#6B655C] line-through">
                              {formatShortCad(rev.previousPreTaxTotal)}
                            </span>
                            <span className="text-[#234733] font-semibold">
                              {formatShortCad(rev.newPreTaxTotal)} pre-tax
                            </span>
                          </div>
                          <div className="text-[11px] text-[#234733]">{rev.note}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Contact & Couple Notes */}
          <div className="rounded-xl bg-white border border-[#E5DED2] p-4 space-y-3 text-xs">
            <div className="font-semibold text-[#22201D]">Contact & notes</div>
            {(vendor.contactName || vendor.contactEmail || vendor.contactPhone) && (
              <div className="flex flex-wrap gap-3 text-[#6B655C]">
                {vendor.contactName && <span>{vendor.contactName}</span>}
                {vendor.contactEmail && (
                  <span className="inline-flex items-center gap-1">
                    <Mail className="w-3.5 h-3.5" />
                    {vendor.contactEmail}
                  </span>
                )}
                {vendor.contactPhone && (
                  <span className="inline-flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5" />
                    {vendor.contactPhone}
                  </span>
                )}
              </div>
            )}
            <textarea
              rows={2}
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              onBlur={() => updateVendor(vendor.id, { notes: notesDraft })}
              placeholder="Couple notes..."
              className="w-full rounded-lg border border-[#E5DED2] bg-[#FAF8F4] p-2.5 text-xs text-[#22201D]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
