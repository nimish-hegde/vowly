import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeLineItemLabel, validateExtractedQuote } from './validator.ts';

const sampleMessage =
  'Maple Event Space (CAD): Deluxe is $60/person. Bartenders are $495 each (up to 150 guests per bartender). Security fee is TBD.';

const validPayload = {
  vendorName: 'Maple Event Space',
  category: 'venue',
  events: ['Reception'],
  quoteKind: 'initial',
  currency: 'CAD',
  taxStatus: 'unknown',
  gratuityStatus: 'unknown',
  lineItems: [
    {
      label: 'Deluxe menu',
      pricingType: 'per_person',
      amount: 60,
      sourceExcerpt: 'Deluxe is $60/person',
    },
    {
      label: 'Bartenders',
      pricingType: 'per_guest_ratio',
      amount: 495,
      ratioGuests: 150,
      sourceExcerpt: 'Bartenders are $495 each (up to 150 guests per bartender)',
    },
    {
      label: 'Security fee',
      pricingType: 'unknown',
      amount: null,
      sourceExcerpt: 'Security fee is TBD',
    },
  ],
  openQuestions: [
    {
      question: 'Confirm security fee',
      reason: 'missing_price',
      sourceExcerpt: 'Security fee is TBD',
    },
  ],
};

test('accepts a valid quote with verbatim source excerpts', () => {
  const res = validateExtractedQuote(validPayload, sampleMessage);
  assert.equal(res.valid, true);
  assert.equal(res.schemaErrors.length, 0);
  assert.equal(res.sourceErrors.length, 0);
});

test('flags missing required openQuestions array as a schema error', () => {
  const { openQuestions: _dropped, ...missingQuestions } = validPayload;
  const res = validateExtractedQuote(missingQuestions, sampleMessage);
  assert.equal(res.valid, false);
  assert.ok(res.schemaErrors.some((e) => e.includes('openQuestions')));
});

test('flags per_guest_ratio line item without ratioGuests', () => {
  const broken = structuredClone(validPayload);
  delete (broken.lineItems[1] as { ratioGuests?: number }).ratioGuests;
  const res = validateExtractedQuote(broken, sampleMessage);
  assert.equal(res.valid, false);
  assert.ok(res.schemaErrors.some((e) => e.includes('ratioGuests')));
});

test('flags fabricated sourceExcerpt on both lineItems and openQuestions', () => {
  const fabricated = structuredClone(validPayload);
  fabricated.lineItems[0]!.sourceExcerpt = 'Invented line not in email';
  fabricated.openQuestions[0]!.sourceExcerpt = 'Made up question source';
  const res = validateExtractedQuote(fabricated, sampleMessage);
  assert.equal(res.valid, false);
  assert.equal(res.sourceErrors.length, 2);
});

test('normalizes equivalent vendor terminology cleanly', () => {
  assert.equal(normalizeLineItemLabel('Audio-visual packages'), 'av packages');
  assert.equal(normalizeLineItemLabel('Audio visual fee'), 'av fee');
  assert.equal(normalizeLineItemLabel('Bartender staffing fee'), 'bartender fee');
  assert.equal(normalizeLineItemLabel('Bar staff'), 'bartender');
});
