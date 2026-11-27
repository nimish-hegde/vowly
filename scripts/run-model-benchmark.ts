import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { calculateQuoteTotal } from '../src/calculator.ts';
import { extractQuote, ExtractionError, type ProviderName } from '../src/extractor.ts';
import { estimateExtractionCostUsd, getModelPricingRates } from '../src/telemetry.ts';
import type { ExtractedQuote, ExtractionAttachment, TokenUsage } from '../src/types.ts';
import { normalizeLineItemLabel, validateExtractedQuote } from '../src/validator.ts';
import { calculateQuoteFinancials } from '../frontend/src/engine/financialCalculator.ts';
import { mapBackendExtractionToFrontendResult } from '../frontend/src/services/quoteExtractor.ts';
import type { BenchmarkCase, BenchmarkDifficulty, BenchmarkModality } from './generate-multimodal-holdout.ts';

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^a-z0-9$%.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFinancialTokens(s: string): string[] {
  const matches = s.match(/\$?\d[\d,]*(?:\.\d+)?%?/g) ?? [];
  return matches.map((m) => m.replace(/,/g, '').toLowerCase());
}

/**
 * True multimodal grounding check:
 * Validates that an excerpt matches a local contiguous span (a single line or adjacent 2-3 line window)
 * in the rendered document text (or rawMessage), AND that every complete numeric/currency/percentage
 * token extracted from the excerpt matches a complete extracted token in that same span.
 */
export function isExcerptGroundedInSource(excerpt: string, fullSourceText: string): boolean {
  const normEx = normalizeText(excerpt);
  if (!normEx || normEx.length < 3) return false;

  const finTokens = extractFinancialTokens(excerpt);
  const rawLines = fullSourceText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Build local spans: individual lines + adjacent 2- and 3-line windows (handles card headers
  // like Title / Badge / Price without allowing document-wide bag-of-words assembly).
  const localSpans: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    localSpans.push(rawLines[i]!);
    if (i + 1 < rawLines.length) {
      localSpans.push(`${rawLines[i]!} ${rawLines[i + 1]!}`);
    }
    if (i + 2 < rawLines.length) {
      localSpans.push(`${rawLines[i]!} ${rawLines[i + 1]!} ${rawLines[i + 2]!}`);
    }
  }
  if (localSpans.length === 0) return false;

  const exWords = normEx.split(' ').filter((t) => t.length >= 2);

  for (const rawSpan of localSpans) {
    const normSpan = normalizeText(rawSpan);
    const spanFinTokenSet = new Set(extractFinancialTokens(rawSpan));

    // Every complete numeric/currency/percentage token in the excerpt MUST appear as a complete
    // token in this local span (rejecting partial decimal matches like $85 vs $85.50 or 5% vs 15.5%).
    const allFinancialMatch = finTokens.every((ft) => spanFinTokenSet.has(ft));
    if (!allFinancialMatch) continue;

    if (normSpan.includes(normEx)) return true;

    if (exWords.length > 0) {
      const matched = exWords.filter((w) => normSpan.includes(w)).length;
      if (matched / exWords.length >= 0.75) return true;
    }
  }

  return false;
}

function collectAllExcerpts(q: ExtractedQuote): string[] {
  const excerpts: string[] = [];
  for (const li of q.lineItems ?? []) {
    if (li.sourceExcerpt) excerpts.push(li.sourceExcerpt);
    for (const opt of li.conflictingOptions ?? []) {
      if (opt.sourceExcerpt) excerpts.push(opt.sourceExcerpt);
    }
  }
  for (const pkg of q.packages ?? []) {
    if (pkg.sourceExcerpt) excerpts.push(pkg.sourceExcerpt);
  }
  for (const oq of q.openQuestions ?? []) {
    if (oq.sourceExcerpt) excerpts.push(oq.sourceExcerpt);
  }
  return excerpts;
}

