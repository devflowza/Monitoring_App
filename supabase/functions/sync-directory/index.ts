// sync-directory — upsert the employee roster + email identities from Google
// Admin SDK Directory. Maps the last org-unit segment to a department by name.
// Gated on monitoring_active (real employee data = collection). Invoked by
// pg_cron (e.g. hourly).

import { adminClient, getPolicy } from '../_shared/db.ts';
import { listDirectoryUsers } from '../_shared/connectors/google-admin/directory.ts';
import { guardRequest } from '../_shared/authz.ts';

Deno.serve(async (req) => {
  const denied = guardRequest(req);
  if (denied) return denied;
  const db = adminClient();
  if (!(await getPolicy<boolean>(db, 'monitoring_active', false))) {
    return Response.json({ skipped: 'monitoring_active is off' });
  }

  const { data: depts } = await db.from('departments').select('id, name');
  const deptByName = new Map((depts ?? []).map((d) => [String(d.name).toLowerCase(), d.id]));

  let upserted = 0;
  const users = await listDirectoryUsers();
  for (const u of users) {
    const leaf = (u.orgUnitPath || '').split('/').filter(Boolean).pop()?.toLowerCase() ?? '';
    const department_id = deptByName.get(leaf) ?? null;
    const { data: emp } = await db.from('employees').upsert({
      primary_email: u.primaryEmail,
      full_name: u.fullName,
      department_id,
      employment_status: u.suspended ? 'inactive' : 'active',
    }, { onConflict: 'primary_email' }).select('id').single();

    if (emp?.id) {
      await db.from('identities').upsert(
        { identity_type: 'email', value: u.primaryEmail, is_internal: true, employee_id: emp.id },
        { onConflict: 'identity_type,value' },
      );
      upserted++;
    }
  }

  return Response.json({ upserted });
});
