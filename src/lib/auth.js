import { createClient } from '@supabase/supabase-js';

const supabaseAnon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/**
 * Extracts and validates the Bearer JWT from the Authorization header.
 * Returns the authenticated user's UUID (sub claim).
 * Throws an error with .status = 401 if missing/invalid.
 */
export async function getAuthenticatedUserId(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    const err = new Error('Missing Authorization header');
    err.status = 401;
    throw err;
  }

  const { data, error } = await supabaseAnon.auth.getUser(token);

  if (error || !data?.user?.id) {
    const err = new Error('Invalid or expired token');
    err.status = 401;
    throw err;
  }

  return data.user.id;
}
