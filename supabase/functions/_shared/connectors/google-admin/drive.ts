// Org-wide Drive connector (production). Surfaces file sharing/permissions —
// the spine of external-sharing / exfiltration detection. Emits one
// NormalizedFilePermission per non-owner grant, flagging external + public links.

import {
  type ConnectorContext,
  type NormalizedFilePermission,
  type NormalizedRecord,
  type PullOptions,
  type PullResult,
  type SourceConnector,
} from '../types.ts';
import { getGoogleAccessToken, SCOPES } from './auth.ts';

interface DrivePermission { id: string; type: string; emailAddress?: string; domain?: string; role?: string; allowFileDiscovery?: boolean }
interface DriveFile { id: string; name?: string; mimeType?: string; permissions?: DrivePermission[] }

export class GoogleAdminDriveConnector implements SourceConnector {
  readonly kind = 'drive' as const;
  readonly mode = 'google_admin' as const;
  constructor(private ctx: ConnectorContext) {}

  private isExternalGrant(p: DrivePermission): boolean {
    if (p.type === 'anyone' || p.type === 'domain') {
      return !this.ctx.internalDomains.includes((p.domain ?? '').toLowerCase());
    }
    const domain = (p.emailAddress ?? '').toLowerCase().split('@')[1] ?? '';
    return domain !== '' && !this.ctx.internalDomains.includes(domain);
  }

  async pullDelta(cursor: string | null, opts: PullOptions): Promise<PullResult> {
    const subject = Deno.env.get('GOOGLE_ADMIN_IMPERSONATE_EMAIL');
    const token = await getGoogleAccessToken([SCOPES.driveMetadata], { subject });
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,permissions(id,type,emailAddress,domain,role,allowFileDiscovery))');
    url.searchParams.set('pageSize', String(Math.min(opts.pageLimit, 100)));
    url.searchParams.set('orderBy', 'modifiedTime desc');
    if (cursor) url.searchParams.set('pageToken', cursor);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Drive list failed: ${res.status}`);
    const { files = [], nextPageToken = null } = await res.json() as { files?: DriveFile[]; nextPageToken?: string | null };

    const records: NormalizedRecord[] = [];
    for (const f of files) {
      for (const p of f.permissions ?? []) {
        if (p.role === 'owner') continue;
        const external = this.isExternalGrant(p);
        if (!external) continue; // only external grants are noteworthy here
        records.push({
          kind: 'file_permission',
          providerFileId: f.id,
          fileName: f.name ?? null,
          permissionType: (p.type as NormalizedFilePermission['permissionType']) ?? 'user',
          grantee: p.emailAddress ?? p.domain ?? p.type,
          isExternal: true,
          isPublicLink: p.type === 'anyone',
          role: p.role ?? null,
        });
      }
    }
    return { records, nextCursor: nextPageToken, done: !nextPageToken };
  }
}
