import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { calculateQuoteTotal } from './calculator.ts';
import {
  buildMockMap,
  ExtractionError,
  extractQuote,
  type ProviderName,
} from './extractor.ts';
import type { EvalCase, ExtractedQuote, TokenUsage } from './types.ts';
import { normalizeLineItemLabel, validateExtractedQuote } from './validator.ts';

type CaseWithMock = EvalCase & { mockExtraction?: ExtractedQuote };

interface CaseScore {
  id: string;
  split: string;
  passed: boolean;
  apiError?: string;
  schemaErrors: string[];
  releaseBlockers: string[];
  criticalFinancialError: boolean;
  unsupportedCurrencyAssumption: boolean;
  failures: string[];
  latencyMs: number;
  retryCount: number;
  tokenUsage?: TokenUsage;
}

function loadCases(splitArg?: string): CaseWithMock[] {
  const files: string[] = [];
  if (!splitArg || splitArg === 'all' || splitArg === 'dev') {
    files.push(resolve('eval-data/dev/cases.json'));
  }
  if (!splitArg || splitArg === 'all' || splitArg === 'regression') {
    files.push(resolve('eval-data/regression/cases.json'));
  }
  if (!splitArg || splitArg === 'all' || splitArg === 'held-out') {
    files.push(resolve('eval-data/held-out/cases.json'));
  }

  const all: CaseWithMock[] = [];
  for (const file of files) {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as CaseWithMock[];
    all.push(...parsed);
  }
  return all;
}

