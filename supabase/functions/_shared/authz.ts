// Shared-secret guard for the edge functions. All nine functions are invoked
// server-to-server (by pg_cron via app_invoke_function, or manually by an
// operator), never directly by a browser, so they authenticate with a single
// shared secret rather than a user JWT — which is why config.toml keeps
// verify_jwt=false.
//
// Enforcement is conditional on EDGE_SHARED_SECRET being configured: when it is
// unset (local dev, or before an operator provisions it) the guard is a no-op,
// matching the codebase's existing "degrade cleanly when a secret is missing"
// convention. In production the secret MUST be set (via `supabase secrets set`)
// and mirrored into Vault as 'edge_shared_secret' so app_invoke_function sends
// the matching `x-sentinel-secret` header (see 0004_m0_hardening.sql).

/**
 * Returns a 401 Response if the caller failed the shared-secret check, or null
 * to proceed. Usage: `const denied = guardRequest(req); if (denied) return denied;`
 */
export function guardRequest(req: Request): Response | null {
  const required = Deno.env.get('EDGE_SHARED_SECRET');
  if (!required) return null;                       // not configured → no enforcement
  const provided = req.headers.get('x-sentinel-secret');
  if (provided !== required) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}
