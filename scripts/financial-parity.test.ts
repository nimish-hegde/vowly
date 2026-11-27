import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { calculateQuoteTotal } from '../src/calculator.ts';
import { calculateQuoteFinancials } from '../frontend/src/engine/financialCalculator.ts';
import { mapBackendExtractionToFrontendResult } from '../frontend/src/services/quoteExtractor.ts';
import type { BenchmarkCase } from './generate-multimodal-holdout.ts';

const cases: BenchmarkCase[] = JSON.parse(
  readFileSync(new URL('../eval-data/held-out-v3-multimodal/cases.json', import.meta.url), 'utf8'),
);

// Replay the pre-refactor mismatch deliberately only when characterizing b76c67c.
const characterizeBaseline = process.env.VOWLY_FINANCE_BASELINE === '1';

// Frozen financial outputs observed on b76c67c. This catches changes shared by both adapters.
const baselineAllInTotals: Record<string, number> = {
  T01: 18517.88, T02: 12891.04, T03: 17006.50, T04: 3200.00, T05: 1073.50,
  T06: 3800.00, T07: 2034.00, T08: 5198.00, T09: 1400.00, T10: 11865.00,
  I01: 15848.25, I02: 12209.65, I03: 900.00, I04: 3503.00, I05: 10375.66,
  I06: 3400.00, I07: 2090.50, I08: 1600.00, I09: 17600.88, I10: 3616.00,
  P01: 21181.85, P02: 12995.00, P03: 23895.00, P04: 3955.00, P05: 8678.40,
  P06: 6893.00, P07: 2100.00, P08: 3164.00, P09: 19167.63, P10: 3200.00,
};

function importQuote(fixture: BenchmarkCase) {
  const sourceType = fixture.modality === 'image' ? 'screenshot'
    : fixture.modality === 'pdf' ? 'pdf'
    : 'pasted_message';
  return mapBackendExtractionToFrontendResult(
    { session: { draftQuote: fixture.mockExtraction, sourceWarnings: [] } },
    {
      sourceType,
      sourceChannel: 'Offline evaluation fixture',
      rawText: fixture.rawMessage,
      guestCount: fixture.calcContext.guestCount ?? 150,
    },
  ).quote;
}

function backendSummary(calc: ReturnType<typeof calculateQuoteTotal>) {
  return {
    subtotal: calc.knownSubtotal,
    gratuity: calc.gratuityAmount ?? 0,
    tax: calc.taxAmount ?? 0,
    allIn: calc.knownAllInTotal,
    complete: calc.isEstimateComplete,
    packageUnresolved: calc.unresolvedPackageSelection,
    gratuityUnresolved: calc.gratuityUnresolved,
    taxNotStated: calc.taxNotStated,
    negotiatedSavings: calc.negotiatedSavings,
  };
}

function frontendSummary(calc: ReturnType<typeof calculateQuoteFinancials>) {
  return {
    subtotal: calc.preTaxTotal,
    gratuity: calc.gratuityAmount,
    tax: calc.taxAmount,
    allIn: calc.estimatedAllInTotal,
    complete: calc.isEstimateComplete,
    packageUnresolved: calc.unresolvedPackageSelection,
    gratuityUnresolved: calc.gratuityUnresolved,
    taxNotStated: calc.taxNotStated,
    negotiatedSavings: calc.negotiatedSavings,
  };
}

test('replays the complete 30-case frozen multimodal split', () => {
  assert.equal(cases.length, 30);
  assert.deepEqual(cases.map(({ id }) => id).sort(), Object.keys(baselineAllInTotals).sort());
});

for (const fixture of cases) {
  test(`multimodal calculation parity: ${fixture.id}`, () => {
    const { guestCount, hours, selectedPackageName } = fixture.calcContext;
    const selectedPackageId = selectedPackageName
      ? fixture.mockExtraction.packages?.find((pkg) =>
        pkg.name.toLowerCase().includes(selectedPackageName.toLowerCase()),
      )?.id
      : undefined;
    if (selectedPackageName) {
      assert.ok(selectedPackageId, `Missing fixture package: ${selectedPackageName}`);
    }

    const backend = backendSummary(calculateQuoteTotal(fixture.mockExtraction, {
      guestCount, hours, selectedPackageId,
    }));
    const frontend = frontendSummary(calculateQuoteFinancials(
      { ...importQuote(fixture), selectedPackageId },
      [], [], guestCount, hours,
    ));

    assert.equal(backend.subtotal, fixture.expected.expectedSelectedPackageSubtotal ?? fixture.expected.knownSubtotal);
    assert.equal(backend.allIn, baselineAllInTotals[fixture.id]);

    if (characterizeBaseline && fixture.id === 'I04') {
      assert.deepEqual(frontend, { ...backend, subtotal: 3375, tax: 438.75, allIn: 3813.75 });
    } else {
      assert.deepEqual(frontend, backend);
    }
  });
}