function normalizeVendorName(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

interface FieldChecks {
  checked: number;
  matched: number;
  details: Record<string, boolean>;
}

export interface BenchmarkCaseResult {
  id: string;
  repeatIndex: number;
  modality: BenchmarkModality;
  category: string;
  difficulty: BenchmarkDifficulty;
  completed: boolean;
  apiError?: string;
  parseError?: string;
  schemaValid: boolean;
  schemaErrors: string[];
  endToEndPassed: boolean;
  criticalFinancialError: boolean;
  unsupportedCurrencyAssumption: boolean;
  frontendParityPassed: boolean;
  frontendParityError?: string;
  releaseBlockers: string[];
  failures: string[];
  fieldChecks: FieldChecks;
  groundingTotalExcerpts: number;
  groundingVerifiedExcerpts: number;
  groundingExpectedSnippetsTotal: number;
  groundingExpectedSnippetsMatched: number;
  missedChargesCount: number;
  inventedChargesCount: number;
  packageCountCorrect: boolean | null;
  inclusionsExpected: number;
  inclusionsMatched: number;
  leakedInclusionTokens: number;
  deliveryTermsExpected: number;
  deliveryTermsMatched: number;
  paymentChecksTotal: number;
  paymentChecksMatched: number;
  /** 3-way separation */
  aiExtractionErrorsRequiringCorrection: number;
  legitimateUserConfirmationsCount: number;
  missingSourceInfoCount: number;
  latencyMs: number;
  latencyWithoutRetriesMs: number;
  retryCount: number;
  tokenUsage?: TokenUsage;
  thinkingTokens: number;
  billedOutputTokens: number;
  extractedSummary?: {
    vendorName: string | null;
    category: string;
    currency: string;
    knownSubtotal: number;
    selectedPackageSubtotal?: number;
    packagesCount: number;
  };
}

export function gradeBenchmarkCase(
  bc: BenchmarkCase,
  rawResponse: unknown,
  latencyMs: number,
  latencyWithoutRetriesMs: number,
  retryCount: number,
  tokenUsage: TokenUsage | undefined,
  repeatIndex: number,
): BenchmarkCaseResult {
  const hasAttachments = Boolean(bc.attachmentPath);
  const validation = validateExtractedQuote(rawResponse, bc.rawMessage, { hasAttachments });
  const schemaErrors = [...validation.schemaErrors];
  const releaseBlockers = hasAttachments ? [] : [...validation.sourceErrors];
  const failures: string[] = [];

  const thinkingTokens = tokenUsage
    ? Math.max(0, tokenUsage.totalTokens - tokenUsage.promptTokens - tokenUsage.outputTokens)
    : 0;
  const billedOutputTokens = tokenUsage ? tokenUsage.outputTokens + thinkingTokens : 0;

  if (!validation.quote) {
    return {
      id: bc.id,
      repeatIndex,
      modality: bc.modality,
      category: bc.expected.category,
      difficulty: bc.difficulty,
      completed: true,
      schemaValid: false,
      schemaErrors,
      endToEndPassed: false,
      criticalFinancialError: false,
      unsupportedCurrencyAssumption: false,
      frontendParityPassed: false,
      frontendParityError: 'Skipped due to schema failure',
      releaseBlockers,
      failures: ['Schema validation failed'],
      fieldChecks: { checked: 0, matched: 0, details: {} },
      groundingTotalExcerpts: 0,
      groundingVerifiedExcerpts: 0,
      groundingExpectedSnippetsTotal: bc.expected.expectedSourceSnippets.length,
      groundingExpectedSnippetsMatched: 0,
      missedChargesCount: 0,
      inventedChargesCount: 0,
      packageCountCorrect: bc.expected.expectedPackageCount !== undefined ? false : null,
      inclusionsExpected: bc.expected.expectedInclusions?.length ?? 0,
      inclusionsMatched: 0,
      leakedInclusionTokens: 0,
      deliveryTermsExpected: bc.expected.expectedDeliveryTerms?.length ?? 0,
      deliveryTermsMatched: 0,
      paymentChecksTotal: 0,
      paymentChecksMatched: 0,
      aiExtractionErrorsRequiringCorrection: 5,
      legitimateUserConfirmationsCount: bc.expected.legitimateUserConfirmations.length,
      missingSourceInfoCount: bc.expected.missingSourceInfo.length,
      latencyMs,
      latencyWithoutRetriesMs,
      retryCount,
      tokenUsage,
      thinkingTokens,
      billedOutputTokens,
    };
  }

  const q = validation.quote;
  let criticalFinancialError = false;
  let unsupportedCurrencyAssumption = false;
  let aiCorrections = 0;

  // --- Field-level checks ---
  const details: Record<string, boolean> = {};
  const checkField = (name: string, ok: boolean, failMsg?: string, countCorrection = true) => {
    details[name] = ok;
    if (!ok) {
      if (failMsg) failures.push(failMsg);
      if (countCorrection) aiCorrections++;
    }
  };

  // Vendor name
  if (bc.expected.vendorName === null) {
    const ok = !q.vendorName || q.vendorName.trim() === '';
    checkField('vendorName', ok, ok ? undefined : `vendorName: invented "${q.vendorName}", expected null`);
  } else {
    const got = normalizeVendorName(q.vendorName);
    const exp = normalizeVendorName(bc.expected.vendorName);
    const ok = got.length > 0 && (got.includes(exp) || exp.includes(got));
    checkField('vendorName', ok, ok ? undefined : `vendorName: got "${q.vendorName}", expected "${bc.expected.vendorName}"`);
  }

  // Category (for P08 videography, accept photographer or other)
  const catOk =
    bc.id === 'P08'
      ? q.category === 'photographer' || q.category === 'other'
      : q.category === bc.expected.category;
  checkField('category', catOk, catOk ? undefined : `category: got "${q.category}", expected "${bc.expected.category}"`);

  // Currency
  const curOk = q.currency === bc.expected.currency;
  details['currency'] = curOk;
  if (!curOk) {
    aiCorrections++;
    if (bc.expected.currency === 'UNKNOWN') {
      unsupportedCurrencyAssumption = true;
      releaseBlockers.push(`Unsupported currency assumption: got "${q.currency}", expected "UNKNOWN"`);
    } else {
      failures.push(`currency: got "${q.currency}", expected "${bc.expected.currency}"`);
    }
  }

  // Quote kind
  const kindOk = q.quoteKind === bc.expected.quoteKind;
  checkField('quoteKind', kindOk, kindOk ? undefined : `quoteKind: got "${q.quoteKind}", expected "${bc.expected.quoteKind}"`);

  // Tax status & percent (wrong tax rate/status materially alters all-in financial totals)
  let taxOrGratuityFinancialError = false;
  const taxStatusOk = q.taxStatus === bc.expected.taxStatus;
  checkField('taxStatus', taxStatusOk, taxStatusOk ? undefined : `taxStatus: got "${q.taxStatus}", expected "${bc.expected.taxStatus}"`);
  if (!taxStatusOk) {
    taxOrGratuityFinancialError = true;
    criticalFinancialError = true;
    releaseBlockers.push(
      `Critical financial error (taxStatus): got "${q.taxStatus}", expected "${bc.expected.taxStatus}"`,
    );
  }
  if (bc.expected.taxPercent !== undefined) {
    const taxPctOk =
      bc.expected.taxPercent === null
        ? q.taxPercent === null || q.taxPercent === undefined
        : q.taxPercent === bc.expected.taxPercent;
    checkField('taxPercent', taxPctOk, taxPctOk ? undefined : `taxPercent: got ${q.taxPercent}, expected ${bc.expected.taxPercent}`);
    if (!taxPctOk) {
      taxOrGratuityFinancialError = true;
      criticalFinancialError = true;
      releaseBlockers.push(
        `Critical financial error (taxPercent): got ${q.taxPercent}, expected ${bc.expected.taxPercent}`,
      );
    }
  }

  // Gratuity status / percent / basis (wrong gratuity rate/basis materially alters all-in totals)
  if (bc.expected.gratuityStatus !== undefined) {
    const ok = q.gratuityStatus === bc.expected.gratuityStatus;
    checkField('gratuityStatus', ok, ok ? undefined : `gratuityStatus: got "${q.gratuityStatus}", expected "${bc.expected.gratuityStatus}"`);
    if (!ok) {
      taxOrGratuityFinancialError = true;
      criticalFinancialError = true;
      releaseBlockers.push(
        `Critical financial error (gratuityStatus): got "${q.gratuityStatus}", expected "${bc.expected.gratuityStatus}"`,
      );
    }
  }
  if (bc.expected.gratuityPercent !== undefined) {
    const ok =
      bc.expected.gratuityPercent === null
        ? q.gratuityPercent === null || q.gratuityPercent === undefined
        : q.gratuityPercent === bc.expected.gratuityPercent;
    checkField('gratuityPercent', ok, ok ? undefined : `gratuityPercent: got ${q.gratuityPercent}, expected ${bc.expected.gratuityPercent}`);
    if (!ok) {
      taxOrGratuityFinancialError = true;
      criticalFinancialError = true;
      releaseBlockers.push(
        `Critical financial error (gratuityPercent): got ${q.gratuityPercent}, expected ${bc.expected.gratuityPercent}`,
      );
    }
  }
  if (bc.expected.gratuityBasis !== undefined) {
    const ok = q.gratuityBasis === bc.expected.gratuityBasis;
    checkField('gratuityBasis', ok, ok ? undefined : `gratuityBasis: got "${q.gratuityBasis}", expected "${bc.expected.gratuityBasis}"`);
    if (!ok) {
      taxOrGratuityFinancialError = true;
      criticalFinancialError = true;
      releaseBlockers.push(
        `Critical financial error (gratuityBasis): got "${q.gratuityBasis}", expected "${bc.expected.gratuityBasis}"`,
      );
    }
  }

  // Venue minGuests & maxCapacity
  if (bc.expected.minGuests !== undefined) {
    const gotMin =
      q.venueDetails?.minGuests ??
      q.lineItems.find((li) => li.minGuests !== undefined)?.minGuests;
    const ok = gotMin === bc.expected.minGuests;
    checkField('minGuests', ok, ok ? undefined : `minGuests: got ${gotMin}, expected ${bc.expected.minGuests}`);
  }
  if (bc.expected.maxCapacity !== undefined) {
    const ok = q.venueDetails?.maxCapacity === bc.expected.maxCapacity;
    checkField('maxCapacity', ok, ok ? undefined : `maxCapacity: got ${q.venueDetails?.maxCapacity}, expected ${bc.expected.maxCapacity}`);
  }

  // --- Deterministic Backend Financial Check ---
  // For multi-package quotes, do not pass package-specific hours before a package is selected.
  const isMultiPkgExpected = (bc.expected.expectedPackageCount ?? 0) >= 2;
  const baseCalc = calculateQuoteTotal(q, {
    guestCount: bc.calcContext.guestCount,
    hours: isMultiPkgExpected ? undefined : bc.calcContext.hours,
  });

  if (Math.abs(baseCalc.knownSubtotal - bc.expected.knownSubtotal) >= 0.01) {
    criticalFinancialError = true;
    aiCorrections++;
    releaseBlockers.push(
      `Critical financial error: knownSubtotal got ${baseCalc.knownSubtotal}, expected ${bc.expected.knownSubtotal}`,
    );
  }

  // Multi-package check & selected package subtotal
  let packageCountCorrect: boolean | null = null;
  let selectedPackageId: string | undefined;
  let selectedPkgSubtotal: number | undefined;
  if (bc.expected.expectedPackageCount !== undefined) {
    const gotPkgs = q.packages?.length ?? 0;
    packageCountCorrect = gotPkgs === bc.expected.expectedPackageCount;
    if (gotPkgs < bc.expected.expectedPackageCount) {
      criticalFinancialError = true;
      aiCorrections++;
      releaseBlockers.push(
        `Multi-package failure: got ${gotPkgs} packages, expected ${bc.expected.expectedPackageCount}`,
      );
    }
    if (bc.expected.expectUnresolvedPackageSelection && !baseCalc.unresolvedPackageSelection) {
      criticalFinancialError = true;
      releaseBlockers.push('Multi-package quote did not block approval with unresolvedPackageSelection');
    }
    if (bc.expected.expectedSelectedPackageSubtotal !== undefined && q.packages && q.packages.length > 0) {
      const targetMatch = (bc.calcContext.selectedPackageName ?? '').toLowerCase();
      const chosenPkg =
        q.packages.find((p) => p.name.toLowerCase().includes(targetMatch)) ?? q.packages[0]!;
      selectedPackageId = chosenPkg.id;
      const selCalc = calculateQuoteTotal(q, {
        guestCount: bc.calcContext.guestCount,
        hours: bc.calcContext.hours,
        selectedPackageId,
      });
      selectedPkgSubtotal = selCalc.knownSubtotal;
      if (Math.abs(selCalc.knownSubtotal - bc.expected.expectedSelectedPackageSubtotal) >= 0.01) {
        criticalFinancialError = true;
        aiCorrections++;
        releaseBlockers.push(
          `Critical financial error (selected package "${chosenPkg.name}"): got ${selCalc.knownSubtotal}, expected ${bc.expected.expectedSelectedPackageSubtotal}`,
        );
      }

      // Validate effective package-level tax & gratuity overrides (which take precedence over quote-level)
      const effTaxStatus = chosenPkg.taxStatus ?? q.taxStatus;
      const effTaxPercent =
        chosenPkg.taxPercent !== undefined ? chosenPkg.taxPercent : q.taxPercent;
      const effGratStatus = chosenPkg.gratuityStatus ?? q.gratuityStatus;
      const effGratPercent =
        chosenPkg.gratuityPercent !== undefined ? chosenPkg.gratuityPercent : q.gratuityPercent;
      const effGratBasis = chosenPkg.gratuityBasis ?? q.gratuityBasis;

      const checkPkgFin = (label: string, ok: boolean, gotVal: unknown, expVal: unknown) => {
        if (!ok) {
          taxOrGratuityFinancialError = true;
          criticalFinancialError = true;
          aiCorrections++;
          releaseBlockers.push(
            `Critical financial error (selected package "${chosenPkg.name}" ${label}): got ${gotVal}, expected ${expVal}`,
          );
        }
      };

      checkPkgFin('taxStatus', effTaxStatus === bc.expected.taxStatus, effTaxStatus, bc.expected.taxStatus);
      if (bc.expected.taxPercent !== undefined) {
        const ok =
          bc.expected.taxPercent === null
            ? effTaxPercent === null || effTaxPercent === undefined
            : effTaxPercent === bc.expected.taxPercent;
        checkPkgFin('taxPercent', ok, effTaxPercent, bc.expected.taxPercent);
      }
      if (bc.expected.gratuityStatus !== undefined) {
        checkPkgFin(
          'gratuityStatus',
          effGratStatus === bc.expected.gratuityStatus,
          effGratStatus,
          bc.expected.gratuityStatus,
        );
      }
      if (bc.expected.gratuityPercent !== undefined) {
        const ok =
          bc.expected.gratuityPercent === null
            ? effGratPercent === null || effGratPercent === undefined
            : effGratPercent === bc.expected.gratuityPercent;
        checkPkgFin('gratuityPercent', ok, effGratPercent, bc.expected.gratuityPercent);
      }
      if (bc.expected.gratuityBasis !== undefined) {
        checkPkgFin(
          'gratuityBasis',
          effGratBasis === bc.expected.gratuityBasis,
          effGratBasis,
          bc.expected.gratuityBasis,
        );
      }
    }
  }

  // --- Frontend Mapping & Calculation Parity Check ---
  let frontendParityPassed = true;
  let frontendParityError: string | undefined;
  try {
    const feResult = mapBackendExtractionToFrontendResult(
      {
        session: { draftQuote: q, sourceWarnings: [] },
      } as never,
      {
        sourceType: bc.modality === 'pdf' ? 'pdf' : bc.modality === 'image' ? 'screenshot' : 'pasted_message',
        sourceChannel: bc.modality === 'pdf' ? 'PDF upload' : bc.modality === 'image' ? 'Screenshot' : 'Pasted message',
        rawText: bc.rawMessage,
        guestCount: bc.calcContext.guestCount ?? 150,
      },
    );
    const feQuote = selectedPackageId
      ? { ...feResult.quote, selectedPackageId }
      : feResult.quote;
    const feCalc = calculateQuoteFinancials(feQuote, [], [], bc.calcContext.guestCount ?? 150);
    const beTarget =
      selectedPackageId !== undefined
        ? calculateQuoteTotal(q, {
            guestCount: bc.calcContext.guestCount,
            hours: bc.calcContext.hours,
            selectedPackageId,
          })
        : baseCalc;

    if (Math.abs(feCalc.preTaxTotal - beTarget.knownSubtotal) >= 0.01) {
      frontendParityPassed = false;
      frontendParityError = `Frontend preTaxTotal ${feCalc.preTaxTotal} !== backend ${beTarget.knownSubtotal}`;
    }
  } catch (err) {
    frontendParityPassed = false;
    frontendParityError = `Frontend mapping threw: ${err instanceof Error ? err.message : String(err)}`;
  }

  // --- Missing & Invented Charges ---
  let missedChargesCount = 0;
  let inventedChargesCount = 0;

  const gotUnknowns = baseCalc.unknownItems.map(normalizeLineItemLabel);
  for (const expUnk of bc.expected.unknownItemLabels) {
    const target = normalizeLineItemLabel(expUnk);
    if (!gotUnknowns.some((g) => g.includes(target))) {
      missedChargesCount++;
      aiCorrections++;
      criticalFinancialError = true;
      releaseBlockers.push(
        `Critical financial error: omitted mandatory/TBD charge matching "${expUnk}" (got: [${baseCalc.unknownItems.join(', ')}])`,
      );
      failures.push(`missed TBD/unknown charge matching "${expUnk}" (got: [${baseCalc.unknownItems.join(', ')}])`);
    }
  }

  // Price conflict checks
  if (bc.expected.expectedPriceConflictDiscrepancy !== undefined) {
    const expDiff = bc.expected.expectedPriceConflictDiscrepancy;
    if (baseCalc.priceConflicts.length === 0) {
      criticalFinancialError = true;
      aiCorrections++;
      releaseBlockers.push(`Undetected price conflict (expected discrepancy ${expDiff})`);
    } else if (!baseCalc.priceConflicts.some((c) => Math.abs(c.discrepancy - expDiff) < 0.01)) {
      failures.push(
        `priceConflict discrepancy: expected ${expDiff}, got [${baseCalc.priceConflicts.map((c) => c.discrepancy).join(', ')}]`,
      );
      aiCorrections++;
    }
  } else if (baseCalc.priceConflicts.length > 0) {
    // False conflict (e.g., negotiated discount wrongly flagged as conflict)
    inventedChargesCount += baseCalc.priceConflicts.length;
    aiCorrections++;
    failures.push(`false price conflict detected when none expected`);
  }

  // Negotiated savings check
  if (bc.expected.expectedNegotiatedSavings !== undefined) {
    const gotSavings = q.lineItems.reduce((sum, li) => {
      if (typeof li.originalAmount === 'number' && typeof li.amount === 'number' && li.originalAmount > li.amount) {
        return sum + (li.originalAmount - li.amount);
      }
      return sum;
    }, 0);
    const ok = Math.abs(gotSavings - bc.expected.expectedNegotiatedSavings) < 0.01;
    checkField(
      'negotiatedSavings',
      ok,
      ok ? undefined : `negotiatedSavings: got ${gotSavings}, expected ${bc.expected.expectedNegotiatedSavings}`,
    );
  }

  if (baseCalc.knownSubtotal > bc.expected.knownSubtotal + 0.01) {
    inventedChargesCount++;
  } else if (baseCalc.knownSubtotal < bc.expected.knownSubtotal - 0.01) {
    missedChargesCount++;
  }

  // --- True Multimodal Source Grounding ---
  const combinedSourceText = [bc.rawMessage, bc.documentText].filter(Boolean).join('\n');
  const excerpts = collectAllExcerpts(q);
  const verifiedExcerpts = excerpts.filter((ex) => isExcerptGroundedInSource(ex, combinedSourceText)).length;
  const allExcerptBlob = normalizeText(excerpts.join(' '));
  const matchedExpectedSnippets = bc.expected.expectedSourceSnippets.filter((snip) => {
    const normSnip = normalizeText(snip);
    if (allExcerptBlob.includes(normSnip)) return true;
    const toks = normSnip.split(' ').filter((t) => t.length >= 2);
    return toks.length > 0 && toks.filter((t) => allExcerptBlob.includes(t)).length / toks.length >= 0.7;
  }).length;

  // --- Package & Inclusion Completeness + Clean Formatting ---
  const allInclusions = [
    ...(q.inclusions ?? []),
    ...(q.packages ?? []).flatMap((p) => p.inclusions ?? []),
  ];
  const inclusionBlob = normalizeText(allInclusions.map((i) => `${i.name} ${i.unit ?? ''}`).join(' '));
  const inclusionsExpected = bc.expected.expectedInclusions?.length ?? 0;
  const inclusionsMatched = (bc.expected.expectedInclusions ?? []).filter((inc) =>
    inclusionBlob.includes(normalizeText(inc)),
  ).length;
  const leakedInclusionTokens = allInclusions.filter(
    (inc) =>
      (typeof inc.unit === 'string' && inc.unit.includes('_')) ||
      /[a-z]+_[a-z]+/.test(inc.name),
  ).length;
  if (leakedInclusionTokens > 0) aiCorrections += leakedInclusionTokens;

  const allDeliveryTerms = [
    ...(q.deliveryTerms ?? []),
    ...(q.packages ?? []).flatMap((p) => p.deliveryTerms ?? []),
  ];
  const deliveryBlob = normalizeText(allDeliveryTerms.join(' '));
  const deliveryTermsExpected = bc.expected.expectedDeliveryTerms?.length ?? 0;
  const deliveryTermsMatched = (bc.expected.expectedDeliveryTerms ?? []).filter((dt) =>
    deliveryBlob.includes(normalizeText(dt)),
  ).length;

  // --- Payment Term Accuracy ---
  let paymentChecksTotal = 0;
  let paymentChecksMatched = 0;
  const pt = q.paymentTerms;
  if (bc.expected.expectedDepositAmount !== undefined) {
    paymentChecksTotal++;
    const gotDep =
      pt?.depositAmount ??
      pt?.milestones?.find((m) => m.amount !== undefined)?.amount;
    if (gotDep === bc.expected.expectedDepositAmount) paymentChecksMatched++;
    else {
      aiCorrections++;
      failures.push(`depositAmount: got ${gotDep}, expected ${bc.expected.expectedDepositAmount}`);
    }
  }
  if (bc.expected.expectedDepositPercent !== undefined) {
    paymentChecksTotal++;
    const gotPct =
      pt?.depositPercent ??
      pt?.milestones?.find((m) => m.percent !== undefined)?.percent;
    if (gotPct === bc.expected.expectedDepositPercent) paymentChecksMatched++;
    else {
      aiCorrections++;
      failures.push(`depositPercent: got ${gotPct}, expected ${bc.expected.expectedDepositPercent}`);
    }
  }
  if (bc.expected.paymentMethodRule !== undefined) {
    paymentChecksTotal++;
    if (pt?.methodRule === bc.expected.paymentMethodRule) paymentChecksMatched++;
    else {
      aiCorrections++;
      failures.push(`paymentMethodRule: got "${pt?.methodRule}", expected "${bc.expected.paymentMethodRule}"`);
    }
  }
  if (bc.expected.expectedDueDates && bc.expected.expectedDueDates.length > 0) {
    const gotDates = (pt?.milestones ?? []).map((m) => m.dueDate ?? '').join(' ');
    for (const d of bc.expected.expectedDueDates) {
      paymentChecksTotal++;
      if (gotDates.includes(d)) paymentChecksMatched++;
      else {
        aiCorrections++;
        failures.push(`missing payment dueDate "${d}"`);
      }
    }
  }
  if (bc.expected.expectedRelativeDays !== undefined) {
    paymentChecksTotal++;
    const gotRel = (pt?.milestones ?? []).some(
      (m) => m.relativeDaysBeforeEvent === bc.expected.expectedRelativeDays,
    );
    if (gotRel) paymentChecksMatched++;
    else {
      aiCorrections++;
      failures.push(`missing relativeDaysBeforeEvent ${bc.expected.expectedRelativeDays}`);
    }
  }

  const fieldKeys = Object.keys(details);
  const fieldMatched = fieldKeys.filter((k) => details[k]).length;

  // End-to-end pass: schema valid + 0 release blockers + 0 critical financial errors (incl. tax/gratuity) + core fields/unknowns match
  const endToEndPassed =
    schemaErrors.length === 0 &&
    releaseBlockers.length === 0 &&
    !criticalFinancialError &&
    !taxOrGratuityFinancialError &&
    catOk &&
    curOk &&
    kindOk &&
    taxStatusOk &&
    missedChargesCount === 0 &&
    (bc.expected.expectedPriceConflictDiscrepancy === undefined
      ? baseCalc.priceConflicts.length === 0
      : baseCalc.priceConflicts.some(
          (c) => Math.abs(c.discrepancy - bc.expected.expectedPriceConflictDiscrepancy!) < 0.01,
        ));

  return {
    id: bc.id,
    repeatIndex,
    modality: bc.modality,
    category: bc.expected.category,
    difficulty: bc.difficulty,
    completed: true,
    schemaValid: schemaErrors.length === 0,
    schemaErrors,
    endToEndPassed,
    criticalFinancialError,
    unsupportedCurrencyAssumption,
    frontendParityPassed,
    frontendParityError,
    releaseBlockers,
    failures,
    fieldChecks: { checked: fieldKeys.length, matched: fieldMatched, details },
    groundingTotalExcerpts: excerpts.length,
    groundingVerifiedExcerpts: verifiedExcerpts,
    groundingExpectedSnippetsTotal: bc.expected.expectedSourceSnippets.length,
    groundingExpectedSnippetsMatched: matchedExpectedSnippets,
    missedChargesCount,
    inventedChargesCount,
    packageCountCorrect,
    inclusionsExpected,
    inclusionsMatched,
    leakedInclusionTokens,
    deliveryTermsExpected,
    deliveryTermsMatched,
    paymentChecksTotal,
    paymentChecksMatched,
    aiExtractionErrorsRequiringCorrection: aiCorrections,
    legitimateUserConfirmationsCount: bc.expected.legitimateUserConfirmations.length,
    missingSourceInfoCount: bc.expected.missingSourceInfo.length,
    latencyMs,
    latencyWithoutRetriesMs,
    retryCount,
    tokenUsage,
    thinkingTokens,
    billedOutputTokens,
    extractedSummary: {
      vendorName: q.vendorName,
      category: q.category,
      currency: q.currency,
      knownSubtotal: baseCalc.knownSubtotal,
      selectedPackageSubtotal: selectedPkgSubtotal,
      packagesCount: q.packages?.length ?? 0,
    },
  };
}

function summarizeResults(results: BenchmarkCaseResult[], model: string) {
  const total = results.length;
  const completed = results.filter((r) => r.completed);
  const schemaValid = completed.filter((r) => r.schemaValid).length;
  const e2ePassed = results.filter((r) => r.endToEndPassed).length;
  const critFinErr = results.filter((r) => r.criticalFinancialError).length;
  const curGuesses = results.filter((r) => r.unsupportedCurrencyAssumption).length;
  const feParityPassed = completed.filter((r) => r.frontendParityPassed).length;

  const fieldChecked = completed.reduce((s, r) => s + r.fieldChecks.checked, 0);
  const fieldMatched = completed.reduce((s, r) => s + r.fieldChecks.matched, 0);

  const gTotal = completed.reduce((s, r) => s + r.groundingTotalExcerpts, 0);
  const gVerified = completed.reduce((s, r) => s + r.groundingVerifiedExcerpts, 0);
  const gSnipTotal = completed.reduce((s, r) => s + r.groundingExpectedSnippetsTotal, 0);
  const gSnipMatched = completed.reduce((s, r) => s + r.groundingExpectedSnippetsMatched, 0);

  const missedCharges = completed.reduce((s, r) => s + r.missedChargesCount, 0);
  const inventedCharges = completed.reduce((s, r) => s + r.inventedChargesCount, 0);
  const incExp = completed.reduce((s, r) => s + r.inclusionsExpected, 0);
  const incMat = completed.reduce((s, r) => s + r.inclusionsMatched, 0);
  const leakedTokens = completed.reduce((s, r) => s + r.leakedInclusionTokens, 0);
  const delExp = completed.reduce((s, r) => s + r.deliveryTermsExpected, 0);
  const delMat = completed.reduce((s, r) => s + r.deliveryTermsMatched, 0);
  const payExp = completed.reduce((s, r) => s + r.paymentChecksTotal, 0);
  const payMat = completed.reduce((s, r) => s + r.paymentChecksMatched, 0);

  const aiCorrections = completed.reduce((s, r) => s + r.aiExtractionErrorsRequiringCorrection, 0);
  const legitDecisions = results.reduce((s, r) => s + r.legitimateUserConfirmationsCount, 0);
  const missingInfo = results.reduce((s, r) => s + r.missingSourceInfoCount, 0);

  const latencies = completed.map((r) => r.latencyMs).sort((a, b) => a - b);
  const noRetryLatencies = completed.map((r) => r.latencyWithoutRetriesMs).sort((a, b) => a - b);
  const avgLat = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
  const p95Lat = latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))]! : 0;
  const avgNoRetryLat = noRetryLatencies.length
    ? Math.round(noRetryLatencies.reduce((a, b) => a + b, 0) / noRetryLatencies.length)
    : 0;
  const totalRetries = results.reduce((s, r) => s + r.retryCount, 0);

  const promptTokens = results.reduce((s, r) => s + (r.tokenUsage?.promptTokens ?? 0), 0);
  const outputTokens = results.reduce((s, r) => s + (r.tokenUsage?.outputTokens ?? 0), 0);
  const thinkingTokens = results.reduce((s, r) => s + r.thinkingTokens, 0);
  const billedOutputTokens = results.reduce((s, r) => s + r.billedOutputTokens, 0);

  const estPaidCostCandidatesOnly = estimateExtractionCostUsd(
    { promptTokens, outputTokens, totalTokens: promptTokens + outputTokens },
    model,
  );
  const estPaidCostWithThinking = estimateExtractionCostUsd(
    { promptTokens, outputTokens: billedOutputTokens, totalTokens: promptTokens + billedOutputTokens },
    model,
  );

  return {
    total,
    completed: completed.length,
    apiAvailabilityRate: total ? completed.length / total : 0,
    schemaValidityRate: completed.length ? schemaValid / completed.length : 0,
    endToEndSuccessCount: e2ePassed,
    endToEndSuccessRate: total ? e2ePassed / total : 0,
    completedAccuracyRate: completed.length ? e2ePassed / completed.length : 0,
    fieldAccuracyRate: fieldChecked ? fieldMatched / fieldChecked : 0,
    fieldMatched,
    fieldChecked,
    criticalFinancialErrors: critFinErr,
    unsupportedCurrencyAssumptions: curGuesses,
    frontendParityRate: completed.length ? feParityPassed / completed.length : 0,
    groundingVerifiedRate: gTotal ? gVerified / gTotal : 0,
    groundingVerified: gVerified,
    groundingTotal: gTotal,
    expectedEvidenceRecall: gSnipTotal ? gSnipMatched / gSnipTotal : 0,
    missedCharges,
    inventedCharges,
    inclusionRecall: incExp ? incMat / incExp : 1,
    leakedInclusionTokens: leakedTokens,
    deliveryTermsRecall: delExp ? delMat / delExp : 1,
    paymentAccuracyRate: payExp ? payMat / payExp : 1,
    avgAiCorrectionsPerQuote: completed.length ? Number((aiCorrections / completed.length).toFixed(2)) : 0,
    totalAiCorrections: aiCorrections,
    totalLegitimateUserConfirmations: legitDecisions,
    totalMissingSourceInfo: missingInfo,
    avgLatencyMs: avgLat,
    p95LatencyMs: p95Lat,
    avgLatencyNoRetryMs: avgNoRetryLat,
    totalRetries,
    promptTokens,
    outputTokens,
    thinkingTokens,
    billedOutputTokens,
    estPaidCostCandidatesOnlyUsd: estPaidCostCandidatesOnly,
    estPaidCostWithThinkingUsd: estPaidCostWithThinking,
    costPerSuccessfulExtractionUsd:
      e2ePassed > 0 ? Number((estPaidCostWithThinking / e2ePassed).toFixed(6)) : null,
  };
}

