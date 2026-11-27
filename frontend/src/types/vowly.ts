export type NavSection = 'overview' | 'events' | 'budget' | 'vendors' | 'payments';

export type PastelTone = 'sage' | 'lavender' | 'blush' | 'peach' | 'blue';

export type CurrencyCode = 'CAD' | 'USD' | 'UNKNOWN';
export type CurrencySource =
  | 'explicit_quote'
  | 'inferred_canada'
  | 'user_confirmed'
  | 'unknown';

export type TaxHandling =
  | 'included'
  | 'excluded_plus_hst'
  | 'unspecified_ontario_assumed'
  | 'unspecified'
  | 'tax_exempt';

export type VendorCategory =
  | 'venue'
  | 'catering'
  | 'photography'
  | 'videography'
  | 'decor'
  | 'dj'
  | 'entertainment'
  | 'beauty'
  | 'transportation'
  | 'other';

export type VendorStatus =
  | 'Researching'
  | 'Shortlisted'
  | 'Quoted'
  | 'Revision pending'
  | 'Booked'
  | 'Declined';

export type EventPlanningStatus = 'Confirmed' | 'In progress' | 'Shortlisting' | 'Early planning';

export type PriceSource =
  | 'User-entered allowance'
  | 'Vendor quote'
  | 'Confirmed booking'
  | 'Unpriced / TBD';

export interface Partner {
  id: string;
  name: string;
  email: string;
  initials: string;
  roleLabel: 'Partner';
  status: 'Active' | 'Invited';
  tone: PastelTone;
}

export interface WeddingEvent {
  id: string;
  name: string;
  date: string; // ISO date string or empty if TBD
  dateDisplay: string; // e.g. "Fri, Aug 13, 2027" or "Date TBD"
  time: string;
  location: string;
  guestCount: number | null; // null = unknown / skipped
  status: EventPlanningStatus;
  budgetAllowance: number | null; // null = unallocated
  tone: PastelTone;
  notes?: string;
}

export type LineItemPricingModel =
  | 'flat'
  | 'per_person'
  | 'per_extra_guest'
  | 'hourly'
  | 'guest_ratio'
  | 'percentage';

export type PercentageBasis =
  | 'specific_line_items'
  | 'food_subtotal'
  | 'entire_subtotal'
  | 'custom_amount'
  | 'unknown';

export interface StructuredInclusion {
  category?: string;
  name: string;
  quantity?: number;
  unit?: string;
  durationHours?: number;
  packageId?: string;
  sourceExcerpt?: string;
}

export interface IncludedPricingItem {
  label: string;
  extractedHours?: number;
  sourceExcerpt: string;
  packageId?: string;
}

export interface QuotePackageOption {
  id: string;
  name: string;
  pricingModel: 'flat' | 'per_person' | 'unknown';
  unitPrice: number | null;
  minGuests?: number;
  includedGuests?: number;
  extraGuestRate?: number;
  maxCapacity?: number;
  hours?: number;
  isFoodItem?: boolean;
  fees?: QuoteLineItem[];
  includedPricingItems?: IncludedPricingItem[];
  taxHandling?: TaxHandling;
  taxPercent?: number | null;
  gratuityStatus?: 'included' | 'excluded' | 'unknown';
  gratuityPercent?: number | null;
  gratuityBasis?: PercentageBasis;
  inclusions: string[];
  structuredInclusions?: StructuredInclusion[];
  deliveryTerms?: string[];
  paymentTermsSummary?: string;
  paymentMilestones?: QuotePaymentMilestone[];
  depositAmount?: number;
  depositPercent?: number;
  evidenceId?: string;
  pageReference?: string;
}

export interface QuotePaymentMilestone {
  label: string;
  amount?: number;
  percent?: number;
  dueDate?: string;
  relativeDaysBeforeEvent?: number;
  relativeDeadlineText?: string;
  sourceExcerpt?: string;
}

export interface QuoteAttachmentPreview {
  fileName: string;
  mimeType: string;
  dataUrl: string;
  sizeBytes: number;
}

