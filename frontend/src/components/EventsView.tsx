import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Clock,
  Edit3,
  FileUp,
  Layers,
  MapPin,
  Plus,
  Trash2,
  Users,
} from 'lucide-react';
import {
  calculateQuoteFinancials,
  CATEGORY_META,
  explainEventGuestCountImpact,
  formatCurrency,
  formatShortCad,
  formatSignedCad,
  getVendorActiveQuote,
} from '../engine/financialCalculator';
import { useWorkspace } from '../store/workspaceStore';
import { WeddingEvent } from '../types/vowly';
import { PASTEL_TONES } from '../utils/pastelStyles';
import { DemoDataNote, StatusText } from './DemoLabel';

interface EventsViewProps {
  onCreateEvent: () => void;
  onEditEvent: (event: WeddingEvent) => void;
  onAddVendorForEvent: (eventId: string) => void;
  onOpenVendor: (vendorId: string) => void;
  onOpenQuoteImport: (presetId?: string, vendorId?: string) => void;
  onOpenComparison: (eventId: string) => void;
}

export function EventsView({
  onCreateEvent,
  onEditEvent,
  onAddVendorForEvent,
  onOpenVendor,
  onOpenQuoteImport,
  onOpenComparison,
}: EventsViewProps) {
  const {
    activeWorkspace,
    financials,
    selectedEventId,
    setSelectedEventId,
    updateEventGuestCount,
    deleteEvent,
  } = useWorkspace();

  const currentEvent = useMemo(() => {
    if (selectedEventId) {
      const match = activeWorkspace.events.find((e) => e.id === selectedEventId);
      if (match) return match;
    }
    return activeWorkspace.events[0] ?? null;
  }, [activeWorkspace.events, selectedEventId]);

  // Preserve incomplete numeric text while typing without snapping mid-keystroke
  const [guestText, setGuestText] = useState<string>(
    currentEvent?.guestCount !== null && currentEvent?.guestCount !== undefined
      ? String(currentEvent.guestCount)
      : ''
  );
  // Baseline guest count when landing on this event so user sees exact signed CAD delta
  const baselineGuestsRef = useRef<number | null>(
    currentEvent?.guestCount ?? null
  );
  const [flashKey, setFlashKey] = useState(0);

  useEffect(() => {
    if (!currentEvent) return;
    baselineGuestsRef.current = currentEvent.guestCount;
    setGuestText(
      currentEvent.guestCount !== null ? String(currentEvent.guestCount) : ''
    );
  }, [currentEvent?.id]);

  // Keep text synced if changed externally (e.g., via Comparison "Apply to event")
  useEffect(() => {
    if (!currentEvent) return;
    const currentParsed = guestText.trim() === '' ? null : parseInt(guestText, 10);
    if (currentParsed !== currentEvent.guestCount) {
      setGuestText(
        currentEvent.guestCount !== null ? String(currentEvent.guestCount) : ''
      );
    }
  }, [currentEvent?.guestCount]);

  const guestImpact = useMemo(() => {
    if (!currentEvent) return null;
    return explainEventGuestCountImpact(
      activeWorkspace,
      currentEvent.id,
      baselineGuestsRef.current,
      currentEvent.guestCount
    );
  }, [activeWorkspace, currentEvent]);

  const eventVendors = useMemo(() => {
    if (!currentEvent) return [];
    return activeWorkspace.vendors.filter(
      (v) => !v.archived && v.eventIds.includes(currentEvent.id) && v.status !== 'Declined'
    );
  }, [activeWorkspace.vendors, currentEvent]);

  const eventManualExpenses = useMemo(() => {
    if (!currentEvent) return [];
    return activeWorkspace.manualExpenses.filter((m) =>
      m.eventIds.includes(currentEvent.id)
    );
  }, [activeWorkspace.manualExpenses, currentEvent]);

  const singleEventVendors = eventVendors.filter((v) => v.eventIds.length === 1);
  const sharedVendors = eventVendors.filter((v) => v.eventIds.length > 1);

  const comparableVenueCount = singleEventVendors.filter(
    (v) => v.category === 'venue' && v.quotes.length > 0
  ).length;

  const handleGuestTextChange = (raw: string) => {
    // Allow empty string or digits only while typing
    if (!/^\d*$/.test(raw)) return;
    setGuestText(raw);
    if (!currentEvent) return;
    if (raw === '') return; // preserve incomplete input while typing
    const parsed = parseInt(raw, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      updateEventGuestCount(currentEvent.id, parsed);
      setFlashKey((k) => k + 1);
    }
  };

  const handleGuestBlur = () => {
    if (!currentEvent) return;
    if (guestText.trim() === '') {
      updateEventGuestCount(currentEvent.id, null);
      return;
    }
    const parsed = parseInt(guestText, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      setGuestText(
        currentEvent.guestCount !== null ? String(currentEvent.guestCount) : ''
      );
      return;
    }
    const clamped = Math.max(1, Math.min(2000, parsed));
    setGuestText(String(clamped));
    updateEventGuestCount(currentEvent.id, clamped);
  };

  const handleStepGuests = (delta: number) => {
    if (!currentEvent) return;
    const base = currentEvent.guestCount ?? 100;
    const next = Math.max(1, Math.min(2000, base + delta));
    setGuestText(String(next));
    updateEventGuestCount(currentEvent.id, next);
    setFlashKey((k) => k + 1);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#22201D]">
            Events
          </h1>
          <p className="mt-1 text-xs text-[#6B655C]">
            Saved event counts update per-guest and table-ratio estimates immediately.
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateEvent}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl bg-[#486755] text-white hover:bg-[#395344] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Add event
        </button>
      </div>

      {activeWorkspace.events.length === 0 ? (
        <div className="rounded-2xl bg-white border border-[#E5DED2] p-10 text-center">
          <p className="text-base font-medium text-[#22201D]">No events yet</p>
          <button
            type="button"
            onClick={onCreateEvent}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-[#486755] text-white hover:bg-[#395344] cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Create first event
          </button>
        </div>
      ) : (
        <>
          {/* Consistent Pastel Event Cards Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {activeWorkspace.events.map((evt) => {
              const isSelected = currentEvent?.id === evt.id;
              const tone = PASTEL_TONES[evt.tone] ?? PASTEL_TONES.sage;
              const sum = financials.eventSummaries[evt.id];
              return (
                <button
                  key={evt.id}
                  type="button"
                  onClick={() => setSelectedEventId(evt.id)}
                  className={`text-left rounded-2xl border p-4 transition-all cursor-pointer ${
                    isSelected
                      ? `${tone.surfaceBg} ${tone.border} ring-2 ring-[#486755]/40`
                      : `${tone.softTint} ${tone.border} hover:${tone.surfaceBg}`
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className={`font-semibold ${tone.ink}`}>
                      {evt.dateDisplay}
                    </span>
                    <StatusText status={evt.status} />
                  </div>
                  <div className="mt-1 font-semibold text-[#22201D] truncate">
                    {evt.name}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-[#5A544C]">
                    <span className="font-num">
                      {evt.guestCount !== null ? `${evt.guestCount} guests` : 'Guests TBD'}
                    </span>
                    <span className="font-num font-semibold text-[#22201D]">
                      {sum && sum.directProjected > 0
                        ? formatShortCad(sum.directProjected)
                        : 'TBD'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Active Event Workspace */}
          {currentEvent && (
            <div className="rounded-2xl bg-white border border-[#E5DED2] overflow-hidden">
              {/* Pastel Top Band */}
              <div
                className={`${
                  (PASTEL_TONES[currentEvent.tone] ?? PASTEL_TONES.sage).surfaceBg
                } border-b ${
                  (PASTEL_TONES[currentEvent.tone] ?? PASTEL_TONES.sage).border
                } p-5 sm:p-6`}
              >
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#5A544C]">
                      <StatusText status={currentEvent.status} />
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        {currentEvent.dateDisplay}
                      </span>
                      {currentEvent.time && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            {currentEvent.time}
                          </span>
                        </>
                      )}
                    </div>

                    <h2 className="mt-1.5 font-editorial text-2xl sm:text-3xl font-medium text-[#22201D]">
                      {currentEvent.name}
                    </h2>

                    <div className="mt-1 flex items-center gap-1.5 text-xs text-[#5A544C]">
                      <MapPin className="w-3.5 h-3.5 shrink-0" />
                      <span>{currentEvent.location || 'Location TBD'}</span>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onEditEvent(currentEvent)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[#E5DED2] bg-white text-[#22201D] hover:bg-[#FAF8F4] cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        Edit event
                      </button>
                      <button
                        type="button"
                        onClick={() => onAddVendorForEvent(currentEvent.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[#B6D7C0] bg-white text-[#234733] hover:bg-[#EAF5EE] cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add vendor
                      </button>
                      {comparableVenueCount >= 2 && (
                        <button
                          type="button"
                          onClick={() => onOpenComparison(currentEvent.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[#CBBCE8] bg-white text-[#42306B] hover:bg-[#F2ECFA] cursor-pointer"
                        >
                          Compare {comparableVenueCount} venues
                        </button>
                      )}
                      {activeWorkspace.events.length > 1 && (
                        <button
                          type="button"
                          onClick={() => deleteEvent(currentEvent.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg text-[#991B1B] hover:bg-white/70 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Remove
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Unified Saved Guest Count + Resulting Estimate + Signed CAD Difference */}
                  <div className="rounded-xl bg-white border border-[#E5DED2] p-4 w-full lg:w-[340px] shrink-0 space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[#22201D] inline-flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-[#486755]" />
                        Saved attendance
                      </span>
                      <span className="text-[11px] text-[#6B655C]">
                        Saves to workspace
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleStepGuests(-10)}
                        className="w-10 h-9 rounded-lg border border-[#E5DED2] bg-[#FAF8F4] text-xs font-semibold text-[#22201D] hover:bg-[#EFEBE2] cursor-pointer"
                        aria-label="Decrease guests by 10"
                      >
                        -10
                      </button>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={guestText}
                        onChange={(e) => handleGuestTextChange(e.target.value)}
                        onBlur={handleGuestBlur}
                        placeholder="TBD"
                        className="flex-1 h-9 rounded-lg border border-[#E5DED2] bg-white px-3 text-center font-num text-base font-semibold text-[#22201D]"
                        aria-label="Saved event guest count"
                      />
                      <button
                        type="button"
                        onClick={() => handleStepGuests(10)}
                        className="w-10 h-9 rounded-lg border border-[#E5DED2] bg-[#FAF8F4] text-xs font-semibold text-[#22201D] hover:bg-[#EFEBE2] cursor-pointer"
                        aria-label="Increase guests by 10"
                      >
                        +10
                      </button>
                    </div>

                    {/* Resulting Estimate & Signed CAD Delta right alongside */}
                    {guestImpact && (
                      <div className="pt-2.5 border-t border-[#F0EAE0] flex items-baseline justify-between gap-2">
                        <div>
                          <div className="text-[11px] text-[#6B655C]">
                            Event estimate
                          </div>
                          <div
                            key={flashKey}
                            className="font-num text-lg font-semibold text-[#22201D] amount-changed-flash px-1 -ml-1"
                          >
                            {guestImpact.currentEventTotal > 0
                              ? formatCurrency(
                                  guestImpact.currentEventTotal,
                                  activeWorkspace.currency
                                )
                              : 'Unpriced / TBD'}
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-[11px] text-[#6B655C]">
                            Change
                          </div>
                          <div
                            className={`font-num text-sm font-semibold ${
                              guestImpact.signedDelta > 0
                                ? 'text-[#9A4A06]'
                                : guestImpact.signedDelta < 0
                                  ? 'text-[#234733]'
                                  : 'text-[#6B655C]'
                            }`}
                          >
                            {formatSignedCad(guestImpact.signedDelta)} CAD
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Explicit deterministic reason whenever total is unchanged */}
                    {guestImpact?.unchangedReason && (
                      <div className="text-[11px] font-medium text-[#5A544C] bg-[#FAF8F4] border border-[#E5DED2] rounded-lg px-2.5 py-1.5">
                        {guestImpact.unchangedReason}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Event Content Body */}
              <div className="p-5 sm:p-6 space-y-6">
                {/* 1. Event-Specific Vendors (including notes-only vendors) */}
                <div>
                  <div className="flex items-center justify-between gap-4 mb-3">
                    <h3 className="text-sm font-semibold text-[#22201D]">
                      Event vendors
                    </h3>
                    <button
                      type="button"
                      onClick={() => onOpenQuoteImport()}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-[#486755] hover:underline cursor-pointer"
                    >
                      <FileUp className="w-3.5 h-3.5" />
                      Import quote
                    </button>
                  </div>

                  {singleEventVendors.length === 0 ? (
                    <p className="text-xs text-[#6B655C] py-2">
                      No event-specific vendors yet.
                    </p>
                  ) : (
                    <div className="divide-y divide-[#F0EAE0] border border-[#E5DED2] rounded-xl overflow-hidden bg-white">
                      {singleEventVendors.map((vendor) => {
                        const quote = getVendorActiveQuote(vendor);
                        const calc = quote
                          ? calculateQuoteFinancials(
                              quote,
                              activeWorkspace.events,
                              vendor.eventIds
                            )
                          : null;
                        const hasQuote = Boolean(quote) || vendor.status === 'Booked';
                        const includedInTotal =
                          vendor.status === 'Booked' || vendor.isPreferred;

                        return (
                          <div
                            key={vendor.id}
                            className="p-4 hover:bg-[#FAF8F4] transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => onOpenVendor(vendor.id)}
                                  className="font-semibold text-sm text-[#22201D] hover:text-[#486755] text-left cursor-pointer"
                                >
                                  {vendor.name}
                                </button>
                                <span className="text-xs text-[#6B655C]">
                                  · {CATEGORY_META[vendor.category].label}
                                </span>
                                <span className="text-xs text-[#6B655C]">·</span>
                                <StatusText
                                  status={hasQuote ? vendor.status : 'No quote'}
                                />
                                {vendor.isDemoVenue && (
                                  <>
                                    <span className="text-xs text-[#6B655C]">·</span>
                                    <DemoDataNote compact />
                                  </>
                                )}
                              </div>

                              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[#6B655C]">
                                {!hasQuote ? (
                                  <span>
                                    {vendor.name} has no quote yet
                                  </span>
                                ) : includedInTotal ? (
                                  <span className="text-[#234733] font-medium">
                                    {vendor.status === 'Booked'
                                      ? 'Booked (Committed)'
                                      : 'Selected estimate'}
                                  </span>
                                ) : (
                                  <span>Competing option (excluded from total)</span>
                                )}
                                {calc?.minGuestsApplied && calc.appliedMinGuests && (
                                  <span className="text-[#9A4A06]">
                                    · {calc.appliedMinGuests}-guest minimum applies
                                  </span>
                                )}
                                {calc?.capacityExceeded && quote?.maxCapacity && (
                                  <span className="text-[#991B1B] font-medium">
                                    · Exceeds {quote.maxCapacity} max capacity
                                  </span>
                                )}
                                {(calc?.unresolvedMandatoryFeesCount ?? 0) > 0 && (
                                  <span className="text-[#9A4A06] font-medium inline-flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3" />
                                    Unconfirmed fee
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                              {!hasQuote ? (
                                <div className="flex items-center gap-3 text-xs">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onOpenQuoteImport(undefined, vendor.id)
                                    }
                                    className="font-semibold text-[#486755] hover:underline cursor-pointer"
                                  >
                                    Add quote
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onOpenVendor(vendor.id)}
                                    className="font-medium text-[#6B655C] hover:text-[#22201D] cursor-pointer"
                                  >
                                    View vendor
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => onOpenVendor(vendor.id)}
                                  className="text-right cursor-pointer"
                                >
                                  <div className="font-num text-sm font-semibold text-[#22201D]">
                                    {vendor.status === 'Booked' &&
                                    vendor.bookedContractTotal
                                      ? formatCurrency(
                                          vendor.bookedContractTotal,
                                          activeWorkspace.currency
                                        )
                                      : calc
                                        ? formatCurrency(
                                            calc.estimatedAllInTotal,
                                            calc.currencyLabel
                                          )
                                        : 'No quote'}
                                  </div>
                                  <div className="text-[11px] text-[#6B655C]">
                                    View drawer →
                                  </div>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 2. Shared Multi-Event Packages (counted once) */}
                {sharedVendors.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2.5">
                      <Layers className="w-4 h-4 text-[#42306B]" />
                      <h3 className="text-sm font-semibold text-[#22201D]">
                        Shared packages (counted once in wedding total)
                      </h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {sharedVendors.map((vendor) => {
                        const quote = getVendorActiveQuote(vendor);
                        const calc = quote
                          ? calculateQuoteFinancials(
                              quote,
                              activeWorkspace.events,
                              vendor.eventIds
                            )
                          : null;
                        return (
                          <button
                            key={vendor.id}
                            type="button"
                            onClick={() => onOpenVendor(vendor.id)}
                            className="text-left rounded-xl border border-[#E5DED2] bg-[#FAF8F4] hover:bg-white p-3.5 transition-colors cursor-pointer flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <div className="font-semibold text-sm text-[#22201D] truncate">
                                {vendor.name}
                              </div>
                              <div className="text-xs text-[#6B655C]">
                                {CATEGORY_META[vendor.category].label} ·{' '}
                                {vendor.eventIds.length} events
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-num text-sm font-semibold text-[#22201D]">
                                {calc
                                  ? formatShortCad(calc.estimatedAllInTotal)
                                  : 'No quote'}
                              </div>
                              <div className="text-[11px] text-[#6B655C]">
                                Counted 1x
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 3. Direct Allowances */}
                {eventManualExpenses.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-[#22201D] mb-2.5">
                      Couple allowances
                    </h3>
                    <div className="divide-y divide-[#F0EAE0] border border-[#E5DED2] rounded-xl overflow-hidden bg-white">
                      {eventManualExpenses.map((exp) => (
                        <div
                          key={exp.id}
                          className="p-3.5 flex items-center justify-between gap-4"
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-[#22201D] truncate">
                              {exp.name}
                            </div>
                            <div className="text-xs text-[#6B655C]">
                              {exp.priceSource}
                            </div>
                          </div>
                          <div className="font-num text-sm font-semibold text-[#22201D] shrink-0">
                            {exp.estimatedAmount !== null
                              ? formatCurrency(
                                  exp.estimatedAmount,
                                  activeWorkspace.currency
                                )
                              : 'Unpriced'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
