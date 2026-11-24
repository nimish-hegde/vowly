import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { handleExtractRequest } from './extract-handler.ts';
import type { ProviderName } from './extractor.ts';
import {
  acknowledgeSourceWarnings,
  approveQuote,
  correctCurrency,
  correctLineItem,
  createBudgetState,
  dismissQuote,
  getUnresolvedQuestionCount,
  type LineItemPatch,
  type QuoteReviewSession,
  resolveOpenQuestion,
  resolvePriceConflict,
} from './review.ts';
import { TelemetryTracker } from './telemetry.ts';
import type { CurrencyCode, EvalCase, ExtractedQuote } from './types.ts';

type SampleCase = EvalCase & { mockExtraction?: ExtractedQuote };

const PORT = Number(process.env.PORT ?? 3000);
const htmlPage = readFileSync(resolve('ui/index.html'), 'utf8');

function loadSamples(): SampleCase[] {
  const dev = JSON.parse(readFileSync(resolve('eval-data/dev/cases.json'), 'utf8')) as SampleCase[];
  const reg = JSON.parse(
    readFileSync(resolve('eval-data/regression/cases.json'), 'utf8'),
  ) as SampleCase[];
  return [...dev, ...reg];
}

const samples = loadSamples();
const telemetry = new TelemetryTracker(resolve('private-data/telemetry.jsonl'));
const sessions = new Map<string, QuoteReviewSession>();
let budget = createBudgetState();
let nextId = 1;

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(htmlPage);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      sendJson(res, 200, {
        budget,
        telemetry: telemetry.getSummary(),
        samples: samples.map((s) => ({
          id: s.id,
          description: s.description,
          rawMessage: s.rawMessage,
          guestCount: s.calcContext?.guestCount ?? 160,
        })),
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/extract') {
      const body = await readBody(req);
      const rawMessage = String(body.rawMessage ?? '').trim();
      const sampleId = typeof body.sampleId === 'string' ? body.sampleId : undefined;
      const guestCount =
        typeof body.guestCount === 'number' && Number.isFinite(body.guestCount)
          ? body.guestCount
          : 160;

      if (!rawMessage) {
        sendJson(res, 400, { error: 'rawMessage is required' });
        return;
      }

      const sampleMatch = samples.find((s) => s.id === sampleId);
      const provider: ProviderName | undefined = process.env.EXTRACTOR_PROVIDER as
        | ProviderName
        | undefined;

      const sessionId = `quote-${nextId++}`;
      const outcome = await handleExtractRequest(
        {
          rawMessage,
          guestCount,
          sessionId,
          options: {
            provider: provider ?? (process.env.GEMINI_API_KEY ? 'gemini' : 'mock'),
            mockLookup: sampleMatch?.mockExtraction,
          },
        },
        telemetry,
      );
      if (outcome.session) {
        sessions.set(outcome.session.id, outcome.session);
      }
      sendJson(res, outcome.status, {
        ...outcome.payload,
        budget,
        telemetry: telemetry.getSummary(),
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/review/correct') {
      const body = await readBody(req);
      const session = sessions.get(String(body.sessionId ?? ''));
      if (!session) {
        sendJson(res, 404, { error: 'Review session not found' });
        return;
      }
      if (typeof body.currency === 'string') {
        correctCurrency(session, body.currency as CurrencyCode);
      }
      if (typeof body.lineItemIndex === 'number' && typeof body.patch === 'object' && body.patch) {
        correctLineItem(session, body.lineItemIndex, body.patch as LineItemPatch);
      }
      sendJson(res, 200, { session, budget, telemetry: telemetry.getSummary() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/review/resolve-question') {
      const body = await readBody(req);
      const session = sessions.get(String(body.sessionId ?? ''));
      if (!session) {
        sendJson(res, 404, { error: 'Review session not found' });
        return;
      }
      resolveOpenQuestion(
        session,
        Number(body.questionIndex),
        String(body.resolutionNote ?? ''),
      );
      telemetry.updateUnresolvedQuestions(session.id, getUnresolvedQuestionCount(session));
      sendJson(res, 200, { session, budget, telemetry: telemetry.getSummary() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/review/resolve-conflict') {
      const body = await readBody(req);
      const session = sessions.get(String(body.sessionId ?? ''));
      if (!session) {
        sendJson(res, 404, { error: 'Review session not found' });
        return;
      }
      resolvePriceConflict(
        session,
        Number(body.lineItemIndex),
        Number(body.optionIndex),
      );
      sendJson(res, 200, { session, budget, telemetry: telemetry.getSummary() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/review/acknowledge-source') {
      const body = await readBody(req);
      const session = sessions.get(String(body.sessionId ?? ''));
      if (!session) {
        sendJson(res, 404, { error: 'Review session not found' });
        return;
      }
      acknowledgeSourceWarnings(session);
      sendJson(res, 200, { session, budget, telemetry: telemetry.getSummary() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/review/approve') {
      const body = await readBody(req);
      const session = sessions.get(String(body.sessionId ?? ''));
      if (!session) {
        sendJson(res, 404, { error: 'Review session not found' });
        return;
      }
      try {
        budget = approveQuote(session, budget, telemetry);
      } catch (err) {
        sendJson(res, 409, { error: err instanceof Error ? err.message : String(err), session });
        return;
      }
      sendJson(res, 200, { session, budget, telemetry: telemetry.getSummary() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/review/dismiss') {
      const body = await readBody(req);
      const session = sessions.get(String(body.sessionId ?? ''));
      if (!session) {
        sendJson(res, 404, { error: 'Review session not found' });
        return;
      }
      budget = dismissQuote(session, budget, telemetry);
      sendJson(res, 200, { session, budget, telemetry: telemetry.getSummary() });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`Vowly Quote Review UI running at http://localhost:${PORT}`);
});
