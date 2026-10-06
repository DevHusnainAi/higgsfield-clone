-- Storage quota: at most 10 start frames per user. The 11th upload is rejected before it is stored.
-- (Supabase allows triggers and policies on storage.objects; only ALTER TABLE is restricted.)

-- security definer: counts every file in the folder, not just what the uploader's RLS lets them see.
create function public.enforce_reference_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  folder text := (storage.foldername(new.name))[1];
begin
  if new.bucket_id <> 'references' then
    return new;
  end if;
  -- Serializes uploads per folder, so parallel uploads can't all count 9 and slip past the cap.
  perform pg_advisory_xact_lock(hashtextextended('reference_quota:' || coalesce(folder, ''), 0));
  if (select count(*) from storage.objects where bucket_id = 'references' and (storage.foldername(name))[1] = folder) >= 10 then
    raise exception 'reference_quota_exceeded: you can keep up to 10 start frames; delete one to upload another'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke execute on function public.enforce_reference_quota() from public, anon, authenticated;

create trigger enforce_reference_quota
  before insert on storage.objects
  for each row execute function public.enforce_reference_quota();
