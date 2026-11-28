import { randomBytes } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import type { PilotAuth } from './pilot-auth.ts';

const FLOW_COOKIE = '__Host-vowly-pilot-flow';
const SESSION_COOKIE = '__Host-vowly-pilot-session';
const FLOW_SECONDS = 300;
const SESSION_SECONDS = 1800;
const MAX_PENDING = 40;
const MAX_SESSIONS = 40;
const MAX_STARTS_PER_MINUTE = 30;

function cookie(name: string, value: string, maxAge: number) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function sendPage(res: ServerResponse, status: number, text: string, action: 'login' | 'logout') {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  const label = action === 'login' ? 'Sign in with Google' : 'Sign out';
  res.end(`<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vowly private pilot</title><style>
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #faf8f4;
color: #22201d; font: 16px system-ui, sans-serif; }
main { width: min(32rem, 82vw); } h1 { font: 2.75rem Georgia, serif; }
button { padding: .75rem 1rem; border: 0; border-radius: .5rem; background: #395344;
color: white; font: inherit; cursor: pointer; }
button:focus-visible { outline: 3px solid #22201d; outline-offset: 3px; }
</style><main><h1>Vowly private pilot</h1><p>${text}</p>
<form method="post" action="/auth/${action}"><button>${label}</button></form></main></html>`);
}

function redirect(res: ServerResponse, location: string) {
  res.writeHead(303, { Location: location });
  res.end();
}

export function createPilotServer(origin: string, supabaseOrigin: string, auth: PilotAuth) {
  const flows = new Map<string, { exchange: Awaited<ReturnType<PilotAuth['begin']>>['exchange']; expiresAt: number }>();
  const sessions = new Map<string, { accessToken: string; expiresAt: number }>();
  let startWindow = 0;
  let starts = 0;

  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${supabaseOrigin} https://accounts.google.com; frame-ancestors 'none'; base-uri 'none'`);
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');

    try {
      const url = new URL(req.url ?? '/', origin);
      if (url.origin !== origin) {
        res.writeHead(404).end();
        return;
      }
      const cookies = new Map((req.headers.cookie ?? '').split(';').map((part) => {
        const [name, value] = part.trim().split('=', 2);
        return [name, value];
      }));
      const sessionId = cookies.get(SESSION_COOKIE) ?? '';
      const flowId = cookies.get(FLOW_COOKIE) ?? '';
      const now = Date.now();
      for (const [id, flow] of flows) if (flow.expiresAt <= now) flows.delete(id);
      for (const [id, session] of sessions) if (session.expiresAt <= now) sessions.delete(id);
      const session = sessions.get(sessionId);

      if (req.method === 'GET' && url.pathname === '/') {
        const allowed = session && await auth.isAllowed(session.accessToken) &&
          sessions.get(sessionId) === session && session.expiresAt > Date.now();
        if (allowed) {
          sendPage(res, 200, 'You are signed in as an approved tester.', 'logout');
        } else {
          if (sessionId) {
            sessions.delete(sessionId);
            res.setHeader('Set-Cookie', cookie(SESSION_COOKIE, '', 0));
          }
          sendPage(res, 200, 'Sign in with your approved tester account.', 'login');
        }
        return;
      }

      if (req.method === 'POST' && (url.pathname === '/auth/login' || url.pathname === '/auth/logout')) {
        if (req.headers.origin !== origin) {
          res.writeHead(403).end();
          return;
        }
        if (url.pathname === '/auth/logout') {
          sessions.delete(sessionId);
          flows.delete(flowId);
          res.setHeader('Set-Cookie', [cookie(SESSION_COOKIE, '', 0), cookie(FLOW_COOKIE, '', 0)]);
          if (session) {
            try { await auth.signOut(session.accessToken); } catch { /* Local session is already closed. */ }
          }
          redirect(res, '/');
          return;
        }
        if (now - startWindow >= 60_000) {
          startWindow = now;
          starts = 0;
        }
        if (starts >= MAX_STARTS_PER_MINUTE || flows.size >= MAX_PENDING) {
          res.setHeader('Retry-After', '60');
          sendPage(res, 429, 'Too many sign-in attempts. Try again shortly.', 'login');
          return;
        }
        starts++;
        flows.delete(flowId);
        const pending = await auth.begin(`${origin}/auth/callback`);
        const destination = new URL(pending.url);
        if (destination.origin !== supabaseOrigin || destination.pathname !== '/auth/v1/authorize') {
          throw new Error('Unexpected OAuth destination');
        }
        const id = randomBytes(32).toString('base64url');
        flows.set(id, { exchange: pending.exchange, expiresAt: now + FLOW_SECONDS * 1000 });
        res.setHeader('Set-Cookie', cookie(FLOW_COOKIE, id, FLOW_SECONDS));
        redirect(res, destination.href);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/auth/callback') {
        res.setHeader('Referrer-Policy', 'no-referrer');
        const flow = flows.get(flowId);
        flows.delete(flowId);
        res.setHeader('Set-Cookie', cookie(FLOW_COOKIE, '', 0));
        const code = url.searchParams.get('code');
        if (!flow || !code || url.searchParams.has('error')) {
          sendPage(res, 403, 'This sign-in could not be completed. Start again.', 'login');
          return;
        }
        const verified = await flow.exchange(code);
        if (!verified || verified.expiresAt <= Date.now() || !await auth.isAllowed(verified.accessToken)) {
          sendPage(res, 403, 'This account could not be signed in to the pilot.', 'login');
          return;
        }
        if (sessions.size >= MAX_SESSIONS && !session) {
          sendPage(res, 503, 'The pilot is at its sign-in limit. Try again shortly.', 'login');
          return;
        }
        sessions.delete(sessionId);
        const id = randomBytes(32).toString('base64url');
        const expiresAt = Math.min(verified.expiresAt, Date.now() + SESSION_SECONDS * 1000);
        sessions.set(id, { accessToken: verified.accessToken, expiresAt });
        res.setHeader('Set-Cookie', [
          cookie(FLOW_COOKIE, '', 0),
          cookie(SESSION_COOKIE, id, Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))),
        ]);
        redirect(res, '/');
        return;
      }

      // The pilot has no workspace, demo, API, or static-file route.
      res.writeHead(404).end();
    } catch {
      sendPage(res, 503, 'Sign-in is temporarily unavailable. Try again shortly.', 'login');
    }
  });
}
