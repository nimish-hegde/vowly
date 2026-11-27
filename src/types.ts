export type VendorCategory =
  | 'venue'
  | 'photographer'
  | 'dj'
  | 'decor'
  | 'catering'
  | 'entertainment'
  | 'other'
  | 'unknown';

export type QuoteKind = 'initial' | 'revision';

export type CurrencyCode = 'CAD' | 'USD' | 'UNKNOWN';

export type PricingType =
  | 'flat'
  | 'per_person'
  | 'per_extra_guest'
  | 'per_hour'
  | 'per_guest_ratio'
  | 'percentage'
  | 'included'
  | 'unknown';

export type PercentageBasis =
  | 'specific_line_items'
  | 'food_subtotal'
  | 'entire_subtotal'
  | 'custom_amount'
  | 'unknown';

export type ChargeRequirement = 'mandatory' | 'conditional' | 'optional';

export type TaxOrGratuityStatus = 'included' | 'excluded' | 'unknown';

export type PaymentMethodRule = 'cash_only' | 'etransfer' | 'card' | 'any' | 'unknown';

export type OpenQuestionReason =
  | 'missing_price'
  | 'conflict'
  | 'ambiguous_rule'
  | 'missing_date';

export type EvalSplit = 'dev' | 'regression' | 'held-out' | 'held-out-v2';

export interface PriceOption {
  /** Short label distinguishing this price source (e.g., "Instagram DM", "PDF contract"). */
  sourceLabel: string;
  pricingType: PricingType;
  amount: number;
  /** Exact substring from the raw vendor message supporting this candidate price. */
  sourceExcerpt: string;
}

export interface LineItem {
  label: string;
  pricingType: PricingType;
  /** Numeric price in the quote's currency, percentage value for 'percentage', or null when included or unknown/TBD. */
  amount: number | null;
  /** Minimum guest count that applies to this item (e.g., 150-person minimum). */
  minGuests?: number;
  /** Guest threshold above which per_extra_guest pricing applies (e.g., 150 for "$55/extra guest above 150"). */
  guestThreshold?: number;
  /** Optional package ID if this line item applies only when a specific package option is selected. */
  packageId?: string;
  /** Ratio denominator for per_guest_ratio items (e.g., 75 for "1 bartender per 75 guests"). */
  ratioGuests?: number;
  /** Plain-language unit label for ratio items (e.g., "bartender", "server", "table"). */
  unitLabel?: string;
  /** Default hours included if this is a per_hour item or duration-bound package. */
  hours?: number;
  /** Percentage rate (e.g., 10 for 10%) when pricingType is "percentage". */
  percentageRate?: number;
  /** Structured basis for percentage-based charges. */
  percentageBasis?: PercentageBasis;
  /** Target line item labels when percentageBasis is "specific_line_items". */
  percentageTargetLabels?: string[];
  /** User-confirmed custom taxable/applicable amount when percentageBasis is "custom_amount". */
  customBasisAmount?: number;
  /** Original/standard price when the vendor explicitly offered a negotiated discount (not a conflict). */
  originalAmount?: number;
  /** True when the charge is billed by or routed through a third-party supplier (e.g., preferred AV). */
  isThirdParty?: boolean;
  /** Optional third-party provider name or description. */
  thirdPartyProvider?: string;
  /** True when this line item is part of the food/catering subtotal for food-only gratuity bases. */
  isFoodItem?: boolean;
  /** Distinguishes mandatory, conditional, and explicitly optional charges. */
  chargeType?: ChargeRequirement;
  /** True only when the message explicitly says the item is an optional upgrade or add-on. */
  optionalAddon?: boolean;
  /**
   * Present when two or more conflicting prices refer to the same service.
   * Preserves every candidate price and its verbatim source without double-counting.
   */
  conflictingOptions?: PriceOption[];
  /** Exact substring or visible document snippet supporting this item. */
  sourceExcerpt: string;
  /** Optional document page or visual section reference for PDF/image extractions. */
  pageReference?: string;
}

export interface PackageInclusion {
  category?: string;
  name: string;
  quantity?: number;
  unit?: string;
  /** Separate coverage/service duration in hours when distinct from quantity (e.g., 1 second photographer for 5 hours). */
  durationHours?: number;
  /** Optional package ID when this inclusion belongs to a specific package tier. */
  packageId?: string;
  sourceExcerpt?: string;
}

