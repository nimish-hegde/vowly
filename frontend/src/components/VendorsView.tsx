import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  Check,
  FileUp,
  Layers,
  Plus,
  Scale,
  Search,
} from 'lucide-react';
import {
  calculateQuoteFinancials,
  CATEGORY_META,
  formatCurrency,
  formatShortCad,
  getVendorActiveQuote,
  getVendorBookingEligibility,
} from '../engine/financialCalculator';
import { useWorkspace } from '../store/workspaceStore';
import { VendorCategory, VendorStatus } from '../types/vowly';
import { PASTEL_TONES } from '../utils/pastelStyles';
import { DemoDataNote, StatusText } from './DemoLabel';
import { VendorComparisonView } from './VendorComparisonView';

interface VendorsViewProps {
  initialMode?: 'directory' | 'compare';
  initialCompareEventId?: string;
  onAddVendor: () => void;
  onOpenVendor: (vendorId: string) => void;
  onOpenQuoteImport: (presetId?: string, vendorId?: string) => void;
  onOpenBooking: (vendorId: string) => void;
  onEditApprovedQuote: (vendorId: string) => void;
}

const ALL_STATUSES: VendorStatus[] = [
  'Booked',
  'Quoted',
  'Revision pending',
  'Shortlisted',
  'Researching',
  'Declined',
];

