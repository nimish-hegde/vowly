import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TokenUsage } from './types.ts';

export interface ExtractionMetricEvent {
  type: 'extraction';
  timestamp: string;
  quoteId?: string;
  provider: string;
  model: string;
  success: boolean;
  latencyMs: number;
  retryCount: number;
  tokenUsage?: TokenUsage;
  unresolvedQuestions: number;
  errorKind?: 'api_error' | 'parse_error' | 'schema_error';
}

export interface ReviewMetricEvent {
  type: 'review_decision';
  timestamp: string;
  quoteId: string;
  decision: 'approved' | 'dismissed';
  correctionsByField: Record<string, number>;
  unresolvedQuestionsRemaining: number;
}

export type TelemetryEvent = ExtractionMetricEvent | ReviewMetricEvent;

export interface TelemetrySummary {
  extractionAttempts: number;
  extractionSuccesses: number;
  extractionSuccessRate: number;
  avgLatencyMs: number;
  totalRetries: number;
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  correctionsByField: Record<string, number>;
  totalCorrections: number;
  unresolvedQuestions: number;
  quotesReviewed: number;
  quotesApproved: number;
  quoteApprovalRate: number;
}

export interface ModelPricingRates {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  note?: string;
}

// Estimated paid-tier rates (USD per 1M tokens). Free tier is $0 actual spend.
export const MODEL_PRICING_USD_PER_MILLION: Record<string, ModelPricingRates> = {
  'gemini-3.5-flash-lite': { inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5 },
  'gemini-flash-lite-latest': { inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5 },
  'gemini-3.8-flash': {
    inputUsdPerMillion: 0.75,
    outputUsdPerMillion: 3.75,
    note: 'promotional pricing',
  },
  'gemini-4-hydrogen': { inputUsdPerMillion: 1.5, outputUsdPerMillion: 7.5 },
  'gemini-4-neon': { inputUsdPerMillion: 3.0, outputUsdPerMillion: 15.0 },
};

const DEFAULT_PRICING: ModelPricingRates = MODEL_PRICING_USD_PER_MILLION['gemini-3.5-flash-lite']!;

export function getModelPricingRates(model?: string): ModelPricingRates {
  if (!model) return DEFAULT_PRICING;
  const norm = model.trim().toLowerCase();
  if (MODEL_PRICING_USD_PER_MILLION[norm]) return MODEL_PRICING_USD_PER_MILLION[norm]!;
  for (const [key, rates] of Object.entries(MODEL_PRICING_USD_PER_MILLION)) {
    if (norm.includes(key)) return rates;
  }
  return DEFAULT_PRICING;
}

export function estimateExtractionCostUsd(usage?: TokenUsage, model?: string): number {
  if (!usage) return 0;
  const rates = getModelPricingRates(model);
  return (
    (usage.promptTokens * rates.inputUsdPerMillion +
      usage.outputTokens * rates.outputUsdPerMillion) /
    1_000_000
  );
}

export class TelemetryTracker {
  private readonly events: TelemetryEvent[] = [];
  private readonly unresolvedByQuote = new Map<string, number>();
  private readonly logFilePath?: string;

  constructor(logFilePath?: string) {
    this.logFilePath = logFilePath;
  }

  recordExtraction(event: Omit<ExtractionMetricEvent, 'type' | 'timestamp'>): void {
    const full: ExtractionMetricEvent = {
      type: 'extraction',
      timestamp: new Date().toISOString(),
      ...event,
    };
    this.events.push(full);
    if (event.quoteId && event.success) {
      this.unresolvedByQuote.set(event.quoteId, event.unresolvedQuestions);
    }
    this.persist(full);
  }

  updateUnresolvedQuestions(quoteId: string, remaining: number): void {
    this.unresolvedByQuote.set(quoteId, Math.max(0, remaining));
  }

  recordReviewDecision(event: Omit<ReviewMetricEvent, 'type' | 'timestamp'>): void {
    const full: ReviewMetricEvent = {
      type: 'review_decision',
      timestamp: new Date().toISOString(),
      ...event,
    };
    this.events.push(full);
    this.unresolvedByQuote.set(event.quoteId, event.unresolvedQuestionsRemaining);
    this.persist(full);
  }

  getSummary(): TelemetrySummary {
    const extractions = this.events.filter(
      (e): e is ExtractionMetricEvent => e.type === 'extraction',
    );
    const reviews = this.events.filter(
      (e): e is ReviewMetricEvent => e.type === 'review_decision',
    );

    const extractionAttempts = extractions.length;
    const extractionSuccesses = extractions.filter((e) => e.success).length;
    const avgLatencyMs =
      extractionAttempts > 0
        ? Math.round(
            extractions.reduce((sum, e) => sum + e.latencyMs, 0) / extractionAttempts,
          )
        : 0;
    const totalRetries = extractions.reduce((sum, e) => sum + e.retryCount, 0);

    const promptTokens = extractions.reduce(
      (sum, e) => sum + (e.tokenUsage?.promptTokens ?? 0),
      0,
    );
    const outputTokens = extractions.reduce(
      (sum, e) => sum + (e.tokenUsage?.outputTokens ?? 0),
      0,
    );
    const totalTokens = promptTokens + outputTokens;
    const estimatedCostUsd = estimateExtractionCostUsd({
      promptTokens,
      outputTokens,
      totalTokens,
    });

    const correctionsByField: Record<string, number> = {};
    let totalCorrections = 0;
    for (const r of reviews) {
      for (const [field, count] of Object.entries(r.correctionsByField)) {
        correctionsByField[field] = (correctionsByField[field] ?? 0) + count;
        totalCorrections += count;
      }
    }

    const unresolvedQuestions =
      this.unresolvedByQuote.size > 0
        ? [...this.unresolvedByQuote.values()].reduce((sum, count) => sum + count, 0)
        : extractions.reduce((sum, e) => sum + e.unresolvedQuestions, 0);

    const quotesReviewed = reviews.length;
    const quotesApproved = reviews.filter((r) => r.decision === 'approved').length;

    return {
      extractionAttempts,
      extractionSuccesses,
      extractionSuccessRate:
        extractionAttempts > 0 ? extractionSuccesses / extractionAttempts : 0,
      avgLatencyMs,
      totalRetries,
      promptTokens,
      outputTokens,
      totalTokens,
      estimatedCostUsd,
      correctionsByField,
      totalCorrections,
      unresolvedQuestions,
      quotesReviewed,
      quotesApproved,
      quoteApprovalRate: quotesReviewed > 0 ? quotesApproved / quotesReviewed : 0,
    };
  }

  private persist(event: TelemetryEvent): void {
    if (!this.logFilePath) return;
    try {
      mkdirSync(dirname(this.logFilePath), { recursive: true });
      appendFileSync(this.logFilePath, `${JSON.stringify(event)}\n`, 'utf8');
    } catch {
      // Telemetry persistence should never break the main flow.
    }
  }
}
