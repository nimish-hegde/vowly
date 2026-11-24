import type {
  CurrencyCode,
  ExtractedQuote,
  LineItem,
  OpenQuestion,
  OpenQuestionReason,
  PaymentMethodRule,
  PricingType,
  QuoteKind,
  TaxOrGratuityStatus,
  VendorCategory,
} from './types.ts';

const VALID_CATEGORIES = new Set<VendorCategory>(['venue', 'photographer', 'dj', 'decor', 'other']);
const VALID_QUOTE_KINDS = new Set<QuoteKind>(['initial', 'revision']);
const VALID_CURRENCIES = new Set<CurrencyCode>(['CAD', 'USD', 'UNKNOWN']);
const VALID_TAX_STATUS = new Set<TaxOrGratuityStatus>(['included', 'excluded', 'unknown']);
const VALID_PRICING_TYPES = new Set<PricingType>([
  'flat',
  'per_person',
  'per_hour',
  'per_guest_ratio',
  'included',
  'unknown',
]);
const VALID_PAYMENT_RULES = new Set<PaymentMethodRule>([
  'cash_only',
  'etransfer',
  'card',
  'any',
  'unknown',
]);
const VALID_QUESTION_REASONS = new Set<OpenQuestionReason>([
  'missing_price',
  'conflict',
  'ambiguous_rule',
  'missing_date',
]);

export interface ValidationResult {
  valid: boolean;
  schemaErrors: string[];
  sourceErrors: string[];
  quote?: ExtractedQuote;
}

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function checkOptionalNumber(
  obj: Record<string, unknown>,
  field: string,
  path: string,
  errors: string[],
) {
  if (obj[field] !== undefined && obj[field] !== null && !isFiniteNumber(obj[field])) {
    errors.push(`${path}.${field} must be a finite number`);
  }
}

