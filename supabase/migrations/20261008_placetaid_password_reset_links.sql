create table if not exists public.plid_v27_password_reset_links (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references public.solicitantes(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  delivered_to text not null default 'administration'
);

create index if not exists plid_v27_password_reset_links_user_idx
  on public.plid_v27_password_reset_links (user_id, expires_at);
create index if not exists plid_v27_password_reset_links_expiry_idx
  on public.plid_v27_password_reset_links (expires_at);

alter table public.plid_v27_password_reset_links enable row level security;
revoke all on public.plid_v27_password_reset_links from anon, authenticated;
grant all on public.plid_v27_password_reset_links to service_role;
