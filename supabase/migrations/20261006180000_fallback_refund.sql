-- Demo fallback runs cost nothing: the stock asset is saved and shown, and the held credits go back to the user.
-- A fallback is the only way a run can be "done" yet refunded, and the constraint now spells that out.

alter table public.generations drop constraint credits_follow_status;
alter table public.generations add constraint credits_follow_status check (
  (status in ('queued', 'generating') and credit_state = 'held' and failure_reason is null and refunded_at is null and not demo_fallback)
  or (status = 'done' and not demo_fallback and credit_state = 'charged' and result_path is not null and refunded_at is null)
  or (status = 'done' and demo_fallback and credit_state = 'refunded' and result_path is not null and refunded_at is not null)
  or (status = 'failed' and not demo_fallback and credit_state = 'refunded' and failure_reason is not null and refunded_at is not null)
);

-- Settles a run exactly once (the status guard means a second call matches no row).
-- Real render: charges the held credits. Demo fallback: saves the stock asset and refunds instead.
create or replace function public.complete_generation(p_id uuid, p_result_path text, p_demo_fallback boolean default false) returns public.generations
language plpgsql set search_path = '' as $$
declare
  g public.generations;
begin
  update public.generations
    set status = 'done', progress = 1, result_path = p_result_path, demo_fallback = p_demo_fallback,
        credit_state = case when p_demo_fallback then 'refunded' else 'charged' end,
        refunded_at = case when p_demo_fallback then now() end,
        updated_at = now()
    where id = p_id and status in ('queued', 'generating')
    returning * into g;
  if not found then
    return null;
  end if;
  if p_demo_fallback then
    update public.user_credits set balance = balance + g.credits_amount, updated_at = now() where user_id = g.user_id;
  end if;
  return g;
end $$;