export function validateExtractedQuote(raw: unknown, rawMessage?: string): ValidationResult {
  const schemaErrors: string[] = [];
  const sourceErrors: string[] = [];

  if (!isObject(raw)) {
    return { valid: false, schemaErrors: ['Response must be a JSON object'], sourceErrors: [] };
  }

  if (typeof raw.vendorName !== 'string' || raw.vendorName.trim() === '') {
    schemaErrors.push('vendorName must be a non-empty string');
  }
  if (!VALID_CATEGORIES.has(raw.category as VendorCategory)) {
    schemaErrors.push(`category must be one of venue|photographer|dj|decor|other (got ${String(raw.category)})`);
  }
  if (!Array.isArray(raw.events) || !raw.events.every((e) => typeof e === 'string')) {
    schemaErrors.push('events must be an array of strings');
  }
  if (!VALID_QUOTE_KINDS.has(raw.quoteKind as QuoteKind)) {
    schemaErrors.push(`quoteKind must be initial|revision (got ${String(raw.quoteKind)})`);
  }
  if (!VALID_CURRENCIES.has(raw.currency as CurrencyCode)) {
    schemaErrors.push(`currency must be CAD|USD|UNKNOWN (got ${String(raw.currency)})`);
  }
  if (!VALID_TAX_STATUS.has(raw.taxStatus as TaxOrGratuityStatus)) {
    schemaErrors.push(`taxStatus must be included|excluded|unknown (got ${String(raw.taxStatus)})`);
  }
  if (!VALID_TAX_STATUS.has(raw.gratuityStatus as TaxOrGratuityStatus)) {
    schemaErrors.push(
      `gratuityStatus must be included|excluded|unknown (got ${String(raw.gratuityStatus)})`,
    );
  }

  const rawNorm = rawMessage ? normalizeText(rawMessage) : undefined;

  // Validate lineItems
  if (!Array.isArray(raw.lineItems)) {
    schemaErrors.push('lineItems must be an array');
  } else {
    raw.lineItems.forEach((entry, idx) => {
      const path = `lineItems[${idx}]`;
      if (!isObject(entry)) {
        schemaErrors.push(`${path} must be an object`);
        return;
      }
      if (typeof entry.label !== 'string' || entry.label.trim() === '') {
        schemaErrors.push(`${path}.label must be a non-empty string`);
      }
      if (!VALID_PRICING_TYPES.has(entry.pricingType as PricingType)) {
        schemaErrors.push(`${path}.pricingType is invalid (got ${String(entry.pricingType)})`);
      }
      if (entry.amount !== null && !isFiniteNumber(entry.amount)) {
        schemaErrors.push(`${path}.amount must be a number or null`);
      }
      if (entry.pricingType === 'unknown' && entry.amount !== null) {
        schemaErrors.push(`${path}.amount must be null when pricingType is "unknown"`);
      }
      if (entry.pricingType === 'per_guest_ratio') {
        if (!isFiniteNumber(entry.ratioGuests) || entry.ratioGuests <= 0) {
          schemaErrors.push(`${path}.ratioGuests must be a positive number for per_guest_ratio items`);
        }
      }
      checkOptionalNumber(entry, 'minGuests', path, schemaErrors);
      checkOptionalNumber(entry, 'ratioGuests', path, schemaErrors);
      checkOptionalNumber(entry, 'hours', path, schemaErrors);
      if (entry.optionalAddon !== undefined && typeof entry.optionalAddon !== 'boolean') {
        schemaErrors.push(`${path}.optionalAddon must be a boolean`);
      }
      if (typeof entry.sourceExcerpt !== 'string' || entry.sourceExcerpt.trim() === '') {
        schemaErrors.push(`${path}.sourceExcerpt must be a non-empty string`);
      } else if (rawNorm && !rawNorm.includes(normalizeText(entry.sourceExcerpt))) {
        sourceErrors.push(
          `Unsupported line item "${String(entry.label)}" — sourceExcerpt not found verbatim in raw message`,
        );
      }
    });
  }

  // Validate openQuestions (required array, even when empty)
  if (!Array.isArray(raw.openQuestions)) {
    schemaErrors.push('openQuestions must be an array (use [] when there are no open questions)');
  } else {
    raw.openQuestions.forEach((entry, idx) => {
      const path = `openQuestions[${idx}]`;
      if (!isObject(entry)) {
        schemaErrors.push(`${path} must be an object`);
        return;
      }
      if (typeof entry.question !== 'string' || entry.question.trim() === '') {
        schemaErrors.push(`${path}.question must be a non-empty string`);
      }
      if (!VALID_QUESTION_REASONS.has(entry.reason as OpenQuestionReason)) {
        schemaErrors.push(`${path}.reason is invalid (got ${String(entry.reason)})`);
      }
      if (typeof entry.sourceExcerpt !== 'string' || entry.sourceExcerpt.trim() === '') {
        schemaErrors.push(`${path}.sourceExcerpt must be a non-empty string`);
      } else if (rawNorm && !rawNorm.includes(normalizeText(entry.sourceExcerpt))) {
        sourceErrors.push(
          `Unsupported open question "${String(entry.question)}" — sourceExcerpt not found verbatim in raw message`,
        );
      }
    });
  }

  // Validate optional paymentTerms
  if (raw.paymentTerms !== undefined && raw.paymentTerms !== null) {
    if (!isObject(raw.paymentTerms)) {
      schemaErrors.push('paymentTerms must be an object when present');
    } else {
      if (!VALID_PAYMENT_RULES.has(raw.paymentTerms.methodRule as PaymentMethodRule)) {
        schemaErrors.push(
          `paymentTerms.methodRule is invalid (got ${String(raw.paymentTerms.methodRule)})`,
        );
      }
      checkOptionalNumber(raw.paymentTerms, 'depositAmount', 'paymentTerms', schemaErrors);
      checkOptionalNumber(raw.paymentTerms, 'depositPercent', 'paymentTerms', schemaErrors);
    }
  }

  // Validate optional venueDetails
  if (raw.venueDetails !== undefined && raw.venueDetails !== null) {
    if (!isObject(raw.venueDetails)) {
      schemaErrors.push('venueDetails must be an object when present');
    } else {
      checkOptionalNumber(raw.venueDetails, 'maxCapacity', 'venueDetails', schemaErrors);
      checkOptionalNumber(raw.venueDetails, 'minGuests', 'venueDetails', schemaErrors);
    }
  }

  // Validate optional photographerDetails
  if (raw.photographerDetails !== undefined && raw.photographerDetails !== null) {
    if (!isObject(raw.photographerDetails)) {
      schemaErrors.push('photographerDetails must be an object when present');
    } else {
      checkOptionalNumber(raw.photographerDetails, 'hoursIncluded', 'photographerDetails', schemaErrors);
      checkOptionalNumber(raw.photographerDetails, 'extraHourRate', 'photographerDetails', schemaErrors);
      checkOptionalNumber(raw.photographerDetails, 'teamSize', 'photographerDetails', schemaErrors);
    }
  }

  const valid = schemaErrors.length === 0 && sourceErrors.length === 0;
  return {
    valid,
    schemaErrors,
    sourceErrors,
    quote: schemaErrors.length === 0 ? (raw as unknown as ExtractedQuote) : undefined,
  };
}

export function normalizeLineItemLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/audio[\s-]*visuals?/g, 'av')
    .replace(/bar\s*staff(ing)?/g, 'bartender')
    .replace(/bartender\s*staff(ing)?/g, 'bartender')
    .replace(/security\s*\/\s*venue\s*fee/g, 'venue fee')
    .replace(/\s+/g, ' ')
    .trim();
}
