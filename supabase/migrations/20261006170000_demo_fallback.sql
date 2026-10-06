-- Demo fallback: when the upstream provider refuses on billing (HTTP 402), the run completes with a stock asset.
-- The row says so permanently, so history never passes a stock asset off as a real render.
alter table public.generations add column demo_fallback boolean not null default false;

drop function public.complete_generation(uuid, text);

-- Charges the held credits. Returns null if the row was already settled (e.g. cancelled), so a late result is discarded.
create function public.complete_generation(p_id uuid, p_result_path text, p_demo_fallback boolean default false) returns public.generations
language plpgsql set search_path = '' as $$
declare
  g public.generations;
begin
  update public.generations
    set status = 'done', progress = 1, credit_state = 'charged', result_path = p_result_path,
        demo_fallback = p_demo_fallback, updated_at = now()
    where id = p_id and status in ('queued', 'generating')
    returning * into g;
  if not found then
    return null;
  end if;
  return g;
end $$;

revoke execute on function public.complete_generation(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.complete_generation(uuid, text, boolean) to service_role;
