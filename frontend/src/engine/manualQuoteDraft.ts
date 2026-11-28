import type { Quote, QuoteAttachmentPreview } from '../types/vowly';

export function hasIncompleteManualPricing(quote: Quote): boolean {
  return Boolean(quote.manualEntry && (
    quote.lineItems.length === 0 ||
    quote.lineItems.some((item) => !item.label.trim() || item.manualAmountPending)
  ));
}

export function createManualQuoteDraft(source: {
  sourceType: Quote['sourceType'];
  sourceChannel: string;
  sourceText: string;
  attachmentPreview?: QuoteAttachmentPreview;
}): Quote {
  const now = new Date();
  return {
    ...source,
    id: `q-manual-${now.getTime()}`,
    title: 'Manually entered quote',
    approvalState: 'draft',
    quoteKind: 'personalized',
    receivedDate: now.toISOString().slice(0, 10),
    manualEntry: true,
    currency: 'UNKNOWN',
    currencySource: 'unknown',
    taxHandling: 'unspecified',
    lineItems: [],
    addOns: [],
    unconfirmedFees: [],
    conflicts: [],
    inclusions: [],
    paymentTermsSummary: '',
    clarificationQuestions: [],
    evidenceSpans: [],
  };
}
