-- WyBuild storage on Supabase. Run once in Supabase -> SQL Editor.
-- Replaces Vercel KV. Only the server (service-role key) can touch these.

create table if not exists public.wb_kv (
  key        text primary key,
  value      jsonb not null,
  expires_at timestamptz
);
create index if not exists wb_kv_expires_idx on public.wb_kv (expires_at) where expires_at is not null;

create table if not exists public.wb_set (
  set_key text not null,
  member  text not null,
  primary key (set_key, member)
);

alter table public.wb_kv  enable row level security;
alter table public.wb_set enable row level security;
-- No policies on purpose: anon/authenticated get no access; service_role bypasses RLS.

create or replace function public.wb_kv_get(p_key text) returns jsonb
language sql security definer set search_path = public as $$
  select value from wb_kv where key = p_key and (expires_at is null or expires_at > now());
$$;

create or replace function public.wb_kv_set(p_key text, p_value jsonb, p_nx boolean default false, p_ex integer default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_nx then
    delete from wb_kv where key = p_key and expires_at is not null and expires_at <= now();
    insert into wb_kv (key, value, expires_at)
      values (p_key, p_value, case when p_ex is null then null else now() + make_interval(secs => p_ex) end)
      on conflict (key) do nothing;
    get diagnostics n = row_count;
    return n = 1;
  end if;
  insert into wb_kv (key, value, expires_at)
    values (p_key, p_value, case when p_ex is null then null else now() + make_interval(secs => p_ex) end)
    on conflict (key) do update set value = excluded.value, expires_at = excluded.expires_at;
  return true;
end $$;

create or replace function public.wb_kv_del(p_key text) returns void
language sql security definer set search_path = public as $$
  delete from wb_kv where key = p_key;
$$;

-- atomic counter (INCR / DECR); expired or missing keys start from 0
create or replace function public.wb_kv_incr(p_key text, p_by integer default 1) returns bigint
language plpgsql security definer set search_path = public as $$
declare r bigint;
begin
  delete from wb_kv where key = p_key and expires_at is not null and expires_at <= now();
  insert into wb_kv (key, value) values (p_key, to_jsonb(p_by::bigint))
    on conflict (key) do update set value = to_jsonb(((wb_kv.value #>> '{}')::bigint) + p_by)
    returning (value #>> '{}')::bigint into r;
  return r;
end $$;

create or replace function public.wb_kv_expire(p_key text, p_ex integer) returns void
language sql security definer set search_path = public as $$
  update wb_kv set expires_at = now() + make_interval(secs => p_ex) where key = p_key;
$$;

create or replace function public.wb_set_add(p_set text, p_member text) returns void
language sql security definer set search_path = public as $$
  insert into wb_set (set_key, member) values (p_set, p_member) on conflict do nothing;
$$;

create or replace function public.wb_set_rem(p_set text, p_member text) returns void
language sql security definer set search_path = public as $$
  delete from wb_set where set_key = p_set and member = p_member;
$$;

create or replace function public.wb_set_members(p_set text) returns text[]
language sql security definer set search_path = public as $$
  select coalesce(array_agg(member), '{}') from wb_set where set_key = p_set;
$$;

-- lock the functions to the server only
revoke all on function public.wb_kv_get(text), public.wb_kv_set(text, jsonb, boolean, integer), public.wb_kv_del(text),
  public.wb_kv_incr(text, integer), public.wb_kv_expire(text, integer), public.wb_set_add(text, text),
  public.wb_set_rem(text, text), public.wb_set_members(text) from public, anon, authenticated;
grant execute on function public.wb_kv_get(text), public.wb_kv_set(text, jsonb, boolean, integer), public.wb_kv_del(text),
  public.wb_kv_incr(text, integer), public.wb_kv_expire(text, integer), public.wb_set_add(text, text),
  public.wb_set_rem(text, text), public.wb_set_members(text) to service_role;