test('I04 recalculates quote-wide overtime from the selected tier and requested hours', () => {
  const fixture = cases.find(({ id }) => id === 'I04');
  assert.ok(fixture);
  const quote = importQuote(fixture);

  const scenarios = [
    { tier: 'Full', hours: undefined, subtotal: 3100, tax: 403, allIn: 3503, baselineFrontendSubtotal: 3375 },
    { tier: 'Full', hours: 8, subtotal: 3100, tax: 403, allIn: 3503, baselineFrontendSubtotal: 3375 },
    { tier: 'Full', hours: 9, subtotal: 3375, tax: 438.75, allIn: 3813.75, baselineFrontendSubtotal: 3375 },
    { tier: 'Luxury', hours: 9, subtotal: 4600, tax: 598, allIn: 5198, baselineFrontendSubtotal: 4875 },
    { tier: 'Mini', hours: 5, subtotal: 1775, tax: 230.75, allIn: 2005.75, baselineFrontendSubtotal: 1775 },
  ];

  for (const scenario of scenarios) {
    const selectedPackageId = quote.packages?.find((pkg) => pkg.name.startsWith(scenario.tier))?.id;
    assert.ok(selectedPackageId);
    const backend = backendSummary(calculateQuoteTotal(fixture.mockExtraction, {
      selectedPackageId, hours: scenario.hours,
    }));
    const frontend = frontendSummary(calculateQuoteFinancials(
      { ...quote, selectedPackageId }, [], [], undefined, scenario.hours,
    ));

    assert.equal(backend.subtotal, scenario.subtotal);
    assert.equal(backend.tax, scenario.tax);
    assert.equal(backend.allIn, scenario.allIn);
    assert.equal(backend.complete, true);
    if (characterizeBaseline) {
      assert.equal(frontend.subtotal, scenario.baselineFrontendSubtotal);
    } else {
      assert.deepEqual(frontend, backend);
    }
  }

  const unselectedBackend = backendSummary(calculateQuoteTotal(fixture.mockExtraction, {}));
  const unselectedFrontend = frontendSummary(calculateQuoteFinancials(quote, [], []));
  assert.equal(unselectedBackend.subtotal, 0);
  assert.equal(unselectedFrontend.subtotal, characterizeBaseline ? 275 : 0);
  assert.equal(unselectedFrontend.packageUnresolved, true);
  assert.equal(unselectedFrontend.complete, false);
});

test('guest minimum, incremental overage, staffing ratio, food gratuity and tax compose at a boundary', () => {
  const fixture = cases.find(({ id }) => id === 'T03');
  assert.ok(fixture);
  const quoteWithGuestMinimum: BenchmarkCase = {
    ...fixture,
    mockExtraction: {
      ...fixture.mockExtraction,
      lineItems: [
        ...fixture.mockExtraction.lineItems,
        {
          label: 'Dessert',
          pricingType: 'per_person',
          amount: 5,
          minGuests: 150,
          isFoodItem: true,
          chargeType: 'mandatory',
          sourceExcerpt: 'Dessert: $5 per person, 150 guests minimum.',
        },
      ],
    },
  };
  const quote = importQuote(quoteWithGuestMinimum);
  const scenarios = [
    { guests: 149, subtotal: 12200, gratuity: 1762.50, tax: 1815.13, allIn: 15777.63 },
    { guests: 150, subtotal: 12200, gratuity: 1762.50, tax: 1815.13, allIn: 15777.63 },
    { guests: 151, subtotal: 12490, gratuity: 1772.25, tax: 1854.09, allIn: 16116.34 },
  ];

  for (const { guests, ...expected } of scenarios) {
    const backend = backendSummary(calculateQuoteTotal(quoteWithGuestMinimum.mockExtraction, { guestCount: guests }));
    const frontend = frontendSummary(calculateQuoteFinancials(quote, [], [], guests));
    assert.deepEqual(backend, {
      ...expected, complete: true, packageUnresolved: false, gratuityUnresolved: false,
      taxNotStated: false, negotiatedSavings: 0,
    });
    assert.deepEqual(frontend, backend);
  }
});
