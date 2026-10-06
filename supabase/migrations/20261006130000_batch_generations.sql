-- Multi-output runs: one request holds credits for every output at once and creates one row per output.
-- Each row still settles on its own, so one failed output refunds only its own share.

alter table public.generations
  add column batch_id uuid,
  add column batch_index smallint not null default 0 check (batch_index between 0 and 3);

drop function public.start_generation(uuid, jsonb, integer);

-- p_intents: a JSON array with one intent per output (1-4). p_cost is per output; the total is held in one update.
create function public.start_generation(p_user uuid, p_intents jsonb, p_cost integer) returns setof public.generations
language plpgsql set search_path = '' as $$
declare
  n integer;
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
  update public.user_credits set balance = balance - p_cost * n, updated_at = now()
    where user_id = p_user and balance >= p_cost * n;
  if not found then
    raise exception 'insufficient_credits';
  end if;
  return query
    insert into public.generations (user_id, intent, credits_amount, batch_id, batch_index)
      select p_user, e.value, p_cost, batch, (e.ordinality - 1)::smallint
      from jsonb_array_elements(p_intents) with ordinality as e
      returning *;
end $$;

revoke execute on function public.start_generation(uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function public.start_generation(uuid, jsonb, integer) to service_role;