export interface PackageOption {
  /** Stable slug identifier (e.g., "royal-package", "imperial-package"). */
  id: string;
  /** Display name of the mutually exclusive package tier. */
  name: string;
  pricingType: 'flat' | 'per_person' | 'unknown';
  amount: number | null;
  /** Minimum guest guarantee for this specific package (e.g., 150 for Royal, 100 for Imperial). */
  minGuests?: number;
  /** Included guest count covered by a flat package before extraGuestRate applies. */
  includedGuests?: number;
  /** Genuine incremental per-guest rate ONLY for guests above includedGuests / minGuests. */
  extraGuestRate?: number;
  maxCapacity?: number;
  /** Service hours included in this package option. */
  hours?: number;
  isFoodItem?: boolean;
  /** Package-specific mandatory or conditional fees when supported by the source. */
  fees?: LineItem[];
  /** Package-specific tax override when different from quote-level tax. */
  taxStatus?: TaxOrGratuityStatus;
  taxPercent?: number | null;
  /** Package-specific gratuity override when different from quote-level gratuity. */
  gratuityStatus?: TaxOrGratuityStatus;
  gratuityPercent?: number | null;
  gratuityBasis?: PercentageBasis;
  inclusions?: PackageInclusion[];
  deliveryTerms?: string[];
  paymentTerms?: PaymentTerms;
  sourceExcerpt: string;
  pageReference?: string;
}

export interface VendorContact {
  name?: string;
  email?: string;
  phone?: string;
}

export interface PaymentMilestoneRule {
  label: string;
  amount?: number;
  percent?: number;
  dueDate?: string;
  relativeDaysBeforeEvent?: number;
  relativeDeadlineText?: string;
  sourceExcerpt?: string;
}

export interface VenueDetails {
  roomName?: string;
  maxCapacity?: number;
  minGuests?: number;
  packageName?: string;
  dayOfWeek?: string;
}

export interface PhotographerDetails {
  hoursIncluded?: number;
  extraHourRate?: number;
  teamSize?: number;
  includesMiniShoot?: boolean | 'unknown';
}

export interface PaymentTerms {
  depositAmount?: number;
  depositPercent?: number;
  methodRule: PaymentMethodRule;
  scheduleNotes?: string;
  milestones?: PaymentMilestoneRule[];
}

export interface OpenQuestion {
  question: string;
  reason: OpenQuestionReason;
  sourceExcerpt: string;
  pageReference?: string;
}

export interface ExtractionAttachment {
  mimeType: string;
  base64Data: string;
  fileName?: string;
}

export interface ExtractedQuote {
  vendorName: string | null;
  vendorLocation?: string | null;
  vendorContact?: VendorContact;
  category: VendorCategory;
  events: string[];
  quotedDate?: string;
  quoteKind: QuoteKind;
  currency: CurrencyCode;
  taxStatus: TaxOrGratuityStatus;
  taxPercent?: number | null;
  gratuityStatus: TaxOrGratuityStatus;
  gratuityPercent?: number | null;
  gratuityBasis?: PercentageBasis;
  serviceDurationHours?: number;
  /** Mutually exclusive package/tier options (e.g., Royal vs. Imperial). Never summed together. */
  packages?: PackageOption[];
  /** Selected package option ID (null/omitted until the user explicitly chooses one). */
  selectedPackageId?: string | null;
  lineItems: LineItem[];
  inclusions?: PackageInclusion[];
  /** Delivery turnaround times, sneak peeks, gallery/USB format, and RAW file terms. */
  deliveryTerms?: string[];
  exclusions?: string[];
  restrictions?: string[];
  venueDetails?: VenueDetails;
  photographerDetails?: PhotographerDetails;
  paymentTerms?: PaymentTerms;
  openQuestions: OpenQuestion[];
}

export interface TokenUsage {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface EvalCase {
  id: string;
  split: EvalSplit;
  description: string;
  rawMessage: string;
  /** Optional context for deterministic total calculation in the grading script. */
  calcContext?: {
    guestCount?: number;
    hours?: number;
    selectedPackageId?: string;
  };
  expected: {
    category: VendorCategory;
    currency: CurrencyCode;
    quoteKind: QuoteKind;
    knownSubtotal: number;
    unknownItemLabels: string[];
    minOpenQuestions?: number;
    taxStatus?: TaxOrGratuityStatus;
    taxPercent?: number | null;
    gratuityStatus?: TaxOrGratuityStatus;
    gratuityPercent?: number | null;
    gratuityBasis?: PercentageBasis;
    paymentMethodRule?: PaymentMethodRule;
    /** Expected numeric discrepancy when the case contains conflicting prices for one service. */
    expectedPriceConflictDiscrepancy?: number;
    /** Expected count of mutually exclusive package options when the quote offers multiple tiers. */
    expectedPackageCount?: number;
    /** True when the quote must block approval until one package option is selected. */
    expectUnresolvedPackageSelection?: boolean;
  };
}
