import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  FileUp,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Tag,
  Trash2,
  X,
  ZoomIn,
} from 'lucide-react';
import {
  calculateQuoteFinancials,
  CATEGORY_META,
  formatCurrency,
  formatShortCad,
  getEffectiveQuoteDeliveryTerms,
  getEffectiveQuoteInclusions,
  getSelectedPackageOption,
  resolveRelativeDeadlineDate,
} from '../engine/financialCalculator';
import { findAmbiguousLegacyOvertimeItems } from '../engine/legacyOvertimeReview';
import { createManualQuoteDraft, hasIncompleteManualPricing } from '../engine/manualQuoteDraft';
import { buildQuoteRevisionPreview, getApprovedRevisionBaseline } from '../engine/revisionPreview';
import {
  ExtractionAttachmentInput,
  liveQuoteExtractor,
  SAMPLE_QUOTE_PRESETS,
  simulatedQuoteExtractor,
  validateUploadFile,
} from '../services/quoteExtractor';
import { useWorkspace } from '../store/workspaceStore';
import {
  CurrencyCode,
  LineItemPricingModel,
  PercentageBasis,
  Quote,
  QuoteLineItem,
  RevisionDecision,
  TaxHandling,
  Vendor,
  VendorCategory,
} from '../types/vowly';
import { DemoDataNote } from './DemoLabel';
import { ImageLightboxModal } from './ImageLightboxModal';
import { QuoteRevisionReview } from './QuoteRevisionReview';

interface QuoteImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialPresetId?: string;
  initialVendorId?: string;
  resumeDraftForVendorId?: string;
  editApprovedForVendorId?: string;
  onCompleteForOnboarding?: (payload: {
    vendorName: string;
    category: VendorCategory;
    location: string;
    isDemoVenue: boolean;
    quote: Quote;
    asDraft: boolean;
    eventName: string;
    plannedGuests: number | null;
  }) => boolean;
}

const LOADING_MESSAGES = [
  'Planning your wedding rn, brb 💍',
  'Doing wedding math. Send coffee.',
  "Reading the fine print so you don't have to.",
  'Finding those sneaky extra fees 👀',
  'Making spreadsheets jealous.',
];

const PRICING_MODEL_LABELS: Record<LineItemPricingModel, string> = {
  flat: 'Fixed price',
  per_person: 'Per guest',
  per_extra_guest: 'Per extra guest (above threshold)',
  hourly: 'Hourly rate',
  guest_ratio: 'Ratio-based staffing / units',
  percentage: 'Percentage charge',
};

const PERCENTAGE_BASIS_LABELS: Record<PercentageBasis, string> = {
  food_subtotal: 'Food subtotal',
  entire_subtotal: 'Entire applicable subtotal',
  specific_line_items: 'Specific line items',
  custom_amount: 'Confirmed custom amount',
  unknown: 'Basis unknown (confirm before booking)',
};

const GENERIC_VENDOR_NAMES = new Set([
  '',
  'imported vendor',
  'uploaded screenshot',
  'uploaded pdf',
  'unknown',
  'unknown vendor',
  'unnamed vendor',
  'vendor',
]);

function readFileAsAttachment(file: File): Promise<ExtractionAttachmentInput> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = dataUrl.indexOf(',');
      if (commaIdx === -1) {
        reject(new Error('Could not read the selected file.'));
        return;
      }
      resolve({
        mimeType: file.type,
        base64Data: dataUrl.slice(commaIdx + 1),
        fileName: file.name,
        sizeBytes: file.size,
        dataUrl,
      });
    };
    reader.onerror = () => reject(new Error('Failed to read the selected file.'));
    reader.readAsDataURL(file);
  });
}

function newRevisionDraft(vendor: Vendor | undefined, mode: 'partial' | 'manual'): Quote['revisionDraft'] {
  const approved = vendor && getApprovedRevisionBaseline(vendor);
  return approved?.approvalState === 'approved' ? { baselineQuoteId: approved.id, mode } : undefined;
}

