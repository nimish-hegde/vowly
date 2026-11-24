import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TokenUsage } from './types.ts';

export interface ExtractionMetricEvent {
  type: 'extraction';
  timestamp: string;
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

// Flash-Lite paid estimate ($0.10 / 1M input, $0.40 / 1M output). Free tier is $0.
const INPUT_USD_PER_MILLION = 0.1;
const OUTPUT_USD_PER_MILLION = 0.4;

export function estimateExtractionCostUsd(usage?: TokenUsage): number {
  if (!usage) return 0;
  return (
    (usage.promptTokens * INPUT_USD_PER_MILLION +
      usage.outputTokens * OUTPUT_USD_PER_MILLION) /
    1_000_000
  );
}

export class TelemetryTracker {
  private readonly events: TelemetryEvent[] = [];
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
    this.persist(full);
  }

  recordReviewDecision(event: Omit<ReviewMetricEvent, 'type' | 'timestamp'>): void {
    const full: ReviewMetricEvent = {
      type: 'review_decision',
      timestamp: new Date().toISOString(),
      ...event,
    };
    this.events.push(full);
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
      reviews.length > 0
        ? reviews.reduce((sum, r) => sum + r.unresolvedQuestionsRemaining, 0)
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
