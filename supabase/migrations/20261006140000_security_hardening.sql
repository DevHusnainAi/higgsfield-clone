-- Pre-launch hardening: locked balance check, active-run cap, smaller starter grant,
-- DB-backed rate limits, owner-scoped cancel, and no client write path to any table.

-- Economic DoS: every anonymous session is a new account, so the starter grant is what an abuser farms.
-- Existing balances are left as they are.
alter table public.user_credits alter column balance set default 40;

-- Defense in depth: RLS already has no write policies; clients also get no write privileges at all.
revoke insert, update, delete, truncate, references, trigger on public.generations, public.user_credits from anon, authenticated;
revoke all on public.generations, public.user_credits from anon;

-- Sliding-window request log. RLS on with no policies + no grants: only the service role touches it.
create table public.rate_limit_hits (
  key text not null,
  at timestamptz not null default now()
);
create index rate_limit_hits_key_at_idx on public.rate_limit_hits (key, at);
alter table public.rate_limit_hits enable row level security;
revoke all on public.rate_limit_hits from public, anon, authenticated;

-- Counts a hit for p_key and returns true when p_key already has p_max hits inside p_window (the hit is then not recorded).
-- The advisory lock serializes callers per key, so concurrent requests can't all slip under the limit.
create function public.rate_limit_hit(p_key text, p_max integer, p_window interval) returns boolean
language plpgsql set search_path = '' as $$
declare
  n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_key, 0));
  delete from public.rate_limit_hits where key = p_key and at < now() - p_window;
  select count(*) into n from public.rate_limit_hits where key = p_key;
  if n >= p_max then
    return true;
  end if;
  insert into public.rate_limit_hits (key) values (p_key);
  return false;
end $$;

-- Same contract as before, now with an explicit row lock and a cap of 3 active runs (a batch counts once).
create or replace function public.start_generation(p_user uuid, p_intents jsonb, p_cost integer) returns setof public.generations
language plpgsql set search_path = '' as $$
declare
  n integer;
  bal integer;
  active integer;
  batch uuid := gen_random_uuid();
begin
  if p_cost < 0 then
    raise exception 'invalid_cost';
  end if;
  if jsonb_typeof(p_intents) <> 'array' or jsonb_array_length(p_intents) not between 1 and 4 then
    raise exception 'invalid_count';
  end if;
  n := jsonb_array_length(p_intents);
  perform public.get_balance(p_user);
  -- Every start for this user queues on this lock, so the cap check, balance check and deduction
  -- below all see the same committed state: concurrent requests cannot double-spend.
  select balance into bal from public.user_credits where user_id = p_user for update;
  select count(distinct coalesce(batch_id, id)) into active
    from public.generations where user_id = p_user and status in ('queued', 'generating');
  if active >= 3 then
    raise exception 'too_many_active';
  end if;
  if bal < p_cost * n then
    raise exception 'insufficient_credits';
  end if;
  update public.user_credits set balance = balance - p_cost * n, updated_at = now() where user_id = p_user;
  return query
    insert into public.generations (user_id, intent, credits_amount, batch_id, batch_index)
      select p_user, e.value, p_cost, batch, (e.ordinality - 1)::smallint
      from jsonb_array_elements(p_intents) with ordinality as e
      returning *;
end $$;

-- Cancel scoped to the owner inside the database: someone else's id matches no row and refunds nothing.
create function public.cancel_generation(p_id uuid, p_user uuid) returns public.generations
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.generations where id = p_id and user_id = p_user) then
    return null;
  end if;
  return public.fail_generation(p_id, 'cancelled');
end $$;

revoke execute on function
  public.rate_limit_hit(text, integer, interval),
  public.start_generation(uuid, jsonb, integer),
  public.cancel_generation(uuid, uuid)
from public, anon, authenticated;
grant execute on function
  public.rate_limit_hit(text, integer, interval),
  public.start_generation(uuid, jsonb, integer),
  public.cancel_generation(uuid, uuid)
to service_role;
