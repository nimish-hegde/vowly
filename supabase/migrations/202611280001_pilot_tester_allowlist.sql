create schema if not exists pilot_private;
revoke all on schema pilot_private from public, anon, authenticated;

create table pilot_private.testers (
  email text primary key check (email <> '' and email = lower(btrim(email)))
);
alter table pilot_private.testers enable row level security;
revoke all on table pilot_private.testers from public, anon, authenticated;

-- Supabase Auth invokes this hook only when creating a new user.
create function public.pilot_before_user_created(event jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when event #>> '{user,app_metadata,provider}' = 'google'
    and exists (
      select 1 from pilot_private.testers
      where email = lower(btrim(event #>> '{user,email}'))
    )
    then '{}'::jsonb
    else '{"error":{"http_code":403,"message":"This account is not approved for the pilot."}}'::jsonb
  end;
$$;
revoke execute on function public.pilot_before_user_created(jsonb)
  from public, anon, authenticated;
grant execute on function public.pilot_before_user_created(jsonb) to supabase_auth_admin;

-- Each protected request checks the current verified identity and allowlist.
create function public.can_use_pilot()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users as account
    join pilot_private.testers as tester on tester.email = lower(btrim(account.email))
    where account.id = auth.uid()
      and account.email_confirmed_at is not null
      and account.raw_app_meta_data ->> 'provider' = 'google'
  );
$$;
revoke execute on function public.can_use_pilot() from public, anon, authenticated;
grant execute on function public.can_use_pilot() to authenticated;