export function QuoteImportModal({
  isOpen,
  onClose,
  initialPresetId,
  initialVendorId,
  resumeDraftForVendorId,
  editApprovedForVendorId,
  onCompleteForOnboarding,
}: QuoteImportModalProps) {
  const { activeWorkspace, saveDraftQuote, approveQuote } = useWorkspace();

  const [step, setStep] = useState<'input' | 'extracting' | 'review'>('input');
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [unlinkedNotice, setUnlinkedNotice] = useState<string | null>(null);
  const isExtractingRef = useRef(false);

  // Input state
  const [sourceType, setSourceType] = useState<'pasted_message' | 'pdf' | 'screenshot'>(
    'pasted_message'
  );
  const [sourceChannel, setSourceChannel] = useState('WhatsApp / Email message');
  const [rawText, setRawText] = useState('');
  const [uploadedAttachment, setUploadedAttachment] =
    useState<ExtractionAttachmentInput | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string | undefined>(undefined);

  // Review state
  const [vendorName, setVendorName] = useState('');
  const [vendorCategory, setVendorCategory] = useState<VendorCategory>('other');
  const [vendorLocation, setVendorLocation] = useState('');
  const [isDemoVenue, setIsDemoVenue] = useState(false);
  const [linkedVendorId, setLinkedVendorId] = useState<string | null>(null);
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
  const [draftQuote, setDraftQuote] = useState<Quote | null>(null);
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<'extracted' | 'source'>('extracted');
  const [feeInputs, setFeeInputs] = useState<Record<string, string>>({});
  const [gratuityPercentInput, setGratuityPercentInput] = useState('');
  const [showLineItemEditor, setShowLineItemEditor] = useState(false);
  const [showVendorDetails, setShowVendorDetails] = useState(false);
  const [vendorNamePromptOpen, setVendorNamePromptOpen] = useState(false);
  const [showRevisionDetails, setShowRevisionDetails] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [newInclusionText, setNewInclusionText] = useState('');
  const [newDeliveryTermText, setNewDeliveryTermText] = useState('');
  const [pkgPriceInput, setPkgPriceInput] = useState('');
  const [pkgPriceModel, setPkgPriceModel] = useState<'flat' | 'per_person'>('flat');
  const [taxPercentInput, setTaxPercentInput] = useState('');
  const [onboardingEventName, setOnboardingEventName] = useState('');
  const [onboardingPlannedGuests, setOnboardingPlannedGuests] = useState('');
  const [extractionMetaLabel, setExtractionMetaLabel] = useState<string | null>(null);

  // Rotate playful loading messages while extracting
  useEffect(() => {
    if (step !== 'extracting') return;
    setLoadingMsgIdx(0);
    const id = window.setInterval(() => {
      setLoadingMsgIdx((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, 2200);
    return () => window.clearInterval(id);
  }, [step]);

  // Reset / initialize whenever modal opens
  useEffect(() => {
    if (!isOpen) return;

    setExtractError(null);
    setSaveError(false);
    setUploadError(null);
    setUnlinkedNotice(null);
    setExtractionMetaLabel(null);
    setShowLineItemEditor(false);
    setShowVendorDetails(false);
    setVendorNamePromptOpen(false);
    setShowRevisionDetails(false);
    setLightboxOpen(false);
    setNewInclusionText('');
    setNewDeliveryTermText('');
    isExtractingRef.current = false;

    if (editApprovedForVendorId) {
      const existingVendor = activeWorkspace.vendors.find(
        (v) => v.id === editApprovedForVendorId
      );
      const active = existingVendor ? getApprovedRevisionBaseline(existingVendor) : undefined;
      if (existingVendor && active) {
        setLinkedVendorId(existingVendor.id);
        setVendorName(existingVendor.name);
        setVendorCategory(existingVendor.category);
        setVendorLocation(existingVendor.location);
        setIsDemoVenue(Boolean(existingVendor.isDemoVenue));
        setSelectedEventIds(existingVendor.eventIds);
        const cloned = structuredClone(active);
        setDraftQuote({ ...cloned, approvalState: 'draft', revisionDraft: newRevisionDraft(existingVendor, 'manual') });
        setShowRevisionDetails(true);
        setGratuityPercentInput(
          cloned.gratuityPercent !== undefined && cloned.gratuityPercent !== null
            ? String(cloned.gratuityPercent)
            : ''
        );
        setShowLineItemEditor(true);
        setStep('review');
        setMobilePane('extracted');
        return;
      }
    }

    if (resumeDraftForVendorId) {
      const existingVendor = activeWorkspace.vendors.find(
        (v) => v.id === resumeDraftForVendorId
      );
      if (existingVendor?.draftQuote) {
        const staged = existingVendor.draftVendorMetadata;
        const resolvedName = staged?.name ?? existingVendor.name;
        setLinkedVendorId(existingVendor.id);
        setVendorName(resolvedName);
        setVendorNamePromptOpen(
          !resolvedName.trim() || GENERIC_VENDOR_NAMES.has(resolvedName.trim().toLowerCase())
        );
        setVendorCategory(staged?.category ?? existingVendor.category);
        setVendorLocation(staged?.location ?? existingVendor.location);
        setIsDemoVenue(Boolean(staged?.isDemoVenue ?? existingVendor.isDemoVenue));
        setSelectedEventIds(staged?.eventIds ?? existingVendor.eventIds);
        const cloned = structuredClone(existingVendor.draftQuote);
        const active = getApprovedRevisionBaseline(existingVendor);
        const revisionDraft = cloned.revisionDraft
          ?? newRevisionDraft(existingVendor, cloned.id === active?.id ? 'manual' : 'partial');
        setDraftQuote({ ...cloned, revisionDraft });
        setShowRevisionDetails(Boolean(cloned.manualEntry || revisionDraft?.mode === 'manual'));
        setShowLineItemEditor(Boolean(cloned.manualEntry || revisionDraft?.mode === 'manual'));
        setGratuityPercentInput(
          cloned.gratuityPercent !== undefined && cloned.gratuityPercent !== null
            ? String(cloned.gratuityPercent)
            : ''
        );
        setStep('review');
        setMobilePane('extracted');
        return;
      }
    }

    setStep('input');
    setDraftQuote(null);
    setActiveEvidenceId(null);
    setFeeInputs({});
    setGratuityPercentInput('');
    setLinkedVendorId(initialVendorId ?? null);
    setSelectedEventIds(activeWorkspace.vendors.find((vendor) => vendor.id === initialVendorId)?.eventIds ?? []);
    setUploadedAttachment(null);

    if (initialPresetId) {
      const preset = SAMPLE_QUOTE_PRESETS.find((p) => p.id === initialPresetId);
      if (preset) {
        setSelectedPresetId(preset.id);
        setSourceType(preset.sourceType);
        setSourceChannel(preset.sourceChannel);
        setRawText(preset.rawText);
        return;
      }
    }

    setSelectedPresetId(undefined);
    setSourceType('pasted_message');
    setSourceChannel('WhatsApp / Email message');
    setRawText('');
  }, [isOpen, initialPresetId, initialVendorId, resumeDraftForVendorId, editApprovedForVendorId]);

  const onboardingEventsPreview = useMemo(() => {
    if (!onCompleteForOnboarding) return activeWorkspace.events;
    const trimmed = onboardingPlannedGuests.trim();
    const parsed =
      trimmed !== '' && /^\d+$/.test(trimmed) && parseInt(trimmed, 10) > 0
        ? parseInt(trimmed, 10)
        : null;
    return [
      {
        id: 'onboarding-preview-evt',
        name: onboardingEventName.trim() || 'Wedding Event',
        date: '',
        dateDisplay: 'Date TBD',
        time: '',
        location: activeWorkspace.location,
        guestCount: parsed,
        status: 'Early planning' as const,
        budgetAllowance: null,
        tone: 'sage' as const,
      },
    ];
  }, [
    onCompleteForOnboarding,
    activeWorkspace.events,
    activeWorkspace.location,
    onboardingEventName,
    onboardingPlannedGuests,
  ]);

  const linkedVendor = activeWorkspace.vendors.find((vendor) => vendor.id === linkedVendorId);
  const revisionDraft = draftQuote?.revisionDraft;
  const bookedRevision = Boolean(revisionDraft && linkedVendor?.status === 'Booked');
  const revisionPreview = useMemo(
    () => draftQuote?.revisionDraft && linkedVendor
      ? buildQuoteRevisionPreview(activeWorkspace, linkedVendor, draftQuote, selectedEventIds, vendorCategory)
      : null,
    [activeWorkspace, draftQuote, linkedVendor, selectedEventIds, vendorCategory],
  );

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

  const primarySelectedEvent = useMemo(() => {
    if (onCompleteForOnboarding) return onboardingEventsPreview[0];
    return activeWorkspace.events.find((e) => selectedEventIds.includes(e.id));
  }, [
    onCompleteForOnboarding,
    onboardingEventsPreview,
    activeWorkspace.events,
    selectedEventIds,
  ]);

  if (!isOpen) return null;

  const isVendorNameValid =
    vendorName.trim().length > 0 &&
    !GENERIC_VENDOR_NAMES.has(vendorName.trim().toLowerCase());

  const legacyOvertimeItems = draftQuote ? findAmbiguousLegacyOvertimeItems(draftQuote) : [];
  const hasOtherDraft = Boolean(!onCompleteForOnboarding && linkedVendor?.draftQuote && linkedVendor.draftQuote.id !== draftQuote?.id);
  const hasPendingMetadataChange = Boolean(
    linkedVendor &&
      linkedVendor.status !== 'Booked' &&
      (vendorName.trim() !== linkedVendor.name ||
        vendorLocation.trim() !== linkedVendor.location ||
        vendorCategory !== linkedVendor.category ||
        selectedEventIds.join('\0') !== linkedVendor.eventIds.join('\0'))
  );
  const revisionBlockers: string[] = [];
  if (revisionPreview && findAmbiguousLegacyOvertimeItems(revisionPreview.quote).length > 0) {
    revisionBlockers.push('Confirm the hourly quantity or mark the rate as conditional before approving.');
  }
  if (revisionDraft && !isVendorNameValid) revisionBlockers.push('Enter a vendor name in quote details.');
  if (hasOtherDraft && (!revisionPreview?.duplicate || hasPendingMetadataChange)) {
    revisionBlockers.push('Resume the saved draft before approving a different quote.');
  }
  const canApproveWithVendor = Boolean(isVendorNameValid && (
    revisionDraft
      ? revisionPreview && (
          (revisionPreview.duplicate && !revisionBlockers.length) || (
            !revisionPreview.stale && revisionPreview.proposedCalc.canApprove
            && !revisionPreview.blockingReasons.length && !revisionBlockers.length
          )
        )
      : calc?.canApprove && !legacyOvertimeItems.length && !revisionBlockers.length
  ));
  const selectedPackage = draftQuote ? getSelectedPackageOption(draftQuote).selectedPackage : undefined;
  const editableLineItems = [...(draftQuote?.lineItems ?? []), ...(selectedPackage?.fees ?? [])];

  const handleSelectPreset = (presetId: string) => {
    const preset = SAMPLE_QUOTE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setExtractError(null);
    setUploadError(null);
    setUploadedAttachment(null);
    setSelectedPresetId(preset.id);
    setSourceType(preset.sourceType);
    setSourceChannel(preset.sourceChannel);
    setRawText(preset.rawText);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setExtractError(null);
    setSelectedPresetId(undefined);

    const validationError = validateUploadFile(file);
    if (validationError) {
      setUploadError(validationError);
      setUploadedAttachment(null);
      e.target.value = '';
      return;
    }

    try {
      const attachment = await readFileAsAttachment(file);
      setUploadedAttachment(attachment);
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'Could not read the selected file.'
      );
      setUploadedAttachment(null);
    }
  };

  const handleRunExtraction = async () => {
    if (isExtractingRef.current) return;
    if (!rawText.trim() && !uploadedAttachment) return;

    isExtractingRef.current = true;
    setExtractError(null);
    setUnlinkedNotice(null);
    setStep('extracting');

    const contextualEvent =
      activeWorkspace.events.find((e) => selectedEventIds.includes(e.id)) ??
      activeWorkspace.events.find((e) =>
        e.name.toLowerCase().includes('reception')
      ) ??
      activeWorkspace.events[0];

    try {
      const useDemoPreset = Boolean(selectedPresetId && !uploadedAttachment);
      const adapter = useDemoPreset ? simulatedQuoteExtractor : liveQuoteExtractor;

      const result = await adapter.extractQuote({
        sourceType,
        sourceChannel,
        rawText,
        fileName: uploadedAttachment?.fileName,
        attachments: uploadedAttachment ? [uploadedAttachment] : undefined,
        guestCount: contextualEvent?.guestCount ?? undefined,
        presetId: selectedPresetId,
        targetVendorId: initialVendorId ?? undefined,
        targetEventIds: selectedEventIds.length > 0 ? selectedEventIds : undefined,
      });

      setVendorName(result.suggestedVendorName);
      const suggestedClean = result.suggestedVendorName.trim().toLowerCase();
      setVendorNamePromptOpen(
        !suggestedClean || GENERIC_VENDOR_NAMES.has(suggestedClean)
      );
      setVendorCategory(result.suggestedCategory);
      setVendorLocation(result.suggestedLocation);
      setIsDemoVenue(result.isDemoVenue);
      setGratuityPercentInput(
        result.quote.gratuityPercent !== undefined &&
          result.quote.gratuityPercent !== null
          ? String(result.quote.gratuityPercent)
          : ''
      );

      if (result.extractionMeta) {
        setExtractionMetaLabel(
          `${result.extractionMeta.provider} · ${result.extractionMeta.model} · ${(
            result.extractionMeta.latencyMs / 1000
          ).toFixed(1)}s`
        );
      } else {
        setExtractionMetaLabel(useDemoPreset ? 'Demo preset (offline)' : null);
      }

      if (onCompleteForOnboarding) {
        setOnboardingEventName(
          result.suggestedCategory === 'venue' ? 'Reception' : 'Wedding Event'
        );
        setOnboardingPlannedGuests('');
      }

      // Safe existing-vendor linking: never silently overwrite an unrelated vendor
      const suggestedNorm = result.suggestedVendorName.trim().toLowerCase();
      const hasRealSuggestedName = !GENERIC_VENDOR_NAMES.has(suggestedNorm);

      let resolvedVendor: Vendor | undefined;
      if (initialVendorId) {
        const target = activeWorkspace.vendors.find((v) => v.id === initialVendorId);
        if (target) {
          const targetNorm = target.name.trim().toLowerCase();
          if (
            !hasRealSuggestedName ||
            targetNorm === suggestedNorm ||
            targetNorm.includes(suggestedNorm) ||
            suggestedNorm.includes(targetNorm)
          ) {
            resolvedVendor = target;
            if (!hasRealSuggestedName) {
              setVendorName(target.name);
            }
          } else {
            // Different vendor extracted than the one originally opened — do not overwrite!
            setUnlinkedNotice(
              `This quote appears to be from "${result.suggestedVendorName}" rather than "${target.name}", so it will be saved as a new vendor instead of overwriting ${target.name}.`
            );
          }
        }
      } else if (result.isRevisionOfExistingVendorId) {
        resolvedVendor = activeWorkspace.vendors.find(
          (v) => v.id === result.isRevisionOfExistingVendorId
        );
      } else if (hasRealSuggestedName) {
        resolvedVendor = activeWorkspace.vendors.find(
          (v) => v.name.trim().toLowerCase() === suggestedNorm
        );
      }

      const importedRevision = onCompleteForOnboarding
        ? undefined
        : newRevisionDraft(resolvedVendor, 'partial');
      setDraftQuote({ ...result.quote, revisionDraft: importedRevision });
      setShowRevisionDetails(false);
      if (resolvedVendor) {
        if (importedRevision) {
          setVendorCategory(resolvedVendor.category);
          setVendorLocation(result.suggestedLocation || resolvedVendor.location);
        }
        setLinkedVendorId(resolvedVendor.id);
        setSelectedEventIds(resolvedVendor.eventIds);
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
    } catch (err) {
      setExtractError(
        err instanceof Error
          ? err.message
          : 'Could not analyze this quote. Your source is preserved — please try again.'
      );
      setStep('input');
    } finally {
      isExtractingRef.current = false;
    }
  };

  const handleManualEntry = () => {
    if (!rawText.trim() && !uploadedAttachment) return;

    const target = activeWorkspace.vendors.find((vendor) => vendor.id === initialVendorId);
    const linked = target?.draftQuote ? undefined : target;
    const attachmentPreview = uploadedAttachment?.dataUrl ? {
      fileName: uploadedAttachment.fileName,
      mimeType: uploadedAttachment.mimeType,
      dataUrl: uploadedAttachment.dataUrl,
      sizeBytes: uploadedAttachment.sizeBytes,
    } : undefined;
    const draft = createManualQuoteDraft({
      sourceType,
      sourceChannel,
      sourceText: rawText,
      attachmentPreview,
    });

    if (target?.draftQuote) {
      setUnlinkedNotice(`This quote will be saved separately to keep the draft for ${target.name} intact.`);
    }
    setVendorName(linked?.name ?? '');
    setVendorNamePromptOpen(!linked);
    setVendorCategory(linked?.category ?? 'other');
    setVendorLocation(linked?.location ?? '');
    setIsDemoVenue(Boolean(linked?.isDemoVenue));
    setLinkedVendorId(linked?.id ?? null);
    setSelectedEventIds(onCompleteForOnboarding ? [] : linked?.eventIds ?? activeWorkspace.events.slice(0, 1).map((event) => event.id));
    setOnboardingEventName('');
    setOnboardingPlannedGuests('');
    setDraftQuote({ ...draft, revisionDraft: newRevisionDraft(linked, 'partial') });
    setShowRevisionDetails(true);
    setShowLineItemEditor(true);
    setStep('review');
    setMobilePane('extracted');
  };

  const updateQuote = (updater: (q: Quote) => Quote) => {
    setDraftQuote((prev) => (prev ? updater(prev) : prev));
  };

  const updateRevisionDecision = (changeId: string, decision?: RevisionDecision) => {
    updateQuote((quote) => {
      if (!quote.revisionDraft) return quote;
      const decisions = { ...quote.revisionDraft.decisions };
      if (decision) decisions[changeId] = decision;
      else delete decisions[changeId];
      return { ...quote, revisionDraft: { ...quote.revisionDraft, decisions } };
    });
  };

  const updateRevisionNote = (note: string) => {
    updateQuote((quote) => quote.revisionDraft
      ? { ...quote, revisionDraft: { ...quote.revisionDraft, note } }
      : quote);
  };

  const latestApprovedQuote = linkedVendor && getApprovedRevisionBaseline(linkedVendor);
  const refreshRevisionBaseline = () => {
    if (!linkedVendor || latestApprovedQuote?.approvalState !== 'approved' || !revisionDraft) return;
    const manual = revisionDraft.mode === 'manual';
    updateQuote((quote) => ({
      ...(manual ? { ...structuredClone(latestApprovedQuote), id: quote.id, approvalState: 'draft' as const } : quote),
      revisionDraft: {
        baselineQuoteId: latestApprovedQuote.id,
        mode: revisionDraft.mode,
        note: manual ? undefined : revisionDraft.note,
      },
    }));
    if (manual) {
      setVendorName(linkedVendor.name);
      setVendorCategory(linkedVendor.category);
      setVendorLocation(linkedVendor.location);
      setSelectedEventIds(linkedVendor.eventIds);
      setGratuityPercentInput(String(latestApprovedQuote.gratuityPercent ?? ''));
      setFeeInputs({});
      setActiveEvidenceId(null);
    }
  };

  const handleVendorLinkChange = (vendorId: string | null) => {
    setLinkedVendorId(vendorId);
    const vendor = activeWorkspace.vendors.find((candidate) => candidate.id === vendorId);
    const nextRevision = newRevisionDraft(vendor, 'partial');
    updateQuote((quote) => ({ ...quote, revisionDraft: nextRevision }));
    if (vendor) setSelectedEventIds(vendor.eventIds);
  };

  const updateQuoteLineItem = (id: string, patch: Partial<QuoteLineItem>) => {
    const updateLine = (item: QuoteLineItem) => item.id === id ? { ...item, ...patch } : item;
    updateQuote((q) => ({
      ...q,
      lineItems: q.lineItems.map(updateLine),
      packages: q.packages?.map((pkg) =>
        pkg.fees?.some((fee) => fee.id === id)
          ? { ...pkg, fees: pkg.fees.map(updateLine) }
          : pkg
      ),
    }));
  };

  const updateEffectiveTaxHandling = (nextTax: TaxHandling, nextPercent?: number) => {
    updateQuote((q) => {
      const updatedPackages = q.packages?.map((pkg) => {
        if (q.selectedPackageId && pkg.id === q.selectedPackageId && pkg.taxHandling !== undefined) {
          return {
            ...pkg,
            taxHandling: nextTax,
            taxPercent: nextPercent !== undefined ? nextPercent : pkg.taxPercent,
          };
        }
        return pkg;
      });
      return {
        ...q,
        taxHandling: nextTax,
        taxPercent: nextPercent !== undefined ? nextPercent : q.taxPercent,
        packages: updatedPackages,
      };
    });
  };

  const handleSave = (asDraft: boolean) => {
    if (!draftQuote) return;
    if (!asDraft && !canApproveWithVendor) return;
    setSaveError(false);

    const cleanName = vendorName.trim() || 'Unnamed Vendor';

    if (onCompleteForOnboarding) {
      const parsedPlanned =
        onboardingPlannedGuests.trim() !== '' &&
        /^\d+$/.test(onboardingPlannedGuests.trim()) &&
        parseInt(onboardingPlannedGuests.trim(), 10) > 0
          ? parseInt(onboardingPlannedGuests.trim(), 10)
          : null;
      const saved = onCompleteForOnboarding({
        vendorName: cleanName,
        category: vendorCategory,
        location: vendorLocation.trim(),
        isDemoVenue,
        quote: draftQuote,
        asDraft,
        eventName:
          onboardingEventName.trim() ||
          (vendorCategory === 'venue' ? 'Reception' : 'Wedding Event'),
        plannedGuests: parsedPlanned,
      });
      if (saved) onClose();
      else if (draftQuote.manualEntry) setSaveError(true);
      return;
    }

    const newVendorPayload: Omit<Vendor, 'id' | 'quotes'> = {
      name: cleanName,
      category: vendorCategory,
      eventIds: selectedEventIds,
      location: vendorLocation.trim(),
      contactName: draftQuote.vendorContact?.name ?? '',
      contactEmail: draftQuote.vendorContact?.email ?? '',
      contactPhone: draftQuote.vendorContact?.phone ?? '',
      status: asDraft ? 'Revision pending' : 'Quoted',
      isPreferred: !asDraft,
      isDemoVenue,
      notes: '',
    };

    if (asDraft) {
      if (!saveDraftQuote(linkedVendorId, newVendorPayload, draftQuote)) {
        setSaveError(true);
        return;
      }
    } else {
      const approvedVendorId = approveQuote(
        linkedVendorId,
        newVendorPayload,
        draftQuote,
        revisionDraft?.note?.trim() || (revisionDraft?.mode === 'manual' ? 'Manual quote edit' : undefined)
      );
      if (!approvedVendorId) return;
    }
    onClose();
  };

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

  const needsAttentionCount =
    (isVendorNameValid && !vendorNamePromptOpen ? 0 : 1) +
    (draftQuote && hasIncompleteManualPricing(draftQuote) ? 1 : 0) +
    (calc?.unresolvedPackageSelection ? 1 : 0) +
    (calc?.unresolvedPackagePrice ? 1 : 0) +
    (calc?.isCurrencyUnknown ? 1 : 0) +
    (calc?.gratuityUnresolved ? 1 : 0) +
    (calc?.unresolvedMandatoryFeesCount ?? 0) +
    (calc?.unresolvedConflictsCount ?? 0) +
    (calc?.unresolvedPercentageCount ?? 0) +
    legacyOvertimeItems.length +
    (draftQuote?.sourceWarnings &&
    draftQuote.sourceWarnings.length > 0 &&
    !draftQuote.sourceWarningsAcknowledged
      ? 1
      : 0);

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
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg font-semibold text-[#22201D]">
                {step === 'input'
                  ? 'Import Vendor Quote'
                  : step === 'extracting'
                    ? 'Analyzing Your Quote'
                    : revisionDraft ? 'Review quote revision' : 'Review Extracted Quote'}
              </h2>
              {step === 'review' && isDemoVenue && <DemoDataNote />}
              {step === 'review' && extractionMetaLabel && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#F3EFE8] text-[#6B655C]">
                  {extractionMetaLabel}
                </span>
              )}
            </div>
            <p className="text-xs text-[#6B655C]">
              {step === 'input'
                ? 'Paste a vendor message or upload a screenshot/PDF. Vowly extracts prices, inclusions, and payment terms.'
                : step === 'extracting'
                  ? 'Extracting structured pricing, inclusions, and fine print.'
                  : revisionDraft
                    ? 'Review changes against the previous approved quote.'
                    : 'Resolve only what needs your attention, then approve into your projected budget.'}
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
          <div className="p-5 sm:p-6 overflow-y-auto space-y-5">
            {extractError && (
              <div className="rounded-xl bg-[#FEE2E2] border border-[#FCA5A5] p-4 flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-[#991B1B] mt-0.5 shrink-0" />
                  <div className="text-xs text-[#991B1B] space-y-1">
                    <div className="font-semibold">Extraction did not complete</div>
                    <div>{extractError}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleManualEntry}
                    disabled={!rawText.trim() && !uploadedAttachment}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#486755] text-white hover:bg-[#395344] cursor-pointer disabled:opacity-50"
                  >
                    Continue with manual entry
                  </button>
                  <button
                    type="button"
                    onClick={handleRunExtraction}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white text-[#991B1B] hover:bg-[#FEF2F2] cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Retry
                  </button>
                </div>
              </div>
            )}

            {/* Source Input Card */}
            <div className="bg-white rounded-2xl border border-[#E5DED2] p-5 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSourceType('pasted_message');
                    setSourceChannel('WhatsApp / Email message');
                    setUploadedAttachment(null);
                    setUploadError(null);
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
                    setSourceType('screenshot');
                    setSourceChannel('Uploaded Screenshot / Image');
                    setSelectedPresetId(undefined);
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
                <button
                  type="button"
                  onClick={() => {
                    setSourceType('pdf');
                    setSourceChannel('Uploaded PDF Quote');
                    setSelectedPresetId(undefined);
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
              </div>

              {(sourceType === 'pdf' || sourceType === 'screenshot') && (
                <div className="space-y-2">
                  <label className="block rounded-xl border border-dashed border-[#C5DEC9] bg-[#F3F8F5] p-5 text-center cursor-pointer hover:bg-[#E7F1EA] transition-colors">
                    <FileUp className="w-5 h-5 text-[#486755] mx-auto" />
                    <div className="mt-2 text-xs font-medium text-[#22201D]">
                      {uploadedAttachment
                        ? `Selected: ${uploadedAttachment.fileName} (${Math.max(
                            1,
                            Math.round(uploadedAttachment.sizeBytes / 1024)
                          )} KB)`
                        : `Choose a ${sourceType === 'pdf' ? 'PDF document' : 'PNG, JPG, WebP, or GIF screenshot'} (max 10 MB)`}
                    </div>
                    <div className="mt-1 text-[11px] text-[#6B655C]">
                      Uploaded documents are processed by the configured AI provider to extract quote details.
                    </div>
                    <input
                      type="file"
                      accept={
                        sourceType === 'pdf'
                          ? 'application/pdf,.pdf'
                          : 'image/png,image/jpeg,image/webp,image/gif'
                      }
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </label>
                  {uploadedAttachment &&
                    uploadedAttachment.mimeType.startsWith('image/') &&
                    uploadedAttachment.dataUrl && (
                      <div className="flex items-center gap-3 rounded-xl border border-[#E5DED2] bg-[#FAF8F4] p-2.5">
                        <img
                          src={uploadedAttachment.dataUrl}
                          alt={uploadedAttachment.fileName}
                          className="w-16 h-16 object-cover rounded-lg border border-[#E5DED2]"
                        />
                        <div className="text-xs text-[#22201D] flex-1 min-w-0">
                          <div className="font-medium truncate">
                            {uploadedAttachment.fileName}
                          </div>
                          <div className="text-[11px] text-[#6B655C]">
                            Ready for real multimodal AI extraction
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setUploadedAttachment(null)}
                          className="text-xs text-[#6B655C] hover:text-[#991B1B] px-2 py-1 cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  {uploadError && (
                    <div className="text-xs text-[#991B1B] font-medium">
                      {uploadError}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label
                  htmlFor="quote-raw-text"
                  className="block text-xs font-medium text-[#22201D] mb-1.5"
                >
                  {uploadedAttachment
                    ? 'Optional accompanying note (e.g. context from DM or email)'
                    : 'Paste vendor message or quote text'}
                </label>
                <textarea
                  id="quote-raw-text"
                  rows={6}
                  value={rawText}
                  onChange={(e) => {
                    setRawText(e.target.value);
                    setSelectedPresetId(undefined);
                  }}
                  placeholder="Paste an email, WhatsApp thread, or Instagram DM from a vendor..."
                  className="w-full rounded-xl border border-[#E5DED2] bg-[#FAF8F4] p-3.5 text-sm text-[#22201D] placeholder:text-[#9A9388] focus:outline-none focus:border-[#486755]"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <span className="text-[11px] text-[#6B655C]">
                  {selectedPresetId
                    ? 'Demo preset selected (runs offline simulation)'
                    : 'Powered by Vowly AI backend · Never invents missing prices or currencies'}
                </span>
                <button
                  type="button"
                  disabled={!rawText.trim() && !uploadedAttachment}
                  onClick={handleRunExtraction}
                  className={`inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl transition-colors ${
                    !rawText.trim() && !uploadedAttachment
                      ? 'bg-[#E5DED2] text-[#9A9388] cursor-not-allowed'
                      : 'bg-[#486755] text-white hover:bg-[#395344] cursor-pointer'
                  }`}
                >
                  <Sparkles className="w-4 h-4" />
                  Analyze Quote
                </button>
              </div>
            </div>

            {/* Collapsible Demo Presets */}
            <details className="rounded-xl border border-[#E5DED2] bg-white p-4">
              <summary className="text-xs font-semibold text-[#6B655C] cursor-pointer select-none">
                Or try an offline GTA sample preset (4 examples)
              </summary>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {SAMPLE_QUOTE_PRESETS.map((preset) => {
                  const isActive = selectedPresetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleSelectPreset(preset.id)}
                      className={`text-left rounded-xl border p-3 transition-all cursor-pointer ${
                        isActive
                          ? 'bg-[#E7F1EA] border-[#486755]'
                          : 'bg-[#FAF8F4] border-[#E5DED2] hover:bg-[#F7F4FC]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[#22201D]">
                          {preset.label}
                        </span>
                        {preset.isDemoVenue && <DemoDataNote compact />}
                      </div>
                      <div className="mt-0.5 text-[11px] font-medium text-[#4C3B70]">
                        {preset.badge}
                      </div>
                    </button>
                  );
                })}
              </div>
            </details>
          </div>
        )}

        {/* STEP 2: SMART LOADING EXPERIENCE */}
        {step === 'extracting' && (
          <div className="p-12 sm:p-20 flex flex-col items-center justify-center text-center space-y-5">
            <div className="w-14 h-14 rounded-2xl bg-[#E7F1EA] border border-[#C6DEC9] flex items-center justify-center shadow-sm">
              <Loader2 className="w-7 h-7 text-[#486755] animate-spin" />
            </div>
            <div className="space-y-1.5 max-w-md">
              <h3 className="text-lg font-semibold text-[#22201D]">
                {LOADING_MESSAGES[loadingMsgIdx]}
              </h3>
              <p className="text-xs text-[#6B655C]">
                Reading your {uploadedAttachment ? uploadedAttachment.fileName : 'vendor message'} — checking pricing, inclusions, taxes, and payment terms.
              </p>
            </div>
          </div>
        )}

        {/* STEP 3: PROGRESSIVE-DISCLOSURE INTELLIGENT QUOTE REVIEW */}
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
                Quote Summary
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
                Original Source
              </button>
            </div>

            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
              {/* LEFT PANE: Original Source & Evidence */}
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

                {draftQuote.attachmentPreview && (
                  <div className="rounded-xl border border-[#E5DED2] bg-[#FAF8F4] p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-[#22201D] truncate">
                        {draftQuote.attachmentPreview.fileName}
                      </span>
                      <span className="text-[11px] text-[#6B655C]">
                        {Math.max(1, Math.round(draftQuote.attachmentPreview.sizeBytes / 1024))} KB
                      </span>
                    </div>
                    {draftQuote.attachmentPreview.mimeType.startsWith('image/') ? (
                      <div className="space-y-1.5">
                        <img
                          src={draftQuote.attachmentPreview.dataUrl}
                          alt={draftQuote.attachmentPreview.fileName}
                          onClick={() => setLightboxOpen(true)}
                          className="w-full max-h-72 object-contain rounded-lg border border-[#E5DED2] bg-white cursor-zoom-in"
                        />
                        <button
                          type="button"
                          onClick={() => setLightboxOpen(true)}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#486755] hover:underline cursor-pointer"
                        >
                          <ZoomIn className="w-3.5 h-3.5" />
                          Enlarge source image
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-xs text-[#6B655C] py-3 px-2 bg-white rounded-lg border border-[#E5DED2]">
                        <FileText className="w-4 h-4 text-[#486755]" />
                        <a
                          href={draftQuote.attachmentPreview.dataUrl}
                          download={draftQuote.attachmentPreview.fileName}
                          className="underline hover:text-[#486755]"
                        >
                          Download original PDF
                        </a>
                      </div>
                    )}
                  </div>
                )}

                {draftQuote.sourceText && (
                  <div className="rounded-xl bg-[#FAF8F4] border border-[#E5DED2] p-4">
                    {renderHighlightedSource()}
                  </div>
                )}

                {draftQuote.evidenceSpans.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-[#22201D] mb-2">
                      Source evidence (click to highlight)
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

              {/* RIGHT PANE: Progressive-Disclosure Review Sections */}
              <div
                className={`lg:col-span-7 p-5 overflow-y-auto space-y-4 ${
                  mobilePane === 'extracted' ? 'block' : 'hidden lg:block'
                }`}
              >
                {unlinkedNotice && (
                  <div className="rounded-xl bg-[#EEF4FB] border border-[#B5D3EE] p-3 text-xs text-[#214869]">
                    {unlinkedNotice}
                  </div>
                )}

                {revisionDraft && (
                  <>
                    {revisionPreview ? (
                      <QuoteRevisionReview
                        vendorName={linkedVendor?.name ?? vendorName}
                        preview={revisionPreview}
                        decisions={revisionDraft.decisions}
                        note={revisionDraft.note}
                        onDecision={updateRevisionDecision}
                        onNoteChange={updateRevisionNote}
                        onRefresh={latestApprovedQuote?.approvalState === 'approved' ? refreshRevisionBaseline : undefined}
                        restartManual={revisionDraft.mode === 'manual'}
                        isBooked={bookedRevision}
                        additionalBlockers={revisionBlockers}
                      />
                    ) : (
                      <div role="status" className="space-y-2 rounded-xl border border-[#F59E0B]/60 bg-[#FFFBEB] p-3 text-xs text-[#92400E]">
                        <p>The approved quote for this revision is unavailable. You can save the draft for review.</p>
                        {latestApprovedQuote?.approvalState === 'approved' && (
                          <button type="button" onClick={refreshRevisionBaseline} className="rounded-md border border-[#D49A49] bg-white px-2.5 py-1.5 font-semibold">
                            {revisionDraft.mode === 'manual' ? 'Restart from latest approved quote' : 'Use latest approved quote'}
                          </button>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      aria-expanded={showRevisionDetails}
                      aria-controls="quote-revision-details"
                      onClick={() => setShowRevisionDetails((current) => !current)}
                      className="rounded-lg border border-[#E5DED2] bg-white px-3 py-2 text-xs font-semibold text-[#486755]"
                    >
                      {showRevisionDetails ? 'Hide quote details' : 'Open quote details'}
                    </button>
                  </>
                )}

                <div id={revisionDraft ? 'quote-revision-details' : undefined}
                  hidden={Boolean(revisionDraft && !showRevisionDetails)} className="space-y-4">
                {/* 1. PROMINENT SUMMARY CARD: Vendor identity + Estimated Total */}
                {!revisionDraft && <div className="rounded-2xl bg-white border border-[#E5DED2] p-5 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-lg font-semibold text-[#22201D]">
                          {isVendorNameValid ? vendorName : 'Vendor name needed'}
                        </h3>
                        <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-[#F3EFE8] text-[#6B655C]">
                          {CATEGORY_META[vendorCategory]?.label ?? 'Other'}
                        </span>
                        {!calc.isEstimateComplete && (
                          <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#FEF3C7] text-[#92400E]">
                            Incomplete estimate
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[#6B655C] mt-1 flex flex-wrap items-center gap-2">
                        {vendorLocation ? (
                          <span>{vendorLocation}</span>
                        ) : (
                          <span>Location not stated</span>
                        )}
                        {primarySelectedEvent && (
                          <span>
                            · {primarySelectedEvent.name}
                            {primarySelectedEvent.guestCount
                              ? ` (${primarySelectedEvent.guestCount} guests)`
                              : ''}
                          </span>
                        )}
                        {draftQuote.minGuests && (
                          <span>· Min {draftQuote.minGuests} guests</span>
                        )}
                        {draftQuote.maxCapacity && (
                          <span>· Max {draftQuote.maxCapacity}</span>
                        )}
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-[11px] font-medium text-[#6B655C]">
                        {calc.isEstimateComplete ? 'Estimated total' : 'Known total so far'}
                      </div>
                      <div className="font-num text-2xl font-semibold text-[#1F3A2B]">
                        {formatCurrency(calc.estimatedAllInTotal, calc.currencyLabel, {
                          decimals: 2,
                        })}
                      </div>
                      {calc.negotiatedSavings > 0 && (
                        <div className="inline-flex items-center gap-1 mt-1 text-xs font-semibold text-[#234733] bg-[#DFEFE4] px-2.5 py-0.5 rounded-full">
                          <Tag className="w-3 h-3" />
                          Saved {formatShortCad(calc.negotiatedSavings)} negotiated
                        </div>
                      )}
                    </div>
                  </div>
                </div>}

                {/* 2. NEEDS YOUR ATTENTION (only shown when items require user action) */}
                {needsAttentionCount > 0 && (
                  <div className="rounded-2xl bg-[#FFFBEB] border border-[#F59E0B]/60 p-4 space-y-3.5">
                    <div className="flex items-center gap-2 text-xs font-semibold text-[#92400E]">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      Needs your attention ({needsAttentionCount})
                    </div>

                    {/* Missing Vendor Name (stays mounted while typing until confirmed) */}
                    {(!isVendorNameValid || vendorNamePromptOpen) && (
                      <div className="rounded-xl bg-white border border-[#E5DED2] p-3 space-y-2">
                        <label className="block text-xs font-semibold text-[#22201D]">
                          Who is this quote from?
                        </label>
                        <p className="text-[11px] text-[#6B655C]">
                          {draftQuote.manualEntry
                            ? 'Enter the vendor name from the original quote when you have it.'
                            : 'The vendor name wasn’t stated in the quote. Enter it so we don’t save a placeholder name.'}
                        </p>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={vendorName}
                            onChange={(e) => setVendorName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && isVendorNameValid) {
                                setVendorNamePromptOpen(false);
                              }
                            }}
                            placeholder="e.g. Grand Palace Banquet Hall"
                            className="flex-1 rounded-lg border border-[#E5DED2] px-3 py-2 text-xs font-medium text-[#22201D] focus:outline-none focus:border-[#486755]"
                          />
                          {isVendorNameValid && (
                            <button
                              type="button"
                              onClick={() => setVendorNamePromptOpen(false)}
                              className="px-3 py-2 text-xs font-semibold rounded-lg bg-[#486755] text-white hover:bg-[#395344] cursor-pointer whitespace-nowrap"
                            >
                              Done
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {legacyOvertimeItems.map((item) => (
                      <div key={item.id} className="rounded-xl bg-white border border-[#E5DED2] p-3 space-y-2">
                        <div className="text-xs font-semibold text-[#22201D]">Confirm hours for {item.label}</div>
                        <p className="text-[11px] text-[#6B655C]">
                          Your saved estimate includes one hour. Confirm that hour or treat this as a rate for extra hours.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => updateQuoteLineItem(item.id, { isConditionalOvertime: false, quantity: 1 })}
                            className="rounded-lg border border-[#E5DED2] px-3 py-1.5 text-xs font-semibold"
                          >
                            Keep one hour
                          </button>
                          <button
                            type="button"
                            onClick={() => updateQuoteLineItem(item.id, { isConditionalOvertime: true, quantity: undefined })}
                            className="rounded-lg border border-[#E5DED2] px-3 py-1.5 text-xs font-semibold"
                          >
                            Treat as overtime
                          </button>
                        </div>
                      </div>
                    ))}

                    {/* Mutually Exclusive Package Selection Required */}
                    {calc.unresolvedPackageSelection && draftQuote.packages && (
                      <div className="rounded-xl bg-white border border-[#E5DED2] p-3 space-y-2">
                        <div className="text-xs font-semibold text-[#22201D]">
                          Choose one package option
                        </div>
                        <p className="text-[11px] text-[#6B655C]">
                          This quote includes multiple package tiers. Select one package to calculate your estimate (all options are preserved for future comparison), or Save as Draft.
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {draftQuote.packages.map((pkg) => (
                            <button
                              key={pkg.id}
                              type="button"
                              onClick={() =>
                                updateQuote((q) => ({
                                  ...q,
                                  selectedPackageId: pkg.id,
                                  minGuests: pkg.minGuests ?? q.minGuests,
                                  maxCapacity: pkg.maxCapacity ?? q.maxCapacity,
                                }))
                              }
                              className="text-left rounded-xl border border-[#E5DED2] bg-[#FAF8F4] hover:border-[#486755] hover:bg-[#EAF5EE] p-3 space-y-1 cursor-pointer transition-colors"
                            >
                              <div className="text-xs font-semibold text-[#22201D]">
                                {pkg.name}
                              </div>
                              <div className="font-num text-sm font-semibold text-[#1F3A2B]">
                                {pkg.unitPrice !== null
                                  ? `${formatShortCad(pkg.unitPrice)}${pkg.pricingModel === 'per_person' ? '/person' : ' flat'}`
                                  : 'Price TBD'}
                              </div>
                              <div className="text-[11px] text-[#6B655C]">
                                {pkg.minGuests ? `Min ${pkg.minGuests} guests` : 'No minimum stated'}
                                {pkg.extraGuestRate
                                  ? ` · +$${pkg.extraGuestRate}/extra guest`
                                  : ''}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {hasIncompleteManualPricing(draftQuote) && (
                      <p className="text-xs text-[#92400E]">Enter a name and amount for each quoted charge before approving. You can save incomplete details as a draft.</p>
                    )}

                    {/* Ambiguous Currency — suggest workspace currency */}
                    {calc.isCurrencyUnknown && (
                      <div className="rounded-xl bg-white border border-[#E5DED2] p-3 space-y-2">
                        <div className="text-xs font-semibold text-[#22201D]">
                          Confirm currency
                        </div>
                        <p className="text-[11px] text-[#6B655C]">
                          Which currency does the original quote use? Your workspace uses {activeWorkspace.currency}.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              updateQuote((q) => ({
                                ...q,
                                currency: activeWorkspace.currency,
                                currencySource: 'user_confirmed',
                              }))
                            }
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#486755] text-white hover:bg-[#395344] cursor-pointer"
                          >
                            Use {activeWorkspace.currency} (workspace default)
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateQuote((q) => ({
                                ...q,
                                currency: activeWorkspace.currency === 'CAD' ? 'USD' : 'CAD',
                                currencySource: 'user_confirmed',
                              }))
                            }
                            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[#E5DED2] bg-white text-[#22201D] hover:bg-[#F3EFE8] cursor-pointer"
                          >
                            Use {activeWorkspace.currency === 'CAD' ? 'USD' : 'CAD'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Unresolved Gratuity Percentage / Basis */}
                    {calc.gratuityUnresolved && (
                      <div className="rounded-xl bg-white border border-[#E5DED2] p-3 space-y-2">
                        <div className="text-xs font-semibold text-[#22201D]">
                          Gratuity is extra, but the percentage or basis is missing
                        </div>
                        <p className="text-[11px] text-[#6B655C]">
                          Confirm the gratuity percentage and what it applies to, or save as a draft until the vendor confirms.
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            placeholder="e.g. 15"
                            value={gratuityPercentInput}
                            onChange={(e) => setGratuityPercentInput(e.target.value)}
                            className="w-24 rounded-lg border border-[#E5DED2] px-2.5 py-1.5 font-num text-xs text-[#22201D]"
                          />
                          <span className="text-xs text-[#6B655C]">% of</span>
                          <select
                            value={draftQuote.gratuityBasis ?? 'entire_subtotal'}
                            onChange={(e) =>
                              updateQuote((q) => ({
                                ...q,
                                gratuityBasis: e.target.value as PercentageBasis,
                              }))
                            }
                            className="rounded-lg border border-[#E5DED2] px-2.5 py-1.5 text-xs text-[#22201D]"
                          >
                            <option value="food_subtotal">Food subtotal</option>
                            <option value="entire_subtotal">Entire subtotal</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => {
                              const parsed = parseFloat(gratuityPercentInput);
                              if (Number.isNaN(parsed) || parsed < 0) return;
                              updateQuote((q) => ({
                                ...q,
                                gratuityStatus: 'excluded',
                                gratuityPercent: parsed,
                                gratuityBasis: q.gratuityBasis ?? 'entire_subtotal',
                              }));
                            }}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#486755] text-white hover:bg-[#395344] cursor-pointer"
                          >
                            Apply gratuity
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Price Conflicts */}
                    {draftQuote.conflicts.map((conflict) => (
                      <div
                        key={conflict.id}
                        className="rounded-xl bg-white border border-[#EED0BE] p-3 space-y-2"
                      >
                        <div className="text-xs font-semibold text-[#7A4329]">
                          Conflicting prices for {conflict.fieldLabel} — pick one
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {conflict.options.map((opt) => {
                            const chosen = conflict.resolvedOptionId === opt.id;
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => {
                                  if (opt.evidenceId) setActiveEvidenceId(opt.evidenceId);
                                  const applyOption = (li: QuoteLineItem): QuoteLineItem =>
                                    li.id === conflict.targetLineItemId
                                      ? {
                                          ...li,
                                          unitPrice: opt.amount,
                                          pricingModel: opt.pricingModel ?? li.pricingModel,
                                        }
                                      : li;
                                  updateQuote((q) => ({
                                    ...q,
                                    conflicts: q.conflicts.map((c) =>
                                      c.id === conflict.id
                                        ? { ...c, resolvedOptionId: opt.id }
                                        : c
                                    ),
                                    lineItems: q.lineItems.map(applyOption),
                                    packages: q.packages?.map((pkg) =>
                                      pkg.fees?.some((fee) => fee.id === conflict.targetLineItemId)
                                        ? { ...pkg, fees: pkg.fees.map(applyOption) }
                                        : pkg
                                    ),
                                  }));
                                }}
                                className={`text-left rounded-lg border p-2.5 cursor-pointer ${
                                  chosen
                                    ? 'bg-[#E7F1EA] border-[#486755]'
                                    : 'bg-[#FAF8F4] border-[#E5DED2]'
                                }`}
                              >
                                <div className="font-num text-sm font-semibold text-[#22201D]">
                                  {formatShortCad(opt.amount)}
                                  {opt.pricingModel === 'per_person'
                                    ? '/person'
                                    : opt.pricingModel === 'hourly'
                                      ? '/hr'
                                      : ''}
                                </div>
                                <div className="text-[11px] text-[#6B655C]">
                                  {opt.sourceLabel}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}

                    {/* Unresolved Selected Package Base Price */}
                    {calc.unresolvedPackagePrice && draftQuote.selectedPackageId && (
                      <div className="rounded-xl bg-white border border-[#E5DED2] p-3 space-y-2">
                        <div className="text-xs font-semibold text-[#22201D]">
                          Confirm base price for {calc.selectedPackageName ?? 'selected package'}
                        </div>
                        <p className="text-[11px] text-[#6B655C]">
                          This package’s price wasn’t stated in the quote. Enter the confirmed price to approve, or Save as Draft.
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={pkgPriceModel}
                            onChange={(e) => setPkgPriceModel(e.target.value as 'flat' | 'per_person')}
                            className="rounded-lg border border-[#E5DED2] bg-white px-2.5 py-1.5 text-xs"
                          >
                            <option value="flat">Fixed price</option>
                            <option value="per_person">Per guest</option>
                          </select>
                          <input
                            type="number"
                            placeholder="Confirmed amount"
                            value={pkgPriceInput}
                            onChange={(e) => setPkgPriceInput(e.target.value)}
                            className="w-36 rounded-lg border border-[#E5DED2] px-2.5 py-1.5 font-num text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const parsed = parseFloat(pkgPriceInput);
                              if (Number.isNaN(parsed) || parsed < 0) return;
                              updateQuote((q) => ({
                                ...q,
                                packages: q.packages?.map((p) =>
                                  p.id === q.selectedPackageId
                                    ? { ...p, pricingModel: pkgPriceModel, unitPrice: parsed }
                                    : p
                                ),
                              }));
                              setPkgPriceInput('');
                            }}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[#486755] text-white cursor-pointer"
                          >
                            Confirm package price
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Unconfirmed Mandatory Fees (quote-wide + selected package) */}
                    {draftQuote.unconfirmedFees
                      .filter(
                        (fee) => !fee.packageId || fee.packageId === draftQuote.selectedPackageId
                      )
                      .map((fee) => (
                      <div
                        key={fee.id}
                        onClick={() =>
                          fee.evidenceId && setActiveEvidenceId(fee.evidenceId)
                        }
                        className="rounded-xl bg-white border border-[#E5DED2] p-3 space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-xs font-semibold text-[#22201D]">
                              {fee.label}
                            </div>
                            <p className="text-[11px] text-[#6B655C]">{fee.description}</p>
                          </div>
                          <span className="text-[11px] font-semibold text-[#B45309]">
                            {fee.status === 'unconfirmed'
                              ? 'Unresolved'
                              : fee.status === 'confirmed_amount'
                                ? formatShortCad(fee.confirmedAmount)
                                : 'Included / Waived'}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="number"
                            placeholder="Confirmed amount"
                            value={feeInputs[fee.id] ?? (fee.confirmedAmount ?? '')}
                            onChange={(e) =>
                              setFeeInputs((prev) => ({
                                ...prev,
                                [fee.id]: e.target.value,
                              }))
                            }
                            className="w-36 rounded-lg border border-[#E5DED2] px-2.5 py-1.5 font-num text-xs"
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
                            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[#486755] text-white cursor-pointer"
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
                            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[#E5DED2] bg-white cursor-pointer"
                          >
                            Mark included / waived
                          </button>
                        </div>
                      </div>
                    ))}

                    {/* Source Evidence Warnings */}
                    {draftQuote.sourceWarnings &&
                      draftQuote.sourceWarnings.length > 0 &&
                      !draftQuote.sourceWarningsAcknowledged && (
                        <div className="rounded-xl bg-[#FEF2F2] border border-[#FCA5A5] p-3 space-y-2">
                          <div className="text-xs font-semibold text-[#991B1B]">
                            Verify flagged evidence against original source
                          </div>
                          <ul className="list-disc pl-4 text-[11px] text-[#991B1B] space-y-0.5">
                            {draftQuote.sourceWarnings.map((w, i) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                          <button
                            type="button"
                            onClick={() =>
                              updateQuote((q) => ({
                                ...q,
                                sourceWarningsAcknowledged: true,
                              }))
                            }
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#991B1B] text-white cursor-pointer"
                          >
                            I checked these against the source
                          </button>
                        </div>
                      )}
                  </div>
                )}

                {/* 2B. PACKAGE OPTION SWITCHER (always visible when multiple packages exist) */}
                {draftQuote.packages && draftQuote.packages.length >= 2 && (
                  <div className="rounded-2xl bg-white border border-[#E5DED2] p-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold text-[#22201D]">
                        Package options ({draftQuote.packages.length} preserved)
                      </h4>
                      <span className="text-[11px] text-[#6B655C]">
                        Mutually exclusive — only selected package is counted
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {draftQuote.packages.map((pkg) => {
                        const selected = draftQuote.selectedPackageId === pkg.id;
                        return (
                          <button
                            key={pkg.id}
                            type="button"
                            onClick={() =>
                              updateQuote((q) => ({
                                ...q,
                                selectedPackageId: pkg.id,
                                minGuests: pkg.minGuests ?? q.minGuests,
                                maxCapacity: pkg.maxCapacity ?? q.maxCapacity,
                              }))
                            }
                            className={`text-left rounded-xl border p-3 space-y-1 cursor-pointer transition-colors ${
                              selected
                                ? 'bg-[#E7F1EA] border-[#486755]'
                                : 'bg-[#FAF8F4] border-[#E5DED2] hover:border-[#486755]/60'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-[#22201D]">
                                {pkg.name}
                              </span>
                              {selected && (
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#486755] text-white">
                                  Selected
                                </span>
                              )}
                            </div>
                            <div className="font-num text-sm font-semibold text-[#1F3A2B]">
                              {formatShortCad(pkg.unitPrice)}
                              {pkg.pricingModel === 'per_person' ? '/person' : ' flat'}
                            </div>
                            <div className="text-[11px] text-[#6B655C]">
                              {pkg.minGuests ? `Min ${pkg.minGuests} guests` : 'No minimum stated'}
                              {pkg.extraGuestRate ? ` · +$${pkg.extraGuestRate}/extra guest` : ''}
                              {pkg.inclusions.length > 0
                                ? ` · ${pkg.inclusions.length} inclusions`
                                : ''}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 3. PRICE & COST BREAKDOWN (Plain language + expandable editor) */}
                <div className="rounded-2xl bg-white border border-[#E5DED2] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-[#22201D]">
                      Price &amp; cost breakdown
                    </h4>
                    <button
                      type="button"
                      onClick={() => setShowLineItemEditor((prev) => !prev)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#486755] hover:underline cursor-pointer"
                    >
                      {showLineItemEditor ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                      {showLineItemEditor ? 'Hide line-item editor' : 'Edit line items & tax'}
                    </button>
                  </div>

                    {/* Clean Readable Breakdown */}
                    <div className="divide-y divide-[#F0EAE0] text-xs">
                      {calc.lineItemBreakdowns.map((row) => {
                        const matchingOvertimeItem = row.conditionalOvertime
                          ? editableLineItems.find((li) => li.id === row.id)
                          : undefined;
                        const extraHours = row.billableHours ?? matchingOvertimeItem?.quantity ?? 0;
                        return (
                          <div
                            key={row.id}
                            className="py-2 flex items-start justify-between gap-3"
                          >
                            <div>
                              <div className="font-medium text-[#22201D] flex items-center gap-1.5 flex-wrap">
                                <span>{row.label}</span>
                                {row.isThirdParty && (
                                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[#EAE2F7] text-[#42306B]">
                                    Third-party{row.thirdPartyProvider ? ` · ${row.thirdPartyProvider}` : ''}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-[#6B655C] mt-0.5">
                                {row.formulaText}
                              </div>
                              {matchingOvertimeItem && (
                                <div className="mt-1.5 inline-flex items-center gap-2 text-[11px] text-[#22201D]">
                                  <span className="text-[#6B655C]">Extra hours:</span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      updateQuoteLineItem(matchingOvertimeItem.id, { quantity: Math.max(0, extraHours - 1) })
                                    }
                                    className="w-6 h-6 rounded border border-[#E5DED2] bg-[#FAF8F4] font-semibold cursor-pointer"
                                    aria-label="Decrease extra hours"
                                  >
                                    −
                                  </button>
                                  <span className="font-num font-semibold min-w-[1.5rem] text-center">
                                    {extraHours}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      updateQuoteLineItem(matchingOvertimeItem.id, { quantity: extraHours + 1 })
                                    }
                                    className="w-6 h-6 rounded border border-[#E5DED2] bg-[#FAF8F4] font-semibold cursor-pointer"
                                    aria-label="Increase extra hours"
                                  >
                                    +
                                  </button>
                                </div>
                              )}
                              {row.negotiatedSavings && row.negotiatedOriginalAmount && (
                                <div className="text-[11px] font-medium text-[#234733] mt-0.5">
                                  Normally {formatShortCad(row.negotiatedOriginalAmount)} · You save{' '}
                                  {formatShortCad(row.negotiatedSavings)}
                                </div>
                              )}
                            </div>
                            <div className="font-num font-semibold text-[#22201D] whitespace-nowrap">
                              {row.amount !== null
                                ? formatCurrency(row.amount, calc.currencyLabel, { decimals: 2 })
                                : 'Needs basis'}
                            </div>
                          </div>
                        );
                      })}

                    {calc.gratuityAmount > 0 && (
                      <div className="py-2 flex items-center justify-between text-[#6B655C]">
                        <span>
                          Gratuity ({draftQuote.gratuityPercent}% of{' '}
                          {calc.gratuityBasisLabel ?? 'subtotal'})
                        </span>
                        <span className="font-num font-medium text-[#22201D]">
                          {formatCurrency(calc.gratuityAmount, calc.currencyLabel, {
                            decimals: 2,
                          })}
                        </span>
                      </div>
                    )}

                    <div className="py-2 space-y-2">
                      <div className="flex items-center justify-between text-[#6B655C]">
                        <span>{calc.taxStatusLabel}</span>
                        <span className="font-num font-medium text-[#22201D]">
                          {formatCurrency(calc.taxAmount, calc.currencyLabel, {
                            decimals: 2,
                          })}
                        </span>
                      </div>
                      {calc.taxRateUnresolved && (
                        <div className="rounded-lg bg-[#FFFBEB] border border-[#F59E0B]/50 p-2.5 space-y-1.5">
                          <div className="text-[11px] text-[#92400E]">
                            This quote states “plus tax” without a percentage. Enter the confirmed tax rate (or estimate 13% HST) before booking.
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="Tax % (e.g. 13)"
                              value={taxPercentInput}
                              onChange={(e) => setTaxPercentInput(e.target.value)}
                              className="w-28 rounded-md border border-[#E5DED2] bg-white px-2 py-1 font-num text-[11px]"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const parsed = parseFloat(taxPercentInput);
                                if (Number.isNaN(parsed) || parsed < 0) return;
                                updateEffectiveTaxHandling('excluded_plus_hst', parsed);
                                setTaxPercentInput('');
                              }}
                              className="px-2.5 py-1 text-[11px] font-semibold rounded-md bg-[#486755] text-white cursor-pointer"
                            >
                              Apply rate
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                updateEffectiveTaxHandling('unspecified_ontario_assumed', 13)
                              }
                              className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-white border border-[#E5DED2] text-[#22201D] hover:bg-[#FAF8F4] cursor-pointer"
                            >
                              Estimate 13% HST
                            </button>
                          </div>
                        </div>
                      )}
                      {calc.taxNotStated && (
                        <div className="rounded-lg bg-[#FFFBEB] border border-[#F59E0B]/50 p-2.5 space-y-1.5">
                          <div className="text-[11px] text-[#92400E]">
                            Tax not stated — excluded from estimate. You can approve for your projected budget now, but tax must be confirmed before booking.
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                updateEffectiveTaxHandling(
                                  'unspecified_ontario_assumed',
                                  draftQuote.taxPercent ?? 13
                                )
                              }
                              className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-white border border-[#E5DED2] text-[#22201D] hover:bg-[#FAF8F4] cursor-pointer"
                            >
                              Estimate 13% HST
                            </button>
                            <button
                              type="button"
                              onClick={() => updateEffectiveTaxHandling('included')}
                              className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-white border border-[#E5DED2] text-[#22201D] hover:bg-[#FAF8F4] cursor-pointer"
                            >
                              Tax included
                            </button>
                            <button
                              type="button"
                              onClick={() => updateEffectiveTaxHandling('tax_exempt')}
                              className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-white border border-[#E5DED2] text-[#22201D] hover:bg-[#FAF8F4] cursor-pointer"
                            >
                              Confirmed no tax charged
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Expandable Detailed Line-Item & Tax Editor */}
                  {showLineItemEditor && (
                    <div className="pt-3 border-t border-[#E5DED2] space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-medium text-[#6B655C] mb-1">
                            Currency
                          </label>
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
                            className="w-full rounded-lg border border-[#E5DED2] px-2.5 py-1.5 text-xs"
                          >
                            <option value="CAD">CAD ($ Canadian Dollar)</option>
                            <option value="USD">USD ($ US Dollar)</option>
                            <option value="UNKNOWN">Unknown / Unspecified</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-[#6B655C] mb-1">
                            Tax handling
                          </label>
                          <select
                            value={calc.effectiveTaxHandling}
                            onChange={(e) =>
                              updateEffectiveTaxHandling(e.target.value as TaxHandling)
                            }
                            className="w-full rounded-lg border border-[#E5DED2] px-2.5 py-1.5 text-xs"
                          >
                            <option value="excluded_plus_hst">Excluded — add tax/HST</option>
                            <option value="unspecified_ontario_assumed">
                              Estimated jurisdiction tax (13% HST)
                            </option>
                            <option value="included">Tax already included</option>
                            <option value="tax_exempt">Confirmed no tax charged (0%)</option>
                            <option value="unspecified">
                              Tax not stated — confirm later (0%)
                            </option>
                          </select>
                        </div>
                      </div>

                      {draftQuote.lineItems.map((item) => {
                        const row = calc.lineItemBreakdowns.find((line) => line.id === item.id);
                        const conditional = row?.conditionalOvertime ?? item.isConditionalOvertime ?? false;
                        return (
                        <div
                          key={item.id}
                          onClick={() =>
                            item.evidenceId && setActiveEvidenceId(item.evidenceId)
                          }
                          className="rounded-xl border border-[#E5DED2] bg-[#FAF8F4] p-3 space-y-2"
                        >
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                            <input
                              type="text"
                              value={item.label}
                              onChange={(e) =>
                                updateQuote((q) => ({
                                  ...q,
                                  lineItems: q.lineItems.map((li) =>
                                    li.id === item.id ? { ...li, label: e.target.value } : li
                                  ),
                                }))
                              }
                              className="sm:col-span-5 rounded-lg border border-[#E5DED2] bg-white px-2.5 py-1.5 text-xs font-medium"
                            />
                            <select
                              value={item.pricingModel}
                              onChange={(e) =>
                                updateQuote((q) => ({
                                  ...q,
                                  lineItems: q.lineItems.map((li) =>
                                    li.id === item.id
                                      ? {
                                          ...li,
                                          pricingModel: e.target.value as LineItemPricingModel,
                                        }
                                      : li
                                  ),
                                }))
                              }
                              className="sm:col-span-4 rounded-lg border border-[#E5DED2] bg-white px-2 py-1.5 text-xs"
                            >
                              {(Object.keys(PRICING_MODEL_LABELS) as LineItemPricingModel[]).map(
                                (m) => (
                                  <option key={m} value={m}>
                                    {PRICING_MODEL_LABELS[m]}
                                  </option>
                                )
                              )}
                            </select>
                            <input
                              type="number"
                              value={item.manualAmountPending ? '' : item.unitPrice}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                updateQuote((q) => ({
                                  ...q,
                                  lineItems: q.lineItems.map((li) =>
                                    li.id === item.id
                                      ? {
                                          ...li,
                                          unitPrice: Number.isNaN(val) ? 0 : val,
                                          manualAmountPending: q.manualEntry && Number.isNaN(val) ? true : undefined,
                                        }
                                      : li
                                  ),
                                }));
                              }}
                              className="sm:col-span-3 rounded-lg border border-[#E5DED2] bg-white px-2.5 py-1.5 text-right font-num text-xs font-semibold"
                            />
                          </div>

                          {/* Conditional fields by pricing model */}
                          {item.pricingModel === 'guest_ratio' && (
                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#6B655C]">
                              <span>1</span>
                              <input
                                type="text"
                                value={item.unitLabel ?? ''}
                                placeholder="e.g. bartender"
                                onChange={(e) =>
                                  updateQuote((q) => ({
                                    ...q,
                                    lineItems: q.lineItems.map((li) =>
                                      li.id === item.id
                                        ? { ...li, unitLabel: e.target.value }
                                        : li
                                    ),
                                  }))
                                }
                                className="w-28 rounded border border-[#E5DED2] bg-white px-2 py-1 text-xs text-[#22201D]"
                              />
                              <span>per</span>
                              <input
                                type="number"
                                min="1"
                                value={item.ratioDivisor ?? 75}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value, 10);
                                  updateQuote((q) => ({
                                    ...q,
                                    lineItems: q.lineItems.map((li) =>
                                      li.id === item.id
                                        ? {
                                            ...li,
                                            ratioDivisor: Number.isNaN(val) ? 1 : val,
                                          }
                                        : li
                                    ),
                                  }));
                                }}
                                className="w-20 rounded border border-[#E5DED2] bg-white px-2 py-1 font-num text-xs text-[#22201D]"
                              />
                              <span>guests</span>
                            </div>
                          )}

                          {item.pricingModel === 'percentage' && (
                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#6B655C]">
                              <span>Applies to:</span>
                              <select
                                value={item.percentageBasis ?? 'unknown'}
                                onChange={(e) =>
                                  updateQuote((q) => ({
                                    ...q,
                                    lineItems: q.lineItems.map((li) =>
                                      li.id === item.id
                                        ? {
                                            ...li,
                                            percentageBasis: e.target.value as PercentageBasis,
                                          }
                                        : li
                                    ),
                                  }))
                                }
                                className="rounded border border-[#E5DED2] bg-white px-2 py-1 text-xs text-[#22201D]"
                              >
                                {(Object.keys(PERCENTAGE_BASIS_LABELS) as PercentageBasis[]).map(
                                  (b) => (
                                    <option key={b} value={b}>
                                      {PERCENTAGE_BASIS_LABELS[b]}
                                    </option>
                                  )
                                )}
                              </select>
                              {item.percentageBasis === 'custom_amount' && (
                                <input
                                  type="number"
                                  placeholder="Confirmed basis $"
                                  value={item.customBasisAmount ?? ''}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    updateQuote((q) => ({
                                      ...q,
                                      lineItems: q.lineItems.map((li) =>
                                        li.id === item.id
                                          ? {
                                              ...li,
                                              customBasisAmount: Number.isNaN(val)
                                                ? undefined
                                                : val,
                                            }
                                          : li
                                      ),
                                    }));
                                  }}
                                  className="w-32 rounded border border-[#E5DED2] bg-white px-2 py-1 font-num text-xs text-[#22201D]"
                                />
                              )}
                            </div>
                          )}
                          {/* Extra-guest threshold, minGuests, or quantity editing + Delete */}
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#6B655C]">
                            <div className="flex flex-wrap items-center gap-2">
                              {item.pricingModel === 'per_person' && (
                                <label className="inline-flex items-center gap-1.5">
                                  <span>Min guests:</span>
                                  <input
                                    type="number"
                                    min="0"
                                    value={item.minGuests ?? ''}
                                    placeholder="None"
                                    onChange={(e) => {
                                      const val = parseInt(e.target.value, 10);
                                      updateQuote((q) => ({
                                        ...q,
                                        lineItems: q.lineItems.map((li) =>
                                          li.id === item.id
                                            ? { ...li, minGuests: Number.isNaN(val) ? undefined : val }
                                            : li
                                        ),
                                      }));
                                    }}
                                    className="w-20 rounded border border-[#E5DED2] bg-white px-2 py-1 font-num text-xs text-[#22201D]"
                                  />
                                </label>
                              )}
                              {item.pricingModel === 'per_extra_guest' && (
                                <label className="inline-flex items-center gap-1.5">
                                  <span>Guests above:</span>
                                  <input
                                    type="number"
                                    min="0"
                                    value={item.guestThreshold ?? ''}
                                    placeholder="e.g. 150"
                                    onChange={(e) => {
                                      const val = parseInt(e.target.value, 10);
                                      updateQuote((q) => ({
                                        ...q,
                                        lineItems: q.lineItems.map((li) =>
                                          li.id === item.id
                                            ? { ...li, guestThreshold: Number.isNaN(val) ? 0 : val }
                                            : li
                                        ),
                                      }));
                                    }}
                                    className="w-20 rounded border border-[#E5DED2] bg-white px-2 py-1 font-num text-xs text-[#22201D]"
                                  />
                                </label>
                              )}
                              {item.pricingModel === 'hourly' && (
                                <div className="flex flex-wrap items-center gap-3">
                                  <label className="inline-flex items-center gap-1.5">
                                    <span>{conditional ? 'Extra hours:' : 'Planned hours:'}</span>
                                    <input
                                      type="number"
                                      min="0"
                                      value={row?.billableHours ?? item.quantity ?? (conditional ? 0 : item.extractedHours ?? 1)}
                                      onChange={(e) => {
                                        const val = parseFloat(e.target.value);
                                        updateQuote((q) => ({
                                          ...q,
                                          lineItems: q.lineItems.map((li) =>
                                            li.id === item.id
                                              ? { ...li, quantity: Number.isNaN(val) ? 0 : val }
                                              : li
                                          ),
                                        }));
                                      }}
                                      className="w-20 rounded border border-[#E5DED2] bg-white px-2 py-1 font-num text-xs text-[#22201D]"
                                    />
                                  </label>
                                  <label className="inline-flex items-center gap-1.5 cursor-pointer text-[#22201D]">
                                    <input
                                      type="checkbox"
                                      checked={conditional}
                                      onChange={(e) => {
                                        const checked = e.target.checked;
                                        updateQuote((q) => ({
                                          ...q,
                                          lineItems: q.lineItems.map((li) =>
                                            li.id === item.id
                                              ? {
                                                  ...li,
                                                  isConditionalOvertime: checked,
                                                  quantity: checked
                                                    ? 0
                                                    : Math.max(1, row?.billableHours ?? li.quantity ?? 1),
                                                }
                                              : li
                                          ),
                                        }));
                                      }}
                                      className="accent-[#486755]"
                                    />
                                    <span>Conditional rate (0 hrs default)</span>
                                  </label>
                                </div>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                updateQuote((q) => ({
                                  ...q,
                                  lineItems: q.lineItems.filter((li) => li.id !== item.id),
                                }))
                              }
                              className="inline-flex items-center gap-1 text-[11px] text-[#991B1B] hover:underline cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                              Remove
                            </button>
                          </div>
                        </div>
                        );
                      })}

                      <button
                        type="button"
                        onClick={() =>
                          updateQuote((q) => ({
                            ...q,
                            lineItems: [
                              ...q.lineItems,
                              {
                                id: `li-manual-${Date.now()}`,
                                label: q.manualEntry ? '' : 'New line item',
                                pricingModel: 'flat',
                                unitPrice: 0,
                                manualAmountPending: q.manualEntry,
                                eventId: selectedEventIds[0],
                              },
                            ],
                          }))
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-dashed border-[#486755] text-[#486755] hover:bg-[#EAF5EE] cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add line item
                      </button>
                    </div>
                  )}
                </div>

                {/* Optional Add-Ons */}
                {draftQuote.addOns.length > 0 && (
                  <div className="rounded-2xl bg-white border border-[#E5DED2] p-4 space-y-2">
                    <h4 className="text-xs font-semibold text-[#22201D]">
                      Optional add-ons
                    </h4>
                    {calc.addOnImpacts.map((addon) => {
                      const rawAddOn = draftQuote.addOns.find((a) => a.id === addon.id);
                      const rawPkgName = rawAddOn?.packageId
                        ? draftQuote.packages?.find((p) => p.id === rawAddOn.packageId)?.name?.trim().toLowerCase()
                        : undefined;
                      const effectiveSelected =
                        revisionDraft?.mode === 'partial' && revisionPreview && !rawAddOn?.selectionConfirmed
                          ? (revisionPreview.quote.addOns.find((a) => {
                              if (a.id === addon.id) return true;
                              if (a.label.trim().toLowerCase() !== addon.label.trim().toLowerCase()) return false;
                              if ((a.packageId ?? undefined) === (rawAddOn?.packageId ?? undefined)) return true;
                              if (!rawPkgName || !a.packageId) return false;
                              const revPkgName = revisionPreview.quote.packages?.find((p) => p.id === a.packageId)?.name?.trim().toLowerCase();
                              return revPkgName === rawPkgName;
                            })?.selected ?? addon.selected)
                          : addon.selected;
                      return (
                      <label
                        key={addon.id}
                        className="flex items-start justify-between gap-3 rounded-lg border border-[#F0EAE0] p-2.5 cursor-pointer hover:bg-[#FAF8F4]"
                      >
                        <div className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={effectiveSelected}
                            onChange={() =>
                              updateQuote((q) => ({
                                ...q,
                                addOns: q.addOns.map((a) =>
                                  a.id === addon.id
                                    ? { ...a, selected: !effectiveSelected, selectionConfirmed: true }
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
                          +{formatShortCad(addon.impactWithTax)}
                        </span>
                      </label>
                      );
                    })}
                  </div>
                )}

                {/* 4. WHAT'S INCLUDED & DELIVERY TERMS */}
                {(getEffectiveQuoteInclusions(draftQuote).length > 0 ||
                  getEffectiveQuoteDeliveryTerms(draftQuote).length > 0 ||
                  draftQuote.serviceDurationHours ||
                  showLineItemEditor ||
                  (draftQuote.exclusions && draftQuote.exclusions.length > 0) ||
                  (draftQuote.restrictions && draftQuote.restrictions.length > 0)) && (
                  <div className="rounded-2xl bg-white border border-[#E5DED2] p-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold text-[#22201D]">
                        What’s included{calc.selectedPackageName ? ` · ${calc.selectedPackageName}` : ''}
                      </h4>
                      {draftQuote.serviceDurationHours && (
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#DFEFE4] text-[#234733]">
                          {draftQuote.serviceDurationHours} hours coverage
                        </span>
                      )}
                    </div>
                    {getEffectiveQuoteInclusions(draftQuote).length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {getEffectiveQuoteInclusions(draftQuote).map((inc, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-[#FAF8F4] border border-[#E5DED2] text-[#22201D]"
                          >
                            {inc}
                            {showLineItemEditor && (
                              <button
                                type="button"
                                onClick={() =>
                                  updateQuote((q) => ({
                                    ...q,
                                    inclusions: q.inclusions.filter((item) => item !== inc),
                                    packages: q.packages?.map((p) =>
                                      p.id === q.selectedPackageId
                                        ? { ...p, inclusions: p.inclusions.filter((item) => item !== inc) }
                                        : p
                                    ),
                                  }))
                                }
                                className="text-[#6B655C] hover:text-[#991B1B] cursor-pointer"
                                aria-label={`Remove inclusion ${inc}`}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                    {showLineItemEditor && (
                      <div className="flex items-center gap-2 pt-1">
                        <input
                          type="text"
                          value={newInclusionText}
                          onChange={(e) => setNewInclusionText(e.target.value)}
                          placeholder="Add package inclusion..."
                          className="flex-1 rounded-lg border border-[#E5DED2] px-2.5 py-1.5 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const val = newInclusionText.trim();
                            if (!val) return;
                            updateQuote((q) => ({
                              ...q,
                              inclusions: [...q.inclusions, val],
                            }));
                            setNewInclusionText('');
                          }}
                          className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-[#FAF8F4] border border-[#E5DED2] hover:bg-[#F3EFE8] cursor-pointer"
                        >
                          Add
                        </button>
                      </div>
                    )}
                    {(getEffectiveQuoteDeliveryTerms(draftQuote).length > 0 || showLineItemEditor) && (
                      <div className="pt-1 space-y-1.5">
                        <div className="text-[11px] font-semibold text-[#22201D]">
                          Delivery &amp; turnaround
                        </div>
                        {getEffectiveQuoteDeliveryTerms(draftQuote).length > 0 && (
                          <ul className="list-disc pl-4 text-xs text-[#22201D] space-y-0.5">
                            {getEffectiveQuoteDeliveryTerms(draftQuote).map((term, idx) => (
                              <li key={idx}>{term}</li>
                            ))}
                          </ul>
                        )}
                        {showLineItemEditor && (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={newDeliveryTermText}
                              onChange={(e) => setNewDeliveryTermText(e.target.value)}
                              placeholder="Add delivery term (e.g. Online gallery in 6–8 weeks)..."
                              className="flex-1 rounded-lg border border-[#E5DED2] px-2.5 py-1.5 text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const val = newDeliveryTermText.trim();
                                if (!val) return;
                                updateQuote((q) => ({
                                  ...q,
                                  deliveryTerms: [...(q.deliveryTerms ?? []), val],
                                }));
                                setNewDeliveryTermText('');
                              }}
                              className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-[#FAF8F4] border border-[#E5DED2] hover:bg-[#F3EFE8] cursor-pointer"
                            >
                              Add
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {draftQuote.exclusions && draftQuote.exclusions.length > 0 && (
                      <div className="text-[11px] text-[#6B655C]">
                        <strong className="text-[#22201D]">Not included:</strong>{' '}
                        {draftQuote.exclusions.join('; ')}
                      </div>
                    )}
                    {draftQuote.restrictions && draftQuote.restrictions.length > 0 && (
                      <div className="text-[11px] text-[#6B655C]">
                        <strong className="text-[#22201D]">Conditions:</strong>{' '}
                        {draftQuote.restrictions.join('; ')}
                      </div>
                    )}
                  </div>
                )}

                {/* 5. PAYMENT SCHEDULE */}
                <div className="rounded-2xl bg-white border border-[#E5DED2] p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-[#22201D]">
                      Payment schedule
                    </h4>
                    <span className="text-[11px] text-[#6B655C]">
                      Deposits default to unpaid until confirmed
                    </span>
                  </div>
                  {showLineItemEditor ? (
                    <textarea
                      rows={2}
                      value={draftQuote.paymentTermsSummary}
                      onChange={(e) =>
                        updateQuote((q) => ({
                          ...q,
                          paymentTermsSummary: e.target.value,
                        }))
                      }
                      className="w-full rounded-lg border border-[#E5DED2] bg-[#FAF8F4] px-2.5 py-1.5 text-xs text-[#22201D]"
                    />
                  ) : (
                    <p className="text-xs text-[#22201D]">
                      {draftQuote.paymentTermsSummary}
                    </p>
                  )}
                  {draftQuote.paymentMilestones &&
                    draftQuote.paymentMilestones.length > 0 && (
                      <div className="space-y-1 pt-1">
                        {draftQuote.paymentMilestones.map((m, idx) => {
                          const computedDate = resolveRelativeDeadlineDate(
                            primarySelectedEvent?.date,
                            m.relativeDaysBeforeEvent
                          );
                          return (
                            <div
                              key={idx}
                              className="flex items-center justify-between text-xs bg-[#FAF8F4] rounded-lg px-3 py-1.5"
                            >
                              <span className="font-medium text-[#22201D]">{m.label}</span>
                              <span className="text-[#6B655C]">
                                {m.amount
                                  ? formatShortCad(m.amount)
                                  : m.percent
                                    ? `${m.percent}%`
                                    : ''}
                                {computedDate
                                  ? ` · Due ${computedDate} (${m.relativeDeadlineText ?? `${m.relativeDaysBeforeEvent}d prior`})`
                                  : m.dueDate
                                    ? ` · Due ${m.dueDate}`
                                    : m.relativeDeadlineText
                                      ? ` · ${m.relativeDeadlineText}`
                                      : ''}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                </div>

                {/* 6. VENDOR DETAILS & EVENT ASSIGNMENT (Collapsible) */}
                <div className="rounded-2xl bg-white border border-[#E5DED2] p-4 space-y-3">
                  <button
                    type="button"
                    onClick={() => setShowVendorDetails((prev) => !prev)}
                    className="w-full flex items-center justify-between text-xs font-semibold text-[#22201D] cursor-pointer"
                  >
                    <span>Vendor details &amp; event assignment</span>
                    {showVendorDetails ? (
                      <ChevronDown className="w-4 h-4 text-[#6B655C]" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-[#6B655C]" />
                    )}
                  </button>

                  {showVendorDetails && (
                    <div className="pt-2 border-t border-[#F0EAE0] space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-medium text-[#6B655C] mb-1">
                            Vendor name
                          </label>
                          <input
                            type="text"
                            value={vendorName}
                            onChange={(e) => setVendorName(e.target.value)}
                            placeholder="Enter vendor name"
                            className="w-full rounded-lg border border-[#E5DED2] px-3 py-1.5 text-xs font-medium text-[#22201D]"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-[#6B655C] mb-1">
                            Category
                          </label>
                          <select
                            value={vendorCategory}
                            disabled={bookedRevision}
                            onChange={(e) =>
                              setVendorCategory(e.target.value as VendorCategory)
                            }
                            className="w-full rounded-lg border border-[#E5DED2] px-3 py-1.5 text-xs text-[#22201D]"
                          >
                            {(Object.keys(CATEGORY_META) as VendorCategory[]).map((cat) => (
                              <option key={cat} value={cat}>
                                {CATEGORY_META[cat].label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {!onCompleteForOnboarding && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] font-medium text-[#6B655C] mb-1">
                              Vendor location (leave blank if unstated)
                            </label>
                            <input
                              type="text"
                              value={vendorLocation}
                              onChange={(e) => setVendorLocation(e.target.value)}
                              placeholder="Not stated in quote"
                              className="w-full rounded-lg border border-[#E5DED2] px-3 py-1.5 text-xs text-[#22201D]"
                            />
                          </div>
                          <div>
                            <label htmlFor="quote-vendor-link" className="block text-[11px] font-medium text-[#6B655C] mb-1">
                              {revisionDraft?.mode === 'manual' ? 'Linked vendor' : 'Save as new or link to existing vendor'}
                            </label>
                            <select
                              id="quote-vendor-link"
                              value={linkedVendorId ?? ''}
                              disabled={revisionDraft?.mode === 'manual'}
                              onChange={(e) => handleVendorLinkChange(e.target.value || null)}
                              className="w-full rounded-lg border border-[#E5DED2] px-3 py-1.5 text-xs text-[#22201D]"
                            >
                              <option value="">Create as new vendor</option>
                              {activeWorkspace.vendors.map((v) => (
                                <option
                                  key={v.id}
                                  value={v.id}
                                  disabled={Boolean(draftQuote.manualEntry && v.draftQuote && v.draftQuote.id !== draftQuote.id)}
                                >
                                  Update {v.name} ({v.status})
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      )}

                      {activeWorkspace.events.length > 0 && !onCompleteForOnboarding && (
                        <div>
                          <div className="text-[11px] font-medium text-[#6B655C] mb-1.5">
                            Associated events
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {activeWorkspace.events.map((evt) => {
                              const checked = selectedEventIds.includes(evt.id);
                              return (
                                <button
                                  key={evt.id}
                                  type="button"
                                  disabled={bookedRevision}
                                  aria-pressed={checked}
                                  onClick={() =>
                                    setSelectedEventIds((prev) =>
                                      checked
                                        ? prev.filter((id) => id !== evt.id)
                                        : [...prev, evt.id]
                                    )
                                  }
                                  className={`px-2.5 py-1 text-xs rounded-lg border cursor-pointer ${
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
                  )}
                </div>
                </div>
              </div>
            </div>

            {/* Bottom Review Action Footer */}
            {saveError && (
              <p role="alert" className="px-5 py-2 text-xs text-[#991B1B] bg-[#FEE2E2]">
                Browser storage could not save this quote and its source. Keep this review open and try again after freeing up storage.
              </p>
            )}
            <div className="px-5 py-3.5 bg-white border-t border-[#E5DED2] flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
              <div className="text-xs text-[#6B655C]">
                {revisionDraft
                  ? canApproveWithVendor
                    ? 'Approving updates the active quote and preserves its revision history.'
                    : 'Resolve the revision for approval or save your review as a draft.'
                  : canApproveWithVendor
                    ? 'Approving adds this quote to your projected budget. Booking is confirmed separately.'
                    : 'Resolve the items under “Needs your attention” to approve, or save as a Draft.'}
              </div>
              <div className="flex items-center gap-2.5 justify-end shrink-0">
                <button
                  type="button"
                  onClick={() => handleSave(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl border border-[#D7CBEB] bg-[#EFEAF8] text-[#4C3B70] hover:bg-[#E5DCF4] whitespace-nowrap cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  {revisionDraft ? 'Save revision draft' : 'Save as Draft'}
                </button>
                <button
                  type="button"
                  disabled={!canApproveWithVendor}
                  onClick={() => handleSave(false)}
                  className={`inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold rounded-xl whitespace-nowrap ${
                    canApproveWithVendor
                      ? 'bg-[#486755] text-white hover:bg-[#395344] cursor-pointer'
                      : 'bg-[#E5DED2] text-[#9A9388] cursor-not-allowed'
                  }`}
                >
                  <Check className="w-3.5 h-3.5" />
                  {revisionDraft ? 'Approve revision' : 'Approve Quote'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {draftQuote?.attachmentPreview &&
        draftQuote.attachmentPreview.mimeType.startsWith('image/') && (
          <ImageLightboxModal
            isOpen={lightboxOpen}
            onClose={() => setLightboxOpen(false)}
            imageUrl={draftQuote.attachmentPreview.dataUrl}
            fileName={draftQuote.attachmentPreview.fileName}
          />
        )}
    </div>
  );
}
