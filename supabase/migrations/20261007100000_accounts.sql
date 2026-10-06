-- Real accounts. Anonymous sessions get a small taster grant; a permanent account (email or Google)
-- gets the full grant exactly once in its life. Upgrading keeps the same user id (Supabase identity
-- linking), so history and balance carry over with no data movement.

-- Anonymous accounts are free to create, so they are what an abuser farms: keep their grant small.
alter table public.user_credits alter column balance set default 8;
alter table public.user_credits add column signup_grant_at timestamptz;

-- Called by the API on every request with the server-verified account type. Creates the row on first
-- use (8 for anonymous, 0 + the grant for permanent) and pays the 40-credit grant once, when the user
-- is first seen as permanent: on sign-up, or on upgrade from anonymous. The row lock makes it once-only
-- under concurrent requests (the losing UPDATE re-checks signup_grant_at after the winner commits).
create function public.settle_account(p_user uuid, p_permanent boolean) returns integer
language plpgsql set search_path = '' as $$
declare
  b integer;
begin
  insert into public.user_credits (user_id, balance) values (p_user, case when p_permanent then 0 else 8 end)
    on conflict (user_id) do nothing;
  if p_permanent then
    update public.user_credits set balance = balance + 40, signup_grant_at = now(), updated_at = now()
      where user_id = p_user and signup_grant_at is null;
  end if;
  select balance into b from public.user_credits where user_id = p_user;
  return b;
end $$;

-- Signing in to an EXISTING account from an anonymous session switches user ids, so the anonymous
-- history would be stranded behind RLS. This moves it across. History only, never credits: otherwise
-- anyone could farm anonymous sessions and merge their balances into one account.
-- Only settled runs move. A run still holding credits stays with the anonymous user and settles there,
-- because its refund would otherwise land in the permanent account (a credit transfer by the back door).
-- updated_at is left alone so "Took" (updated - created) stays true.
create function public.merge_anonymous_history(p_from uuid, p_to uuid) returns integer
language plpgsql set search_path = '' as $$
declare
  n integer;
begin
  if p_from = p_to then
    return 0;
  end if;
  if not exists (select 1 from auth.users where id = p_from and is_anonymous) then
    raise exception 'source_not_anonymous';
  end if;
  if not exists (select 1 from auth.users where id = p_to and not is_anonymous) then
    raise exception 'target_not_permanent';
  end if;
  update public.generations set user_id = p_to
    where user_id = p_from and status in ('done', 'failed');
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function
  public.settle_account(uuid, boolean),
  public.merge_anonymous_history(uuid, uuid)
from public, anon, authenticated;
grant execute on function
  public.settle_account(uuid, boolean),
  public.merge_anonymous_history(uuid, uuid)
to service_role;