export interface QuoteLineItem {
  id: string;
  label: string;
  pricingModel: LineItemPricingModel;
  unitPrice: number;
  quantity?: number; // confirmed quantity; extra hours on a conditional rate
  extractedHours?: number;
  chargeType?: 'mandatory' | 'conditional' | 'optional';
  sourceExcerpt?: string;
  isConditionalOvertime?: boolean; // explicit review override; undefined lets imported facts decide
  includedPackageHours?: number; // included base package hours before overtime applies
  ratioDivisor?: number; // e.g., 75 guests per bartender for guest_ratio
  unitLabel?: string; // e.g., "bartender", "table"
  percentageBasis?: PercentageBasis;
  percentageTargetLabels?: string[];
  customBasisAmount?: number;
  originalUnitPrice?: number; // explicit negotiated standard price (not a conflict)
  isThirdParty?: boolean;
  thirdPartyProvider?: string;
  isFoodItem?: boolean;
  eventId?: string; // binds per_person or guest_ratio to a specific event
  minGuests?: number; // minimum guest floor if per_person
  guestThreshold?: number; // included guest threshold for per_extra_guest
  packageId?: string; // optional package option scope
  evidenceId?: string;
  pageReference?: string;
  note?: string;
}

export interface QuoteAddOn {
  id: string;
  label: string;
  description: string;
  pricePreTax: number;
  pricingModel?: LineItemPricingModel;
  quantity?: number;
  ratioDivisor?: number;
  unitLabel?: string;
  minGuests?: number;
  eventId?: string;
  packageId?: string;
  percentageBasis?: PercentageBasis;
  percentageTargetLabels?: string[];
  customBasisAmount?: number;
  selected: boolean;
  evidenceId?: string;
}

export interface QuoteUnconfirmedFee {
  id: string;
  label: string;
  description: string;
  mandatory: boolean;
  status: 'unconfirmed' | 'confirmed_amount' | 'waived_or_included';
  confirmedAmount?: number;
  packageId?: string;
  evidenceId?: string;
}

export interface QuoteConflictOption {
  id: string;
  label: string;
  sourceLabel: string;
  amount: number;
  pricingModel?: LineItemPricingModel;
  evidenceId?: string;
}

export interface QuoteConflict {
  id: string;
  fieldLabel: string;
  description: string;
  targetLineItemId?: string;
  options: QuoteConflictOption[];
  resolvedOptionId?: string;
}

export interface QuotePaymentOption {
  id: string;
  label: string;
  method: 'regular' | 'cash';
  adjustmentDelta: number; // e.g. -200 for cash discount vs regular
  taxHandling: TaxHandling; // never assumes cash is tax-free automatically
  note: string;
  evidenceId?: string;
}

export interface BrochureReference {
  packageName: string;
  publishedPricePreTax: number;
  isComparable: boolean;
  comparabilityNote: string;
  inclusionsSummary: string;
}

export interface QuoteEvidenceSpan {
  id: string;
  excerpt: string;
  sourceLabel: string;
}

export interface QuoteRevisionRecord {
  id: string;
  date: string;
  summary: string;
  previousPreTaxTotal: number;
  newPreTaxTotal: number;
  previousPerPerson?: number;
  newPerPerson?: number;
  note: string;
}

export interface Quote {
  id: string;
  title: string;
  approvalState: 'draft' | 'approved';
  quoteKind: 'personalized' | 'published_brochure';
  receivedDate: string;
  sourceType: 'pasted_message' | 'pdf' | 'screenshot';
  sourceChannel: string; // e.g., "WhatsApp message", "Email PDF", "Instagram DM"
  sourceText: string;
  currency: CurrencyCode;
  currencySource: CurrencySource;
  locationContext?: string; // e.g., "Mississauga, ON, Canada"
  taxHandling: TaxHandling;
  taxPercent?: number | null;
  gratuityStatus?: 'included' | 'excluded' | 'unknown';
  gratuityPercent?: number | null;
  gratuityBasis?: PercentageBasis;
  serviceDurationHours?: number;
  extraHourRate?: number;
  includedPricingItems?: IncludedPricingItem[];
  minGuests?: number;
  maxCapacity?: number;
  packages?: QuotePackageOption[];
  selectedPackageId?: string | null;
  lineItems: QuoteLineItem[];
  addOns: QuoteAddOn[];
  unconfirmedFees: QuoteUnconfirmedFee[];
  conflicts: QuoteConflict[];
  paymentOptions?: QuotePaymentOption[];
  selectedPaymentOptionId?: string;
  inclusions: string[];
  structuredInclusions?: StructuredInclusion[];
  deliveryTerms?: string[];
  exclusions?: string[];
  restrictions?: string[];
  legacyReviewAcknowledged?: boolean;
  cateringAndBarSummary?: string;
  avAndStaffingSummary?: string;
  paymentTermsSummary: string;
  paymentMilestones?: QuotePaymentMilestone[];
  depositAmount?: number;
  depositPercent?: number;
  clarificationQuestions: string[];
  evidenceSpans: QuoteEvidenceSpan[];
  sourceWarnings?: string[];
  sourceWarningsAcknowledged?: boolean;
  attachmentPreview?: QuoteAttachmentPreview;
  vendorContact?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  brochureReference?: BrochureReference;
  revisions?: QuoteRevisionRecord[];
}

