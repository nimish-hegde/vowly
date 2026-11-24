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

export type LineItemPricingModel = 'flat' | 'per_person' | 'hourly' | 'guest_ratio';

export interface QuoteLineItem {
  id: string;
  label: string;
  pricingModel: LineItemPricingModel;
  unitPrice: number;
  quantity?: number; // hours for hourly, or fixed count
  ratioDivisor?: number; // e.g., 10 guests per table for guest_ratio
  eventId?: string; // binds per_person or guest_ratio to a specific event
  minGuests?: number; // minimum guest floor if per_person
  evidenceId?: string;
  note?: string;
}

export interface QuoteAddOn {
  id: string;
  label: string;
  description: string;
  pricePreTax: number;
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
  evidenceId?: string;
}

export interface QuoteConflictOption {
  id: string;
  label: string;
  sourceLabel: string;
  amount: number;
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
  gratuityPercent?: number;
  minGuests?: number;
  maxCapacity?: number;
  lineItems: QuoteLineItem[];
  addOns: QuoteAddOn[];
  unconfirmedFees: QuoteUnconfirmedFee[];
  conflicts: QuoteConflict[];
  paymentOptions?: QuotePaymentOption[];
  selectedPaymentOptionId?: string;
  inclusions: string[];
  cateringAndBarSummary?: string;
  avAndStaffingSummary?: string;
  paymentTermsSummary: string;
  depositAmount?: number;
  depositPercent?: number;
  clarificationQuestions: string[];
  evidenceSpans: QuoteEvidenceSpan[];
  brochureReference?: BrochureReference;
  revisions?: QuoteRevisionRecord[];
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
