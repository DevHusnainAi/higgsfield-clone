-- Settings: users' own provider keys (bring your own key) and lifetime usage numbers.

-- Keys are encrypted by the server (AES-256-GCM, lib/server/key-vault.ts) before they get here; the database
-- never sees a plaintext key or the encryption key. RLS on with no policies, and every privilege revoked from
-- the browser roles: not even the owner can read their own ciphertext through the API. Only the server
-- (service role) reads and writes, and it only ever sends back `hint` (the key's last 4 characters).
create table public.provider_keys (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('hf', 'fal')),
  secret text not null,
  hint text not null check (char_length(hint) = 4),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);
alter table public.provider_keys enable row level security;
revoke all on public.provider_keys from public, anon, authenticated;

-- Lifetime numbers for the settings page (the history endpoint returns only the latest 100 runs).
create function public.account_stats(p_user uuid)
returns table (runs integer, done integer, failed integer, credits_used integer, credits_refunded integer)
language sql stable set search_path = '' as $$
  select count(*)::integer,
         count(*) filter (where status = 'done')::integer,
         count(*) filter (where status = 'failed')::integer,
         coalesce(sum(credits_amount) filter (where credit_state = 'charged'), 0)::integer,
         coalesce(sum(credits_amount) filter (where credit_state = 'refunded'), 0)::integer
  from public.generations
  where user_id = p_user
$$;

revoke execute on function public.account_stats(uuid) from public, anon, authenticated;
grant execute on function public.account_stats(uuid) to service_role;