export function gradeExtraction(
  testCase: EvalCase,
  rawResponse: unknown,
  latencyMs: number,
  retryCount: number,
  tokenUsage?: TokenUsage,
): CaseScore {
  const validation = validateExtractedQuote(rawResponse, testCase.rawMessage);
  const schemaErrors = [...validation.schemaErrors];
  const releaseBlockers = [...validation.sourceErrors];
  const failures: string[] = [];
  let criticalFinancialError = false;
  let unsupportedCurrencyAssumption = false;

  if (!validation.quote) {
    return {
      id: testCase.id,
      split: testCase.split,
      passed: false,
      schemaErrors,
      releaseBlockers,
      criticalFinancialError: true,
      unsupportedCurrencyAssumption: false,
      failures: ['Skipped financial grading because response failed schema validation'],
      latencyMs,
      retryCount,
      tokenUsage,
    };
  }

  const extracted = validation.quote;

  // Currency check — assuming CAD/USD when currency is unstated is a release blocker
  if (extracted.currency !== testCase.expected.currency) {
    if (testCase.expected.currency === 'UNKNOWN') {
      unsupportedCurrencyAssumption = true;
      releaseBlockers.push(
        `Unsupported currency assumption: got "${extracted.currency}", expected "UNKNOWN"`,
      );
    } else {
      failures.push(`currency: got "${extracted.currency}", expected "${testCase.expected.currency}"`);
    }
  }

  // Category, quoteKind, taxStatus, paymentMethodRule
  if (extracted.category !== testCase.expected.category) {
    failures.push(`category: got "${extracted.category}", expected "${testCase.expected.category}"`);
  }
  if (extracted.quoteKind !== testCase.expected.quoteKind) {
    failures.push(
      `quoteKind: got "${extracted.quoteKind}", expected "${testCase.expected.quoteKind}"`,
    );
  }
  if (testCase.expected.taxStatus && extracted.taxStatus !== testCase.expected.taxStatus) {
    failures.push(
      `taxStatus: got "${extracted.taxStatus}", expected "${testCase.expected.taxStatus}"`,
    );
  }
  if (
    testCase.expected.paymentMethodRule &&
    extracted.paymentTerms?.methodRule !== testCase.expected.paymentMethodRule
  ) {
    failures.push(
      `paymentMethodRule: got "${extracted.paymentTerms?.methodRule}", expected "${testCase.expected.paymentMethodRule}"`,
    );
  }

  // Deterministic math check
  const calc = calculateQuoteTotal(extracted, testCase.calcContext ?? {});
  if (calc.knownSubtotal !== testCase.expected.knownSubtotal) {
    criticalFinancialError = true;
    releaseBlockers.push(
      `Critical financial error: knownSubtotal got ${calc.knownSubtotal}, expected ${testCase.expected.knownSubtotal}`,
    );
  }

  // Unknown items preserved (using equivalent vendor term normalization)
  const gotUnknowns = calc.unknownItems.map(normalizeLineItemLabel);
  for (const expectedUnknown of testCase.expected.unknownItemLabels) {
    const target = normalizeLineItemLabel(expectedUnknown);
    const found = gotUnknowns.some((g) => g.includes(target));
    if (!found) {
      failures.push(
        `missing unknown fee matching "${expectedUnknown}" (got: [${calc.unknownItems.join(', ')}])`,
      );
    }
  }

  // Open questions check
  if (
    testCase.expected.minOpenQuestions !== undefined &&
    extracted.openQuestions.length < testCase.expected.minOpenQuestions
  ) {
    failures.push(
      `openQuestions: got ${extracted.openQuestions.length}, expected at least ${testCase.expected.minOpenQuestions}`,
    );
  }

  const passed =
    schemaErrors.length === 0 && releaseBlockers.length === 0 && failures.length === 0;

  return {
    id: testCase.id,
    split: testCase.split,
    passed,
    schemaErrors,
    releaseBlockers,
    criticalFinancialError,
    unsupportedCurrencyAssumption,
    failures,
    latencyMs,
    retryCount,
    tokenUsage,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const splitIdx = args.indexOf('--split');
  const splitArg = splitIdx >= 0 ? args[splitIdx + 1] : 'all';
  const delayIdx = args.indexOf('--delay-ms');
  const explicitDelayMs = delayIdx >= 0 ? Number(args[delayIdx + 1]) : undefined;

  const providerArg = process.env.EXTRACTOR_PROVIDER as ProviderName | undefined;
  const effectiveProvider =
    providerArg ?? (process.env.GEMINI_API_KEY ? 'gemini' : 'mock');
  const delayMs =
    explicitDelayMs ?? (effectiveProvider === 'gemini' ? 1500 : 0);

  const cases = loadCases(splitArg);
  const mockMap = buildMockMap(cases);

  let usedProvider: string = effectiveProvider;
  let usedModel = '';
  let resolvedModelVersion = '';
  const scores: CaseScore[] = [];

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]!;
    if (i > 0 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }

    try {
      const res = await extractQuote(c.rawMessage, {
        provider: providerArg,
        mockLookup: mockMap[c.id],
      });
      usedProvider = res.provider;
      usedModel = res.model;
      resolvedModelVersion = res.resolvedModelVersion ?? res.model;
      scores.push(
        gradeExtraction(c, res.rawResponse, res.latencyMs, res.retryCount, res.tokenUsage),
      );
    } catch (err) {
      const isKnown = err instanceof ExtractionError;
      scores.push({
        id: c.id,
        split: c.split,
        passed: false,
        apiError: err instanceof Error ? err.message : String(err),
        schemaErrors: [],
        releaseBlockers: [],
        criticalFinancialError: false,
        unsupportedCurrencyAssumption: false,
        failures: [],
        latencyMs: isKnown ? err.latencyMs : 0,
        retryCount: isKnown ? err.retryCount : 0,
      });
    }
  }

  const total = scores.length;
  const apiErrors = scores.filter((s) => s.apiError !== undefined).length;
  const completed = total - apiErrors;
  const schemaCompliant = scores.filter((s) => !s.apiError && s.schemaErrors.length === 0).length;
  const passedCount = scores.filter((s) => s.passed).length;
  const financialErrors = scores.filter((s) => s.criticalFinancialError).length;
  const currencyGuesses = scores.filter((s) => s.unsupportedCurrencyAssumption).length;
  const blockerCount = scores.reduce((sum, s) => sum + s.releaseBlockers.length, 0);
  const totalRetries = scores.reduce((sum, s) => sum + s.retryCount, 0);
  const avgLatency = Math.round(
    scores.reduce((sum, s) => sum + s.latencyMs, 0) / Math.max(total, 1),
  );
  const promptTokens = scores.reduce((sum, s) => sum + (s.tokenUsage?.promptTokens ?? 0), 0);
  const outputTokens = scores.reduce((sum, s) => sum + (s.tokenUsage?.outputTokens ?? 0), 0);

  const accuracyPct = total > 0 ? ((passedCount / total) * 100).toFixed(1) : '0.0';
  const availPct = total > 0 ? ((completed / total) * 100).toFixed(1) : '0.0';
  const schemaPct = completed > 0 ? ((schemaCompliant / completed) * 100).toFixed(1) : '0.0';

  console.log(`\nVowly Quote Extraction Eval`);
  console.log(
    `Provider: ${usedProvider} | Configured model: ${usedModel || 'n/a'} | Resolved: ${resolvedModelVersion || 'n/a'}`,
  );
  console.log(`Split: ${splitArg} (${total} cases)`);
  console.log(`Passed: ${passedCount}/${total} (${accuracyPct}%)`);
  console.log(
    `API availability: ${completed}/${total} (${availPct}%) | Schema valid: ${schemaCompliant}/${completed} (${schemaPct}%)`,
  );
  console.log(
    `Critical financial errors: ${financialErrors} | Unsupported currency guesses: ${currencyGuesses} | Release blockers: ${blockerCount}`,
  );
  console.log(`Avg latency: ${avgLatency}ms | Total retries: ${totalRetries}`);
  if (promptTokens > 0 || outputTokens > 0) {
    // Rough Flash-Lite paid estimate ($0.10 / 1M input, $0.40 / 1M output); free tier is $0.
    const estPaidUsd = (promptTokens * 0.1 + outputTokens * 0.4) / 1_000_000;
    console.log(
      `Tokens: ${promptTokens} in / ${outputTokens} out | Est. paid cost: $${estPaidUsd.toFixed(5)} ($0 on Gemini free tier)`,
    );
  }
  console.log('');

  for (const s of scores) {
    const tag = s.apiError ? 'API_ERR' : s.passed ? 'PASS' : 'FAIL';
    const retryNote = s.retryCount > 0 ? ` (${s.retryCount} retries)` : '';
    console.log(`[${tag}] (${s.split}) ${s.id} — ${s.latencyMs}ms${retryNote}`);
    if (s.apiError) {
      console.log(`   API ERROR: ${s.apiError}`);
    }
    for (const se of s.schemaErrors) {
      console.log(`   SCHEMA:    ${se}`);
    }
    for (const b of s.releaseBlockers) {
      console.log(`   BLOCKER:   ${b}`);
    }
    for (const f of s.failures) {
      console.log(`   FAIL:      ${f}`);
    }
  }

  if (passedCount < total) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve('src/eval.ts');
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
