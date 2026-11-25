import type {
  ChargeRequirement,
  CurrencyCode,
  ExtractedQuote,
  LineItem,
  OpenQuestion,
  OpenQuestionReason,
  PaymentMethodRule,
  PercentageBasis,
  PricingType,
  QuoteKind,
  TaxOrGratuityStatus,
  VendorCategory,
} from './types.ts';

const VALID_CATEGORIES = new Set<VendorCategory>([
  'venue',
  'photographer',
  'dj',
  'decor',
  'catering',
  'entertainment',
  'other',
  'unknown',
]);
const VALID_CHARGE_TYPES = new Set<ChargeRequirement>(['mandatory', 'conditional', 'optional']);
const VALID_QUOTE_KINDS = new Set<QuoteKind>(['initial', 'revision']);
const VALID_CURRENCIES = new Set<CurrencyCode>(['CAD', 'USD', 'UNKNOWN']);
const VALID_TAX_STATUS = new Set<TaxOrGratuityStatus>(['included', 'excluded', 'unknown']);
const VALID_PRICING_TYPES = new Set<PricingType>([
  'flat',
  'per_person',
  'per_hour',
  'per_guest_ratio',
  'percentage',
  'included',
  'unknown',
]);
const VALID_PERCENTAGE_BASES = new Set<PercentageBasis>([
  'specific_line_items',
  'food_subtotal',
  'entire_subtotal',
  'custom_amount',
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

export function validateExtractedQuote(
  raw: unknown,
  rawMessage?: string,
  options?: { hasAttachments?: boolean },
): ValidationResult {
  const schemaErrors: string[] = [];
  const sourceErrors: string[] = [];

  if (!isObject(raw)) {
    return { valid: false, schemaErrors: ['Response must be a JSON object'], sourceErrors: [] };
  }

  if (raw.vendorName !== null && typeof raw.vendorName !== 'string') {
    schemaErrors.push('vendorName must be a string or null');
  }
  if (!VALID_CATEGORIES.has(raw.category as VendorCategory)) {
    schemaErrors.push(
      `category must be one of venue|photographer|dj|decor|catering|entertainment|other|unknown (got ${String(raw.category)})`,
    );
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
  checkOptionalNumber(raw, 'taxPercent', 'quote', schemaErrors);
  checkOptionalNumber(raw, 'gratuityPercent', 'quote', schemaErrors);
  checkOptionalNumber(raw, 'serviceDurationHours', 'quote', schemaErrors);
  if (
    raw.gratuityBasis !== undefined &&
    raw.gratuityBasis !== null &&
    !VALID_PERCENTAGE_BASES.has(raw.gratuityBasis as PercentageBasis)
  ) {
    schemaErrors.push(`gratuityBasis is invalid (got ${String(raw.gratuityBasis)})`);
  }

  const hasAttachments = options?.hasAttachments === true;
  const rawNorm = !hasAttachments && rawMessage && rawMessage.trim() ? normalizeText(rawMessage) : undefined;

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
      checkOptionalNumber(entry, 'percentageRate', path, schemaErrors);
      checkOptionalNumber(entry, 'customBasisAmount', path, schemaErrors);
      checkOptionalNumber(entry, 'originalAmount', path, schemaErrors);
      if (entry.pricingType === 'percentage') {
        const rate = entry.percentageRate ?? entry.amount;
        if (!isFiniteNumber(rate) || rate < 0) {
          schemaErrors.push(`${path}.percentageRate or amount must be a non-negative number for percentage items`);
        }
      }
      if (
        entry.percentageBasis !== undefined &&
        entry.percentageBasis !== null &&
        !VALID_PERCENTAGE_BASES.has(entry.percentageBasis as PercentageBasis)
      ) {
        schemaErrors.push(`${path}.percentageBasis is invalid (got ${String(entry.percentageBasis)})`);
      }
      if (entry.chargeType !== undefined) {
        if (!VALID_CHARGE_TYPES.has(entry.chargeType as ChargeRequirement)) {
          schemaErrors.push(
            `${path}.chargeType must be mandatory|conditional|optional (got ${String(entry.chargeType)})`,
          );
        } else if (
          (entry.chargeType === 'mandatory' || entry.chargeType === 'conditional') &&
          entry.optionalAddon === true
        ) {
          schemaErrors.push(
            `${path}.optionalAddon cannot be true when chargeType is "${entry.chargeType}"`,
          );
        }
      }
      if (entry.optionalAddon !== undefined && typeof entry.optionalAddon !== 'boolean') {
        schemaErrors.push(`${path}.optionalAddon must be a boolean`);
      }
      if (entry.conflictingOptions !== undefined) {
        if (!Array.isArray(entry.conflictingOptions)) {
          schemaErrors.push(`${path}.conflictingOptions must be an array`);
        } else {
          entry.conflictingOptions.forEach((opt, optIdx) => {
            const optPath = `${path}.conflictingOptions[${optIdx}]`;
            if (!isObject(opt)) {
              schemaErrors.push(`${optPath} must be an object`);
              return;
            }
            if (typeof opt.sourceLabel !== 'string' || opt.sourceLabel.trim() === '') {
              schemaErrors.push(`${optPath}.sourceLabel must be a non-empty string`);
            }
            if (!VALID_PRICING_TYPES.has(opt.pricingType as PricingType)) {
              schemaErrors.push(`${optPath}.pricingType is invalid (got ${String(opt.pricingType)})`);
            }
            if (!isFiniteNumber(opt.amount)) {
              schemaErrors.push(`${optPath}.amount must be a finite number`);
            }
            if (typeof opt.sourceExcerpt !== 'string' || opt.sourceExcerpt.trim() === '') {
              schemaErrors.push(`${optPath}.sourceExcerpt must be a non-empty string`);
            } else if (rawNorm && !rawNorm.includes(normalizeText(opt.sourceExcerpt))) {
              sourceErrors.push(
                `Unsupported conflicting price "${String(opt.sourceLabel)}" on "${String(entry.label)}" — sourceExcerpt not found verbatim in raw message`,
              );
            }
          });
        }
      }
      if (typeof entry.sourceExcerpt !== 'string' || entry.sourceExcerpt.trim() === '') {
        if (hasAttachments && typeof entry.pageReference === 'string' && entry.pageReference.trim() !== '') {
          // Document evidence tracked via pageReference; warn if snippet itself is missing
          sourceErrors.push(
            `Line item "${String(entry.label)}" has page reference (${entry.pageReference}) but no visible source snippet — verify against uploaded document`,
          );
        } else {
          schemaErrors.push(`${path}.sourceExcerpt must be a non-empty string`);
        }
      } else if (rawNorm && !rawNorm.includes(normalizeText(entry.sourceExcerpt))) {
        sourceErrors.push(
          `Unsupported line item "${String(entry.label)}" — sourceExcerpt not found verbatim in raw message`,
        );
      } else if (hasAttachments && entry.sourceExcerpt.trim().length < 3) {
        sourceErrors.push(
          `Line item "${String(entry.label)}" has insufficient document evidence — verify against uploaded document`,
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
