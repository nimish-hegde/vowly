import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  FileText,
  FileUp,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Save,
  X,
} from 'lucide-react';
import {
  calculateQuoteFinancials,
  CATEGORY_META,
  formatCurrency,
  formatShortCad,
} from '../engine/financialCalculator';
import {
  quoteExtractor,
  SAMPLE_QUOTE_PRESETS,
} from '../services/quoteExtractor';
import { useWorkspace } from '../store/workspaceStore';
import {
  CurrencyCode,
  Quote,
  TaxHandling,
  Vendor,
  VendorCategory,
} from '../types/vowly';
import { DemoDataNote } from './DemoLabel';

interface QuoteImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialPresetId?: string;
  initialVendorId?: string;
  resumeDraftForVendorId?: string;
  onCompleteForOnboarding?: (payload: {
    vendorName: string;
    category: VendorCategory;
    location: string;
    isDemoVenue: boolean;
    quote: Quote;
    asDraft: boolean;
    eventName: string;
    plannedGuests: number | null;
  }) => void;
}

const EXTRACTION_STEPS = [
  'Reading source text & pricing clauses...',
  'Identifying vendor, events & Canadian location context...',
  'Extracting line items, fees, add-ons & Ontario 13% HST rules...',
  'Checking for conflicting prices and unconfirmed mandatory fees...',
];

