import { createSupabasePilotAuth } from './pilot-auth.ts';
import { createPilotServer } from './pilot-server.ts';

function httpsOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (value === url.origin || value === `${url.origin}/`)
      ? url.origin : null;
  } catch {
    return null;
  }
}

const origin = httpsOrigin(process.env.VOWLY_PILOT_ORIGIN);
const supabase = httpsOrigin(process.env.SUPABASE_URL);
const key = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!origin || !supabase || !key?.startsWith('sb_publishable_')) {
  throw new Error('Pilot requires HTTPS origins and a Supabase publishable key.');
}

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
createPilotServer(origin, supabase, createSupabasePilotAuth(supabase, key)).listen(port, host, () => {
  console.log('Vowly private pilot listening behind HTTPS ingress.');
});
