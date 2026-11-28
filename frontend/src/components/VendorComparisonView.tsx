import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, FileUp, Info, RotateCcw } from 'lucide-react';
import { CATEGORY_META, formatCurrency, getVendorActiveQuote } from '../engine/financialCalculator';
import { buildVendorComparison, describeComparisonDifference, supportsCoverageHours, type ComparisonOption } from '../engine/vendorComparison';
import { useWorkspace } from '../store/workspaceStore';
import type { VendorCategory, WeddingWorkspace } from '../types/vowly';
import { DemoDataNote, StatusText } from './DemoLabel';

interface VendorComparisonViewProps {
  initialEventId?: string;
  initialCategory?: VendorCategory;
  onOpenVendor: (vendorId: string) => void;
  onOpenQuoteImport: (presetId?: string, vendorId?: string) => void;
  onEditQuote?: (vendorId: string) => void;
}

type ComparisonMode = 'vendors' | 'packages';
type Row = readonly [key: string, label: string];

const FIELD_CLASS = 'min-h-10 w-full min-w-0 rounded-lg border border-[#D7CDC0] bg-white px-2.5 py-1.5 text-sm text-[#22201D]';
const CATEGORY_OPTIONS = Object.keys(CATEGORY_META) as VendorCategory[];

const COST_ROWS: Row[] = [
  ['total', 'Estimated total'],
  ['base', 'Base price'],
  ['extras', 'Extras'],
  ['gratuity', 'Gratuity'],
  ['tax', 'Tax'],
  ['pricing', 'Pricing terms'],
];

const CATEGORY_ROWS: Partial<Record<VendorCategory, Row[]>> = {
  venue: [['minimum', 'Guest minimum'], ['capacity', 'Capacity'], ['equipment', 'AV & equipment'], ['staffing', 'Staffing']],
  catering: [['minimum', 'Guest minimum'], ['menu', 'Menu & service'], ['staffing', 'Staffing'], ['equipment', 'Equipment']],
  photography: [['coverage', 'Coverage'], ['staffing', 'Photography team']],
  dj: [['coverage', 'Coverage'], ['equipment', 'Sound & lighting'], ['staffing', 'Staffing'], ['setup', 'Setup']],
  decor: [['equipment', 'Rentals & equipment'], ['setup', 'Setup & teardown']],
};

const QUOTE_ROWS: Row[] = [
  ['inclusions', 'Included'],
  ['exclusions', 'Excluded'],
  ['delivery', 'Delivery'],
  ['restrictions', 'Restrictions'],
];

function defaultEventId(workspace: WeddingWorkspace, category: VendorCategory, initialEventId?: string): string {
  const requestedEvent = workspace.events.find((event) => event.id === initialEventId);
  if (requestedEvent) return requestedEvent.id;
  const linked = workspace.vendors.filter((vendor) => !vendor.archived && vendor.category === category && vendor.status !== 'Declined');
  const comparable = workspace.events.find((event) =>
    linked.filter((vendor) => vendor.eventIds.includes(event.id) && getVendorActiveQuote(vendor)).length >= 2,
  );
  return comparable?.id
    ?? workspace.events.find((event) => linked.some((vendor) => vendor.eventIds.includes(event.id)))?.id
    ?? workspace.events[0]?.id
    ?? '';
}

