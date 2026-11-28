import React, { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileUp,
  Plus,
  PlusCircle,
  X,
} from 'lucide-react';
import { useWorkspace } from '../store/workspaceStore';
import {
  FollowUpTask,
  ManualExpense,
  PastelTone,
  Quote,
  Vendor,
  VendorCategory,
  WeddingEvent,
  WeddingWorkspace,
} from '../types/vowly';
import { ALL_PASTEL_TONES, PASTEL_TONES } from '../utils/pastelStyles';
import { QuoteImportModal } from './QuoteImportModal';

interface OnboardingFlowProps {
  onCloseToWorkspace: () => void;
}

const OPTIONAL_EVENT_SUGGESTIONS: Array<{
  name: string;
  tone: PastelTone;
}> = [
  { name: 'Mehndi', tone: 'sage' },
  { name: 'Haldi / Maiyan', tone: 'peach' },
  { name: 'Sangeet / Jaggo', tone: 'lavender' },
  { name: 'Wedding Ceremony', tone: 'blush' },
  { name: 'Reception', tone: 'blue' },
];

const OPTIONAL_CATEGORIES: Array<{
  category: VendorCategory;
  label: string;
}> = [
  { category: 'venue', label: 'Venue & Banquet Hall' },
  { category: 'catering', label: 'Catering & Food' },
  { category: 'photography', label: 'Photography' },
  { category: 'videography', label: 'Videography' },
  { category: 'decor', label: 'Decor & Florals' },
  { category: 'dj', label: 'DJ, MC & Sound' },
  { category: 'beauty', label: 'Hair, Makeup & Mehndi' },
  { category: 'transportation', label: 'Transportation' },
];

interface DraftEventInput {
  id: string;
  name: string;
  date: string;
  guestsStr: string;
  tone: PastelTone;
}

function parseOptionalGuests(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  const parsed = parseInt(trimmed, 10);
  return parsed > 0 ? parsed : null;
}

function parseOptionalBudget(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = parseFloat(trimmed);
  return Number.isNaN(parsed) || parsed < 0 ? null : parsed;
}

