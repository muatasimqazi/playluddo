-- Storage for custom photo avatars (lib/avatars/catalog.ts's photo:<style>:<url>
-- scheme). Public bucket — other seated players' clients load this <img>
-- cross-origin with no auth header, same as the static /avatars/*.webp
-- presets already do. Upload path convention: <user_id>/avatar.webp.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatar-photos', 'avatar-photos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "anyone can view avatar photos" on storage.objects
for select to public
using (bucket_id = 'avatar-photos');

create policy "users can upload their own avatar photo" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'avatar-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "users can replace their own avatar photo" on storage.objects
for update to authenticated
using (
  bucket_id = 'avatar-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'avatar-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "users can delete their own avatar photo" on storage.objects
for delete to authenticated
using (
  bucket_id = 'avatar-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
