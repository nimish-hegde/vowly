import { createClient } from '@supabase/supabase-js';

type PilotSession = { accessToken: string; expiresAt: number };

export interface PilotAuth {
  begin(callback: string): Promise<{
    url: string;
    exchange(code: string): Promise<PilotSession | null>;
  }>;
  isAllowed(accessToken: string): Promise<boolean>;
  signOut(accessToken: string): Promise<void>;
}

export function createSupabasePilotAuth(url: string, publishableKey: string): PilotAuth {
  const global = {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      const timeout = AbortSignal.timeout(8_000);
      const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
      return fetch(input, { ...init, signal });
    },
  };
  const authOptions = { autoRefreshToken: false, detectSessionInUrl: false };
  const verifier = createClient(url, publishableKey, {
    global,
    auth: { ...authOptions, persistSession: false },
  });
  return {
    async begin(callback) {
      // The only state needed between requests is the SDK's PKCE verifier.
      const storage = new Map<string, string>();
      const client = createClient(url, publishableKey, {
        global,
        auth: {
          ...authOptions,
          flowType: 'pkce',
          storage: {
            getItem: (key) => storage.get(key) ?? null,
            setItem: (key, value) => {
              if (key.endsWith('-code-verifier')) storage.set(key, value);
            },
            removeItem: (key) => { storage.delete(key); },
          },
        },
      });
      const { data, error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: callback, scopes: 'openid email profile', skipBrowserRedirect: true },
      });
      if (error || !data.url) throw new Error('Could not start Google sign-in');
      return {
        url: data.url,
        async exchange(code) {
          try {
            const { data, error } = await client.auth.exchangeCodeForSession(code);
            if (error || !data.session?.expires_at) return null;
            return { accessToken: data.session.access_token, expiresAt: data.session.expires_at * 1000 };
          } finally {
            storage.clear();
          }
        },
      };
    },
    async isAllowed(accessToken) {
      const { data, error } = await verifier.auth.getUser(accessToken);
      if (error || !data.user?.email_confirmed_at || data.user.app_metadata.provider !== 'google') {
        return false;
      }
      const caller = createClient(url, publishableKey, { global, accessToken: async () => accessToken });
      const result = await caller.rpc('can_use_pilot');
      return !result.error && result.data === true;
    },
    async signOut(accessToken) {
      // Supabase's logout endpoint uses the caller's JWT, never a service-role key.
      await verifier.auth.admin.signOut(accessToken, 'local');
    },
  };
}
