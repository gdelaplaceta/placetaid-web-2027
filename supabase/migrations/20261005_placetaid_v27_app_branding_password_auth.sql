alter table public.plid_v27_integrations
  add column if not exists logo_url text,
  add column if not exists brand_color text;

alter table public.plid_v27_auth_requests
  drop constraint if exists plid_v27_auth_requests_method_check;

alter table public.plid_v27_auth_requests
  add constraint plid_v27_auth_requests_method_check
  check (method in ('mobile', 'authenticator', 'desktop', 'password'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('plid27-app-logos', 'plid27-app-logos', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
