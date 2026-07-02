-- =============================================================================
-- Sentinel — bootstrap operator seed
-- Creates (or updates) a Supabase Auth email/password user, links it to
-- app_users, and grants an app_role so RLS lets them into the dashboard.
--
-- Run in the Supabase SQL editor (or psql as postgres) AFTER migrations
-- 0001–0003 have been applied. Idempotent: re-running resets the password
-- and leaves existing rows alone.
--
-- Edit the four values in the declare block below before running.
-- Do NOT commit real credentials to this file.
-- =============================================================================

do $$
declare
  v_email    text     := 'operator@example.com';   -- <-- operator email
  v_password text     := 'CHANGE-ME';              -- <-- operator password
  v_name     text     := 'Operator';               -- <-- display name
  v_role     app_role := 'ceo';                    -- ceo | admin | dept_manager | security_analyst | viewer
  v_uid      uuid;
  v_app_id   uuid;
begin
  select id into v_uid from auth.users where email = v_email;

  if v_uid is null then
    -- GoTrue reads several token columns as non-null empty strings; keep them ''.
    v_uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change,
      email_change_token_new, email_change_token_current
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      v_email, extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
      '', '', '', '', ''
    );

    -- Password sign-in requires a matching email identity.
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_uid, v_uid::text,
      jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
      'email', now(), now(), now()
    );
  else
    update auth.users
       set encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           updated_at         = now()
     where id = v_uid;
  end if;

  insert into app_users (auth_user_id, display_name)
  values (v_uid, v_name)
  on conflict (auth_user_id) do nothing;

  select id into v_app_id from app_users where auth_user_id = v_uid;

  -- unique(app_user_id, role, department_id) doesn't catch NULL department
  -- duplicates, so guard explicitly instead of relying on ON CONFLICT.
  insert into user_roles (app_user_id, role)
  select v_app_id, v_role
  where not exists (
    select 1 from user_roles
    where app_user_id = v_app_id and role = v_role and department_id is null
  );
end $$;