export interface DraftVendorMetadata {
  name: string;
  category: VendorCategory;
  eventIds: string[];
  location: string;
  isDemoVenue?: boolean;
}

export interface Vendor {
  id: string;
  name: string;
  category: VendorCategory;
  eventIds: string[]; // multiple events => shared multi-event contract
  location: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  status: VendorStatus;
  isPreferred: boolean; // counts toward projected spend if not booked
  isDemoVenue?: boolean; // true for real GTA venues with fictional pricing
  notes: string;
  quotes: Quote[];
  activeQuoteId?: string;
  draftQuote?: Quote; // saved draft with unresolved ambiguities
  draftVendorMetadata?: DraftVendorMetadata; // staged metadata edits held until draft approval
  bookedContractTotal?: number; // locked agreed total on explicit booking confirmation
  bookedDate?: string;
}

export interface ManualExpense {
  id: string;
  name: string;
  eventIds: string[];
  category: VendorCategory;
  budgetAllowance: number | null;
  estimatedAmount: number | null; // null => Unpriced / TBD
  committedAmount: number;
  paidAmount: number;
  priceSource: PriceSource;
  status: 'Planned' | 'Estimated' | 'Booked' | 'Unpriced';
  notes?: string;
}

export interface PaymentMilestone {
  id: string;
  vendorId: string;
  vendorName: string;
  isDemoVenue?: boolean;
  eventId?: string; // optional single-event link
  eventLabel?: string; // e.g., "Sangeet / Jaggo" or "Shared (4 events)"
  label: string; // e.g., "Booking Deposit", "Second Installment"
  amount: number;
  dueDate: string | null; // null when relative to unknown date
  relativeDueLabel?: string; // e.g., "30 days before Reception (date TBD)"
  status: 'Paid' | 'Upcoming' | 'Due soon' | 'Date TBD';
  paidDate?: string;
  payer?: string; // e.g., "Unassigned", "Meera & Kabir", "Gill Family", "Sharma Family"
  paidBy?: string; // who actually paid when marked paid
  reminderEnabled: boolean; // only active after confirmed booking & known date
}

export interface FollowUpTask {
  id: string;
  title: string;
  description: string;
  vendorId?: string;
  eventId?: string;
  assigneePartnerId: string;
  priority: 'high' | 'medium';
  kind: 'unresolved_fee' | 'draft_quote' | 'missing_quote' | 'payment' | 'decision';
  status: 'Open' | 'Done';
  dueLabel?: string;
}

export interface ActivityItem {
  id: string;
  timestampLabel: string;
  actorName: string;
  summary: string;
  category: 'quote' | 'booking' | 'payment' | 'revision' | 'event' | 'partner';
}

export interface WeddingWorkspace {
  id: string;
  name: string;
  coupleNames: string;
  location: string;
  dateRangeLabel: string;
  weddingStyle: string;
  currency: 'CAD' | 'USD';
  budgetTarget: number | null;
  isDemoWorkspace: boolean;
  partners: Partner[];
  events: WeddingEvent[];
  vendors: Vendor[];
  manualExpenses: ManualExpense[];
  payments: PaymentMilestone[];
  tasks: FollowUpTask[];
  activities: ActivityItem[];
}

export interface BudgetRow {
  id: string;
  sourceType: 'vendor' | 'manual';
  vendorId?: string;
  manualExpenseId?: string;
  name: string;
  subtitle?: string;
  isDemoVenue?: boolean;
  eventIds: string[];
  isSharedMultiEvent: boolean;
  category: VendorCategory;
  budgetAllowance: number | null;
  projectedCost: number | null; // null => Unpriced / TBD
  committedAmount: number;
  paidAmount: number;
  remainingBalance: number | null;
  statusLabel: string;
  priceSource: PriceSource;
  hasUnconfirmedFees: boolean;
  hasDraftQuote: boolean;
  hstAssumed: boolean;
  addOns?: Array<{
    id: string;
    label: string;
    selected: boolean;
    impactWithTax: number;
  }>;
}
