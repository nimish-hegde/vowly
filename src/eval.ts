import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { calculateQuoteTotal } from './calculator.ts';
import {
  buildMockMap,
  ExtractionError,
  extractQuote,
  type ProviderName,
} from './extractor.ts';
import { estimateExtractionCostUsd, TelemetryTracker } from './telemetry.ts';
import type { EvalCase, ExtractedQuote, TokenUsage, VendorCategory } from './types.ts';
import { normalizeLineItemLabel, validateExtractedQuote } from './validator.ts';

type CaseWithMock = EvalCase & { mockExtraction?: ExtractedQuote };

export interface CaseScore {
  id: string;
  split: string;
  category: VendorCategory;
  passed: boolean;
  apiError?: string;
  parseError?: string;
  schemaErrors: string[];
  releaseBlockers: string[];
  criticalFinancialError: boolean;
  unsupportedCurrencyAssumption: boolean;
  failures: string[];
  latencyMs: number;
  latencyWithoutRetriesMs: number;
  retryCount: number;
  tokenUsage?: TokenUsage;
  rawResponse?: unknown;
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
  if (!splitArg || splitArg === 'all' || splitArg === 'held-out-v2') {
    files.push(resolve('eval-data/held-out-v2/cases.json'));
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
  latencyWithoutRetriesMs?: number,
): CaseScore {
  const validation = validateExtractedQuote(rawResponse, testCase.rawMessage);
  const schemaErrors = [...validation.schemaErrors];
  const releaseBlockers = [...validation.sourceErrors];
  const failures: string[] = [];
  let criticalFinancialError = false;
  let unsupportedCurrencyAssumption = false;
  const noRetryLatency = latencyWithoutRetriesMs ?? latencyMs;

  if (!validation.quote) {
    return {
      id: testCase.id,
      split: testCase.split,
      category: testCase.expected.category,
      passed: false,
      schemaErrors,
      releaseBlockers,
      criticalFinancialError: false,
      unsupportedCurrencyAssumption: false,
      failures: ['Skipped financial grading because response failed schema validation'],
      latencyMs,
      latencyWithoutRetriesMs: noRetryLatency,
      retryCount,
      tokenUsage,
      rawResponse,
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

  // Price conflict discrepancy check (when the case has conflicting prices for the same service)
  if (testCase.expected.expectedPriceConflictDiscrepancy !== undefined) {
    const expectedDiff = testCase.expected.expectedPriceConflictDiscrepancy;
    if (calc.priceConflicts.length === 0) {
      releaseBlockers.push(
        `Undetected unresolved price conflict (expected discrepancy ${expectedDiff}): quote would be approvable without conflict resolution`,
      );
    } else if (!calc.priceConflicts.some((c) => c.discrepancy === expectedDiff)) {
      const gotDiffs = calc.priceConflicts.map((c) => c.discrepancy).join(', ');
      failures.push(
        `priceConflict discrepancy: expected ${expectedDiff}, got [${gotDiffs || 'none'}]`,
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
    category: testCase.expected.category,
    passed,
    schemaErrors,
    releaseBlockers,
    criticalFinancialError,
    unsupportedCurrencyAssumption,
    failures,
    latencyMs,
    latencyWithoutRetriesMs: noRetryLatency,
    retryCount,
    tokenUsage,
    rawResponse,
  };
}

export function scoreExtractionError(testCase: EvalCase, err: unknown): CaseScore {
  const isKnown = err instanceof ExtractionError;
  const message = err instanceof Error ? err.message : String(err);

  if (isKnown && err.kind === 'parse_error') {
    return {
      id: testCase.id,
      split: testCase.split,
      category: testCase.expected.category,
      passed: false,
      parseError: message,
      schemaErrors: [`Parse error: ${message}`],
      releaseBlockers: [],
      criticalFinancialError: false,
      unsupportedCurrencyAssumption: false,
      failures: [],
      latencyMs: err.latencyMs,
      latencyWithoutRetriesMs: err.latencyWithoutRetriesMs,
      retryCount: err.retryCount,
    };
  }

  return {
    id: testCase.id,
    split: testCase.split,
    category: testCase.expected.category,
    passed: false,
    apiError: message,
    schemaErrors: [],
    releaseBlockers: [],
    criticalFinancialError: false,
    unsupportedCurrencyAssumption: false,
    failures: [],
    latencyMs: isKnown ? err.latencyMs : 0,
    latencyWithoutRetriesMs: isKnown ? err.latencyWithoutRetriesMs : 0,
    retryCount: isKnown ? err.retryCount : 0,
  };
}

export function summarizeScores(scores: CaseScore[]) {
  const total = scores.length;
  const apiErrors = scores.filter((s) => s.apiError !== undefined).length;
  const parseErrors = scores.filter((s) => s.parseError !== undefined).length;
  const completedScores = scores.filter((s) => s.apiError === undefined);
  const completed = completedScores.length;
  const schemaCompliant = scores.filter(
    (s) => s.apiError === undefined && s.parseError === undefined && s.schemaErrors.length === 0,
  ).length;
  const passedCount = scores.filter((s) => s.passed).length;
  const financialErrors = scores.filter((s) => s.criticalFinancialError).length;
  const currencyGuesses = scores.filter((s) => s.unsupportedCurrencyAssumption).length;
  const blockerCount = scores.reduce((sum, s) => sum + s.releaseBlockers.length, 0);
  const totalRetries = scores.reduce((sum, s) => sum + s.retryCount, 0);
  const avgLatency = Math.round(
    scores.reduce((sum, s) => sum + s.latencyMs, 0) / Math.max(total, 1),
  );
  const noRetryPool = completedScores.length > 0 ? completedScores : scores;
  const avgLatencyWithoutRetries = Math.round(
    noRetryPool.reduce((sum, s) => sum + s.latencyWithoutRetriesMs, 0) /
      Math.max(noRetryPool.length, 1),
  );
  const apiAvailabilityRate = total > 0 ? completed / total : 0;
  const schemaValidityRate = completed > 0 ? schemaCompliant / completed : 0;
  const extractionAccuracyRate = completed > 0 ? passedCount / completed : 0;
  const endToEndSuccessRate = total > 0 ? passedCount / total : 0;
  const promptTokens = scores.reduce((sum, s) => sum + (s.tokenUsage?.promptTokens ?? 0), 0);
  const outputTokens = scores.reduce((sum, s) => sum + (s.tokenUsage?.outputTokens ?? 0), 0);
  const estPaidCostUsd = estimateExtractionCostUsd({
    promptTokens,
    outputTokens,
    totalTokens: promptTokens + outputTokens,
  });

  return {
    total,
    apiErrors,
    parseErrors,
    completed,
    schemaCompliant,
    passedCount,
    financialErrors,
    currencyGuesses,
    blockerCount,
    totalRetries,
    avgLatency,
    avgLatencyWithoutRetries,
    apiAvailabilityRate,
    schemaValidityRate,
    extractionAccuracyRate,
    endToEndSuccessRate,
    promptTokens,
    outputTokens,
    estPaidCostUsd,
  };
}

export function summarizeByGroup(
  scores: CaseScore[],
  keyFn: (score: CaseScore) => string,
): Record<string, ReturnType<typeof summarizeScores>> {
  const grouped = new Map<string, CaseScore[]>();
  for (const score of scores) {
    const key = keyFn(score);
    const list = grouped.get(key) ?? [];
    list.push(score);
    grouped.set(key, list);
  }
  const result: Record<string, ReturnType<typeof summarizeScores>> = {};
  for (const [key, list] of grouped.entries()) {
    result[key] = summarizeScores(list);
  }
  return result;
}

const VALID_SPLITS = new Set(['all', 'dev', 'regression', 'held-out', 'held-out-v2']);
const VALID_PROVIDERS = new Set<ProviderName>(['mock', 'ollama', 'gemini']);

export interface ParsedEvalArgs {
  split: string;
  provider?: ProviderName;
  delayMs?: number;
  showRaw: boolean;
}

export function parseEvalArgs(argv: string[]): ParsedEvalArgs {
  let split = 'all';
  let provider: ProviderName | undefined;
  let delayMs: number | undefined;
  let showRaw = false;

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]!;
    const eqIdx = raw.indexOf('=');
    const flag = eqIdx >= 0 ? raw.slice(0, eqIdx) : raw;
    const inlineVal = eqIdx >= 0 ? raw.slice(eqIdx + 1) : undefined;

    const readValue = (): string => {
      if (inlineVal !== undefined) return inlineVal;
      const next = argv[++i];
      if (!next || next.startsWith('--')) {
        throw new Error(`Missing value for CLI option ${flag}`);
      }
      return next;
    };

    if (flag === '--split') {
      const val = readValue();
      if (!VALID_SPLITS.has(val)) {
        throw new Error(
          `Unsupported --split "${val}". Expected one of: ${[...VALID_SPLITS].join(', ')}`,
        );
      }
      split = val;
    } else if (flag === '--provider') {
      const val = readValue() as ProviderName;
      if (!VALID_PROVIDERS.has(val)) {
        throw new Error(
          `Unsupported --provider "${val}". Expected one of: ${[...VALID_PROVIDERS].join(', ')}`,
        );
      }
      provider = val;
    } else if (flag === '--delay-ms') {
      const val = Number(readValue());
      if (!Number.isFinite(val) || val < 0) {
        throw new Error(`Invalid --delay-ms value. Expected a non-negative number.`);
      }
      delayMs = val;
    } else if (flag === '--show-raw') {
      if (inlineVal !== undefined) {
        throw new Error(`Flag --show-raw does not take a value.`);
      }
      showRaw = true;
    } else {
      throw new Error(
        `Unsupported CLI argument "${raw}". Supported flags: --split, --provider, --delay-ms, --show-raw`,
      );
    }
  }

  return { split, provider, delayMs, showRaw };
}

export function resolveEvalProvider(
  cliProvider: ProviderName | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ProviderName {
  const envProviderRaw = env.EXTRACTOR_PROVIDER;
  if (envProviderRaw !== undefined && envProviderRaw !== '') {
    if (!VALID_PROVIDERS.has(envProviderRaw as ProviderName)) {
      throw new Error(
        `Unsupported EXTRACTOR_PROVIDER "${envProviderRaw}". Expected one of: ${[...VALID_PROVIDERS].join(', ')}`,
      );
    }
  }

  const chosen =
    cliProvider ??
    (envProviderRaw ? (envProviderRaw as ProviderName) : undefined) ??
    (env.GEMINI_API_KEY ? 'gemini' : 'mock');

  if (chosen === 'gemini' && !env.GEMINI_API_KEY) {
    throw new Error(
      'Provider "gemini" was explicitly requested, but GEMINI_API_KEY is not set. Refusing to fall back to mock.',
    );
  }

  return chosen;
}

async function main() {
  const parsedArgs = parseEvalArgs(process.argv.slice(2));
  const splitArg = parsedArgs.split;
  const effectiveProvider = resolveEvalProvider(parsedArgs.provider);
  const delayMs =
    parsedArgs.delayMs ?? (effectiveProvider === 'gemini' ? 1500 : 0);
  const showRaw = parsedArgs.showRaw;

  const cases = loadCases(splitArg);
  const mockMap = buildMockMap(cases);

  let usedProvider: string = effectiveProvider;
  let usedModel = '';
  let resolvedModelVersion = '';
  const scores: CaseScore[] = [];
  const telemetry = new TelemetryTracker();

  console.log(`\nRunning Vowly eval (${splitArg}, ${cases.length} cases, provider=${effectiveProvider})...`);

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]!;
    if (i > 0 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }

    process.stdout.write(`  [${i + 1}/${cases.length}] ${c.id}... `);

    try {
      const res = await extractQuote(c.rawMessage, {
        provider: effectiveProvider,
        mockLookup: mockMap[c.id],
        onRetry: (info) => {
          const secs = Math.round(info.delayMs / 1000);
          console.log(
            `\n      retrying (${info.attempt}/${info.maxRetries} after ${info.reason}, waiting ${secs}s)...`,
          );
          process.stdout.write(`      resuming ${c.id}... `);
        },
      });
      usedProvider = res.provider;
      usedModel = res.model;
      resolvedModelVersion = res.resolvedModelVersion ?? res.model;

      const score = gradeExtraction(
        c,
        res.rawResponse,
        res.latencyMs,
        res.retryCount,
        res.tokenUsage,
        res.latencyWithoutRetriesMs,
      );
      scores.push(score);

      const extracted = res.rawResponse as Partial<ExtractedQuote> | null;
      telemetry.recordExtraction({
        provider: res.provider,
        model: resolvedModelVersion,
        success: score.schemaErrors.length === 0,
        latencyMs: res.latencyMs,
        retryCount: res.retryCount,
        tokenUsage: res.tokenUsage,
        unresolvedQuestions: Array.isArray(extracted?.openQuestions)
          ? extracted.openQuestions.length
          : 0,
        errorKind: score.schemaErrors.length > 0 ? 'schema_error' : undefined,
      });

      const status = score.passed ? 'PASS' : 'FAIL';
      const retryNote =
        score.retryCount > 0
          ? `, ${score.retryCount} retries, ${score.latencyWithoutRetriesMs}ms excl. retries`
          : '';
      console.log(`${status} (${score.latencyMs}ms${retryNote})`);
    } catch (err) {
      const score = scoreExtractionError(c, err);
      scores.push(score);
      telemetry.recordExtraction({
        provider: usedProvider,
        model: resolvedModelVersion || usedModel || 'unknown',
        success: false,
        latencyMs: score.latencyMs,
        retryCount: score.retryCount,
        unresolvedQuestions: 0,
        errorKind: score.parseError ? 'parse_error' : 'api_error',
      });
      const tag = score.parseError ? 'PARSE_ERR' : 'API_ERR';
      console.log(`${tag} (${score.latencyMs}ms)`);
    }
  }

  const summary = summarizeScores(scores);
  const telSummary = telemetry.getSummary();
  const fmtPct = (rate: number) => `${(rate * 100).toFixed(1)}%`;

  console.log(`\nVowly Quote Extraction Eval`);
  console.log(
    `Provider: ${usedProvider} | Configured model: ${usedModel || 'n/a'} | Resolved: ${resolvedModelVersion || 'n/a'}`,
  );
  console.log(`Split: ${splitArg} (${summary.total} cases)`);
  console.log(
    `End-to-end success: ${summary.passedCount}/${summary.total} (${fmtPct(summary.endToEndSuccessRate)}) | Extraction accuracy (completed): ${summary.passedCount}/${summary.completed} (${fmtPct(summary.extractionAccuracyRate)})`,
  );
  console.log(
    `API availability: ${summary.completed}/${summary.total} (${fmtPct(summary.apiAvailabilityRate)}) | Schema validity: ${summary.schemaCompliant}/${summary.completed} (${fmtPct(summary.schemaValidityRate)}) | Parse errors: ${summary.parseErrors}`,
  );
  console.log(
    `Unresolved questions extracted: ${telSummary.unresolvedQuestions}`,
  );
  console.log(
    `Critical financial errors: ${summary.financialErrors} | Unsupported currency guesses: ${summary.currencyGuesses} | Release blockers: ${summary.blockerCount}`,
  );
  console.log(
    `Avg latency (incl. retries): ${summary.avgLatency}ms | Avg latency (excl. retries): ${summary.avgLatencyWithoutRetries}ms | Total retries: ${summary.totalRetries}`,
  );
  if (summary.promptTokens > 0 || summary.outputTokens > 0) {
    console.log(
      `Tokens: ${summary.promptTokens} in / ${summary.outputTokens} out | Est. paid cost: $${summary.estPaidCostUsd.toFixed(5)} ($0 on Gemini free tier)`,
    );
  }

  const printBreakdown = (
    heading: string,
    groups: Record<string, ReturnType<typeof summarizeScores>>,
  ) => {
    console.log(`\n${heading}`);
    for (const [label, g] of Object.entries(groups)) {
      const costStr =
        g.promptTokens > 0 || g.outputTokens > 0 ? ` | cost $${g.estPaidCostUsd.toFixed(5)}` : '';
      console.log(
        `  ${label.padEnd(14)} e2e ${g.passedCount}/${g.total} (${fmtPct(g.endToEndSuccessRate)}) | acc ${g.passedCount}/${g.completed} (${fmtPct(g.extractionAccuracyRate)}) | avail ${g.completed}/${g.total} | schema ${g.schemaCompliant}/${g.completed} (${fmtPct(g.schemaValidityRate)}) | finErr ${g.financialErrors} | blockers ${g.blockerCount} | lat ${g.avgLatency}ms (no-retry ${g.avgLatencyWithoutRetries}ms) | retries ${g.totalRetries}${costStr}`,
      );
    }
  };

  const bySplit = summarizeByGroup(scores, (s) => s.split);
  if (Object.keys(bySplit).length > 1) {
    printBreakdown('By split:', bySplit);
  }
  const byCategory = summarizeByGroup(scores, (s) => s.category);
  printBreakdown('By vendor category:', byCategory);
  console.log('');

  for (const s of scores) {
    if (s.passed) continue;
    const tag = s.apiError ? 'API_ERR' : s.parseError ? 'PARSE_ERR' : 'FAIL';
    const retryNote = s.retryCount > 0 ? ` (${s.retryCount} retries)` : '';
    console.log(
      `[${tag}] (${s.split}) ${s.id} — ${s.latencyMs}ms (no-retry ${s.latencyWithoutRetriesMs}ms)${retryNote}`,
    );
    if (s.apiError) {
      console.log(`   API ERROR:   ${s.apiError}`);
    }
    if (s.parseError) {
      console.log(`   PARSE ERROR: ${s.parseError}`);
    }
    for (const se of s.schemaErrors) {
      console.log(`   SCHEMA:      ${se}`);
    }
    for (const b of s.releaseBlockers) {
      console.log(`   BLOCKER:     ${b}`);
    }
    for (const f of s.failures) {
      console.log(`   FAIL:        ${f}`);
    }
    if (showRaw && s.rawResponse !== undefined) {
      console.log(`   RAW OUTPUT:  ${JSON.stringify(s.rawResponse)}`);
    }
  }

  if (summary.passedCount < summary.total) {
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