function parseScenarioNumber(text: string, wholeNumber: boolean): number | undefined {
  const trimmed = text.trim();
  const decimal = wholeNumber ? /^\d+$/ : /^(?:\d+(?:\.\d*)?|\.\d+)$/;
  if (!decimal.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value > 0 && Number.isSafeInteger(Math.floor(value)) ? value : undefined;
}

const TERM_DIFFERENCES = [
  ['scope', 'Event coverage varies across these options.'],
  ['coverage', 'Coverage hours vary across these options.'],
  ['minimum', 'Guest minimums vary across these options.'],
  ['capacity', 'Capacity varies across these options.'],
  ['delivery', 'Delivery terms vary across these options.'],
  ['staffing', 'Staffing terms vary across these options.'],
  ['equipment', 'Equipment terms vary across these options.'],
  ['setup', 'Setup terms vary across these options.'],
  ['menu', 'Menu and service terms vary across these options.'],
  ['inclusions', 'Included services vary across these options.'],
] as const;

function describeTermsDifference(entries: ComparisonOption[]): string | null {
  if (entries.length < 2) return null;
  const needsReview = entries.filter((entry) => entry.unresolved.length > 0).length;
  if (needsReview > 0) {
    return needsReview === 1
      ? 'One option has pricing or terms to review.'
      : needsReview + ' options have pricing or terms to review.';
  }

  for (const [key, message] of TERM_DIFFERENCES) {
    const values = entries.map(({ rows }) => (rows[key]?.text ?? 'Not stated').split('\n').sort().join('\n'));
    if (new Set(values).size > 1) return message;
  }
  return null;
}

function DifferenceNote({ text, className }: { text: string; className: string }) {
  return (
    <div className={`items-start gap-2 rounded-xl border border-[#CBBCE8] bg-[#F2ECFA] px-3.5 py-3 text-xs leading-relaxed text-[#30224B] ${className}`}>
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p><strong>Key difference.</strong> {text}</p>
    </div>
  );
}

interface ComparisonTableProps {
  entries: ComparisonOption[];
  mode: ComparisonMode;
  category: VendorCategory;
  mobile?: boolean;
  onOpenVendor: VendorComparisonViewProps['onOpenVendor'];
  onEditQuote?: VendorComparisonViewProps['onEditQuote'];
  onChoosePackage: (vendorId: string, packageId: string) => void;
}

function ComparisonTable({
  entries,
  mode,
  category,
  mobile = false,
  onOpenVendor,
  onEditQuote,
  onChoosePackage,
}: ComparisonTableProps) {
  const categoryRows = CATEGORY_ROWS[category] ?? [['coverage', 'Coverage']];
  const hasCoverageRow = categoryRows.some(([key]) => key === 'coverage');
  const hasCoverageFacts = entries.some(({ rows }) => rows.coverage && rows.coverage.text !== 'Not stated');
  const rows: Row[] = [
    ...COST_ROWS,
    ...(mode === 'vendors' && entries.some((entry) => entry.contractTotal !== undefined) ? [['contract', 'Confirmed contract'] as const] : []),
    ['unresolved', 'Needs review'],
    ...(entries.some(({ vendor }) => vendor.eventIds.length > 1) ? [['scope', 'Event coverage'] as const] : []),
    ...(!hasCoverageRow && hasCoverageFacts ? [['coverage', 'Coverage'] as const] : []),
    ...categoryRows,
    ...QUOTE_ROWS,
  ];

  return (
    <table
      aria-label={mode === 'packages' ? 'Package comparison' : 'Vendor comparison'}
      className="w-full table-fixed border-collapse text-left text-xs"
      style={mobile ? undefined : { minWidth: 164 + 210 * entries.length }}
    >
      <colgroup>
        <col className={mobile ? 'w-[25%]' : 'w-[164px]'} />
        {entries.map(({ id }) => <col key={id} />)}
      </colgroup>
      <thead>
        <tr className="border-b border-[#E5DED2] align-top">
          <th scope="col" className="bg-[#F6F2EA] px-2 py-3 font-semibold text-[#5A544C] sm:px-4">Criteria</th>
          {entries.map((entry) => {
            const { vendor, title, quote } = entry;
            const packages = quote?.packages ?? [];
            const savedQuote = getVendorActiveQuote(vendor);
            const isSavedTier = mode === 'packages' && entry.packageId && entry.packageId === savedQuote?.selectedPackageId;
            const canReview = onEditQuote && !vendor.draftQuote
              && savedQuote?.id === quote?.id
              && quote?.approvalState === 'approved';
            return (
              <th key={entry.id} scope="col" className="border-l border-[#F0EAE0] px-2 py-3 align-top [overflow-wrap:anywhere] sm:px-4">
                <button
                  type="button"
                  aria-label={mode === 'packages' ? `View vendor ${vendor.name} for ${title}` : `View vendor ${vendor.name}`}
                  onClick={() => onOpenVendor(vendor.id)}
                  className="text-left text-sm font-semibold text-[#234733] underline decoration-[#A1B6A5] underline-offset-2 hover:decoration-current"
                >
                  {title}
                </button>
                <div className="mt-1 text-[11px] font-normal text-[#6B655C]">
                  {mode === 'packages' && <span className="mb-0.5 block">{vendor.name}</span>}
                  <StatusText status={vendor.status} />
                  {isSavedTier && <span className="ml-1">· Saved tier</span>}
                  {vendor.isDemoVenue && <span className="ml-1">· Demo data</span>}
                </div>
                {mode === 'vendors' && packages.length > 1 && (
                  <select
                    aria-label={`Package for ${vendor.name}`}
                    value={entry.packageId ?? ''}
                    onChange={(event) => onChoosePackage(vendor.id, event.target.value)}
                    className="mt-2 min-h-8 w-full min-w-0 rounded-md border border-[#D7CDC0] bg-white px-1.5 py-1 text-xs font-normal"
                  >
                    <option value="">{savedQuote?.selectedPackageId ? 'Use saved package' : 'Choose a package'}</option>
                    {packages.map((pkg) => <option key={pkg.id} value={pkg.id}>{pkg.name}</option>)}
                  </select>
                )}
                {canReview && (
                  <button
                    type="button"
                    aria-label={mode === 'packages' ? `Review quote for ${vendor.name}, ${title}` : `Review quote for ${vendor.name}`}
                    onClick={() => onEditQuote(vendor.id)}
                    className="mt-2 block text-left text-xs font-medium text-[#486755] underline underline-offset-2 hover:text-[#234733]"
                  >
                    Review quote
                  </button>
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody className="divide-y divide-[#F0EAE0]">
        {rows.map(([key, label]) => (
          <tr key={key} className={key === 'total' ? 'bg-[#EAF5EE]/70' : undefined}>
            <th scope="row" className={`px-2 py-2.5 text-xs font-medium align-top [overflow-wrap:anywhere] sm:px-4 ${key === 'total' ? 'font-semibold text-[#234733]' : 'bg-[#F6F2EA]/60 text-[#5A544C]'}`}>
              {label}
            </th>
            {entries.map((entry) => {
              const row = entry.rows[key];
              const review = key === 'unresolved' && entry.unresolved.length > 0;
              const capacityWarning = key === 'capacity' && entry.calc?.capacityExceeded;
              const currency = entry.quote?.currency ?? 'UNKNOWN';
              const text = key === 'contract'
                ? entry.contractTotal === undefined
                  ? '—'
                  : formatCurrency(entry.contractTotal, currency, { decimals: 2 }) + (currency === 'UNKNOWN' ? ' (currency not stated)' : '')
                : row?.text ?? 'Not stated';
              return (
                <td key={entry.id} className="border-l border-[#F0EAE0] px-2 py-2.5 align-top [overflow-wrap:anywhere] sm:px-4">
                  <div className={`whitespace-pre-line leading-relaxed ${key === 'total' ? 'font-num text-[13px] font-semibold sm:text-sm' : ''} ${review || capacityWarning ? 'font-semibold text-[#92400E]' : text === 'Not stated' ? 'text-[#6B655C]' : 'text-[#22201D]'}`}>
                    {text}
                  </div>
                  {row?.detail && (
                    <div className="mt-0.5 text-[11px] leading-relaxed text-[#5A544C]">{row.detail}</div>
                  )}
                  {row?.evidence?.length ? (
                    <details className="mt-1">
                      <summary
                        aria-label={'Source details for ' + label + ', ' + entry.title}
                        className="cursor-pointer font-medium text-[#486755] hover:underline"
                      >
                        Source details
                      </summary>
                      <ul className="mt-1 space-y-1.5 text-[11px] leading-relaxed text-[#5A544C]">
                        {row.evidence.map((excerpt, index) => <li key={index}><q>{excerpt}</q></li>)}
                      </ul>
                    </details>
                  ) : null}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function VendorComparisonView({
  initialEventId,
  initialCategory = 'venue',
  onOpenVendor,
  onOpenQuoteImport,
  onEditQuote,
}: VendorComparisonViewProps) {
  const { activeWorkspace } = useWorkspace();
  const [category, setCategory] = useState(initialCategory);
  const [eventId, setEventId] = useState(() => defaultEventId(activeWorkspace, initialCategory, initialEventId));
  const [mode, setMode] = useState<ComparisonMode>('vendors');
  const [packageVendorId, setPackageVendorId] = useState('');
  const [guestText, setGuestText] = useState('');
  const [coverageText, setCoverageText] = useState('');
  const [packageByVendor, setPackageByVendor] = useState<Record<string, string>>({});
  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');

  useEffect(() => {
    setCategory(initialCategory);
    setEventId(defaultEventId(activeWorkspace, initialCategory, initialEventId));
    setMode('vendors');
    setPackageVendorId('');
    setGuestText('');
    setCoverageText('');
    setPackageByVendor({});
    setLeftId('');
    setRightId('');
  }, [activeWorkspace.id, initialEventId, initialCategory]);

  const selectedEvent = activeWorkspace.events.find((event) => event.id === eventId)
    ?? activeWorkspace.events.find((event) => event.id === defaultEventId(activeWorkspace, category));
  const packageVendors = activeWorkspace.vendors.filter((vendor) =>
    !vendor.archived
    && vendor.category === category
    && vendor.status !== 'Declined'
    && Boolean(selectedEvent && vendor.eventIds.includes(selectedEvent.id))
    && (getVendorActiveQuote(vendor)?.packages?.length ?? 0) >= 2,
  );
  const packageVendor = packageVendors.find((vendor) => vendor.id === packageVendorId) ?? packageVendors[0];

  const guests = parseScenarioNumber(guestText, true);
  const showCoverage = supportsCoverageHours(category);
  const coverageHours = showCoverage ? parseScenarioNumber(coverageText, false) : undefined;
  const invalidGuests = guestText !== '' && guests === undefined;
  const hasScenarioOverrides = Boolean(guestText || coverageText || Object.keys(packageByVendor).length);
  const invalidCoverage = showCoverage && coverageText !== '' && coverageHours === undefined;
  const scenarioEventId = selectedEvent?.id;
  const scenarioVendorId = mode === 'packages' ? packageVendor?.id : undefined;
  const comparison = useMemo(() => {
    if (!scenarioEventId || (mode === 'packages' && !scenarioVendorId)) {
      return { entries: [], unquotedVendors: [], difference: null };
    }
    return buildVendorComparison(activeWorkspace, {
      category,
      eventId: scenarioEventId,
      guestCount: guests,
      coverageHours,
      vendorId: scenarioVendorId,
      packageByVendor,
    });
  }, [activeWorkspace, category, scenarioEventId, scenarioVendorId, guests, coverageHours, mode, packageByVendor]);

  const left = comparison.entries.find(({ id }) => id === leftId) ?? comparison.entries[0];
  const right = comparison.entries.find(({ id }) => id === rightId && id !== left?.id)
    ?? comparison.entries.find(({ id }) => id !== left?.id);
  const mobileEntries = [left, right].filter((entry): entry is ComparisonOption => Boolean(entry));
  const desktopDifference = comparison.difference ?? describeTermsDifference(comparison.entries);
  const mobileDifference = describeComparisonDifference(mobileEntries, guests ?? selectedEvent?.guestCount ?? undefined)
    ?? describeTermsDifference(mobileEntries);

  const tableProps = {
    mode,
    category,
    onOpenVendor,
    onEditQuote,
    onChoosePackage: (vendorId: string, packageId: string) => {
      setPackageByVendor((current) => {
        const next = { ...current };
        if (packageId) next[vendorId] = packageId;
        else delete next[vendorId];
        return next;
      });
    },
  };

  return (
    <section aria-label="Compare quotes" className="min-w-0 space-y-4">
      <div className="rounded-2xl border border-[#E5DED2] bg-white p-3.5 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold text-[#22201D]">Compare quotes</h2>
              {activeWorkspace.isDemoWorkspace && <DemoDataNote />}
            </div>
            <p className="mt-0.5 text-xs text-[#5A544C]">Compare estimates for the same event and category.</p>
          </div>
          <div role="group" aria-label="Comparison mode" className="inline-flex rounded-xl border border-[#E5DED2] bg-[#F6F2EA] p-1">
            {(['vendors', 'packages'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                onClick={() => setMode(option)}
                className={`min-h-8 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${mode === option ? 'bg-white text-[#234733] shadow-2xs' : 'text-[#5A544C] hover:text-[#22201D]'}`}
              >
                {option === 'vendors' ? 'Compare vendors' : 'Compare packages'}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <label className="min-w-0 space-y-1 text-xs font-medium text-[#5A544C]">
            <span>Event</span>
            <select
              aria-label="Comparison event"
              className={FIELD_CLASS}
              value={selectedEvent?.id ?? ''}
              onChange={(event) => {
                setEventId(event.target.value);
                setGuestText('');
                setCoverageText('');
              }}
              disabled={!activeWorkspace.events.length}
            >
              {!activeWorkspace.events.length && <option value="">No events yet</option>}
              {activeWorkspace.events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
            </select>
          </label>
          <label className="min-w-0 space-y-1 text-xs font-medium text-[#5A544C]">
            <span>Category</span>
            <select
              aria-label="Comparison category"
              className={FIELD_CLASS}
              value={category}
              onChange={(event) => setCategory(event.target.value as VendorCategory)}
            >
              {CATEGORY_OPTIONS.map((option) => <option key={option} value={option}>{CATEGORY_META[option].label}</option>)}
            </select>
          </label>
          <label className="min-w-0 space-y-1 text-xs font-medium text-[#5A544C]">
            <span>Guest count</span>
            <input
              type="text"
              inputMode="numeric"
              aria-label="Guest count"
              className={FIELD_CLASS}
              value={guestText}
              placeholder={selectedEvent?.guestCount != null ? String(selectedEvent.guestCount) : 'Not stated'}
              aria-invalid={invalidGuests || undefined}
              aria-describedby={invalidGuests ? 'compare-guest-error compare-saved-guests compare-scenario-note' : 'compare-saved-guests compare-scenario-note'}
              onChange={(event) => setGuestText(event.target.value)}
            />
            <span id="compare-saved-guests" className="block font-normal">Saved event count: {selectedEvent?.guestCount ?? 'Not stated'}</span>
            {invalidGuests && <span id="compare-guest-error" className="block text-[#991B1B]">Enter a whole number above zero.</span>}
          </label>
          {showCoverage && <label className="min-w-0 space-y-1 text-xs font-medium text-[#5A544C]">
            <span>Coverage hours</span>
            <input
              type="text"
              inputMode="decimal"
              aria-label="Coverage hours"
              className={FIELD_CLASS}
              value={coverageText}
              placeholder="Quote default"
              aria-invalid={invalidCoverage || undefined}
              aria-describedby={invalidCoverage ? 'compare-hours-error compare-scenario-note' : 'compare-scenario-note'}
              onChange={(event) => setCoverageText(event.target.value)}
            />
            {invalidCoverage && <span id="compare-hours-error" className="block text-[#991B1B]">Enter a number above zero.</span>}
          </label>}
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <p id="compare-scenario-note" className="text-xs text-[#5A544C]">Guest and coverage changes apply to this comparison only.</p>
          <button
            type="button"
            disabled={!hasScenarioOverrides}
            onClick={() => {
              setGuestText('');
              setCoverageText('');
              setPackageByVendor({});
            }}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-md text-xs font-semibold text-[#486755] hover:underline disabled:text-[#7A7368] disabled:no-underline"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Reset scenario
          </button>
        </div>

        {mode === 'packages' && packageVendor && (
          <label className="mt-3 block max-w-sm space-y-1 text-xs font-medium text-[#5A544C]">
            <span>Package vendor</span>
            <select
              className={FIELD_CLASS}
              value={packageVendor.id}
              onChange={(event) => setPackageVendorId(event.target.value)}
            >
              {packageVendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
            </select>
          </label>
        )}
      </div>

      {desktopDifference && <DifferenceNote text={desktopDifference} className="hidden lg:flex" />}
      {mobileDifference && <DifferenceNote text={mobileDifference} className="flex lg:hidden" />}

      {mode === 'packages' && packageVendor?.status === 'Booked' && packageVendor.bookedContractTotal !== undefined && (
        <p className="rounded-xl border border-[#E5DED2] bg-white px-3.5 py-3 text-xs text-[#22201D]">
          Confirmed contract for {packageVendor.name}{' '}
          <strong className="font-num">{formatCurrency(packageVendor.bookedContractTotal,
            getVendorActiveQuote(packageVendor)?.currency ?? activeWorkspace.currency, { decimals: 2 })}</strong>
        </p>
      )}

      {comparison.entries.length === 0 ? (
        <div className="rounded-2xl border border-[#E5DED2] bg-white p-5 text-center">
          <p className="text-sm font-semibold text-[#22201D]">
            {!selectedEvent
              ? 'Choose an event to compare quotes'
              : mode === 'packages'
                ? 'No vendor with multiple packages for this event and category'
                : 'No quotes for this event and category'}
          </p>
          <p className="mt-1 text-xs text-[#5A544C]">
            {!selectedEvent
              ? 'Add an event and link your vendors to it.'
              : mode === 'packages'
                ? 'Choose another category or import a quote with multiple package tiers.'
                : 'Choose another category or import a quote for a vendor linked to this event.'}
          </p>
        </div>
      ) : (
        <>
          {comparison.entries.length === 1 && (
            <p className="flex items-center gap-2 text-xs text-[#5A544C]">
              <Info className="size-4 shrink-0" aria-hidden="true" />
              Add a second quote for a side-by-side comparison.
            </p>
          )}
          <div role="region" aria-label="Comparison matrix" tabIndex={0} className="hidden min-w-0 overflow-x-auto rounded-2xl border border-[#E5DED2] bg-white lg:block">
            <ComparisonTable {...tableProps} entries={comparison.entries} />
          </div>
          <div className="min-w-0 space-y-2 lg:hidden">
            {left && right && (
              <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
                <label className="min-w-0 space-y-1 text-xs font-medium text-[#5A544C]">
                  <span>Left option</span>
                  <select
                    className={FIELD_CLASS}
                    value={left.id}
                    onChange={(event) => {
                      if (event.target.value === right.id) setRightId(left.id);
                      setLeftId(event.target.value);
                    }}
                  >
                    {comparison.entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
                  </select>
                </label>
                <button
                  type="button"
                  title="Swap comparison columns"
                  aria-label="Swap comparison columns"
                  onClick={() => {
                    setLeftId(right.id);
                    setRightId(left.id);
                  }}
                  className="grid size-10 place-items-center rounded-lg border border-[#D7CDC0] bg-white text-[#486755] hover:bg-[#EAF5EE]"
                >
                  <ArrowLeftRight className="size-4" aria-hidden="true" />
                </button>
                <label className="min-w-0 space-y-1 text-xs font-medium text-[#5A544C]">
                  <span>Right option</span>
                  <select
                    className={FIELD_CLASS}
                    value={right.id}
                    onChange={(event) => {
                      if (event.target.value === left.id) setLeftId(right.id);
                      setRightId(event.target.value);
                    }}
                  >
                    {comparison.entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
                  </select>
                </label>
              </div>
            )}
            <div className="min-w-0 overflow-hidden rounded-xl border border-[#E5DED2] bg-white">
              <ComparisonTable {...tableProps} entries={mobileEntries} mobile />
            </div>
          </div>
        </>
      )}

      {comparison.unquotedVendors.length > 0 && (
        <div className="rounded-2xl border border-[#E5DED2] bg-white p-3.5 sm:p-4">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[#5A544C]">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
            Vendors without a quote
          </div>
          <ul className="divide-y divide-[#F0EAE0] text-xs">
            {comparison.unquotedVendors.map((vendor) => (
              <li key={vendor.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                <button type="button" onClick={() => onOpenVendor(vendor.id)} className="min-w-0 text-left font-medium text-[#22201D] hover:underline">
                  {vendor.name}
                </button>
                <button
                  type="button"
                  aria-label={`Add quote for ${vendor.name}`}
                  onClick={() => onOpenQuoteImport(undefined, vendor.id)}
                  className="inline-flex items-center gap-1.5 font-semibold text-[#486755] hover:underline"
                >
                  <FileUp className="size-3.5" aria-hidden="true" />
                  Add quote
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
