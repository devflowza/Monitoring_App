// Admin SDK Directory roster sync. Populates the authoritative employee list so
// RLS department-scoping and owner_employee_id attribution resolve. Impersonates
// a super-admin (GOOGLE_ADMIN_IMPERSONATE_EMAIL) with the directory readonly scope.

import { getGoogleAccessToken, SCOPES } from './auth.ts';

export interface DirectoryUser {
  primaryEmail: string;
  fullName: string;
  suspended: boolean;
  orgUnitPath: string;
  lastLoginTime: string | null;
}

interface RawUser {
  primaryEmail?: string;
  name?: { fullName?: string };
  suspended?: boolean;
  orgUnitPath?: string;
  lastLoginTime?: string;
}

export async function listDirectoryUsers(maxUsers = 5000): Promise<DirectoryUser[]> {
  const subject = Deno.env.get('GOOGLE_ADMIN_IMPERSONATE_EMAIL');
  const token = await getGoogleAccessToken([SCOPES.adminDirectory], { subject });
  const users: DirectoryUser[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL('https://admin.googleapis.com/admin/directory/v1/users');
    url.searchParams.set('customer', 'my_customer');
    url.searchParams.set('maxResults', '200');
    url.searchParams.set('projection', 'basic');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Directory users.list failed: ${res.status}`);
    const json = await res.json() as { users?: RawUser[]; nextPageToken?: string };
    for (const u of json.users ?? []) {
      const email = (u.primaryEmail ?? '').toLowerCase();
      if (!email) continue;
      users.push({
        primaryEmail: email,
        fullName: u.name?.fullName ?? email,
        suspended: Boolean(u.suspended),
        orgUnitPath: u.orgUnitPath ?? '/',
        lastLoginTime: u.lastLoginTime ?? null,
      });
    }
    pageToken = json.nextPageToken;
  } while (pageToken && users.length < maxUsers);

  return users;
}
