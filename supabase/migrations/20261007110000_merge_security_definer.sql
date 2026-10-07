-- Hosted Supabase does not let service_role read auth.users, so the merge failed with
-- "permission denied for table users". Run it as the owner instead. Safe because only
-- service_role can execute it (re-asserted below) and every name in the body is schema-qualified,
-- with search_path pinned so nothing can be shadowed.
create or replace function public.merge_anonymous_history(p_from uuid, p_to uuid) returns integer
language plpgsql security definer set search_path = '' as $$
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

revoke execute on function public.merge_anonymous_history(uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_anonymous_history(uuid, uuid) to service_role;
