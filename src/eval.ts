import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { calculateQuoteTotal } from './calculator.ts';
import { buildMockMap, extractQuote, type ProviderName } from './extractor.ts';
import type { EvalCase, ExtractedQuote } from './types.ts';

type CaseWithMock = EvalCase & { mockExtraction?: ExtractedQuote };

interface CaseScore {
  id: string;
  split: string;
  passed: boolean;
  failures: string[];
  releaseBlockers: string[];
  latencyMs: number;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function loadCases(splitArg?: string): CaseWithMock[] {
  const files: string[] = [];
  if (!splitArg || splitArg === 'all' || splitArg === 'dev') {
    files.push(resolve('eval-data/dev/cases.json'));
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

function gradeCase(testCase: EvalCase, extracted: ExtractedQuote, latencyMs: number): CaseScore {
  const failures: string[] = [];
  const releaseBlockers: string[] = [];
  const rawNorm = normalize(testCase.rawMessage);

  // 1. Release blocker: every extracted line item and open question must have a matching sourceExcerpt
  for (const item of extracted.lineItems) {
    if (!item.sourceExcerpt || !rawNorm.includes(normalize(item.sourceExcerpt))) {
      releaseBlockers.push(
        `Unsupported line item "${item.label}" — sourceExcerpt not found verbatim in raw message`,
      );
    }
  }

  // 2. Category, currency, and quoteKind
  if (extracted.category !== testCase.expected.category) {
    failures.push(`category: got "${extracted.category}", expected "${testCase.expected.category}"`);
  }
  if (extracted.currency !== testCase.expected.currency) {
    failures.push(`currency: got "${extracted.currency}", expected "${testCase.expected.currency}"`);
  }
  if (extracted.quoteKind !== testCase.expected.quoteKind) {
    failures.push(`quoteKind: got "${extracted.quoteKind}", expected "${testCase.expected.quoteKind}"`);
  }
  if (testCase.expected.taxStatus && extracted.taxStatus !== testCase.expected.taxStatus) {
    failures.push(`taxStatus: got "${extracted.taxStatus}", expected "${testCase.expected.taxStatus}"`);
  }
  if (
    testCase.expected.paymentMethodRule &&
    extracted.paymentTerms?.methodRule !== testCase.expected.paymentMethodRule
  ) {
    failures.push(
      `paymentMethodRule: got "${extracted.paymentTerms?.methodRule}", expected "${testCase.expected.paymentMethodRule}"`,
    );
  }

  // 3. Deterministic math check
  const calc = calculateQuoteTotal(extracted, testCase.calcContext ?? {});
  if (calc.knownSubtotal !== testCase.expected.knownSubtotal) {
    failures.push(
      `knownSubtotal: got ${calc.knownSubtotal}, expected ${testCase.expected.knownSubtotal}`,
    );
  }

  // 4. Unknown items preserved
  const gotUnknowns = calc.unknownItems.map((u) => u.toLowerCase());
  for (const expectedUnknown of testCase.expected.unknownItemLabels) {
    const found = gotUnknowns.some((g) => g.includes(expectedUnknown.toLowerCase()));
    if (!found) {
      failures.push(`missing unknown fee matching "${expectedUnknown}" (got: [${calc.unknownItems.join(', ')}])`);
    }
  }

  // 5. Open questions count
  if (
    testCase.expected.minOpenQuestions !== undefined &&
    extracted.openQuestions.length < testCase.expected.minOpenQuestions
  ) {
    failures.push(
      `openQuestions: got ${extracted.openQuestions.length}, expected at least ${testCase.expected.minOpenQuestions}`,
    );
  }

  return {
    id: testCase.id,
    split: testCase.split,
    passed: failures.length === 0 && releaseBlockers.length === 0,
    failures,
    releaseBlockers,
    latencyMs,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const splitIdx = args.indexOf('--split');
  const splitArg = splitIdx >= 0 ? args[splitIdx + 1] : 'all';
  const providerArg = process.env.EXTRACTOR_PROVIDER as ProviderName | undefined;

  const cases = loadCases(splitArg);
  const mockMap = buildMockMap(cases);

  let usedProvider = '';
  let usedModel = '';
  const scores: CaseScore[] = [];

  for (const c of cases) {
    try {
      const res = await extractQuote(c.rawMessage, {
        provider: providerArg,
        mockLookup: mockMap[c.id],
      });
      usedProvider = res.provider;
      usedModel = res.model;
      scores.push(gradeCase(c, res.quote, res.latencyMs));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      scores.push({
        id: c.id,
        split: c.split,
        passed: false,
        failures: [`Extraction error: ${message}`],
        releaseBlockers: [],
        latencyMs: 0,
      });
    }
  }

  const passedCount = scores.filter((s) => s.passed).length;
  const blockerCount = scores.reduce((sum, s) => sum + s.releaseBlockers.length, 0);
  const avgLatency = Math.round(
    scores.reduce((sum, s) => sum + s.latencyMs, 0) / Math.max(scores.length, 1),
  );

  console.log(`\nVowly Quote Extraction Eval`);
  console.log(`Provider: ${usedProvider} (${usedModel}) | Split: ${splitArg}`);
  console.log(`Passed: ${passedCount}/${scores.length} | Release blockers: ${blockerCount} | Avg latency: ${avgLatency}ms\n`);

  for (const s of scores) {
    const icon = s.passed ? 'PASS' : 'FAIL';
    console.log(`[${icon}] (${s.split}) ${s.id} — ${s.latencyMs}ms`);
    for (const b of s.releaseBlockers) {
      console.log(`   BLOCKER: ${b}`);
    }
    for (const f of s.failures) {
      console.log(`   FAIL:    ${f}`);
    }
  }

  if (passedCount < scores.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
