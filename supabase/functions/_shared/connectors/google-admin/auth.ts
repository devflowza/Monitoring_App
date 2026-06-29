// Google service-account auth with domain-wide delegation.
// Builds an RS256-signed JWT asserting the service account, impersonating a
// Workspace user (`sub`), and exchanges it for an OAuth access token. This is
// the mechanism that grants org-wide, read-only access to every mailbox/drive
// once the super-admin authorizes the client ID + scopes in the Admin console
// (see docs/runbooks/google-workspace-setup.md).

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function b64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : new Uint8Array(input);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const raw = atob(body);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

function loadServiceAccount(): ServiceAccount {
  const raw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not configured');
  // Accept raw JSON or base64-encoded JSON.
  const json = raw.trim().startsWith('{') ? raw : atob(raw);
  return JSON.parse(json) as ServiceAccount;
}

/** Returns a short-lived OAuth access token for the given scopes, impersonating
 *  `subject` (defaults to GOOGLE_ADMIN_IMPERSONATE_EMAIL). */
export async function getGoogleAccessToken(
  scopes: string[],
  opts: { subject?: string } = {},
): Promise<string> {
  const sa = loadServiceAccount();
  const subject = opts.subject ?? Deno.env.get('GOOGLE_ADMIN_IMPERSONATE_EMAIL');
  const tokenUri = sa.token_uri ?? 'https://oauth2.googleapis.com/token';
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: scopes.join(' '),
    aud: tokenUri,
    exp: now + 3600,
    iat: now,
    ...(subject ? { sub: subject } : {}),
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${b64url(sig)}`;

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json() as { access_token: string };
  return json.access_token;
}

export const SCOPES = {
  gmailReadonly: 'https://www.googleapis.com/auth/gmail.readonly',
  driveMetadata: 'https://www.googleapis.com/auth/drive.metadata.readonly',
  driveActivity: 'https://www.googleapis.com/auth/drive.activity.readonly',
  calendarReadonly: 'https://www.googleapis.com/auth/calendar.readonly',
  adminDirectory: 'https://www.googleapis.com/auth/admin.directory.user.readonly',
  adminReports: 'https://www.googleapis.com/auth/admin.reports.audit.readonly',
};
