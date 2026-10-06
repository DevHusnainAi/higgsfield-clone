-- Start-frame uploads. Private bucket: files are never publicly addressable.
-- Each user owns the folder named after their auth id: "<auth.uid()>/<uuid>.<ext>".
-- The browser uploads here directly; the API only ever receives the path, checks the folder, and the server
-- reads the bytes back with the service role. No user-supplied URL is fetched by anything.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('references', 'references', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- No update policy: files can't be overwritten after the server has validated a path.
create policy "Users upload references to their own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'references' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users read their own references" on storage.objects
  for select to authenticated
  using (bucket_id = 'references' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users delete their own references" on storage.objects
  for delete to authenticated
  using (bucket_id = 'references' and (storage.foldername(name))[1] = (select auth.uid())::text);
