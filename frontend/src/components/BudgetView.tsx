import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Edit3,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import {
  CATEGORY_META,
  formatCurrency,
  formatShortCad,
  getVendorActiveQuote,
} from '../engine/financialCalculator';
import { useWorkspace } from '../store/workspaceStore';
import { BudgetRow, ManualExpense, PriceSource } from '../types/vowly';
import { PASTEL_TONES } from '../utils/pastelStyles';
import { DemoDataNote, StatusText } from './DemoLabel';

interface BudgetViewProps {
  initialSourceFilter?: string;
  onClearInitialSourceFilter?: () => void;
  onAddExpense: () => void;
  onEditExpense: (expense: ManualExpense) => void;
  onOpenVendor: (vendorId: string) => void;
}

export function BudgetView({
  initialSourceFilter,
  onClearInitialSourceFilter,
  onAddExpense,
  onEditExpense,
  onOpenVendor,
}: BudgetViewProps) {
  const {
    activeWorkspace,
    financials,
    toggleVendorAddOn,
    deleteManualExpense,
    updateWorkspaceMeta,
  } = useWorkspace();

  const [eventFilter, setEventFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>(
    initialSourceFilter ?? 'all'
  );
  const [query, setQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [changedRowId, setChangedRowId] = useState<string | null>(null);
  const [showCategoryBar, setShowCategoryBar] = useState(false);
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetInput, setTargetInput] = useState(
    financials.budgetTarget !== null ? String(financials.budgetTarget) : ''
  );

  useEffect(() => {
    if (initialSourceFilter) {
      setSourceFilter(initialSourceFilter);
      onClearInitialSourceFilter?.();
    }
  }, [initialSourceFilter]);

  const toggleExpand = (rowId: string) => {
    setExpandedIds((prev) => ({ ...prev, [rowId]: !prev[rowId] }));
  };

  const filteredRows = useMemo(() => {
    return financials.budgetRows.filter((row) => {
      if (eventFilter !== 'all' && !row.eventIds.includes(eventFilter)) {
        return false;
      }
      if (sourceFilter !== 'all' && row.priceSource !== sourceFilter) {
        return false;
      }
      if (query.trim()) {
        const q = query.toLowerCase();
        const catLabel = CATEGORY_META[row.category].label.toLowerCase();
        if (
          !row.name.toLowerCase().includes(q) &&
          !catLabel.includes(q) &&
          !(row.subtitle ?? '').toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [financials.budgetRows, eventFilter, sourceFilter, query]);

  const filteredProjected = useMemo(() => {
    return filteredRows.reduce((sum, r) => sum + (r.projectedCost ?? 0), 0);
  }, [filteredRows]);

  const getEventDisplay = (eventIds: string[]) => {
    if (eventIds.length === 0) {
      return { label: 'Whole wedding', dotClass: 'bg-[#9A9388]' };
    }
    const matched = eventIds
      .map((id) => activeWorkspace.events.find((e) => e.id === id))
      .filter((e): e is NonNullable<typeof e> => Boolean(e));
    if (matched.length === 0) {
      return { label: 'Whole wedding', dotClass: 'bg-[#9A9388]' };
    }
    if (matched.length === 1) {
      const tone = PASTEL_TONES[matched[0].tone] ?? PASTEL_TONES.sage;
      return { label: matched[0].name, dotClass: tone.dot };
    }
    return {
      label: `Shared (${matched.length} events)`,
      dotClass: 'bg-[#725BA0]',
    };
  };

  const priceSources: PriceSource[] = [
    'Confirmed booking',
    'Vendor quote',
    'User-entered allowance',
    'Unpriced / TBD',
  ];

  const handleToggleAddOn = (
    rowId: string,
    vendorId: string,
    quoteId: string,
    addOnId: string
  ) => {
    toggleVendorAddOn(vendorId, quoteId, addOnId);
    setChangedRowId(rowId);
    window.setTimeout(() => {
      setChangedRowId((curr) => (curr === rowId ? null : curr));
    }, 950);
  };

  const renderExpandedDetails = (row: BudgetRow) => {
    const vendor = row.vendorId
      ? activeWorkspace.vendors.find((v) => v.id === row.vendorId)
      : undefined;
    const activeQuote = vendor ? getVendorActiveQuote(vendor) : undefined;
    const manualExpense = row.manualExpenseId
      ? activeWorkspace.manualExpenses.find((m) => m.id === row.manualExpenseId)
      : undefined;

    const bookingOwed =
      row.committedAmount > 0
        ? Math.max(0, row.committedAmount - row.paidAmount)
        : 0;

    return (
      <div className="space-y-3 text-xs">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div>
            <div className="text-[11px] text-[#6B655C]">Allowance</div>
            <div className="font-num font-medium text-[#22201D] mt-0.5">
              {row.budgetAllowance !== null
                ? formatShortCad(row.budgetAllowance)
                : '—'}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#6B655C]">Booked</div>
            <div className="font-num font-medium text-[#22201D] mt-0.5">
              {row.committedAmount > 0
                ? formatShortCad(row.committedAmount)
                : '—'}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#6B655C]">Paid</div>
            <div className="font-num font-medium text-[#234733] mt-0.5">
              {row.paidAmount > 0 ? formatShortCad(row.paidAmount) : '—'}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#6B655C]">Owed on booking</div>
            <div className="font-num font-medium text-[#22201D] mt-0.5">
              {row.committedAmount > 0 ? formatShortCad(bookingOwed) : '—'}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#6B655C]">Price source</div>
            <div className="font-medium text-[#22201D] mt-0.5">
              {row.priceSource}
            </div>
          </div>
        </div>

        {/* Metadata + Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#EAE3D8]">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#6B655C]">
            <span>{CATEGORY_META[row.category].label}</span>
            {row.isSharedMultiEvent && (
              <>
                <span aria-hidden="true">·</span>
                <span>Counted once across {row.eventIds.length} events</span>
              </>
            )}
            {row.hstAssumed && (
              <>
                <span aria-hidden="true">·</span>
                <span>Includes est. 13% ON HST</span>
              </>
            )}
            {row.isDemoVenue && (
              <>
                <span aria-hidden="true">·</span>
                <DemoDataNote />
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            {row.vendorId && (
              <button
                type="button"
                onClick={() => onOpenVendor(row.vendorId!)}
                className="font-semibold text-[#486755] hover:underline cursor-pointer"
              >
                View vendor →
              </button>
            )}
            {manualExpense && (
              <>
                <button
                  type="button"
                  onClick={() => onEditExpense(manualExpense)}
                  className="inline-flex items-center gap-1 font-medium text-[#22201D] hover:underline cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => deleteManualExpense(manualExpense.id)}
                  className="inline-flex items-center gap-1 font-medium text-[#991B1B] hover:underline cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Remove
                </button>
              </>
            )}
          </div>
        </div>

        {/* Optional Add-Ons */}
        {row.addOns && row.addOns.length > 0 && vendor && activeQuote && (
          <div className="pt-2 border-t border-[#EAE3D8] space-y-1.5">
            <div className="text-[11px] font-semibold text-[#22201D]">
              Optional add-ons
            </div>
            {row.addOns.map((addon) => (
              <label
                key={addon.id}
                className="flex items-center justify-between gap-3 py-1 cursor-pointer"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <input
                    type="checkbox"
                    checked={addon.selected}
                    onChange={() =>
                      handleToggleAddOn(
                        row.id,
                        vendor.id,
                        activeQuote.id,
                        addon.id
                      )
                    }
                    className="accent-[#486755] cursor-pointer shrink-0"
                  />
                  <span className="text-[#22201D] break-words">
                    {addon.label}
                  </span>
                </span>
                <span className="font-num font-medium text-[#42306B] whitespace-nowrap shrink-0">
                  {addon.selected ? '-' : '+'}
                  {formatShortCad(addon.impactWithTax)} incl. HST
                </span>
              </label>
            ))}
          </div>
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
            Budget
          </h1>
          <p className="mt-0.5 text-xs text-[#6B655C]">
            {financials.pricedExpenseCount} of {financials.totalExpenseCount}{' '}
            items priced · Shared contracts counted once
          </p>
        </div>
        <button
          type="button"
          onClick={onAddExpense}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl bg-[#486755] text-white hover:bg-[#395344] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Add expense
        </button>
      </div>

      {/* Clear Distinction: Budget Headroom vs. Amount Owed on Bookings */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl bg-white border border-[#E5DED2] p-4">
          <div className="text-xs text-[#6B655C]">Projected spend</div>
          <div className="mt-1 font-num text-xl font-semibold text-[#22201D]">
            {formatShortCad(financials.projectedSpend)}
          </div>
          <div className="mt-1 text-[11px] text-[#6B655C]">
            {financials.unpricedExpenseCount > 0 ? (
              <button
                type="button"
                onClick={() =>
                  setSourceFilter(
                    sourceFilter === 'Unpriced / TBD' ? 'all' : 'Unpriced / TBD'
                  )
                }
                className="font-semibold text-[#9A4A06] hover:underline cursor-pointer"
              >
                {financials.unpricedExpenseCount} unpriced excluded
              </button>
            ) : (
              'All items priced'
            )}
          </div>
        </div>

        <div className="rounded-2xl bg-white border border-[#E5DED2] p-4">
          <div className="text-xs text-[#6B655C]">Budget headroom</div>
          {editingTarget ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const n = parseFloat(targetInput);
                if (!Number.isNaN(n) && n > 0) {
                  updateWorkspaceMeta({ budgetTarget: n });
                  setEditingTarget(false);
                }
              }}
              className="mt-1 flex items-center gap-1.5"
            >
              <input
                type="number"
                value={targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
                placeholder="Target"
                className="w-24 rounded-lg border border-[#486755] px-2 py-1 font-num text-xs"
              />
              <button
                type="submit"
                className="px-2 py-1 rounded-lg bg-[#486755] text-white text-xs font-semibold cursor-pointer"
              >
                Save
              </button>
            </form>
          ) : financials.remainingBudget !== null ? (
            <>
              <div
                className={`mt-1 font-num text-xl font-semibold ${
                  financials.remainingBudget < 0
                    ? 'text-[#991B1B]'
                    : 'text-[#234733]'
                }`}
              >
                {formatShortCad(financials.remainingBudget)}
              </div>
              <div className="mt-1 text-[11px] text-[#6B655C]">
                Target {formatShortCad(financials.budgetTarget)} − Projected
              </div>
            </>
          ) : (
            <div className="mt-1">
              <button
                type="button"
                onClick={() => setEditingTarget(true)}
                className="text-xs font-semibold text-[#486755] hover:underline cursor-pointer"
              >
                Set target →
              </button>
              <div className="text-[11px] text-[#6B655C] mt-0.5">
                Target unknown
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl bg-white border border-[#E5DED2] p-4">
          <div className="text-xs text-[#6B655C]">Booked contracts</div>
          <div className="mt-1 font-num text-xl font-semibold text-[#22201D]">
            {formatShortCad(financials.committedSpend)}
          </div>
          <div className="mt-1 text-[11px] text-[#234733]">
            {formatShortCad(financials.paidToDate)} paid to date
          </div>
        </div>

        <div className="rounded-2xl bg-white border border-[#E5DED2] p-4">
          <div className="text-xs text-[#6B655C]">Owed on bookings</div>
          <div className="mt-1 font-num text-xl font-semibold text-[#22201D]">
            {formatShortCad(financials.remainingToPay)}
          </div>
          <div className="mt-1 text-[11px] text-[#6B655C]">
            Booked minus paid (separate from headroom)
          </div>
        </div>
      </div>

      {/* Category Breakdown Disclosure (Moved here from Overview) */}
      {financials.categoryBreakdown.length > 0 && (
        <div className="rounded-2xl bg-white border border-[#E5DED2] overflow-hidden">
          <button
            type="button"
            aria-expanded={showCategoryBar}
            onClick={() => setShowCategoryBar((v) => !v)}
            className="w-full px-4 py-3 flex items-center justify-between text-xs font-semibold text-[#22201D] hover:bg-[#FAF8F4] cursor-pointer"
          >
            <span>Category spend breakdown ({financials.categoryBreakdown.length})</span>
            {showCategoryBar ? (
              <ChevronDown className="w-4 h-4 text-[#6B655C]" />
            ) : (
              <ChevronRight className="w-4 h-4 text-[#6B655C]" />
            )}
          </button>
          {showCategoryBar && (
            <div className="px-4 pb-4 pt-2 border-t border-[#F0EAE0] space-y-3">
              <div className="h-3 w-full rounded-full overflow-hidden flex bg-[#F3EFE8] gap-0.5">
                {financials.categoryBreakdown.map((cat) => (
                  <div
                    key={cat.category}
                    style={{ width: `${Math.max(cat.sharePercent, 2)}%` }}
                    className={(PASTEL_TONES[cat.tone] ?? PASTEL_TONES.sage).barFill}
                    title={`${cat.label}: ${formatShortCad(cat.projected)}`}
                  />
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5 text-xs">
                {financials.categoryBreakdown.map((cat) => (
                  <div
                    key={cat.category}
                    className="flex items-center justify-between gap-2 py-1"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-2.5 h-2.5 rounded-sm shrink-0 ${
                          (PASTEL_TONES[cat.tone] ?? PASTEL_TONES.sage).barFill
                        }`}
                      />
                      <span className="truncate text-[#22201D]">{cat.label}</span>
                    </span>
                    <span className="font-num font-medium text-[#22201D] shrink-0">
                      {formatShortCad(cat.projected)} ({cat.sharePercent}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Width-Adaptive Filters Bar (Fits 390px & 1280px cleanly) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <select
            value={eventFilter}
            onChange={(e) => setEventFilter(e.target.value)}
            aria-label="Filter by event"
            className="max-w-full rounded-xl border border-[#E5DED2] bg-white px-3 py-2 text-xs font-medium text-[#22201D]"
          >
            <option value="all">
              All events ({financials.budgetRows.length})
            </option>
            {activeWorkspace.events.map((evt) => (
              <option key={evt.id} value={evt.id}>
                {evt.name}
              </option>
            ))}
          </select>

          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            aria-label="Filter by price source"
            className="max-w-full rounded-xl border border-[#E5DED2] bg-white px-3 py-2 text-xs font-medium text-[#22201D]"
          >
            <option value="all">All sources</option>
            {priceSources.map((src) => (
              <option key={src} value={src}>
                {src}
              </option>
            ))}
          </select>

          {sourceFilter !== 'all' && (
            <button
              type="button"
              onClick={() => setSourceFilter('all')}
              className="text-xs font-medium text-[#486755] hover:underline cursor-pointer"
            >
              Clear filter
            </button>
          )}
        </div>

        <div className="relative w-full sm:w-56 shrink-0">
          <Search className="w-3.5 h-3.5 text-[#6B655C] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search expense or vendor..."
            className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-[#E5DED2] bg-white text-[#22201D] placeholder:text-[#9A9388]"
          />
        </div>
      </div>

      {/* DESKTOP 4-COLUMN TABLE (md+) — Neutral Financial Rows + Obvious Row Disclosure */}
      <div className="hidden md:block rounded-2xl bg-white border border-[#E5DED2] overflow-hidden">
        <table className="w-full text-left border-collapse table-fixed">
          <thead>
            <tr className="bg-[#F6F2EA] border-b border-[#E5DED2] text-[11px] font-semibold text-[#6B655C]">
              <th className="py-3 px-4 w-[44%]">Expense / vendor</th>
              <th className="py-3 px-3 w-[22%]">Event</th>
              <th className="py-3 px-3 w-[18%] text-right">Projected CAD</th>
              <th className="py-3 px-4 w-[16%] text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0EAE0] text-sm">
            {filteredRows.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="py-10 text-center text-xs text-[#6B655C]"
                >
                  No expenses match this filter.
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => {
                const isExpanded = Boolean(expandedIds[row.id]);
                const evtDisp = getEventDisplay(row.eventIds);
                const isChanged = changedRowId === row.id;

                return (
                  <React.Fragment key={row.id}>
                    <tr
                      className={`hover:bg-[#FAF8F4] transition-colors ${
                        isExpanded ? 'bg-[#FAF8F4]/70' : 'bg-white'
                      }`}
                    >
                      {/* Col 1: Expense / vendor with obvious disclosure button */}
                      <td className="py-3 px-4 align-middle">
                        <div className="flex items-center gap-2 min-w-0">
                          <button
                            type="button"
                            aria-expanded={isExpanded}
                            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} details for ${row.name}`}
                            onClick={() => toggleExpand(row.id)}
                            className="p-1 -ml-1 rounded-md text-[#5A544C] hover:bg-[#EFEBE2] hover:text-[#22201D] shrink-0 cursor-pointer"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4" />
                            ) : (
                              <ChevronRight className="w-4 h-4" />
                            )}
                          </button>
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => toggleExpand(row.id)}
                              className="font-medium text-[#22201D] hover:text-[#486755] text-left truncate block max-w-full cursor-pointer"
                              title={row.name}
                            >
                              {row.name}
                            </button>
                            {(row.isDemoVenue ||
                              (row.addOns && row.addOns.length > 0)) && (
                              <div className="flex items-center gap-1.5 text-[11px] text-[#6B655C] truncate">
                                {row.isDemoVenue && <DemoDataNote compact />}
                                {row.isDemoVenue &&
                                  row.addOns &&
                                  row.addOns.length > 0 && (
                                    <span aria-hidden="true">·</span>
                                  )}
                                {row.addOns && row.addOns.length > 0 && (
                                  <span>
                                    {row.addOns.length}{' '}
                                    {row.addOns.length === 1
                                      ? 'add-on'
                                      : 'add-ons'}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Col 2: Event with consistent pastel dot */}
                      <td className="py-3 px-3 align-middle">
                        <div className="flex items-center gap-2 min-w-0 text-xs text-[#22201D]">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${evtDisp.dotClass}`}
                            aria-hidden="true"
                          />
                          <span className="truncate" title={evtDisp.label}>
                            {evtDisp.label}
                          </span>
                        </div>
                      </td>

                      {/* Col 3: Projected CAD (right aligned) */}
                      <td className="py-3 px-3 align-middle text-right">
                        <span
                          className={`font-num text-sm font-semibold px-1.5 py-0.5 ${
                            isChanged ? 'amount-changed-flash' : ''
                          } ${
                            row.projectedCost === null
                              ? 'text-[#9A4A06] font-sans text-xs font-medium'
                              : 'text-[#22201D]'
                          }`}
                        >
                          {row.projectedCost !== null
                            ? formatCurrency(
                                row.projectedCost,
                                activeWorkspace.currency
                              )
                            : 'Unpriced'}
                        </span>
                      </td>

                      {/* Col 4: Status (text + icon, right aligned) */}
                      <td className="py-3 px-4 align-middle text-right">
                        <StatusText status={row.statusLabel} />
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="bg-[#FAF8F4]">
                        <td
                          colSpan={4}
                          className="px-10 py-4 border-t border-[#EFEAE0]"
                        >
                          {renderExpandedDetails(row)}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
          {filteredRows.length > 0 && (
            <tfoot>
              <tr className="bg-[#F6F2EA] border-t border-[#E5DED2] text-xs font-semibold text-[#22201D]">
                <td colSpan={2} className="py-3 px-4">
                  Total ({filteredRows.length}{' '}
                  {filteredRows.length === 1 ? 'item' : 'items'})
                </td>
                <td className="py-3 px-3 text-right font-num">
                  {formatCurrency(filteredProjected, activeWorkspace.currency)}
                </td>
                <td className="py-3 px-4 text-right font-normal text-[#6B655C]">
                  Click row for details
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* MOBILE STACKED ROWS (< md, clean at 390px with long vendor & event names) */}
      <div className="md:hidden space-y-2.5">
        {filteredRows.length === 0 ? (
          <div className="rounded-2xl bg-white border border-[#E5DED2] p-8 text-center text-xs text-[#6B655C]">
            No expenses match this filter.
          </div>
        ) : (
          filteredRows.map((row) => {
            const isExpanded = Boolean(expandedIds[row.id]);
            const evtDisp = getEventDisplay(row.eventIds);
            const isChanged = changedRowId === row.id;

            return (
              <div
                key={row.id}
                className="rounded-2xl bg-white border border-[#E5DED2] overflow-hidden"
              >
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  onClick={() => toggleExpand(row.id)}
                  className="w-full p-4 text-left flex items-start justify-between gap-3 cursor-pointer"
                >
                  <div className="flex items-start gap-2 min-w-0">
                    <span className="mt-0.5 text-[#5A544C] shrink-0">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[#22201D] break-words">
                        {row.name}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#6B655C]">
                        <span className="inline-flex items-center gap-1.5 min-w-0">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${evtDisp.dotClass}`}
                          />
                          <span className="break-words">{evtDisp.label}</span>
                        </span>
                        {row.isDemoVenue && <DemoDataNote compact />}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div
                      className={`font-num text-sm font-semibold ${
                        isChanged ? 'amount-changed-flash px-1' : ''
                      } ${
                        row.projectedCost === null
                          ? 'text-[#9A4A06] font-sans text-xs'
                          : 'text-[#22201D]'
                      }`}
                    >
                      {row.projectedCost !== null
                        ? formatShortCad(row.projectedCost)
                        : 'Unpriced'}
                    </div>
                    <div className="mt-1">
                      <StatusText status={row.statusLabel} />
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 pt-3 bg-[#FAF8F4] border-t border-[#F0EAE0]">
                    {renderExpandedDetails(row)}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
