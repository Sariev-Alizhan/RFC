import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Service-role client — bypasses RLS, used by all backend writes/reads.
// Returns null if env vars missing (functions then run without DB and log).
export const sb = (URL && SERVICE_KEY)
  ? createClient(URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

// Verify Supabase access token from Authorization: Bearer <jwt>.
// Returns { ok: true, user } or { ok: false, error }.
export async function verifyAuth(req) {
  if (!sb) return { ok: false, error: 'Supabase not configured (missing SUPABASE_URL or SUPABASE_SERVICE_KEY)' };
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const token = String(header).replace(/^Bearer\s+/i, '').trim();
  if (!token) return { ok: false, error: 'No bearer token in Authorization header' };
  try {
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data?.user) return { ok: false, error: error?.message || 'Invalid token' };
    return { ok: true, user: data.user };
  } catch (e) {
    return { ok: false, error: e.message || 'Auth check failed' };
  }
}