function groupBy<T>(items: T[], keyFn: (x: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of items) {
    const k = keyFn(item);
    (out[k] ??= []).push(item);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  let provider: ProviderName = 'mock';
  let model = 'gemini-3.5-flash-lite';
  let delayMs: number | undefined;
  let caseFilter: Set<string> | undefined;
  let repeats = 1;
  let outPath: string | undefined;
  let circuitBreakerLimit = 3;

  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    const val = args[i + 1];
    if (flag === '--provider' && val) { provider = val as ProviderName; i++; }
    else if (flag === '--model' && val) { model = val; i++; }
    else if (flag === '--delay-ms' && val) { delayMs = Number(val); i++; }
    else if (flag === '--cases' && val) { caseFilter = new Set(val.split(',').map((s) => s.trim())); i++; }
    else if (flag === '--repeats' && val) { repeats = Math.max(1, Number(val)); i++; }
    else if (flag === '--out' && val) { outPath = val; i++; }
    else if (flag === '--circuit-breaker' && val) { circuitBreakerLimit = Math.max(1, Number(val)); i++; }
  }

  const effectiveDelay = delayMs ?? (provider === 'gemini' ? 2000 : 0);
  const allCases = JSON.parse(
    readFileSync(resolve('eval-data/held-out-v3-multimodal/cases.json'), 'utf8'),
  ) as BenchmarkCase[];
  const selectedCases = caseFilter ? allCases.filter((c) => caseFilter!.has(c.id)) : allCases;

  const pricing = getModelPricingRates(model);
  console.log(`\n=== Vowly Multimodal Benchmark (held-out-v3-multimodal) ===`);
  console.log(
    `Provider: ${provider} | Model: ${model} | Cases: ${selectedCases.length} x ${repeats} repeats | Pricing: $${pricing.inputUsdPerMillion}/1M in, $${pricing.outputUsdPerMillion}/1M out`,
  );

  const results: BenchmarkCaseResult[] = [];
  let resolvedModelVersion = model;
  let consecutiveApiFailures = 0;
  let abortedEarly = false;
  let abortReason = '';

  outer: for (let r = 1; r <= repeats; r++) {
    for (let idx = 0; idx < selectedCases.length; idx++) {
      const bc = selectedCases[idx]!;
      if ((r > 1 || idx > 0) && effectiveDelay > 0) {
        await new Promise((res) => setTimeout(res, effectiveDelay));
      }

      const attachments: ExtractionAttachment[] | undefined = bc.attachmentPath
        ? [
            {
              mimeType: bc.mimeType!,
              fileName: bc.attachmentPath.split('/').pop(),
              base64Data: readFileSync(resolve(bc.attachmentPath)).toString('base64'),
            },
          ]
        : undefined;

      const label = repeats > 1 ? `[r${r}/${repeats} ${idx + 1}/${selectedCases.length}] ${bc.id}` : `[${idx + 1}/${selectedCases.length}] ${bc.id}`;
      process.stdout.write(`  ${label} (${bc.modality}/${bc.difficulty})... `);

      try {
        const res = await extractQuote(bc.rawMessage, {
          provider,
          model,
          mockLookup: bc.mockExtraction,
          attachments,
          onRetry: (info) => {
            console.log(`\n      retry ${info.attempt}/${info.maxRetries} (${info.reason}, wait ${Math.round(info.delayMs / 1000)}s)...`);
            process.stdout.write(`      resuming ${bc.id}... `);
          },
        });
        consecutiveApiFailures = 0;
        if (res.resolvedModelVersion) resolvedModelVersion = res.resolvedModelVersion;

        const graded = gradeBenchmarkCase(
          bc,
          res.rawResponse,
          res.latencyMs,
          res.latencyWithoutRetriesMs,
          res.retryCount,
          res.tokenUsage,
          r,
        );
        results.push(graded);
        const tag = graded.endToEndPassed ? 'PASS' : graded.criticalFinancialError ? 'CRIT_FAIL' : 'FAIL';
        const parityNote = graded.frontendParityPassed ? '' : ' [FE_PARITY_ERR]';
        console.log(
          `${tag}${parityNote} (${graded.latencyWithoutRetriesMs}ms, corr=${graded.aiExtractionErrorsRequiringCorrection}, ground=${graded.groundingVerifiedExcerpts}/${graded.groundingTotalExcerpts})`,
        );
      } catch (err) {
        const isKnown = err instanceof ExtractionError;
        const msg = err instanceof Error ? err.message : String(err);
        const isParse = isKnown && err.kind === 'parse_error';
        results.push({
          id: bc.id,
          repeatIndex: r,
          modality: bc.modality,
          category: bc.expected.category,
          difficulty: bc.difficulty,
          completed: isParse,
          apiError: isParse ? undefined : msg,
          parseError: isParse ? msg : undefined,
          schemaValid: false,
          schemaErrors: isParse ? [msg] : [],
          endToEndPassed: false,
          criticalFinancialError: false,
          unsupportedCurrencyAssumption: false,
          frontendParityPassed: false,
          releaseBlockers: [],
          failures: [],
          fieldChecks: { checked: 0, matched: 0, details: {} },
          groundingTotalExcerpts: 0,
          groundingVerifiedExcerpts: 0,
          groundingExpectedSnippetsTotal: bc.expected.expectedSourceSnippets.length,
          groundingExpectedSnippetsMatched: 0,
          missedChargesCount: 0,
          inventedChargesCount: 0,
          packageCountCorrect: null,
          inclusionsExpected: bc.expected.expectedInclusions?.length ?? 0,
          inclusionsMatched: 0,
          leakedInclusionTokens: 0,
          deliveryTermsExpected: bc.expected.expectedDeliveryTerms?.length ?? 0,
          deliveryTermsMatched: 0,
          paymentChecksTotal: 0,
          paymentChecksMatched: 0,
          aiExtractionErrorsRequiringCorrection: 0,
          legitimateUserConfirmationsCount: bc.expected.legitimateUserConfirmations.length,
          missingSourceInfoCount: bc.expected.missingSourceInfo.length,
          latencyMs: isKnown ? err.latencyMs : 0,
          latencyWithoutRetriesMs: isKnown ? err.latencyWithoutRetriesMs : 0,
          retryCount: isKnown ? err.retryCount : 0,
          thinkingTokens: 0,
          billedOutputTokens: 0,
        });
        console.log(`${isParse ? 'PARSE_ERR' : 'API_ERR'} (${msg.slice(0, 100)})`);

        if (!isParse) {
          consecutiveApiFailures++;
          if (msg.includes('HTTP 402') || msg.toLowerCase().includes('billing_not_active')) {
            abortedEarly = true;
            abortReason = `Billing/payment error encountered: ${msg.slice(0, 160)}`;
            break outer;
          }
          if (consecutiveApiFailures >= circuitBreakerLimit) {
            abortedEarly = true;
            abortReason = `Circuit breaker tripped after ${consecutiveApiFailures} consecutive API failures: ${msg.slice(0, 160)}`;
            break outer;
          }
        }
      }
    }
  }

  const overall = summarizeResults(results, model);
  const byModality = Object.fromEntries(
    Object.entries(groupBy(results, (r) => r.modality)).map(([k, v]) => [k, summarizeResults(v, model)]),
  );
  const byCategory = Object.fromEntries(
    Object.entries(groupBy(results, (r) => r.category)).map(([k, v]) => [k, summarizeResults(v, model)]),
  );
  const byDifficulty = Object.fromEntries(
    Object.entries(groupBy(results, (r) => r.difficulty)).map(([k, v]) => [k, summarizeResults(v, model)]),
  );

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  console.log(`\n--- Summary (${model} -> ${resolvedModelVersion}) ---`);
  if (abortedEarly) console.log(`ABORTED EARLY: ${abortReason}`);
  console.log(
    `E2E Accuracy: ${overall.endToEndSuccessCount}/${overall.total} (${pct(overall.endToEndSuccessRate)}) | Completed Acc: ${pct(overall.completedAccuracyRate)} | Field Acc: ${overall.fieldMatched}/${overall.fieldChecked} (${pct(overall.fieldAccuracyRate)})`,
  );
  console.log(
    `API Avail: ${overall.completed}/${overall.total} (${pct(overall.apiAvailabilityRate)}) | Schema Valid: ${pct(overall.schemaValidityRate)} | FE/BE Parity: ${pct(overall.frontendParityRate)}`,
  );
  console.log(
    `Critical Fin Err: ${overall.criticalFinancialErrors} | Currency Guesses: ${overall.unsupportedCurrencyAssumptions} | Missed Charges: ${overall.missedCharges} | Invented Charges: ${overall.inventedCharges}`,
  );
  console.log(
    `True Grounding: ${overall.groundingVerified}/${overall.groundingTotal} (${pct(overall.groundingVerifiedRate)}) | Expected Evidence Recall: ${pct(overall.expectedEvidenceRecall)}`,
  );
  console.log(
    `Inclusions Recall: ${pct(overall.inclusionRecall)} (leaked tokens: ${overall.leakedInclusionTokens}) | Delivery Terms Recall: ${pct(overall.deliveryTermsRecall)} | Payment Acc: ${pct(overall.paymentAccuracyRate)}`,
  );
  console.log(
    `3-Way Separation -> AI Extraction Errors: ${overall.totalAiCorrections} (${overall.avgAiCorrectionsPerQuote}/quote) | Legit User Decisions: ${overall.totalLegitimateUserConfirmations} | Missing Source Info: ${overall.totalMissingSourceInfo}`,
  );
  console.log(
    `Latency: avg ${overall.avgLatencyMs}ms (no-retry ${overall.avgLatencyNoRetryMs}ms, p95 ${overall.p95LatencyMs}ms) | Retries: ${overall.totalRetries}`,
  );
  console.log(
    `Tokens: ${overall.promptTokens} in / ${overall.outputTokens} out (+${overall.thinkingTokens} thinking = ${overall.billedOutputTokens} billed out)`,
  );
  console.log(
    `Est. Paid Cost: $${overall.estPaidCostWithThinkingUsd.toFixed(5)} (incl. thinking) / $${overall.estPaidCostCandidatesOnlyUsd.toFixed(5)} (candidates only) | Cost/Successful Extraction: ${overall.costPerSuccessfulExtractionUsd !== null ? '$' + overall.costPerSuccessfulExtractionUsd.toFixed(5) : 'n/a'}`,
  );

  console.log(`\nBy Modality:`);
  for (const [m, s] of Object.entries(byModality)) {
    console.log(
      `  ${m.padEnd(8)} e2e ${s.endToEndSuccessCount}/${s.total} (${pct(s.endToEndSuccessRate)}) | field ${pct(s.fieldAccuracyRate)} | finErr ${s.criticalFinancialErrors} | ground ${pct(s.groundingVerifiedRate)} | corr/q ${s.avgAiCorrectionsPerQuote} | lat ${s.avgLatencyNoRetryMs}ms`,
    );
  }

  console.log(`\nBy Difficulty:`);
  for (const [d, s] of Object.entries(byDifficulty)) {
    console.log(
      `  ${d.padEnd(10)} e2e ${s.endToEndSuccessCount}/${s.total} (${pct(s.endToEndSuccessRate)}) | field ${pct(s.fieldAccuracyRate)} | finErr ${s.criticalFinancialErrors} | corr/q ${s.avgAiCorrectionsPerQuote}`,
    );
  }

  // Print failure details
  const failed = results.filter((r) => !r.endToEndPassed || !r.frontendParityPassed);
  if (failed.length > 0) {
    console.log(`\nFailures / Parity Issues (${failed.length}):`);
    for (const f of failed) {
      console.log(`  [${f.id} r${f.repeatIndex}] ${f.apiError ? 'API_ERR: ' + f.apiError.slice(0, 120) : ''}`);
      for (const b of f.releaseBlockers) console.log(`     BLOCKER: ${b}`);
      for (const e of f.failures) console.log(`     FAIL:    ${e}`);
      if (f.frontendParityError) console.log(`     PARITY:  ${f.frontendParityError}`);
    }
  }

  if (outPath) {
    const payload = {
      timestamp: new Date().toISOString(),
      provider,
      requestedModel: model,
      resolvedModelVersion,
      abortedEarly,
      abortReason: abortReason || undefined,
      pricingRatesUsdPerMillion: pricing,
      overall,
      byModality,
      byCategory,
      byDifficulty,
      results,
    };
    writeFileSync(resolve(outPath), JSON.stringify(payload, null, 2), 'utf8');
    console.log(`\nSaved structured benchmark results to ${resolve(outPath)}`);
  }

  if (provider === 'mock' && (overall.endToEndSuccessCount < overall.total || overall.frontendParityRate < 1)) {
    process.exitCode = 1;
  }
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve('scripts/run-model-benchmark.ts');
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