export function QuoteImportModal({
  isOpen,
  onClose,
  initialPresetId,
  initialVendorId,
  resumeDraftForVendorId,
  onCompleteForOnboarding,
}: QuoteImportModalProps) {
  const { activeWorkspace, saveDraftQuote, approveQuote } = useWorkspace();

  const [step, setStep] = useState<'input' | 'extracting' | 'review'>('input');
  const [extractProgressIdx, setExtractProgressIdx] = useState(0);

  // Input state
  const [sourceType, setSourceType] = useState<'pasted_message' | 'pdf' | 'screenshot'>('pasted_message');
  const [sourceChannel, setSourceChannel] = useState('WhatsApp message');
  const [rawText, setRawText] = useState('');
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  const [selectedPresetId, setSelectedPresetId] = useState<string | undefined>(undefined);

  // Review state
  const [vendorName, setVendorName] = useState('');
  const [vendorCategory, setVendorCategory] = useState<VendorCategory>('venue');
  const [vendorLocation, setVendorLocation] = useState('Mississauga, ON, Canada');
  const [isDemoVenue, setIsDemoVenue] = useState(false);
  const [linkedVendorId, setLinkedVendorId] = useState<string | null>(null);
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
  const [draftQuote, setDraftQuote] = useState<Quote | null>(null);
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<'extracted' | 'source'>('extracted');
  const [feeInputs, setFeeInputs] = useState<Record<string, string>>({});
  const [onboardingEventName, setOnboardingEventName] = useState('');
  const [onboardingPlannedGuests, setOnboardingPlannedGuests] = useState('');

  // Reset / initialize whenever modal opens
  useEffect(() => {
    if (!isOpen) return;

    if (resumeDraftForVendorId) {
      const existingVendor = activeWorkspace.vendors.find(
        (v) => v.id === resumeDraftForVendorId
      );
      if (existingVendor?.draftQuote) {
        const staged = existingVendor.draftVendorMetadata;
        setLinkedVendorId(existingVendor.id);
        setVendorName(staged?.name ?? existingVendor.name);
        setVendorCategory(staged?.category ?? existingVendor.category);
        setVendorLocation(staged?.location ?? existingVendor.location);
        setIsDemoVenue(Boolean(staged?.isDemoVenue ?? existingVendor.isDemoVenue));
        setSelectedEventIds(staged?.eventIds ?? existingVendor.eventIds);
        setDraftQuote(structuredClone(existingVendor.draftQuote));
        setStep('review');
        setMobilePane('extracted');
        return;
      }
    }

    setStep('input');
    setDraftQuote(null);
    setActiveEvidenceId(null);
    setFeeInputs({});
    setLinkedVendorId(initialVendorId ?? null);

    if (initialPresetId) {
      const preset = SAMPLE_QUOTE_PRESETS.find((p) => p.id === initialPresetId);
      if (preset) {
        setSelectedPresetId(preset.id);
        setSourceType(preset.sourceType);
        setSourceChannel(preset.sourceChannel);
        setRawText(preset.rawText);
        setFileName(preset.sourceType !== 'pasted_message' ? `${preset.label}.pdf` : undefined);
        return;
      }
    }

    setSelectedPresetId(undefined);
    setSourceType('pasted_message');
    setSourceChannel('WhatsApp message');
    setRawText('');
    setFileName(undefined);
  }, [isOpen, initialPresetId, initialVendorId, resumeDraftForVendorId]);

  const onboardingEventsPreview = useMemo(() => {
    if (!onCompleteForOnboarding) return activeWorkspace.events;
    const parsedGuests =
      onboardingPlannedGuests.trim() !== '' &&
      /^\d+$/.test(onboardingPlannedGuests.trim())
        ? parseInt(onboardingPlannedGuests.trim(), 10)
        : null;
    return [
      {
        id: 'onboarding-preview-evt',
        name: onboardingEventName.trim() || 'Wedding Event',
        date: '',
        dateDisplay: 'Date TBD',
        time: '',
        location: vendorLocation || 'Location TBD',
        guestCount: parsedGuests,
        status: 'Shortlisting' as const,
        budgetAllowance: null,
        tone: 'sage' as const,
      },
    ];
  }, [
    onCompleteForOnboarding,
    activeWorkspace.events,
    onboardingEventName,
    onboardingPlannedGuests,
    vendorLocation,
  ]);

  const calc = useMemo(() => {
    if (!draftQuote) return null;
    return calculateQuoteFinancials(
      draftQuote,
      onboardingEventsPreview,
      onCompleteForOnboarding ? ['onboarding-preview-evt'] : selectedEventIds
    );
  }, [
    draftQuote,
    onboardingEventsPreview,
    onCompleteForOnboarding,
    selectedEventIds,
  ]);

  if (!isOpen) return null;

  const handleSelectPreset = (presetId: string) => {
    const preset = SAMPLE_QUOTE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setSelectedPresetId(preset.id);
    setSourceType(preset.sourceType);
    setSourceChannel(preset.sourceChannel);
    setRawText(preset.rawText);
    setFileName(
      preset.sourceType === 'pdf'
        ? `${preset.id}.pdf`
        : preset.sourceType === 'screenshot'
          ? `${preset.id}.png`
          : undefined
    );
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setSelectedPresetId(undefined);
    if (!rawText.trim()) {
      setRawText(
        `Uploaded ${sourceType === 'pdf' ? 'PDF document' : 'screenshot'}: ${file.name}\nVendor location: Mississauga, Ontario\nPackage quote: $4,200 + 13% HST\nMandatory setup/delivery fee: TBD`
      );
    }
  };

  const handleRunExtraction = async () => {
    if (!rawText.trim() && !fileName) return;
    setStep('extracting');
    setExtractProgressIdx(0);

    const timer1 = window.setTimeout(() => setExtractProgressIdx(1), 350);
    const timer2 = window.setTimeout(() => setExtractProgressIdx(2), 700);
    const timer3 = window.setTimeout(() => setExtractProgressIdx(3), 1050);

    try {
      const result = await quoteExtractor.extractQuote({
        sourceType,
        sourceChannel,
        rawText,
        fileName,
        presetId: selectedPresetId,
        targetVendorId: linkedVendorId ?? undefined,
      });

      await new Promise((r) => setTimeout(r, 750));
      window.clearTimeout(timer1);
      window.clearTimeout(timer2);
      window.clearTimeout(timer3);

      setVendorName(result.suggestedVendorName);
      setVendorCategory(result.suggestedCategory);
      setVendorLocation(result.suggestedLocation);
      setIsDemoVenue(result.isDemoVenue);
      setDraftQuote(result.quote);
      if (onCompleteForOnboarding) {
        setOnboardingEventName(
          result.suggestedCategory === 'venue' ? 'Reception' : 'Wedding Event'
        );
        setOnboardingPlannedGuests('');
      }

      // Match existing vendor if ID suggested or name matches
      const matchedVendor =
        (linkedVendorId &&
          activeWorkspace.vendors.find((v) => v.id === linkedVendorId)) ||
        (result.isRevisionOfExistingVendorId &&
          activeWorkspace.vendors.find(
            (v) => v.id === result.isRevisionOfExistingVendorId
          )) ||
        activeWorkspace.vendors.find(
          (v) =>
            v.name.toLowerCase() === result.suggestedVendorName.toLowerCase()
        );

      if (matchedVendor) {
        setLinkedVendorId(matchedVendor.id);
        setSelectedEventIds(matchedVendor.eventIds);
      } else {
        setLinkedVendorId(null);
        const defaultEvt =
          result.suggestedCategory === 'venue'
            ? activeWorkspace.events.find((e) =>
                e.name.toLowerCase().includes('reception')
              )?.id ?? activeWorkspace.events[0]?.id
            : activeWorkspace.events[0]?.id;
        setSelectedEventIds(defaultEvt ? [defaultEvt] : []);
      }

      setStep('review');
      setMobilePane('extracted');
    } catch {
      setStep('input');
    }
  };

  const updateQuote = (updater: (q: Quote) => Quote) => {
    setDraftQuote((prev) => (prev ? updater(prev) : prev));
  };

  const handleSave = (asDraft: boolean) => {
    if (!draftQuote) return;
    if (!asDraft && calc && !calc.canApprove) return;

    if (onCompleteForOnboarding) {
      const parsedPlanned =
        onboardingPlannedGuests.trim() !== '' &&
        /^\d+$/.test(onboardingPlannedGuests.trim()) &&
        parseInt(onboardingPlannedGuests.trim(), 10) > 0
          ? parseInt(onboardingPlannedGuests.trim(), 10)
          : null;
      onCompleteForOnboarding({
        vendorName: vendorName.trim() || 'Imported Vendor',
        category: vendorCategory,
        location: vendorLocation,
        isDemoVenue,
        quote: draftQuote,
        asDraft,
        eventName:
          onboardingEventName.trim() ||
          (vendorCategory === 'venue' ? 'Reception' : 'Wedding Event'),
        plannedGuests: parsedPlanned,
      });
      onClose();
      return;
    }

    const newVendorPayload: Omit<Vendor, 'id' | 'quotes'> = {
      name: vendorName.trim() || 'Imported Vendor',
      category: vendorCategory,
      eventIds: selectedEventIds,
      location: vendorLocation,
      contactName: '',
      contactEmail: '',
      contactPhone: '',
      status: asDraft ? 'Revision pending' : 'Quoted',
      isPreferred: !asDraft,
      isDemoVenue,
      notes: '',
    };

    if (asDraft) {
      saveDraftQuote(linkedVendorId, newVendorPayload, draftQuote);
    } else {
      approveQuote(linkedVendorId, newVendorPayload, draftQuote);
    }
    onClose();
  };

  // Highlight active evidence excerpt inside source text
  const renderHighlightedSource = () => {
    if (!draftQuote) return null;
    const text = draftQuote.sourceText;
    const activeSpan = draftQuote.evidenceSpans.find(
      (s) => s.id === activeEvidenceId
    );
    if (!activeSpan || !text.includes(activeSpan.excerpt)) {
      return (
        <pre className="whitespace-pre-wrap font-sans text-xs sm:text-sm text-[#22201D] leading-relaxed">
          {text}
        </pre>
      );
    }
    const idx = text.indexOf(activeSpan.excerpt);
    const before = text.slice(0, idx);
    const match = text.slice(idx, idx + activeSpan.excerpt.length);
    const after = text.slice(idx + activeSpan.excerpt.length);
    return (
      <pre className="whitespace-pre-wrap font-sans text-xs sm:text-sm text-[#22201D] leading-relaxed">
        {before}
        <mark className="bg-[#FCE9B8] text-[#22201D] px-1 py-0.5 rounded font-medium">
          {match}
        </mark>
        {after}
      </pre>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="AI Quote Import and Review"
    >
      <div className="bg-[#FAF8F4] border border-[#E5DED2] rounded-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden shadow-xl">
        {/* Top Modal Header */}
        <div className="px-5 py-4 bg-white border-b border-[#E5DED2] flex items-center justify-between gap-4 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-semibold text-[#22201D]">
                {step === 'input'
                  ? 'Import Vendor Quote'
                  : step === 'extracting'
                    ? 'Extracting Quote Details'
                    : 'Review & Verify Extracted Quote'}
              </h2>
              {step === 'review' && isDemoVenue && <DemoDataNote />}
            </div>
            <p className="text-xs text-[#6B655C]">
              {step === 'input'
                ? 'Import one quote at a time from a pasted email, WhatsApp/IG message, PDF, or screenshot.'
                : step === 'extracting'
                  ? 'Parsing pricing clauses, Ontario HST rules, and potential ambiguities.'
                  : 'Verify every extracted figure against its source passage. Approving updates estimates without booking.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-[#6B655C] hover:text-[#22201D] hover:bg-[#F3EFE8] cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* STEP 1: INPUT */}
        {step === 'input' && (
          <div className="p-5 sm:p-6 overflow-y-auto space-y-6">
            {/* Quick Try Presets */}
            <div>
              <div className="text-xs font-semibold text-[#22201D] mb-2.5">
                Try a realistic GTA sample quote (one click to populate):
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {SAMPLE_QUOTE_PRESETS.map((preset) => {
                  const isActive = selectedPresetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleSelectPreset(preset.id)}
                      className={`text-left rounded-xl border p-3.5 transition-all cursor-pointer ${
                        isActive
                          ? 'bg-[#E7F1EA] border-[#486755]'
                          : 'bg-white border-[#E5DED2] hover:bg-[#F7F4FC] hover:border-[#D7CBEB]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[#22201D]">
                          {preset.label}
                        </span>
                        {preset.isDemoVenue && <DemoDataNote compact />}
                      </div>
                      <div className="mt-1 text-[11px] font-medium text-[#4C3B70]">
                        {preset.badge}
                      </div>
                      <p className="mt-1 text-xs text-[#6B655C] leading-snug">
                        {preset.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Source Type Tabs */}
            <div className="bg-white rounded-2xl border border-[#E5DED2] p-5 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSourceType('pasted_message');
                    setSourceChannel('WhatsApp / Email message');
                  }}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-xl cursor-pointer transition-colors ${
                    sourceType === 'pasted_message'
                      ? 'bg-[#486755] text-white'
                      : 'bg-[#F3EFE8] text-[#6B655C] hover:text-[#22201D]'
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Paste Email / WhatsApp / IG Message
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSourceType('pdf');
                    setSourceChannel('PDF Quote');
                  }}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-xl cursor-pointer transition-colors ${
                    sourceType === 'pdf'
                      ? 'bg-[#486755] text-white'
                      : 'bg-[#F3EFE8] text-[#6B655C] hover:text-[#22201D]'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  Upload PDF
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSourceType('screenshot');
                    setSourceChannel('Screenshot / Image');
                  }}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-xl cursor-pointer transition-colors ${
                    sourceType === 'screenshot'
                      ? 'bg-[#486755] text-white'
                      : 'bg-[#F3EFE8] text-[#6B655C] hover:text-[#22201D]'
                  }`}
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  Upload Screenshot / Image
                </button>
              </div>

              {(sourceType === 'pdf' || sourceType === 'screenshot') && (
                <label className="block rounded-xl border border-dashed border-[#C5DEC9] bg-[#F3F8F5] p-5 text-center cursor-pointer hover:bg-[#E7F1EA] transition-colors">
                  <FileUp className="w-5 h-5 text-[#486755] mx-auto" />
                  <div className="mt-2 text-xs font-medium text-[#22201D]">
                    {fileName
                      ? `Selected file: ${fileName}`
                      : `Choose a single ${sourceType === 'pdf' ? 'PDF document' : 'PNG/JPG screenshot'}`}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[#6B655C]">
                    Simulated prototype upload — file stays in your browser
                  </div>
                  <input
                    type="file"
                    accept={sourceType === 'pdf' ? '.pdf' : 'image/*'}
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
              )}

              <div>
                <label
                  htmlFor="quote-raw-text"
                  className="block text-xs font-medium text-[#22201D] mb-1.5"
                >
                  Quote text / pasted vendor message
                </label>
                <textarea
                  id="quote-raw-text"
                  rows={7}
                  value={rawText}
                  onChange={(e) => {
                    setRawText(e.target.value);
                    setSelectedPresetId(undefined);
                  }}
                  placeholder="Paste an email, WhatsApp thread, or Instagram DM from a vendor..."
                  className="w-full rounded-xl border border-[#E5DED2] bg-[#FAF8F4] p-3.5 text-sm text-[#22201D] placeholder:text-[#9A9388] focus:outline-none focus:border-[#486755]"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-[#6B655C]">
                  Simulated AI extraction · Ready to connect to Vowly’s Antigravity backend
                </span>
                <button
                  type="button"
                  disabled={!rawText.trim() && !fileName}
                  onClick={handleRunExtraction}
                  className={`px-5 py-2.5 text-sm font-medium rounded-xl transition-colors ${
                    !rawText.trim() && !fileName
                      ? 'bg-[#E5DED2] text-[#9A9388] cursor-not-allowed'
                      : 'bg-[#486755] text-white hover:bg-[#395344] cursor-pointer'
                  }`}
                >
                  Extract Quote Details
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: EXTRACTING PROGRESS */}
        {step === 'extracting' && (
          <div className="p-10 sm:p-16 flex flex-col items-center justify-center text-center space-y-6">
            <div className="w-12 h-12 rounded-2xl bg-[#E7F1EA] border border-[#C6DEC9] flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-[#486755] animate-spin" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[#22201D]">
                Analyzing vendor quote
              </h3>
              <p className="mt-1 text-xs text-[#6B655C]">
                Verifying currency, Ontario HST assumptions, and mandatory fees
              </p>
            </div>
            <div className="w-full max-w-md space-y-2.5 text-left">
              {EXTRACTION_STEPS.map((label, idx) => {
                const done = idx < extractProgressIdx;
                const active = idx === extractProgressIdx;
                return (
                  <div
                    key={label}
                    className={`flex items-center gap-2.5 text-xs px-3.5 py-2.5 rounded-xl border ${
                      done
                        ? 'bg-[#E7F1EA] border-[#C6DEC9] text-[#2D4F3C]'
                        : active
                          ? 'bg-white border-[#D7CBEB] text-[#22201D] font-medium'
                          : 'bg-[#F3EFE8]/60 border-transparent text-[#9A9388]'
                    }`}
                  >
                    {done ? (
                      <CheckCircle2 className="w-4 h-4 text-[#486755] shrink-0" />
                    ) : active ? (
                      <Loader2 className="w-3.5 h-3.5 text-[#4C3B70] animate-spin shrink-0" />
                    ) : (
                      <span className="w-3.5 h-3.5 rounded-full border border-[#D8D0C3] shrink-0" />
                    )}
                    <span>{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 3: SPLIT-SCREEN REVIEW */}
        {step === 'review' && draftQuote && calc && (
          <>
            {/* Mobile Source / Extracted Switch */}
            <div className="lg:hidden px-4 py-2.5 bg-white border-b border-[#E5DED2] flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMobilePane('extracted')}
                className={`flex-1 py-2 text-xs font-medium rounded-lg cursor-pointer ${
                  mobilePane === 'extracted'
                    ? 'bg-[#486755] text-white'
                    : 'bg-[#F3EFE8] text-[#6B655C]'
                }`}
              >
                Extracted Details
              </button>
              <button
                type="button"
                onClick={() => setMobilePane('source')}
                className={`flex-1 py-2 text-xs font-medium rounded-lg cursor-pointer ${
                  mobilePane === 'source'
                    ? 'bg-[#486755] text-white'
                    : 'bg-[#F3EFE8] text-[#6B655C]'
                }`}
              >
                Source Document
              </button>
            </div>

            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
              {/* LEFT PANE: Original Source Document & Clickable Evidence */}
              <div
                className={`lg:col-span-5 border-r border-[#E5DED2] bg-white p-5 overflow-y-auto space-y-4 ${
                  mobilePane === 'source' ? 'block' : 'hidden lg:block'
                }`}
              >
                <div className="flex items-center justify-between text-xs text-[#6B655C]">
                  <span className="font-semibold text-[#22201D]">
                    Original source · {draftQuote.sourceChannel}
                  </span>
                  <span>{draftQuote.receivedDate}</span>
                </div>

                <div className="rounded-xl bg-[#FAF8F4] border border-[#E5DED2] p-4">
                  {renderHighlightedSource()}
                </div>

                {draftQuote.evidenceSpans.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-[#22201D] mb-2">
                      Source evidence passages (click to highlight)
                    </div>
                    <div className="space-y-1.5">
                      {draftQuote.evidenceSpans.map((span) => {
                        const selected = activeEvidenceId === span.id;
                        return (
                          <button
                            key={span.id}
                            type="button"
                            onClick={() => setActiveEvidenceId(span.id)}
                            className={`w-full text-left rounded-lg border px-3 py-2 text-xs transition-colors cursor-pointer ${
                              selected
                                ? 'bg-[#FEF3C7] border-[#F59E0B] text-[#22201D]'
                                : 'bg-white border-[#E5DED2] text-[#6B655C] hover:bg-[#FAF8F4]'
                            }`}
                          >
                            <div className="font-semibold text-[11px] text-[#22201D]">
                              {span.sourceLabel}
                            </div>
                            <div className="mt-0.5 line-clamp-2">“{span.excerpt}”</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* RIGHT PANE: Structured Editable Fields */}
              <div
                className={`lg:col-span-7 p-5 overflow-y-auto space-y-5 ${
                  mobilePane === 'extracted' ? 'block' : 'hidden lg:block'
                }`}
              >
                {/* Approval Blockers Banner */}
                {!calc.canApprove && (
                  <div className="rounded-xl bg-[#FEF3C7] border border-[#F59E0B]/50 p-4 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-[#92400E]">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      Approval blocked until material financial ambiguities are resolved
                    </div>
                    <ul className="list-disc pl-5 text-xs text-[#92400E] space-y-1">
                      {calc.blockingReasons.map((reason, idx) => (
                        <li key={idx}>{reason}</li>
                      ))}
                    </ul>
                    <p className="text-[11px] text-[#92400E]/90">
                      You can click <strong>Save as Draft</strong> now to preserve this quote without affecting your projected budget, and finish approving once the vendor replies.
                    </p>
                  </div>
                )}

                {/* Vendor, Category & Events */}
                <div className="rounded-xl bg-white border border-[#E5DED2] p-4 space-y-3.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-[#6B655C] mb-1">
                        Vendor name
                      </label>
                      <input
                        type="text"
                        value={vendorName}
                        onChange={(e) => setVendorName(e.target.value)}
                        className="w-full rounded-lg border border-[#E5DED2] px-3 py-2 text-sm font-medium text-[#22201D] focus:outline-none focus:border-[#486755]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[#6B655C] mb-1">
                        Category
                      </label>
                      <select
                        value={vendorCategory}
                        onChange={(e) =>
                          setVendorCategory(e.target.value as VendorCategory)
                        }
                        className="w-full rounded-lg border border-[#E5DED2] px-3 py-2 text-sm text-[#22201D] focus:outline-none focus:border-[#486755]"
                      >
                        {(Object.keys(CATEGORY_META) as VendorCategory[]).map(
                          (cat) => (
                            <option key={cat} value={cat}>
                              {CATEGORY_META[cat].label}
                            </option>
                          )
                        )}
                      </select>
                    </div>
                  </div>

                  {/* Link to Existing Vendor or Create New */}
                  {!onCompleteForOnboarding && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-[#6B655C] mb-1">
                          Link to existing vendor (optional)
                        </label>
                        <select
                          value={linkedVendorId ?? ''}
                          onChange={(e) =>
                            setLinkedVendorId(e.target.value || null)
                          }
                          className="w-full rounded-lg border border-[#E5DED2] px-3 py-2 text-xs text-[#22201D] focus:outline-none focus:border-[#486755]"
                        >
                          <option value="">Create as new vendor</option>
                          {activeWorkspace.vendors.map((v) => (
                            <option key={v.id} value={v.id}>
                              Update {v.name} ({v.status})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-[#6B655C] mb-1">
                          Vendor location
                        </label>
                        <input
                          type="text"
                          value={vendorLocation}
                          onChange={(e) => setVendorLocation(e.target.value)}
                          className="w-full rounded-lg border border-[#E5DED2] px-3 py-2 text-xs text-[#22201D] focus:outline-none focus:border-[#486755]"
                        />
                      </div>
                    </div>
                  )}

                  {/* Onboarding Event Name & Separate Planned Attendance */}
                  {onCompleteForOnboarding && (
                    <div className="pt-2 border-t border-[#F0EAE0] grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-[#6B655C] mb-1">
                          Event name
                        </label>
                        <input
                          type="text"
                          value={onboardingEventName}
                          onChange={(e) => setOnboardingEventName(e.target.value)}
                          placeholder="e.g., Reception, Sangeet"
                          className="w-full rounded-lg border border-[#E5DED2] px-3 py-2 text-xs text-[#22201D] focus:outline-none focus:border-[#486755]"
                        />
                      </div>
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <label className="text-[11px] font-medium text-[#6B655C]">
                            Planned attendance (optional)
                          </label>
                          {draftQuote.minGuests ? (
                            <span className="text-[11px] font-medium text-[#4C3B70]">
                              Vendor min: {draftQuote.minGuests}
                            </span>
                          ) : null}
                        </div>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={onboardingPlannedGuests}
                          onChange={(e) => setOnboardingPlannedGuests(e.target.value)}
                          placeholder="Leave blank if undecided"
                          className="w-full rounded-lg border border-[#E5DED2] px-3 py-2 font-num text-xs text-[#22201D] placeholder:font-sans placeholder:text-[#9A9388] focus:outline-none focus:border-[#486755]"
                        />
                      </div>
                    </div>
                  )}

                  {/* Associated Events */}
                  {activeWorkspace.events.length > 0 && !onCompleteForOnboarding && (
                    <div>
                      <div className="text-[11px] font-medium text-[#6B655C] mb-1.5">
                        Associated events (select multiple for shared packages)
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {activeWorkspace.events.map((evt) => {
                          const checked = selectedEventIds.includes(evt.id);
                          return (
                            <button
                              key={evt.id}
                              type="button"
                              onClick={() =>
                                setSelectedEventIds((prev) =>
                                  checked
                                    ? prev.filter((id) => id !== evt.id)
                                    : [...prev, evt.id]
                                )
                              }
                              className={`px-2.5 py-1 text-xs rounded-lg border transition-colors cursor-pointer ${
                                checked
                                  ? 'bg-[#E7F1EA] border-[#486755] text-[#2D4F3C] font-medium'
                                  : 'bg-[#FAF8F4] border-[#E5DED2] text-[#6B655C]'
                              }`}
                            >
                              {evt.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Currency Assumption & Ontario HST Controls */}
                <div className="rounded-xl bg-white border border-[#E5DED2] p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-medium text-[#6B655C]">
                        Currency
                      </label>
                      <span
                        className={`text-[11px] font-medium ${
                          draftQuote.currencySource === 'inferred_canada'
                            ? 'text-[#2B5170]'
                            : draftQuote.currency === 'UNKNOWN'
                              ? 'text-[#B91C1C]'
                              : 'text-[#2D4F3C]'
                        }`}
                      >
                        {draftQuote.currencySource === 'explicit_quote'
                          ? 'Explicitly quoted'
                          : draftQuote.currencySource === 'inferred_canada'
                            ? 'Inferred from Canadian location (editable)'
                            : draftQuote.currencySource === 'user_confirmed'
                              ? 'Confirmed by you'
                              : 'Unknown — required'}
                      </span>
                    </div>
                    <select
                      value={draftQuote.currency}
                      onChange={(e) =>
                        updateQuote((q) => ({
                          ...q,
                          currency: e.target.value as CurrencyCode,
                          currencySource:
                            e.target.value === 'UNKNOWN'
                              ? 'unknown'
                              : 'user_confirmed',
                        }))
                      }
                      className="w-full rounded-lg border border-[#E5DED2] px-3 py-2 text-xs font-medium text-[#22201D] focus:outline-none focus:border-[#486755]"
                    >
                      <option value="CAD">CAD ($ Canadian Dollar)</option>
                      <option value="USD">USD ($ US Dollar)</option>
                      <option value="UNKNOWN">Unknown / Unspecified</option>
                    </select>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-medium text-[#6B655C]">
                        Ontario 13% HST handling
                      </label>
                      {calc.hstAssumed && (
                        <span className="text-[11px] font-medium text-[#B45309]">
                          Assumed 13% ON HST
                        </span>
                      )}
                    </div>
                    <select
                      value={draftQuote.taxHandling}
                      onChange={(e) =>
                        updateQuote((q) => ({
                          ...q,
                          taxHandling: e.target.value as TaxHandling,
                        }))
                      }
                      className="w-full rounded-lg border border-[#E5DED2] px-3 py-2 text-xs font-medium text-[#22201D] focus:outline-none focus:border-[#486755]"
                    >
                      <option value="excluded_plus_hst">
                        Excluded — add 13% Ontario HST
                      </option>
                      <option value="unspecified_ontario_assumed">
                        Unspecified — estimate 13% Ontario HST
                      </option>
                      <option value="included">
                        HST already included (do not add again)
                      </option>
                      <option value="tax_exempt">Tax exempt / 0%</option>
                    </select>
                  </div>
                </div>

                {/* Conflicting Prices Resolver */}
                {draftQuote.conflicts.length > 0 && (
                  <div className="rounded-xl bg-[#FDF6F2] border border-[#EED0BE] p-4 space-y-3">
                    <div className="text-xs font-semibold text-[#7A4329]">
                      Conflicting prices detected — select one confirmed figure (never summed)
                    </div>
                    {draftQuote.conflicts.map((conflict) => (
                      <div key={conflict.id} className="space-y-2">
                        <p className="text-xs text-[#22201D] font-medium">
                          {conflict.fieldLabel}
                        </p>
                        <p className="text-xs text-[#6B655C]">
                          {conflict.description}
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                          {conflict.options.map((opt) => {
                            const chosen = conflict.resolvedOptionId === opt.id;
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => {
                                  if (opt.evidenceId)
                                    setActiveEvidenceId(opt.evidenceId);
                                  updateQuote((q) => ({
                                    ...q,
                                    conflicts: q.conflicts.map((c) =>
                                      c.id === conflict.id
                                        ? { ...c, resolvedOptionId: opt.id }
                                        : c
                                    ),
                                    lineItems: q.lineItems.map((li) =>
                                      li.id === conflict.targetLineItemId
                                        ? { ...li, unitPrice: opt.amount }
                                        : li
                                    ),
                                  }));
                                }}
                                className={`text-left rounded-xl border p-3 transition-all cursor-pointer ${
                                  chosen
                                    ? 'bg-[#E7F1EA] border-[#486755]'
                                    : 'bg-white border-[#E5DED2] hover:border-[#7A4329]'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-num text-sm font-semibold text-[#22201D]">
                                    {formatShortCad(opt.amount)}
                                  </span>
                                  {chosen && (
                                    <Check className="w-4 h-4 text-[#2D4F3C]" />
                                  )}
                                </div>
                                <div className="mt-0.5 text-xs font-medium text-[#22201D]">
                                  {opt.label}
                                </div>
                                <div className="text-[11px] text-[#6B655C]">
                                  Source: {opt.sourceLabel}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Cash vs Regular Payment Options */}
                {draftQuote.paymentOptions && draftQuote.paymentOptions.length > 0 && (
                  <div className="rounded-xl bg-[#F7F4FC] border border-[#D7CBEB] p-4 space-y-2.5">
                    <div className="text-xs font-semibold text-[#4C3B70]">
                      Alternative payment options (regular vs. cash)
                    </div>
                    <p className="text-[11px] text-[#6B655C]">
                      Cash options are tracked as selectable alternatives — Vowly never assumes cash is tax-free.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {draftQuote.paymentOptions.map((opt) => {
                        const selected =
                          draftQuote.selectedPaymentOptionId === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              if (opt.evidenceId)
                                setActiveEvidenceId(opt.evidenceId);
                              updateQuote((q) => ({
                                ...q,
                                selectedPaymentOptionId: opt.id,
                              }));
                            }}
                            className={`text-left rounded-xl border p-3 transition-colors cursor-pointer ${
                              selected
                                ? 'bg-white border-[#4C3B70] ring-1 ring-[#4C3B70]/25'
                                : 'bg-white/70 border-[#D7CBEB]'
                            }`}
                          >
                            <div className="flex items-center justify-between text-xs font-semibold text-[#22201D]">
                              <span>{opt.label}</span>
                              {selected && (
                                <Check className="w-3.5 h-3.5 text-[#4C3B70]" />
                              )}
                            </div>
                            <p className="mt-1 text-[11px] text-[#6B655C]">
                              {opt.note}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Extracted Editable Line Items */}
                <div className="rounded-xl bg-white border border-[#E5DED2] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#22201D]">
                      Extracted line items (editable)
                    </span>
                    {draftQuote.minGuests && (
                      <span className="text-[11px] text-[#6B655C]">
                        Min {draftQuote.minGuests} guests
                        {draftQuote.maxCapacity
                          ? ` · Max ${draftQuote.maxCapacity}`
                          : ''}
                      </span>
                    )}
                  </div>

                  <div className="space-y-2.5">
                    {draftQuote.lineItems.map((item) => (
                      <div
                        key={item.id}
                        onClick={() =>
                          item.evidenceId && setActiveEvidenceId(item.evidenceId)
                        }
                        className="rounded-xl border border-[#E5DED2] bg-[#FAF8F4] p-3 grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center"
                      >
                        <div className="sm:col-span-6">
                          <input
                            type="text"
                            value={item.label}
                            onChange={(e) =>
                              updateQuote((q) => ({
                                ...q,
                                lineItems: q.lineItems.map((li) =>
                                  li.id === item.id
                                    ? { ...li, label: e.target.value }
                                    : li
                                ),
                              }))
                            }
                            className="w-full rounded-lg border border-[#E5DED2] bg-white px-2.5 py-1.5 text-xs font-medium text-[#22201D]"
                          />
                        </div>
                        <div className="sm:col-span-3">
                          <select
                            value={item.pricingModel}
                            onChange={(e) =>
                              updateQuote((q) => ({
                                ...q,
                                lineItems: q.lineItems.map((li) =>
                                  li.id === item.id
                                    ? {
                                        ...li,
                                        pricingModel: e.target.value as typeof item.pricingModel,
                                      }
                                    : li
                                ),
                              }))
                            }
                            className="w-full rounded-lg border border-[#E5DED2] bg-white px-2 py-1.5 text-xs text-[#6B655C]"
                          >
                            <option value="flat">Flat fee</option>
                            <option value="per_person">Per guest</option>
                            <option value="hourly">Hourly</option>
                            <option value="guest_ratio">Per table</option>
                          </select>
                        </div>
                        <div className="sm:col-span-3">
                          <div className="relative">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-[#6B655C]">
                              $
                            </span>
                            <input
                              type="number"
                              value={item.unitPrice}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                updateQuote((q) => ({
                                  ...q,
                                  lineItems: q.lineItems.map((li) =>
                                    li.id === item.id
                                      ? {
                                          ...li,
                                          unitPrice: Number.isNaN(val) ? 0 : val,
                                        }
                                      : li
                                  ),
                                }));
                              }}
                              className="w-full rounded-lg border border-[#E5DED2] bg-white pl-6 pr-2.5 py-1.5 text-right font-num text-xs font-semibold text-[#22201D]"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Unconfirmed Mandatory Fees Resolver */}
                {draftQuote.unconfirmedFees.length > 0 && (
                  <div className="rounded-xl bg-white border border-[#F59E0B]/60 p-4 space-y-3">
                    <div className="text-xs font-semibold text-[#92400E]">
                      Unconfirmed mandatory charges
                    </div>
                    {draftQuote.unconfirmedFees.map((fee) => (
                      <div
                        key={fee.id}
                        onClick={() =>
                          fee.evidenceId && setActiveEvidenceId(fee.evidenceId)
                        }
                        className="rounded-xl bg-[#FAF8F4] border border-[#E5DED2] p-3 space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-xs font-semibold text-[#22201D]">
                              {fee.label}
                            </div>
                            <p className="text-[11px] text-[#6B655C] mt-0.5">
                              {fee.description}
                            </p>
                          </div>
                          <span
                            className={`text-[11px] font-semibold whitespace-nowrap ${
                              fee.status === 'unconfirmed'
                                ? 'text-[#B45309]'
                                : 'text-[#2D4F3C]'
                            }`}
                          >
                            {fee.status === 'unconfirmed'
                              ? 'Unresolved'
                              : fee.status === 'confirmed_amount'
                                ? `Confirmed: ${formatShortCad(fee.confirmedAmount)}`
                                : 'Included / Waived'}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="number"
                            placeholder="Confirmed CAD $"
                            value={feeInputs[fee.id] ?? (fee.confirmedAmount ?? '')}
                            onChange={(e) =>
                              setFeeInputs((prev) => ({
                                ...prev,
                                [fee.id]: e.target.value,
                              }))
                            }
                            className="w-36 rounded-lg border border-[#E5DED2] bg-white px-2.5 py-1.5 font-num text-xs text-[#22201D]"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const parsed = parseFloat(feeInputs[fee.id] ?? '');
                              if (Number.isNaN(parsed) || parsed < 0) return;
                              updateQuote((q) => ({
                                ...q,
                                unconfirmedFees: q.unconfirmedFees.map((f) =>
                                  f.id === fee.id
                                    ? {
                                        ...f,
                                        status: 'confirmed_amount',
                                        confirmedAmount: parsed,
                                      }
                                    : f
                                ),
                              }));
                            }}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[#486755] text-white hover:bg-[#395344] cursor-pointer"
                          >
                            Confirm amount
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateQuote((q) => ({
                                ...q,
                                unconfirmedFees: q.unconfirmedFees.map((f) =>
                                  f.id === fee.id
                                    ? {
                                        ...f,
                                        status: 'waived_or_included',
                                        confirmedAmount: 0,
                                      }
                                    : f
                                ),
                              }))
                            }
                            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[#E5DED2] bg-white text-[#22201D] hover:bg-[#F3EFE8] cursor-pointer"
                          >
                            Mark included / waived
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Optional Add-Ons */}
                {draftQuote.addOns.length > 0 && (
                  <div className="rounded-xl bg-white border border-[#E5DED2] p-4 space-y-2">
                    <div className="text-xs font-semibold text-[#22201D]">
                      Optional add-ons (toggle to preview impact)
                    </div>
                    {calc.addOnImpacts.map((addon) => (
                      <label
                        key={addon.id}
                        className="flex items-start justify-between gap-3 rounded-lg border border-[#F0EAE0] p-2.5 cursor-pointer hover:bg-[#FAF8F4]"
                      >
                        <div className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={addon.selected}
                            onChange={() =>
                              updateQuote((q) => ({
                                ...q,
                                addOns: q.addOns.map((a) =>
                                  a.id === addon.id
                                    ? { ...a, selected: !a.selected }
                                    : a
                                ),
                              }))
                            }
                            className="mt-0.5 accent-[#486755]"
                          />
                          <div>
                            <div className="text-xs font-medium text-[#22201D]">
                              {addon.label}
                            </div>
                            <div className="text-[11px] text-[#6B655C]">
                              {addon.description}
                            </div>
                          </div>
                        </div>
                        <span className="font-num text-xs font-semibold text-[#4C3B70] whitespace-nowrap">
                          +{formatShortCad(addon.impactWithTax)} incl. tax
                        </span>
                      </label>
                    ))}
                  </div>
                )}

                {/* Live Calculated Totals Summary */}
                <div className="rounded-xl bg-[#F3F8F5] border border-[#C6DEC9] p-4 space-y-2 text-xs">
                  <div className="flex justify-between text-[#6B655C]">
                    <span>Pre-tax subtotal</span>
                    <span className="font-num font-medium text-[#22201D]">
                      {formatCurrency(calc.preTaxTotal, calc.currencyLabel, {
                        decimals: 2,
                      })}
                    </span>
                  </div>
                  <div className="flex justify-between text-[#6B655C]">
                    <span>
                      {calc.hstIncluded
                        ? 'Ontario HST (already included)'
                        : calc.hstAssumed
                          ? 'Estimated Ontario HST (13% assumed)'
                          : calc.taxRate > 0
                            ? 'Ontario HST (13%)'
                            : 'Tax (0%)'}
                    </span>
                    <span className="font-num font-medium text-[#22201D]">
                      {formatCurrency(calc.taxAmount, calc.currencyLabel, {
                        decimals: 2,
                      })}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-[#C6DEC9] flex justify-between items-baseline">
                    <span className="font-semibold text-[#1F3A2B] text-sm">
                      Estimated All-In Total
                    </span>
                    <span className="font-num text-lg font-semibold text-[#1F3A2B]">
                      {formatCurrency(calc.estimatedAllInTotal, calc.currencyLabel, {
                        decimals: 2,
                      })}
                    </span>
                  </div>
                  {calc.revisionSavings && (
                    <div className="text-[11px] font-medium text-[#2D4F3C]">
                      Verified revision savings: {formatShortCad(calc.revisionSavings.savingsWithTax)} incl. HST vs prior quote.
                    </div>
                  )}
                </div>

                {/* Clarification Questions */}
                {draftQuote.clarificationQuestions.length > 0 && (
                  <div className="rounded-xl bg-white border border-[#E5DED2] p-4">
                    <div className="text-xs font-semibold text-[#22201D] mb-1.5">
                      Suggested clarification questions for vendor
                    </div>
                    <ul className="list-disc pl-4 space-y-1 text-xs text-[#6B655C]">
                      {draftQuote.clarificationQuestions.map((q, idx) => (
                        <li key={idx}>{q}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Review Action Footer */}
            <div className="px-5 py-3.5 bg-white border-t border-[#E5DED2] flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
              <div className="text-xs text-[#6B655C]">
                {calc.canApprove
                  ? 'Approving updates your projected estimate only. Booking confirmation is a separate step.'
                  : 'Resolve blocking items above to approve, or save as Draft to revisit later.'}
              </div>
              <div className="flex items-center gap-2.5 justify-end shrink-0">
                <button
                  type="button"
                  onClick={() => handleSave(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl border border-[#D7CBEB] bg-[#EFEAF8] text-[#4C3B70] hover:bg-[#E5DCF4] transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  Save as Draft
                </button>
                <button
                  type="button"
                  disabled={!calc.canApprove}
                  onClick={() => handleSave(false)}
                  className={`inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap ${
                    calc.canApprove
                      ? 'bg-[#486755] text-white hover:bg-[#395344] cursor-pointer'
                      : 'bg-[#E5DED2] text-[#9A9388] cursor-not-allowed'
                  }`}
                >
                  <Check className="w-3.5 h-3.5" />
                  Approve Quote
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
