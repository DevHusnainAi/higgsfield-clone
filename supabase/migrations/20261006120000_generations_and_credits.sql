-- Generations and credit balances.
-- Clients can only READ their own rows (RLS). Every write goes through the functions below,
-- which only the service role (our API route) may execute.

create table public.user_credits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- ponytail: flat starter grant; replace with plan/purchase logic when billing exists
  balance integer not null default 200 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  intent jsonb not null,
  status text not null default 'queued' check (status in ('queued', 'generating', 'done', 'failed')),
  progress real not null default 0 check (progress between 0 and 1),
  credits_amount integer not null check (credits_amount >= 0),
  credit_state text not null default 'held' check (credit_state in ('held', 'charged', 'refunded')),
  failure_reason text check (failure_reason in ('capacity', 'provider_error', 'timeout', 'cancelled', 'interrupted')),
  result_path text,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Same guarantee as the Generation type in lib/generation.ts: a failure is always refunded.
  constraint credits_follow_status check (
    (status in ('queued', 'generating') and credit_state = 'held' and failure_reason is null and refunded_at is null)
    or (status = 'done' and credit_state = 'charged' and result_path is not null and refunded_at is null)
    or (status = 'failed' and credit_state = 'refunded' and failure_reason is not null and refunded_at is not null)
  )
);

create index generations_user_created_idx on public.generations (user_id, created_at desc);

alter table public.user_credits enable row level security;
alter table public.generations enable row level security;

create policy "Users read their own credits" on public.user_credits
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users read their own generations" on public.generations
  for select to authenticated using ((select auth.uid()) = user_id);

-- Public bucket; objects live at <user_id>/<generation_id>.<ext>, so paths are unguessable.
-- ponytail: public URLs; switch to a private bucket + signed URLs if results must stay private
insert into storage.buckets (id, name, public) values ('generations', 'generations', true)
on conflict (id) do nothing;

-- Creates the balance row on first use and returns the current balance.
create function public.get_balance(p_user uuid) returns integer
language plpgsql set search_path = '' as $$
declare
  b integer;
begin
  insert into public.user_credits (user_id) values (p_user) on conflict (user_id) do nothing;
  select balance into b from public.user_credits where user_id = p_user;
  return b;
end $$;

-- Holds the cost and creates the generation in one transaction. Raises insufficient_credits.
create function public.start_generation(p_user uuid, p_intent jsonb, p_cost integer) returns public.generations
language plpgsql set search_path = '' as $$
declare
  g public.generations;
begin
  if p_cost < 0 then
    raise exception 'invalid_cost';
  end if;
  perform public.get_balance(p_user);
  update public.user_credits set balance = balance - p_cost, updated_at = now()
    where user_id = p_user and balance >= p_cost;
  if not found then
    raise exception 'insufficient_credits';
  end if;
  insert into public.generations (user_id, intent, credits_amount)
    values (p_user, p_intent, p_cost)
    returning * into g;
  return g;
end $$;

-- Progress never moves backwards; settled rows are left alone.
create function public.mark_generating(p_id uuid, p_progress real) returns void
language sql set search_path = '' as $$
  update public.generations
    set status = 'generating', progress = greatest(progress, least(p_progress, 1)), updated_at = now()
    where id = p_id and status in ('queued', 'generating');
$$;

-- Charges the held credits. Returns null if the row was already settled (e.g. cancelled), so a late result is discarded.
create function public.complete_generation(p_id uuid, p_result_path text) returns public.generations
language plpgsql set search_path = '' as $$
declare
  g public.generations;
begin
  update public.generations
    set status = 'done', progress = 1, credit_state = 'charged', result_path = p_result_path, updated_at = now()
    where id = p_id and status in ('queued', 'generating')
    returning * into g;
  if not found then
    return null;
  end if;
  return g;
end $$;

-- Fails and refunds exactly once: the status guard means a second call matches no row.
create function public.fail_generation(p_id uuid, p_reason text) returns public.generations
language plpgsql set search_path = '' as $$
declare
  g public.generations;
begin
  update public.generations
    set status = 'failed', credit_state = 'refunded', failure_reason = p_reason, refunded_at = now(), updated_at = now()
    where id = p_id and status in ('queued', 'generating')
    returning * into g;
  if not found then
    return null;
  end if;
  update public.user_credits set balance = balance + g.credits_amount, updated_at = now()
    where user_id = g.user_id;
  return g;
end $$;

-- Safety net for jobs whose worker died: anything active longer than p_max_age is failed and refunded.
create function public.fail_stale_generations(p_user uuid, p_max_age interval) returns integer
language plpgsql set search_path = '' as $$
declare
  r record;
  g public.generations;
  n integer := 0;
begin
  for r in
    select id from public.generations
    where user_id = p_user and status in ('queued', 'generating') and created_at < now() - p_max_age
  loop
    -- Check .id: a composite IS NOT NULL is false whenever any column (e.g. result_path) is null.
    g := public.fail_generation(r.id, 'timeout');
    if g.id is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

revoke execute on function
  public.get_balance(uuid),
  public.start_generation(uuid, jsonb, integer),
  public.mark_generating(uuid, real),
  public.complete_generation(uuid, text),
  public.fail_generation(uuid, text),
  public.fail_stale_generations(uuid, interval)
from public, anon, authenticated;

grant execute on function
  public.get_balance(uuid),
  public.start_generation(uuid, jsonb, integer),
  public.mark_generating(uuid, real),
  public.complete_generation(uuid, text),
  public.fail_generation(uuid, text),
  public.fail_stale_generations(uuid, interval)
to service_role;
