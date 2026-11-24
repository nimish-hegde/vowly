import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  FileUp,
  Info,
  Scale,
  Users,
} from 'lucide-react';
import {
  calculateVendorComparison,
  formatCurrency,
  formatShortCad,
} from '../engine/financialCalculator';
import { useWorkspace } from '../store/workspaceStore';
import { DemoDataNote, StatusText } from './DemoLabel';

interface VendorComparisonViewProps {
  initialEventId?: string;
  onOpenVendor: (vendorId: string) => void;
  onOpenQuoteImport: (presetId?: string, vendorId?: string) => void;
  onOpenBooking: (vendorId: string) => void;
}

export function VendorComparisonView({
  initialEventId,
  onOpenVendor,
  onOpenQuoteImport,
  onOpenBooking,
}: VendorComparisonViewProps) {
  const {
    activeWorkspace,
    setPreferredVendor,
    updateEventGuestCount,
    pushToast,
  } = useWorkspace();

  const comparableEvents = useMemo(() => {
    return activeWorkspace.events.filter((evt) => {
      const count = activeWorkspace.vendors.filter(
        (v) =>
          v.category === 'venue' &&
          v.eventIds.includes(evt.id) &&
          v.quotes.length > 0 &&
          v.status !== 'Declined'
      ).length;
      return count >= 2;
    });
  }, [activeWorkspace.events, activeWorkspace.vendors]);

  const [selectedEventId, setSelectedEventId] = useState<string>(
    initialEventId ??
      comparableEvents[0]?.id ??
      activeWorkspace.events[activeWorkspace.events.length - 1]?.id ??
      ''
  );

  React.useEffect(() => {
    if (initialEventId) setSelectedEventId(initialEventId);
  }, [initialEventId]);

  const selectedEvent = activeWorkspace.events.find(
    (e) => e.id === selectedEventId
  );

  const [hypotheticalGuests, setHypotheticalGuests] = useState<number>(
    selectedEvent?.guestCount ?? 200
  );
  const [guestText, setGuestText] = useState<string>(
    String(selectedEvent?.guestCount ?? 200)
  );
  const [showAiSummary, setShowAiSummary] = useState<boolean>(false);

  React.useEffect(() => {
    const base = selectedEvent?.guestCount ?? 200;
    setHypotheticalGuests(base);
    setGuestText(String(base));
    setShowAiSummary(false);
  }, [selectedEvent?.id]);

  // All non-declined venues linked to the selected event (both quoted and notes-only)
  const venuesInScope = useMemo(() => {
    return activeWorkspace.vendors.filter(
      (v) =>
        v.category === 'venue' &&
        v.status !== 'Declined' &&
        (!selectedEventId || v.eventIds.includes(selectedEventId))
    );
  }, [activeWorkspace.vendors, selectedEventId]);

  const comparison = useMemo(
    () =>
      calculateVendorComparison(
        venuesInScope,
        activeWorkspace.events,
        hypotheticalGuests
      ),
    [venuesInScope, activeWorkspace.events, hypotheticalGuests]
  );

  const guestsDifferFromSaved =
    selectedEvent && hypotheticalGuests !== selectedEvent.guestCount;

  const handleGuestTextChange = (raw: string) => {
    if (!/^\d*$/.test(raw)) return;
    setGuestText(raw);
    if (raw === '') return;
    const val = parseInt(raw, 10);
    if (!Number.isNaN(val) && val > 0) {
      setHypotheticalGuests(Math.min(2000, val));
    }
  };

  return (
    <div className="space-y-4">
      {/* Control Strip — Explicitly Labeled as Hypothetical Comparison */}
      <div className="rounded-2xl bg-[#EAF3FB] border border-[#B5D3EE] p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[#214869]">
            <Scale className="w-4 h-4" />
            <span>Hypothetical comparison (saved attendance unchanged)</span>
            {activeWorkspace.isDemoWorkspace && (
              <>
                <span aria-hidden="true">·</span>
                <DemoDataNote />
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <label htmlFor="compare-event-select" className="text-xs text-[#5A544C]">
              Event:
            </label>
            <select
              id="compare-event-select"
              value={selectedEventId}
              onChange={(e) => setSelectedEventId(e.target.value)}
              className="rounded-lg border border-[#B5D3EE] bg-white px-3 py-1.5 text-xs font-semibold text-[#22201D]"
            >
              {activeWorkspace.events.map((evt) => (
                <option key={evt.id} value={evt.id}>
                  {evt.name} (saved: {evt.guestCount ?? 'TBD'})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Hypothetical Guest Count Control */}
        <div className="rounded-xl bg-white border border-[#B5D3EE] px-4 py-2.5 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Users className="w-4 h-4 text-[#214869]" />
            <span className="text-xs font-medium text-[#22201D]">
              Test count:
            </span>
          </div>

          <input
            type="range"
            min={80}
            max={500}
            step={10}
            value={Math.min(500, Math.max(80, hypotheticalGuests))}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              setHypotheticalGuests(v);
              setGuestText(String(v));
            }}
            className="w-24 sm:w-32 accent-[#486755] cursor-pointer"
            aria-label="Hypothetical comparison guest count slider"
          />
          <input
            type="text"
            inputMode="numeric"
            value={guestText}
            onChange={(e) => handleGuestTextChange(e.target.value)}
            onBlur={() => setGuestText(String(hypotheticalGuests))}
            className="w-16 rounded-lg border border-[#E5DED2] px-2 py-1 text-center font-num text-sm font-semibold text-[#22201D]"
            aria-label="Hypothetical comparison guest count"
          />

          {guestsDifferFromSaved && selectedEvent && (
            <button
              type="button"
              onClick={() => {
                updateEventGuestCount(selectedEvent.id, hypotheticalGuests);
                pushToast(
                  `Saved ${hypotheticalGuests} guests to ${selectedEvent.name}`
                );
              }}
              className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-[#DFEFE4] text-[#234733] hover:bg-[#D1E7D8] whitespace-nowrap cursor-pointer"
            >
              Save to event
            </button>
          )}
        </div>
      </div>

      {/* Hide AI comparison suggestions completely when fewer than 2 comparable quotes exist */}
      {comparison.hasComparableQuotes && comparison.aiTradeoffSummary && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl bg-[#F2ECFA] border border-[#CBBCE8] px-4 py-3.5">
          <div className="flex items-start gap-2.5 text-xs text-[#22201D] leading-relaxed">
            <Info className="w-4 h-4 text-[#42306B] mt-0.5 shrink-0" />
            <div>
              {showAiSummary ? (
                <>
                  <span className="font-semibold text-[#42306B]">
                    AI tradeoff ({hypotheticalGuests} guests):{' '}
                  </span>
                  {comparison.aiTradeoffSummary}
                </>
              ) : (
                <>
                  <span className="font-semibold text-[#42306B]">
                    Key difference:{' '}
                  </span>
                  {comparison.breakEvenNote ??
                    'Compare all-in costs, minimums, capacity, and unconfirmed fees below.'}
                </>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowAiSummary((v) => !v)}
            className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-white border border-[#CBBCE8] text-[#42306B] hover:bg-[#EAE2F7] whitespace-nowrap shrink-0 cursor-pointer"
          >
            {showAiSummary ? 'Hide AI suggestion' : 'AI suggestion'}
          </button>
        </div>
      )}

      {/* Priced Comparison Matrix */}
      {comparison.entries.length === 0 ? (
        <div className="rounded-2xl bg-white border border-[#E5DED2] p-8 text-center">
          <p className="text-sm font-medium text-[#22201D]">
            No priced venue quotes for {selectedEvent?.name ?? 'this event'} yet
          </p>
          <p className="mt-1 text-xs text-[#6B655C]">
            Import at least two venue quotes to compare pricing side-by-side.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl bg-white border border-[#E5DED2] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[740px]">
              <thead>
                <tr className="border-b border-[#E5DED2]">
                  <th className="py-3.5 px-4 w-44 bg-[#F6F2EA] text-xs font-semibold text-[#6B655C] align-bottom">
                    Criteria
                  </th>
                  {comparison.entries.map(({ vendor, calc }) => (
                    <th
                      key={vendor.id}
                      className={`py-3.5 px-4 align-top min-w-[210px] border-l border-[#F0EAE0] ${
                        vendor.isPreferred ? 'bg-[#EAF5EE]' : 'bg-white'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
                        <StatusText status={vendor.status} />
                        {vendor.isPreferred && (
                          <span className="font-semibold text-[#234733]">
                            Preferred
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenVendor(vendor.id)}
                        className="mt-1 text-left text-sm font-semibold text-[#22201D] hover:text-[#486755] cursor-pointer block"
                      >
                        {vendor.name}
                      </button>
                      <div className="mt-0.5 text-[11px] font-normal text-[#6B655C]">
                        {vendor.location}
                        {vendor.isDemoVenue && ' · Illustrative demo data'}
                      </div>
                      {calc.capacityExceeded && (
                        <div className="mt-1.5 text-[11px] font-semibold text-[#991B1B]">
                          Over capacity at {hypotheticalGuests}
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-[#F0EAE0] text-xs">
                <tr>
                  <td className="py-3 px-4 font-semibold text-[#22201D] bg-[#F6F2EA]/70">
                    All-in estimate
                    <div className="text-[11px] font-normal text-[#6B655C]">
                      At {hypotheticalGuests} guests
                    </div>
                  </td>
                  {comparison.entries.map(
                    ({ vendor, calc, unconfirmedMandatoryLabels }) => (
                      <td
                        key={vendor.id}
                        className="py-3 px-4 border-l border-[#F0EAE0]"
                      >
                        <div className="font-num text-base font-semibold text-[#22201D]">
                          {formatCurrency(
                            calc.estimatedAllInTotal,
                            calc.currencyLabel
                          )}
                        </div>
                        <div className="text-[11px] text-[#6B655C]">
                          Pre-tax {formatShortCad(calc.preTaxTotal)} · HST{' '}
                          {formatShortCad(calc.taxAmount)}
                        </div>
                        {unconfirmedMandatoryLabels.length > 0 && (
                          <div className="mt-1 text-[11px] font-medium text-[#9A4A06] inline-flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            Excludes unconfirmed fee
                          </div>
                        )}
                      </td>
                    )
                  )}
                </tr>

                <tr>
                  <td className="py-2.5 px-4 font-medium text-[#6B655C] bg-[#F6F2EA]/40">
                    Per-person rate
                  </td>
                  {comparison.entries.map(({ vendor, perPersonRate, calc }) => (
                    <td
                      key={vendor.id}
                      className="py-2.5 px-4 border-l border-[#F0EAE0] text-[#22201D]"
                    >
                      {perPersonRate !== null ? (
                        <span className="font-num">
                          <strong>${perPersonRate}/pp</strong> ×{' '}
                          {calc.effectiveGuestCountUsed ?? hypotheticalGuests}
                        </span>
                      ) : (
                        'Fixed package'
                      )}
                    </td>
                  ))}
                </tr>

                <tr>
                  <td className="py-2.5 px-4 font-medium text-[#6B655C] bg-[#F6F2EA]/40">
                    Minimum guests
                  </td>
                  {comparison.entries.map(({ vendor, quote, calc }) => (
                    <td
                      key={vendor.id}
                      className="py-2.5 px-4 border-l border-[#F0EAE0]"
                    >
                      <span className="font-num text-[#22201D]">
                        {quote.minGuests ? `${quote.minGuests} min` : 'None'}
                      </span>
                      {calc.minGuestsApplied && quote.minGuests && (
                        <div className="text-[11px] font-medium text-[#9A4A06]">
                          {quote.minGuests}-guest minimum applies
                        </div>
                      )}
                    </td>
                  ))}
                </tr>

                <tr>
                  <td className="py-2.5 px-4 font-medium text-[#6B655C] bg-[#F6F2EA]/40">
                    Max capacity
                  </td>
                  {comparison.entries.map(({ vendor, quote, calc }) => (
                    <td
                      key={vendor.id}
                      className="py-2.5 px-4 border-l border-[#F0EAE0]"
                    >
                      <span
                        className={`font-num ${
                          calc.capacityExceeded
                            ? 'text-[#991B1B] font-semibold'
                            : 'text-[#22201D]'
                        }`}
                      >
                        {quote.maxCapacity ?? 'Unspecified'}
                      </span>
                    </td>
                  ))}
                </tr>

                <tr>
                  <td className="py-2.5 px-4 font-medium text-[#6B655C] bg-[#F6F2EA]/40">
                    AV & staffing fees
                  </td>
                  {comparison.entries.map(({ vendor, quote, flatFeesPreTax }) => (
                    <td
                      key={vendor.id}
                      className="py-2.5 px-4 border-l border-[#F0EAE0] text-[#22201D]"
                    >
                      <div className="font-num font-medium">
                        {flatFeesPreTax > 0 ? formatShortCad(flatFeesPreTax) : '$0'}
                      </div>
                      <div className="text-[11px] text-[#6B655C]">
                        {quote.avAndStaffingSummary ?? 'See quote'}
                      </div>
                    </td>
                  ))}
                </tr>

                <tr>
                  <td className="py-2.5 px-4 font-medium text-[#6B655C] bg-[#F6F2EA]/40">
                    Unconfirmed fees
                  </td>
                  {comparison.entries.map(
                    ({ vendor, unconfirmedMandatoryLabels }) => (
                      <td
                        key={vendor.id}
                        className="py-2.5 px-4 border-l border-[#F0EAE0]"
                      >
                        {unconfirmedMandatoryLabels.length > 0 ? (
                          <span className="text-[#9A4A06] font-medium">
                            {unconfirmedMandatoryLabels.join(', ')} (TBD)
                          </span>
                        ) : (
                          <span className="text-[#234733]">None known</span>
                        )}
                      </td>
                    )
                  )}
                </tr>

                <tr className="bg-[#FAF8F4]">
                  <td className="py-3.5 px-4 font-medium text-[#6B655C] bg-[#F6F2EA]/70">
                    Action
                  </td>
                  {comparison.entries.map(({ vendor, calc }) => (
                    <td
                      key={vendor.id}
                      className="py-3.5 px-4 border-l border-[#F0EAE0]"
                    >
                      {vendor.status === 'Booked' ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-[#234733]">
                          <Check className="w-3.5 h-3.5" />
                          Booked
                        </span>
                      ) : vendor.isPreferred ? (
                        <button
                          type="button"
                          onClick={() => onOpenBooking(vendor.id)}
                          className="w-full py-2 px-3 rounded-xl bg-[#486755] text-white font-semibold hover:bg-[#395344] cursor-pointer"
                        >
                          Confirm booking
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={calc.capacityExceeded}
                          onClick={() => setPreferredVendor(vendor.id)}
                          className={`w-full py-2 px-3 rounded-xl font-medium ${
                            calc.capacityExceeded
                              ? 'bg-[#F3EFE8] text-[#9A9388] cursor-not-allowed'
                              : 'bg-white border border-[#B6D7C0] text-[#234733] hover:bg-[#DFEFE4] cursor-pointer'
                          }`}
                        >
                          {calc.capacityExceeded
                            ? 'Over capacity'
                            : 'Select preferred'}
                        </button>
                      )}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Unquoted / Notes-Only Vendors Kept Out of Priced Comparisons */}
      {comparison.unquotedVendors.length > 0 && (
        <div className="rounded-2xl bg-white border border-[#E5DED2] p-4 space-y-2.5">
          <div className="text-xs font-semibold text-[#6B655C]">
            Not in priced comparison (no quote yet)
          </div>
          <div className="divide-y divide-[#F0EAE0]">
            {comparison.unquotedVendors.map((v) => (
              <div
                key={v.id}
                className="py-2.5 first:pt-1 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="text-[#22201D] font-medium">
                  {v.name} has no quote yet
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => onOpenQuoteImport(undefined, v.id)}
                    className="inline-flex items-center gap-1 font-semibold text-[#486755] hover:underline cursor-pointer"
                  >
                    <FileUp className="w-3.5 h-3.5" />
                    Add quote
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenVendor(v.id)}
                    className="font-medium text-[#6B655C] hover:text-[#22201D] cursor-pointer"
                  >
                    View vendor
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