export function VendorsView({
  initialMode = 'directory',
  initialCompareEventId,
  onAddVendor,
  onOpenVendor,
  onOpenQuoteImport,
  onOpenBooking,
  onEditApprovedQuote,
}: VendorsViewProps) {
  const { activeWorkspace, setPreferredVendor } = useWorkspace();

  const [mode, setMode] = useState<'directory' | 'compare'>(initialMode);
  const [categoryFilter, setCategoryFilter] = useState<VendorCategory | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<VendorStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'price_asc' | 'price_desc' | 'status'>('price_desc');

  React.useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  const enrichedVendors = useMemo(() => {
    return activeWorkspace.vendors.map((vendor) => {
      const activeQuote = getVendorActiveQuote(vendor);
      const calc = activeQuote
        ? calculateQuoteFinancials(activeQuote, activeWorkspace.events, vendor.eventIds)
        : null;
      const hasQuote = Boolean(activeQuote) || vendor.status === 'Booked';
      const effectivePrice =
        vendor.status === 'Booked' && vendor.bookedContractTotal !== undefined
          ? vendor.bookedContractTotal
          : calc && !(calc.guestCountMissing && calc.estimatedAllInTotal === 0)
            ? calc.estimatedAllInTotal
            : null;
      return { vendor, activeQuote, calc, hasQuote, effectivePrice };
    });
  }, [activeWorkspace.vendors, activeWorkspace.events]);

  const filteredVendors = useMemo(() => {
    return enrichedVendors
      .filter(({ vendor }) => {
        if (categoryFilter !== 'all' && vendor.category !== categoryFilter) return false;
        if (statusFilter !== 'all' && vendor.status !== statusFilter) return false;
        if (search.trim()) {
          const q = search.toLowerCase();
          if (
            !vendor.name.toLowerCase().includes(q) &&
            !vendor.location.toLowerCase().includes(q) &&
            !CATEGORY_META[vendor.category].label.toLowerCase().includes(q)
          ) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'name') return a.vendor.name.localeCompare(b.vendor.name);
        if (sortBy === 'status') return a.vendor.status.localeCompare(b.vendor.status);
        if (sortBy === 'price_asc') {
          return (
            (a.effectivePrice ?? Number.MAX_SAFE_INTEGER) -
            (b.effectivePrice ?? Number.MAX_SAFE_INTEGER)
          );
        }
        return (b.effectivePrice ?? -1) - (a.effectivePrice ?? -1);
      });
  }, [enrichedVendors, categoryFilter, statusFilter, search, sortBy]);

  return (
    <div className="space-y-5">
      {/* Header + Mode Switch */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#22201D]">
            Vendors
          </h1>
          <p className="mt-0.5 text-xs text-[#6B655C]">
            Select one preferred estimate per category · Competing quotes never sum together
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="inline-flex items-center p-1 rounded-xl bg-[#F3EFE8] border border-[#E5DED2]">
            <button
              type="button"
              onClick={() => setMode('directory')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                mode === 'directory'
                  ? 'bg-white text-[#22201D] shadow-2xs'
                  : 'text-[#6B655C] hover:text-[#22201D]'
              }`}
            >
              All vendors ({activeWorkspace.vendors.length})
            </button>
            <button
              type="button"
              onClick={() => setMode('compare')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                mode === 'compare'
                  ? 'bg-[#EAE2F7] text-[#42306B] shadow-2xs'
                  : 'text-[#6B655C] hover:text-[#22201D]'
              }`}
            >
              <Scale className="w-3.5 h-3.5" />
              Compare
            </button>
          </div>

          <button
            type="button"
            onClick={() => onOpenQuoteImport()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl border border-[#B6D7C0] bg-[#DFEFE4] text-[#234733] hover:bg-[#D1E7D8] transition-colors whitespace-nowrap cursor-pointer"
          >
            <FileUp className="w-3.5 h-3.5" />
            Import quote
          </button>

          <button
            type="button"
            onClick={onAddVendor}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-xl bg-[#486755] text-white hover:bg-[#395344] transition-colors whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Add vendor
          </button>
        </div>
      </div>

      {mode === 'compare' ? (
        <VendorComparisonView
          initialEventId={initialCompareEventId}
          initialCategory={categoryFilter === 'all' ? undefined : categoryFilter}
          onOpenVendor={onOpenVendor}
          onOpenQuoteImport={onOpenQuoteImport}
          onEditQuote={onEditApprovedQuote}
        />
      ) : (
        <>
          {/* Filter Bar */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#6B655C] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search vendors..."
                  className="pl-8 pr-3 py-2 text-xs rounded-xl border border-[#E5DED2] bg-white text-[#22201D] placeholder:text-[#9A9388] w-48"
                />
              </div>

              <select
                value={categoryFilter}
                onChange={(e) =>
                  setCategoryFilter(e.target.value as VendorCategory | 'all')
                }
                aria-label="Filter by category"
                className="px-3 py-2 text-xs rounded-xl border border-[#E5DED2] bg-white text-[#22201D]"
              >
                <option value="all">All categories</option>
                {(Object.keys(CATEGORY_META) as VendorCategory[]).map((cat) => (
                  <option key={cat} value={cat}>
                    {CATEGORY_META[cat].label}
                  </option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as VendorStatus | 'all')
                }
                aria-label="Filter by status"
                className="px-3 py-2 text-xs rounded-xl border border-[#E5DED2] bg-white text-[#22201D]"
              >
                <option value="all">All statuses</option>
                {ALL_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 text-xs text-[#6B655C]">
              <ArrowUpDown className="w-3.5 h-3.5" />
              <select
                aria-label="Sort vendors"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-[#E5DED2] bg-white text-[#22201D]"
              >
                <option value="price_desc">Estimate: High to Low</option>
                <option value="price_asc">Estimate: Low to High</option>
                <option value="name">Name (A–Z)</option>
                <option value="status">Status</option>
              </select>
            </div>
          </div>

          {/* Vendor Cards */}
          {filteredVendors.length === 0 ? (
            <div className="rounded-2xl bg-white border border-[#E5DED2] p-10 text-center">
              <p className="text-sm font-medium text-[#22201D]">
                No vendors match your filters
              </p>
              <button
                type="button"
                onClick={() => {
                  setCategoryFilter('all');
                  setStatusFilter('all');
                  setSearch('');
                }}
                className="mt-2 text-xs font-medium text-[#486755] hover:underline cursor-pointer"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {filteredVendors.map(
                ({ vendor, activeQuote, calc, hasQuote, effectivePrice }) => {
                  const catMeta = CATEGORY_META[vendor.category];
                  const linkedEvents = vendor.eventIds
                    .map((id) =>
                      activeWorkspace.events.find((e) => e.id === id)
                    )
                    .filter((e): e is NonNullable<typeof e> => Boolean(e));

                  const hasUnconfirmed =
                    (calc?.unresolvedMandatoryFeesCount ?? 0) > 0;
                  const hasSavings =
                    Boolean(calc?.revisionSavings) ||
                    Boolean(
                      calc?.brochureSavings?.comparable &&
                        (calc?.brochureSavings.savingsPreTax ?? 0) > 0
                    );

                  return (
                    <div
                      key={vendor.id}
                      className="rounded-2xl border border-[#E5DED2] bg-white p-4 sm:p-5 flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="flex flex-wrap items-center gap-1.5 text-[#6B655C]">
                            <span className="font-medium text-[#22201D]">
                              {catMeta.label}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>{vendor.location}</span>
                            {vendor.isDemoVenue && (
                              <>
                                <span aria-hidden="true">·</span>
                                <DemoDataNote compact />
                              </>
                            )}
                          </div>
                          <StatusText
                            status={hasQuote ? vendor.status : 'No quote'}
                          />
                        </div>

                        <div className="mt-2 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => onOpenVendor(vendor.id)}
                              className="text-left text-base font-semibold text-[#22201D] hover:text-[#486755] cursor-pointer break-words"
                            >
                              {vendor.name}
                            </button>

                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#6B655C]">
                              {linkedEvents.length === 0 ? (
                                <span>Whole wedding</span>
                              ) : (
                                linkedEvents.map((e) => (
                                  <span
                                    key={e.id}
                                    className="inline-flex items-center gap-1"
                                  >
                                    <span
                                      className={`w-2 h-2 rounded-full ${
                                        (PASTEL_TONES[e.tone] ?? PASTEL_TONES.sage)
                                          .dot
                                      }`}
                                    />
                                    <span>{e.name}</span>
                                  </span>
                                ))
                              )}
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <div
                              className={`font-num text-base font-semibold ${
                                effectivePrice === null
                                  ? 'text-[#9A4A06] font-sans text-xs'
                                  : 'text-[#22201D]'
                              }`}
                            >
                              {effectivePrice !== null
                                ? formatCurrency(
                                    effectivePrice,
                                    calc?.currencyLabel ?? activeWorkspace.currency
                                  )
                                : 'No quote'}
                            </div>
                            <div className="text-[11px] text-[#6B655C]">
                              {vendor.status === 'Booked'
                                ? 'Booked total'
                                : calc
                                  ? calc.taxNotStated
                                    ? 'Incomplete · Tax not stated'
                                    : calc.effectiveTaxHandling === 'tax_exempt'
                                      ? 'Confirmed no tax'
                                      : calc.hstAssumed
                                        ? 'Est. incl. 13% HST'
                                        : 'Incl. HST / tax'
                                  : 'Unpriced'}
                            </div>
                          </div>
                        </div>

                        {/* Compact Highlights / Notes-only notice */}
                        <div className="mt-2.5 space-y-1 text-xs">
                          {!hasQuote && (
                            <div className="text-[#6B655C]">
                              {vendor.name} has no quote yet
                              {vendor.notes ? ` · ${vendor.notes}` : ''}
                            </div>
                          )}
                          {vendor.draftQuote && (
                            <div className="text-[#9A4A06] font-medium flex items-center gap-1.5">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                              Saved draft awaiting resolution
                            </div>
                          )}
                          {hasUnconfirmed && (
                            <div className="text-[#9A4A06] font-medium flex items-center gap-1.5">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                              Unconfirmed mandatory fee
                            </div>
                          )}
                          {calc?.capacityExceeded && activeQuote?.maxCapacity && (
                            <div className="text-[#991B1B] font-medium">
                              Exceeds {activeQuote.maxCapacity} max capacity
                            </div>
                          )}
                          {hasSavings && (
                            <div className="text-[#234733] font-medium">
                              {calc?.revisionSavings
                                ? `Revised quote saves ${formatShortCad(
                                    calc.revisionSavings.savingsWithTax
                                  )} incl. HST`
                                : calc?.brochureSavings
                                  ? `Saves ${formatShortCad(
                                      calc.brochureSavings.savingsWithTax
                                    )} vs. brochure`
                                  : null}
                            </div>
                          )}
                          {vendor.eventIds.length > 1 && (
                            <div className="text-[#42306B] inline-flex items-center gap-1">
                              <Layers className="w-3 h-3" />
                              Shared package (counted once)
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Footer */}
                      <div className="mt-3.5 pt-3 border-t border-[#F0EAE0] flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div>
                          {vendor.status === 'Booked' ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-[#234733]">
                              <Check className="w-3.5 h-3.5" />
                              Booked
                            </span>
                          ) : !hasQuote ? (
                            <button
                              type="button"
                              onClick={() =>
                                onOpenQuoteImport(undefined, vendor.id)
                              }
                              className="font-semibold text-[#486755] hover:underline cursor-pointer"
                            >
                              Add quote
                            </button>
                          ) : vendor.isPreferred ? (
                            <span className="inline-flex items-center gap-1 font-medium text-[#234733]">
                              <Check className="w-3.5 h-3.5" />
                              In projected budget
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setPreferredVendor(vendor.id)}
                              className="font-medium text-[#42306B] hover:underline cursor-pointer"
                            >
                              Use for budget
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-3">
                          {vendor.status !== 'Booked' && activeQuote && (() => {
                            const eligibility = getVendorBookingEligibility(
                              vendor,
                              activeWorkspace.events
                            );
                            return (
                              <button
                                type="button"
                                disabled={!eligibility.canBook}
                                title={
                                  eligibility.canBook
                                    ? 'Confirm booking'
                                    : eligibility.blockingReasons.join(' ')
                                }
                                onClick={() => onOpenBooking(vendor.id)}
                                className={
                                  eligibility.canBook
                                    ? 'font-medium text-[#234733] hover:underline cursor-pointer'
                                    : 'font-medium text-[#9A9388] cursor-not-allowed'
                                }
                              >
                                {eligibility.canBook ? 'Book' : 'Resolve blockers'}
                              </button>
                            );
                          })()}
                          <button
                            type="button"
                            onClick={() => onOpenVendor(vendor.id)}
                            className="font-semibold text-[#22201D] hover:text-[#486755] cursor-pointer"
                          >
                            View vendor →
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
