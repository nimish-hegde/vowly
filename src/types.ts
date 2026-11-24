export type VendorCategory = 'venue' | 'photographer' | 'dj' | 'decor' | 'other';

export type QuoteKind = 'initial' | 'revision';

export type CurrencyCode = 'CAD' | 'USD' | 'UNKNOWN';

export type PricingType =
  | 'flat'
  | 'per_person'
  | 'per_hour'
  | 'per_guest_ratio'
  | 'included'
  | 'unknown';

export type TaxOrGratuityStatus = 'included' | 'excluded' | 'unknown';

export type PaymentMethodRule = 'cash_only' | 'etransfer' | 'card' | 'any' | 'unknown';

export type OpenQuestionReason =
  | 'missing_price'
  | 'conflict'
  | 'ambiguous_rule'
  | 'missing_date';

export type EvalSplit = 'dev' | 'regression' | 'held-out';

export interface LineItem {
  label: string;
  pricingType: PricingType;
  /** Numeric price in the quote's currency, or null when included or unknown/TBD. */
  amount: number | null;
  /** Minimum guest count that applies to this item (e.g., 150-person minimum). */
  minGuests?: number;
  /** Ratio denominator for per_guest_ratio items (e.g., 150 for "1 bartender per 150 guests"). */
  ratioGuests?: number;
  /** Default hours included if this is a per_hour item. */
  hours?: number;
  /** True only when the message explicitly says the item is an optional upgrade or add-on. */
  optionalAddon?: boolean;
  /** Exact substring from the raw vendor message supporting this item. */
  sourceExcerpt: string;
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
}

export interface OpenQuestion {
  question: string;
  reason: OpenQuestionReason;
  sourceExcerpt: string;
}

export interface ExtractedQuote {
  vendorName: string;
  category: VendorCategory;
  events: string[];
  quotedDate?: string;
  quoteKind: QuoteKind;
  currency: CurrencyCode;
  taxStatus: TaxOrGratuityStatus;
  gratuityStatus: TaxOrGratuityStatus;
  lineItems: LineItem[];
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
  };
  expected: {
    category: VendorCategory;
    currency: CurrencyCode;
    quoteKind: QuoteKind;
    knownSubtotal: number;
    unknownItemLabels: string[];
    minOpenQuestions?: number;
    taxStatus?: TaxOrGratuityStatus;
    paymentMethodRule?: PaymentMethodRule;
  };
}
