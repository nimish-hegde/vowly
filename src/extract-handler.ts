import { ExtractionError, extractQuote } from './extractor.ts';
import { createReviewSession, type QuoteReviewSession } from './review.ts';
import type { TelemetryTracker } from './telemetry.ts';
import { validateExtractedQuote } from './validator.ts';

type ExtractOptions = NonNullable<Parameters<typeof extractQuote>[1]>;

export interface ExtractRequest {
  rawMessage: string;
  guestCount: number;
  sessionId: string;
  options: ExtractOptions;
}

export interface ExtractResponse {
  status: number;
  payload: Record<string, unknown>;
  session?: QuoteReviewSession;
}

/**
 * Runs one extraction for the review UI and records telemetry for every
 * outcome, including provider failures, so the success rate is honest.
 */
export async function handleExtractRequest(
  req: ExtractRequest,
  telemetry: TelemetryTracker,
  extract: typeof extractQuote = extractQuote,
): Promise<ExtractResponse> {
  const started = Date.now();
  let result;
  try {
    result = await extract(req.rawMessage, req.options);
  } catch (err) {
    const isExtractionError = err instanceof ExtractionError;
    telemetry.recordExtraction({
      provider: req.options.provider ?? 'unknown',
      model: process.env.GEMINI_MODEL ?? 'unknown',
      success: false,
      latencyMs: isExtractionError ? err.latencyMs : Date.now() - started,
      retryCount: isExtractionError ? err.retryCount : 0,
      unresolvedQuestions: 0,
      errorKind: isExtractionError ? err.kind : 'api_error',
    });
    return {
      status: 502,
      payload: {
        error: err instanceof Error ? err.message : String(err),
        errorKind: isExtractionError ? err.kind : 'api_error',
      },
    };
  }

  const validation = validateExtractedQuote(result.rawResponse, req.rawMessage);
  if (!validation.quote) {
    telemetry.recordExtraction({
      provider: result.provider,
      model: result.resolvedModelVersion ?? result.model,
      success: false,
      latencyMs: result.latencyMs,
      retryCount: result.retryCount,
      tokenUsage: result.tokenUsage,
      unresolvedQuestions: 0,
      errorKind: 'schema_error',
    });
    return {
      status: 422,
      payload: {
        error: 'Extracted quote failed schema validation',
        schemaErrors: validation.schemaErrors,
        sourceErrors: validation.sourceErrors,
      },
    };
  }

  const session = createReviewSession(req.sessionId, validation.quote, {
    guestCount: req.guestCount,
    sourceWarnings: validation.sourceErrors,
  });

  telemetry.recordExtraction({
    quoteId: session.id,
    provider: result.provider,
    model: result.resolvedModelVersion ?? result.model,
    success: true,
    latencyMs: result.latencyMs,
    retryCount: result.retryCount,
    tokenUsage: result.tokenUsage,
    unresolvedQuestions: session.draftQuote.openQuestions.length,
  });

  return {
    status: 200,
    session,
    payload: {
      session,
      meta: {
        provider: result.provider,
        model: result.resolvedModelVersion ?? result.model,
        latencyMs: result.latencyMs,
        tokenUsage: result.tokenUsage,
      },
    },
  };
}
