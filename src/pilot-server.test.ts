import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test, type TestContext } from 'node:test';
import { createSupabasePilotAuth, type PilotAuth } from './pilot-auth.ts';
import { createPilotServer } from './pilot-server.ts';

const origin = 'https://pilot.example.test';
const supabase = 'https://supabase.example.test';

async function setup(t: TestContext) {
  let allowed = true;
  let unavailable = false;
  let signOutCalls = 0;
  const provider: PilotAuth = {
    async begin(callback) {
      assert.equal(callback, origin + '/auth/callback');
      return {
        url: supabase + '/auth/v1/authorize?provider=google',
        async exchange(code) {
          if (code === 'invalid') return null;
          return { accessToken: code, expiresAt: Date.now() + (code === 'expired' ? -1 : 60_000) };
        },
      };
    },
    async isAllowed(token) {
      if (unavailable) throw new Error('internal provider error');
      return allowed && token === 'synthetic-allowed';
    },
    async signOut() { signOutCalls++; },
  };
  const server = createPilotServer(origin, supabase, provider).listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((done) => { server.close(() => done()); }));
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const request = (path: string, options?: RequestInit) =>
    fetch(`http://127.0.0.1:${address.port}${path}`, { ...options, redirect: 'manual' });
  const login = () => request('/auth/login', { method: 'POST', headers: { Origin: origin } });
  const callback = (flow: string, code = 'synthetic-allowed') =>
    request('/auth/callback?code=' + code + '&next=https://outside.example.test', { headers: { Cookie: flow } });
  const flowCookie = async () => (await login()).headers.getSetCookie()[0]!.split(';')[0]!;
  const session = async () => (await callback(await flowCookie())).headers.getSetCookie()[1]!.split(';')[0]!;
  return {
    request, login, callback, flowCookie, session,
    removeTester: () => { allowed = false; },
    failProvider: () => { unavailable = true; },
    signOutCalls: () => signOutCalls,
  };
}

test('pilot sign-in uses the fixed destinations, one-use flow, and opaque secure cookies', async (t) => {
  const { request, login, callback } = await setup(t);
  const entry = await request('/');
  assert.match(await entry.text(), /Sign in with Google/);
  assert.equal(entry.headers.get('Cache-Control'), 'no-store');
  const start = await login();
  assert.equal(start.status, 303);
  assert.equal(start.headers.get('Location'), supabase + '/auth/v1/authorize?provider=google');
  const flow = start.headers.getSetCookie()[0]!;
  assert.match(flow, /^__Host-vowly-pilot-flow=[\w-]+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=300$/);
  const reply = await callback(flow.split(';')[0]!);
  assert.equal(reply.status, 303);
  assert.equal(reply.headers.get('Location'), '/');
  const session = reply.headers.getSetCookie()[1]!;
  assert.match(session, /^__Host-vowly-pilot-session=[\w-]+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=\d+$/);
  assert.doesNotMatch(session, /synthetic-allowed/);
  const signedIn = await request('/', { headers: { Cookie: session.split(';')[0]! } });
  assert.match(await signedIn.text(), /signed in as an approved tester/);
  assert.equal((await callback(flow.split(';')[0]!)).status, 403);
});

test('pilot rejects unlisted, expired, invalid, and unbound callbacks', async (t) => {
  const { callback, flowCookie } = await setup(t);
  for (const code of ['synthetic-unlisted', 'expired', 'invalid']) {
    const response = await callback(await flowCookie(), code);
    assert.equal(response.status, 403);
    assert.equal(response.headers.getSetCookie().length, 1);
  }
  assert.equal((await callback('')).status, 403);
});

test('pilot rechecks access and fails closed when provider verification is unavailable', async (t) => {
  const { request, session, failProvider } = await setup(t);
  const headers = { Cookie: await session() };
  failProvider();
  const unavailable = await request('/', { headers });
  assert.equal(unavailable.status, 503);
  assert.doesNotMatch(await unavailable.text(), /internal provider error|signed in as/);
  // Restoring the provider is unnecessary to test allowlist removal in a fresh server.
  const revoked = await setup(t);
  const oldCookie = await revoked.session();
  revoked.removeTester();
  const denied = await revoked.request('/', { headers: { Cookie: oldCookie } });
  assert.match(await denied.text(), /Sign in with Google/);
  assert.match(denied.headers.getSetCookie()[0]!, /Max-Age=0/);
});

test('managed Auth adapter exchanges PKCE and checks a verified Google identity with a caller-scoped RPC', async (t) => {
  let verified = true;
  const paths: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    assert.equal(url.origin, supabase);
    paths.push(url.pathname);
    const user = {
      id: '7bf8bd2e-f1ab-4a39-b149-000000000001',
      email_confirmed_at: verified ? '2026-11-28T00:00:00Z' : null,
      app_metadata: { provider: 'google' },
    };
    if (url.pathname === '/auth/v1/token') {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.auth_code, 'synthetic-code');
      assert.ok(body.code_verifier.length > 32);
      return Response.json({
        access_token: 'synthetic-access', refresh_token: 'synthetic-refresh',
        provider_token: 'synthetic-provider', expires_in: 3600, user,
      });
    }
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer synthetic-access');
    if (url.pathname === '/auth/v1/user') return Response.json(user);
    if (url.pathname === '/rest/v1/rpc/can_use_pilot') return Response.json(true);
    if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
    assert.fail('Unexpected Supabase path');
  });
  const auth = createSupabasePilotAuth(supabase, 'sb_publishable_synthetic');
  const pending = await auth.begin(origin + '/auth/callback');
  const params = new URL(pending.url).searchParams;
  assert.equal(params.get('provider'), 'google');
  assert.equal(params.get('redirect_to'), origin + '/auth/callback');
  assert.equal(params.get('code_challenge_method'), 's256');
  const identity = await pending.exchange('synthetic-code');
  assert.ok(identity);
  assert.deepEqual(Object.keys(identity).sort(), ['accessToken', 'expiresAt']);
  assert.equal(await auth.isAllowed(identity.accessToken), true);
  verified = false;
  assert.equal(await auth.isAllowed(identity.accessToken), false);
  await auth.signOut(identity.accessToken);
  assert.deepEqual(paths, ['/auth/v1/token', '/auth/v1/user', '/rest/v1/rpc/can_use_pilot', '/auth/v1/user', '/auth/v1/logout']);
});

test('pilot denies cross-origin auth writes and never routes demo or workspace requests', async (t) => {
  const { request, session, signOutCalls } = await setup(t);
  const Cookie = await session();
  assert.equal((await request('/auth/login', { method: 'POST' })).status, 403);
  assert.equal((await request('/auth/logout', { method: 'POST', headers: { Cookie, Origin: 'https://outside.example.test' } })).status, 403);
  for (const headers of [undefined, { Cookie }]) {
    for (const path of ['/api/state', '/api/health', '/index.html', '/private-data/telemetry.jsonl']) {
      assert.equal((await request(path, { headers })).status, 404);
    }
    for (const path of ['/api/extract', '/api/review/approve']) {
      assert.equal((await request(path, { method: 'POST', headers })).status, 404);
    }
  }
  const logout = await request('/auth/logout', { method: 'POST', headers: { Cookie, Origin: origin } });
  assert.equal(logout.status, 303);
  assert.equal(signOutCalls(), 1);
  assert.match(await (await request('/', { headers: { Cookie } })).text(), /Sign in with Google/);
});