function formatIsoDateDisplay(iso: string): string {
  if (!iso) return 'Date TBD';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return 'Date TBD';
  return d.toLocaleDateString('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function OnboardingFlow({ onCloseToWorkspace }: OnboardingFlowProps) {
  const { createWorkspace, enterDemoWorkspace, hasExistingWorkspace } =
    useWorkspace();

  const [mode, setMode] = useState<'welcome' | 'scratch'>('welcome');
  const [showImportModal, setShowImportModal] = useState(false);

  // Scratch Step 1: One event first (no silent guest or event defaults)
  const [step, setStep] = useState<1 | 2>(1);
  const [firstEventName, setFirstEventName] = useState('');
  const [firstEventDate, setFirstEventDate] = useState('');
  const [firstEventGuestsStr, setFirstEventGuestsStr] = useState('');
  const [firstEventTone, setFirstEventTone] = useState<PastelTone>('sage');
  const [workspaceCurrency, setWorkspaceCurrency] = useState<WeddingWorkspace['currency']>('CAD');
  const [budgetTargetStr, setBudgetTargetStr] = useState('');
  const [partnerOne, setPartnerOne] = useState('');
  const [partnerTwo, setPartnerTwo] = useState('');

  // Scratch Step 2 (optional): Additional events & optional starting categories
  const [extraEvents, setExtraEvents] = useState<DraftEventInput[]>([]);
  const [customEventName, setCustomEventName] = useState('');
  const [categoryAllowances, setCategoryAllowances] = useState<
    Record<VendorCategory, { enabled: boolean; allowance: string }>
  >({
    venue: { enabled: false, allowance: '' },
    catering: { enabled: false, allowance: '' },
    photography: { enabled: false, allowance: '' },
    videography: { enabled: false, allowance: '' },
    decor: { enabled: false, allowance: '' },
    dj: { enabled: false, allowance: '' },
    entertainment: { enabled: false, allowance: '' },
    beauty: { enabled: false, allowance: '' },
    transportation: { enabled: false, allowance: '' },
    other: { enabled: false, allowance: '' },
  });

  const handleToggleSuggestionEvent = (tpl: { name: string; tone: PastelTone }) => {
    setExtraEvents((prev) => {
      const exists = prev.some(
        (e) => e.name.toLowerCase() === tpl.name.toLowerCase()
      );
      if (exists) {
        return prev.filter(
          (e) => e.name.toLowerCase() !== tpl.name.toLowerCase()
        );
      }
      return [
        ...prev,
        {
          id: `extra-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: tpl.name,
          date: '',
          guestsStr: '',
          tone: tpl.tone,
        },
      ];
    });
  };

  const handleAddCustomEvent = () => {
    const trimmed = customEventName.trim();
    if (!trimmed) return;
    const toneIndex = (extraEvents.length + 1) % ALL_PASTEL_TONES.length;
    setExtraEvents((prev) => [
      ...prev,
      {
        id: `extra-${Date.now()}`,
        name: trimmed,
        date: '',
        guestsStr: '',
        tone: ALL_PASTEL_TONES[toneIndex],
      },
    ]);
    setCustomEventName('');
  };

  const handleBuildFromScratch = () => {
    const primaryName = firstEventName.trim() || 'Wedding Event';
    const p1 = partnerOne.trim();
    const p2 = partnerTwo.trim();
    const coupleNames =
      p1 && p2 ? `${p1} & ${p2}` : p1 || p2 || 'Our Wedding';
    const wsId = `ws-${Date.now()}`;
    const budgetTarget = parseOptionalBudget(budgetTargetStr);
    const primaryGuests = parseOptionalGuests(firstEventGuestsStr);

    const primaryEvent: WeddingEvent = {
      id: `evt-${Date.now()}-0`,
      name: primaryName,
      date: firstEventDate,
      dateDisplay: formatIsoDateDisplay(firstEventDate),
      time: '',
      location: 'Location TBD',
      guestCount: primaryGuests,
      status: 'Early planning',
      budgetAllowance: null,
      tone: firstEventTone,
    };

    const additionalEvents: WeddingEvent[] = extraEvents
      .filter((e) => e.name.trim().length > 0)
      .map((evt, idx) => ({
        id: `evt-${Date.now()}-${idx + 1}`,
        name: evt.name.trim(),
        date: evt.date,
        dateDisplay: formatIsoDateDisplay(evt.date),
        time: '',
        location: 'Location TBD',
        guestCount: parseOptionalGuests(evt.guestsStr),
        status: 'Early planning',
        budgetAllowance: null,
        tone: evt.tone,
      }));

    const events = [primaryEvent, ...additionalEvents];

    const manualExpenses: ManualExpense[] = OPTIONAL_CATEGORIES.filter(
      (c) => categoryAllowances[c.category]?.enabled
    ).map((c, idx) => {
      const parsed = parseOptionalBudget(
        categoryAllowances[c.category]?.allowance ?? ''
      );
      return {
        id: `exp-init-${Date.now()}-${idx}`,
        name: c.label,
        eventIds: [primaryEvent.id],
        category: c.category,
        budgetAllowance: parsed,
        estimatedAmount: parsed,
        committedAmount: 0,
        paidAmount: 0,
        priceSource:
          parsed !== null ? 'User-entered allowance' : 'Unpriced / TBD',
        status: parsed !== null ? 'Planned' : 'Unpriced',
        notes:
          parsed !== null
            ? 'Starting budget allowance'
            : 'Import a vendor quote or add an allowance when ready.',
      };
    });

    const p1Name = p1 || 'You';
    const partners = [
      {
        id: `p-${Date.now()}-1`,
        name: p1Name,
        email: '',
        initials: p1Name.slice(0, 2).toUpperCase(),
        roleLabel: 'Partner' as const,
        status: 'Active' as const,
        tone: 'lavender' as PastelTone,
      },
      ...(p2
        ? [
            {
              id: `p-${Date.now()}-2`,
              name: p2,
              email: '',
              initials: p2.slice(0, 2).toUpperCase(),
              roleLabel: 'Partner' as const,
              status: 'Invited' as const,
              tone: 'sage' as PastelTone,
            },
          ]
        : []),
    ];

    const nextTask: FollowUpTask = {
      id: `task-first-quote-${Date.now()}`,
      title: `Import your first quote for ${primaryEvent.name}`,
      description:
        'Paste a vendor message, PDF, or screenshot to turn estimates into real numbers.',
      eventId: primaryEvent.id,
      assigneePartnerId: partners[0].id,
      priority: 'medium',
      kind: 'missing_quote',
      status: 'Open',
    };

    const newWs: WeddingWorkspace = {
      id: wsId,
      name: `${coupleNames} Wedding`,
      coupleNames,
      location: 'Ontario, Canada',
      dateRangeLabel: firstEventDate
        ? formatIsoDateDisplay(firstEventDate)
        : 'Date TBD',
      weddingStyle: 'Wedding Plan',
      currency: workspaceCurrency,
      budgetTarget,
      isDemoWorkspace: false,
      partners,
      events,
      vendors: [],
      manualExpenses,
      payments: [],
      tasks: [nextTask],
      activities: [
        {
          id: `act-init-${Date.now()}`,
          timestampLabel: 'Just now',
          actorName: p1Name,
          summary: `Started workspace with ${events.length} ${
            events.length === 1 ? 'event' : 'events'
          }.`,
          category: 'event',
        },
      ],
    };

    createWorkspace(newWs);
  };

  const handleBuildFromImportedQuote = (payload: {
    vendorName: string;
    category: VendorCategory;
    location: string;
    isDemoVenue: boolean;
    quote: Quote;
    asDraft: boolean;
    eventName: string;
    plannedGuests: number | null;
  }) => {
    const evtId = `evt-import-${Date.now()}`;
    const vendorId = `ven-import-${Date.now()}`;

    // Strictly keep vendor minimum (quote.minGuests) separate from couple's planned attendance (event.guestCount)
    const newEvent: WeddingEvent = {
      id: evtId,
      name: payload.eventName,
      date: '',
      dateDisplay: 'Date TBD',
      time: '',
      location: payload.location || 'Location TBD',
      guestCount: payload.plannedGuests,
      status: 'Shortlisting',
      budgetAllowance: null,
      tone: 'sage',
    };

    const vendor: Vendor = {
      id: vendorId,
      name: payload.vendorName,
      category: payload.category,
      eventIds: [evtId],
      location: payload.location || 'Ontario, Canada',
      contactName: '',
      contactEmail: '',
      contactPhone: '',
      status: payload.asDraft ? 'Revision pending' : 'Quoted',
      isPreferred: !payload.asDraft,
      isDemoVenue: payload.isDemoVenue,
      notes: 'Imported when starting workspace.',
      quotes: payload.asDraft
        ? []
        : [{ ...payload.quote, approvalState: 'approved' }],
      activeQuoteId: payload.asDraft ? undefined : payload.quote.id,
      draftQuote: payload.asDraft
        ? { ...payload.quote, approvalState: 'draft' }
        : undefined,
    };

    const hasPerPersonPricing = payload.quote.lineItems.some(
      (li) => li.pricingModel === 'per_person' || li.pricingModel === 'guest_ratio'
    );

    let nextActionTask: FollowUpTask;
    if (payload.asDraft) {
      nextActionTask = {
        id: `task-draft-${vendorId}`,
        title: `Resolve draft quote for ${payload.vendorName}`,
        description:
          'Confirm missing fees or conflicting prices to approve this estimate.',
        vendorId,
        eventId: evtId,
        assigneePartnerId: 'p-owner-1',
        priority: 'high',
        kind: 'draft_quote',
        status: 'Open',
      };
    } else if (payload.plannedGuests === null && hasPerPersonPricing) {
      nextActionTask = {
        id: `task-guests-${evtId}`,
        title: `Add planned guest count for ${newEvent.name}`,
        description: payload.quote.minGuests
          ? `Vendor minimum is ${payload.quote.minGuests} guests. Add your planned attendance separately.`
          : 'Enter your planned attendance to refine per-guest totals.',
        eventId: evtId,
        assigneePartnerId: 'p-owner-1',
        priority: 'medium',
        kind: 'missing_quote',
        status: 'Open',
      };
    } else {
      nextActionTask = {
        id: `task-compare-${vendorId}`,
        title: `Import a second quote to compare with ${payload.vendorName}`,
        description:
          'Compare all-in pricing side by side under the same guest count.',
        eventId: evtId,
        assigneePartnerId: 'p-owner-1',
        priority: 'medium',
        kind: 'missing_quote',
        status: 'Open',
      };
    }

    const newWs: WeddingWorkspace = {
      id: `ws-import-${Date.now()}`,
      name: `Our Wedding (${payload.vendorName})`,
      coupleNames: 'Our Wedding',
      location: payload.location || 'Location TBD',
      dateRangeLabel: 'Date TBD',
      weddingStyle: 'Wedding Plan',
      currency: payload.quote.currency === 'USD' ? 'USD' : 'CAD',
      budgetTarget: null,
      isDemoWorkspace: payload.isDemoVenue,
      partners: [
        {
          id: 'p-owner-1',
          name: 'You',
          email: '',
          initials: 'YO',
          roleLabel: 'Partner',
          status: 'Active',
          tone: 'sage',
        },
      ],
      events: [newEvent],
      vendors: [vendor],
      manualExpenses: [],
      payments: [],
      tasks: [nextActionTask],
      activities: [
        {
          id: `act-imp-${Date.now()}`,
          timestampLabel: 'Just now',
          actorName: 'You',
          summary: `Imported ${payload.vendorName} (${
            payload.asDraft ? 'draft' : 'approved quote'
          }).`,
          category: 'quote',
        },
      ],
    };

    return createWorkspace(newWs, payload.quote.manualEntry);
  };

  const canContinueStep1 = firstEventName.trim().length > 0;

  return (
    <div className="min-h-screen bg-[#FAF8F4] flex flex-col">
      {/* Top Bar */}
      <header className="px-6 py-4 border-b border-[#E5DED2] bg-white/85 backdrop-blur-xs flex items-center justify-between gap-4">
        <span className="font-editorial text-xl font-semibold text-[#22201D]">
          Vowly
        </span>
        {hasExistingWorkspace && (
          <button
            type="button"
            onClick={onCloseToWorkspace}
            className="text-xs font-medium text-[#486755] hover:underline cursor-pointer"
          >
            Cancel & return to workspace
          </button>
        )}
      </header>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
        {mode === 'welcome' ? (
          <div className="w-full max-w-3xl space-y-8">
            <div className="text-center max-w-xl mx-auto">
              <h1 className="font-editorial text-3xl sm:text-4xl font-medium text-[#22201D]">
                Your wedding budget, organized calmly
              </h1>
              <p className="mt-2.5 text-sm text-[#6B655C]">
                Start with a vendor quote or set up your first event.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Path 1: Import a quote */}
              <button
                type="button"
                onClick={() => setShowImportModal(true)}
                className="text-left rounded-2xl bg-[#DFF0E4] border border-[#B0D2B8] hover:border-[#486755] p-6 transition-all flex flex-col justify-between cursor-pointer group"
              >
                <div>
                  <div className="w-10 h-10 rounded-xl bg-white border border-[#B0D2B8] flex items-center justify-center text-[#1F402E]">
                    <FileUp className="w-5 h-5" />
                  </div>
                  <h2 className="mt-4 text-lg font-semibold text-[#1F402E]">
                    Import a quote
                  </h2>
                  <p className="mt-1.5 text-xs sm:text-sm text-[#234331] leading-relaxed">
                    Paste one vendor message, PDF, or screenshot to extract pricing, review assumptions, and create your workspace.
                  </p>
                </div>
                <div className="mt-6 inline-flex items-center gap-1.5 text-xs font-semibold text-[#1F402E] group-hover:translate-x-0.5 transition-transform">
                  Import first quote
                  <ArrowRight className="w-4 h-4" />
                </div>
              </button>

              {/* Path 2: Start from scratch */}
              <button
                type="button"
                onClick={() => {
                  setMode('scratch');
                  setStep(1);
                }}
                className="text-left rounded-2xl bg-[#EAE2F8] border border-[#C6B4E8] hover:border-[#412E6B] p-6 transition-all flex flex-col justify-between cursor-pointer group"
              >
                <div>
                  <div className="w-10 h-10 rounded-xl bg-white border border-[#C6B4E8] flex items-center justify-center text-[#412E6B]">
                    <PlusCircle className="w-5 h-5" />
                  </div>
                  <h2 className="mt-4 text-lg font-semibold text-[#38275D]">
                    Start from scratch
                  </h2>
                  <p className="mt-1.5 text-xs sm:text-sm text-[#412E6B] leading-relaxed">
                    Add your first event now and skip guest count or budget until you are ready. Add more events anytime.
                  </p>
                </div>
                <div className="mt-6 inline-flex items-center gap-1.5 text-xs font-semibold text-[#38275D] group-hover:translate-x-0.5 transition-transform">
                  Add your first event
                  <ArrowRight className="w-4 h-4" />
                </div>
              </button>
            </div>

            {/* Quieter Explore Demo link */}
            <div className="text-center pt-1">
              <button
                type="button"
                onClick={enterDemoWorkspace}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-[#6B655C] hover:text-[#22201D] rounded-xl border border-transparent hover:border-[#E5DED2] hover:bg-white transition-colors cursor-pointer"
              >
                Explore demo
                <span className="text-[#9A9388]">·</span>
                <span className="text-[#6B655C]">
                  Meera & Kabir’s GTA multi-event wedding (illustrative data)
                </span>
              </button>
            </div>
          </div>
        ) : (
          /* START FROM SCRATCH WIZARD */
          <div className="w-full max-w-xl rounded-2xl bg-white border border-[#E5DED2] p-6 sm:p-7 space-y-6">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => (step > 1 ? setStep(1) : setMode('welcome'))}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#6B655C] hover:text-[#22201D] cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back
              </button>
              <span className="text-xs font-medium text-[#6B655C]">
                Step {step} of 2
              </span>
            </div>

            {step === 1 && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-xl font-semibold text-[#22201D]">
                    Start with one event
                  </h2>
                  <p className="text-xs text-[#6B655C] mt-0.5">
                    Guest count and budget are optional—leave them blank if undecided.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="first-event-name"
                    className="block text-xs font-medium text-[#22201D] mb-1"
                  >
                    Event name
                  </label>
                  <input
                    id="first-event-name"
                    type="text"
                    value={firstEventName}
                    onChange={(e) => setFirstEventName(e.target.value)}
                    placeholder="e.g., Reception, Sangeet, Wedding Ceremony"
                    className="w-full rounded-xl border border-[#E5DED2] px-3.5 py-2.5 text-sm text-[#22201D]"
                  />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {OPTIONAL_EVENT_SUGGESTIONS.map((tpl) => (
                      <button
                        key={tpl.name}
                        type="button"
                        onClick={() => {
                          setFirstEventName(tpl.name);
                          setFirstEventTone(tpl.tone);
                        }}
                        className="px-2.5 py-1 text-[11px] rounded-lg border border-[#E5DED2] bg-[#FAF8F4] text-[#5A544C] hover:border-[#486755] cursor-pointer"
                      >
                        {tpl.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label
                      htmlFor="first-event-guests"
                      className="block text-xs font-medium text-[#22201D] mb-1"
                    >
                      Planned guests (optional)
                    </label>
                    <input
                      id="first-event-guests"
                      type="text"
                      inputMode="numeric"
                      value={firstEventGuestsStr}
                      onChange={(e) => setFirstEventGuestsStr(e.target.value)}
                      placeholder="Skip if unsure"
                      className="w-full rounded-xl border border-[#E5DED2] px-3.5 py-2.5 font-num text-sm placeholder:font-sans placeholder:text-[#9A9388]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="first-event-date"
                      className="block text-xs font-medium text-[#22201D] mb-1"
                    >
                      Date (optional)
                    </label>
                    <input
                      id="first-event-date"
                      type="date"
                      value={firstEventDate}
                      onChange={(e) => setFirstEventDate(e.target.value)}
                      className="w-full rounded-xl border border-[#E5DED2] px-3.5 py-2.5 text-xs text-[#22201D]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  <div>
                    <label
                      htmlFor="workspace-currency"
                      className="block text-xs font-medium text-[#22201D] mb-1"
                    >
                      Workspace currency
                    </label>
                    <select
                      id="workspace-currency"
                      value={workspaceCurrency}
                      onChange={(e) => setWorkspaceCurrency(e.target.value === 'USD' ? 'USD' : 'CAD')}
                      className="w-full rounded-xl border border-[#E5DED2] bg-white px-3.5 py-2.5 text-xs text-[#22201D]"
                    >
                      <option value="CAD">CAD (Canadian dollar)</option>
                      <option value="USD">USD (US dollar)</option>
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="overall-budget"
                      className="block text-xs font-medium text-[#22201D] mb-1"
                    >
                      Wedding budget target ({workspaceCurrency}, optional)
                    </label>
                    <input
                      id="overall-budget"
                      type="text"
                      inputMode="decimal"
                      value={budgetTargetStr}
                      onChange={(e) => setBudgetTargetStr(e.target.value)}
                      placeholder="Skip if undecided"
                      className="w-full rounded-xl border border-[#E5DED2] px-3.5 py-2.5 font-num text-sm placeholder:font-sans placeholder:text-[#9A9388]"
                    />
                  </div>
                  <div>
                    <span className="block text-xs font-medium text-[#22201D] mb-1.5">
                      Event color
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {ALL_PASTEL_TONES.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setFirstEventTone(t)}
                          className={`px-2.5 py-1.5 rounded-lg border text-[11px] cursor-pointer ${
                            PASTEL_TONES[t].surfaceBg
                          } ${PASTEL_TONES[t].ink} ${
                            firstEventTone === t
                              ? 'border-[#22201D] font-semibold'
                              : PASTEL_TONES[t].border
                          }`}
                        >
                          {PASTEL_TONES[t].label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1 border-t border-[#F0EAE0]">
                  <div>
                    <label className="block text-xs font-medium text-[#6B655C] mb-1">
                      Partner 1 name (optional)
                    </label>
                    <input
                      type="text"
                      value={partnerOne}
                      onChange={(e) => setPartnerOne(e.target.value)}
                      placeholder="e.g., Rhea"
                      className="w-full rounded-xl border border-[#E5DED2] px-3.5 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#6B655C] mb-1">
                      Partner 2 name (optional)
                    </label>
                    <input
                      type="text"
                      value={partnerTwo}
                      onChange={(e) => setPartnerTwo(e.target.value)}
                      placeholder="e.g., Dev"
                      className="w-full rounded-xl border border-[#E5DED2] px-3.5 py-2 text-xs"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                  {hasExistingWorkspace ? (
                    <button
                      type="button"
                      onClick={onCloseToWorkspace}
                      className="px-3.5 py-2 text-xs font-medium text-[#6B655C] hover:text-[#22201D] cursor-pointer"
                    >
                      Cancel
                    </button>
                  ) : (
                    <span />
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={!canContinueStep1}
                      onClick={handleBuildFromScratch}
                      className={`px-4 py-2.5 text-xs font-medium rounded-xl border transition-colors ${
                        canContinueStep1
                          ? 'border-[#E5DED2] bg-[#FAF8F4] text-[#22201D] hover:bg-[#EFEBE2] cursor-pointer'
                          : 'border-[#E5DED2] text-[#9A9388] cursor-not-allowed'
                      }`}
                    >
                      Create now
                    </button>
                    <button
                      type="button"
                      disabled={!canContinueStep1}
                      onClick={() => setStep(2)}
                      className={`inline-flex items-center gap-1.5 px-5 py-2.5 text-xs font-semibold rounded-xl transition-colors ${
                        canContinueStep1
                          ? 'bg-[#486755] text-white hover:bg-[#395344] cursor-pointer'
                          : 'bg-[#E5DED2] text-[#9A9388] cursor-not-allowed'
                      }`}
                    >
                      Add more events or categories
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-xl font-semibold text-[#22201D]">
                    Optional: more events & categories
                  </h2>
                  <p className="text-xs text-[#6B655C] mt-0.5">
                    Add other events or budget categories now, or skip and create with just {firstEventName.trim()}.
                  </p>
                </div>

                {/* Additional Events */}
                <div className="space-y-2.5">
                  <div className="text-xs font-semibold text-[#22201D]">
                    Additional events (optional)
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {OPTIONAL_EVENT_SUGGESTIONS.filter(
                      (tpl) =>
                        tpl.name.toLowerCase() !==
                        firstEventName.trim().toLowerCase()
                    ).map((tpl) => {
                      const active = extraEvents.some(
                        (e) => e.name.toLowerCase() === tpl.name.toLowerCase()
                      );
                      return (
                        <button
                          key={tpl.name}
                          type="button"
                          onClick={() => handleToggleSuggestionEvent(tpl)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-xl border cursor-pointer transition-colors ${
                            active
                              ? `${PASTEL_TONES[tpl.tone].surfaceBg} ${PASTEL_TONES[tpl.tone].border} ${PASTEL_TONES[tpl.tone].ink}`
                              : 'bg-[#FAF8F4] border-[#E5DED2] text-[#6B655C]'
                          }`}
                        >
                          {active ? '✓ ' : '+ '}
                          {tpl.name}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={customEventName}
                      onChange={(e) => setCustomEventName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddCustomEvent();
                        }
                      }}
                      placeholder="Add another event name..."
                      className="flex-1 rounded-xl border border-[#E5DED2] px-3 py-2 text-xs"
                    />
                    <button
                      type="button"
                      onClick={handleAddCustomEvent}
                      className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium rounded-xl border border-[#E5DED2] bg-[#FAF8F4] hover:bg-[#EFEBE2] cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add
                    </button>
                  </div>

                  {extraEvents.length > 0 && (
                    <div className="divide-y divide-[#F0EAE0] border border-[#E5DED2] rounded-xl overflow-hidden">
                      {extraEvents.map((evt) => (
                        <div
                          key={evt.id}
                          className="px-3.5 py-2 flex items-center justify-between gap-2 bg-[#FAF8F4]"
                        >
                          <span className="text-xs font-medium text-[#22201D] truncate">
                            {evt.name}
                          </span>
                          <div className="flex items-center gap-2 shrink-0">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={evt.guestsStr}
                              onChange={(e) =>
                                setExtraEvents((prev) =>
                                  prev.map((item) =>
                                    item.id === evt.id
                                      ? { ...item, guestsStr: e.target.value }
                                      : item
                                  )
                                )
                              }
                              placeholder="Guests (TBD)"
                              className="w-24 rounded-lg border border-[#E5DED2] bg-white px-2 py-1 text-right font-num text-xs placeholder:font-sans placeholder:text-[#9A9388]"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setExtraEvents((prev) =>
                                  prev.filter((item) => item.id !== evt.id)
                                )
                              }
                              className="p-1 text-[#6B655C] hover:text-[#B91C1C] cursor-pointer"
                              aria-label={`Remove ${evt.name}`}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Optional Starting Categories */}
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-[#22201D]">
                    Starting budget categories (optional, no invented prices)
                  </div>
                  <div className="divide-y divide-[#F0EAE0] border border-[#E5DED2] rounded-xl overflow-hidden max-h-52 overflow-y-auto">
                    {OPTIONAL_CATEGORIES.map((item) => {
                      const state = categoryAllowances[item.category];
                      return (
                        <div
                          key={item.category}
                          className="px-3.5 py-2 flex items-center justify-between gap-3 bg-white"
                        >
                          <label className="flex items-center gap-2 text-xs font-medium text-[#22201D] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={state.enabled}
                              onChange={() =>
                                setCategoryAllowances((prev) => ({
                                  ...prev,
                                  [item.category]: {
                                    ...prev[item.category],
                                    enabled: !prev[item.category].enabled,
                                  },
                                }))
                              }
                              className="accent-[#486755]"
                            />
                            {item.label}
                          </label>
                          {state.enabled && (
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="Allowance (TBD)"
                              value={state.allowance}
                              onChange={(e) =>
                                setCategoryAllowances((prev) => ({
                                  ...prev,
                                  [item.category]: {
                                    ...prev[item.category],
                                    allowance: e.target.value,
                                  },
                                }))
                              }
                              className="w-32 rounded-lg border border-[#E5DED2] bg-[#FAF8F4] px-2.5 py-1 text-right font-num text-xs placeholder:font-sans placeholder:text-[#9A9388]"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  {hasExistingWorkspace ? (
                    <button
                      type="button"
                      onClick={onCloseToWorkspace}
                      className="px-3.5 py-2 text-xs font-medium text-[#6B655C] hover:text-[#22201D] cursor-pointer"
                    >
                      Cancel
                    </button>
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    onClick={handleBuildFromScratch}
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 text-xs font-semibold rounded-xl bg-[#486755] text-white hover:bg-[#395344] cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    Create Workspace
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <QuoteImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onCompleteForOnboarding={handleBuildFromImportedQuote}
      />
    </div>
  );
}
