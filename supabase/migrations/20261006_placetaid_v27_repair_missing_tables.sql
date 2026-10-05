create table if not exists public.plid_v27_authenticators (
  user_id bigint primary key references public.solicitantes(id) on delete cascade,
  secret_encrypted text not null,
  enabled boolean not null default true,
  enrolled_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plid_v27_user_access (
  user_id bigint not null references public.solicitantes(id) on delete cascade,
  app_id uuid not null references public.plid_v27_integrations(id) on delete cascade,
  decision text not null check (decision in ('allow', 'deny')),
  reason text not null default '',
  updated_at timestamptz not null default now(),
  updated_by bigint references public.solicitantes(id) on delete set null,
  primary key (user_id, app_id)
);

create table if not exists public.plid_v27_user_security (
  user_id bigint primary key references public.solicitantes(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'pending', 'restricted', 'suspended', 'closed')),
  identity_verified boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by bigint references public.solicitantes(id) on delete set null
);

create table if not exists public.plid_v27_sessions (
  token_hash text primary key,
  user_id bigint not null references public.solicitantes(id) on delete cascade,
  app_id uuid references public.plid_v27_integrations(id) on delete cascade,
  service_id uuid references public.plid_v27_services(id) on delete set null,
  auth_request_id uuid references public.plid_v27_auth_requests(id) on delete set null,
  scopes jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists plid_v27_sessions_user_active_idx
  on public.plid_v27_sessions (user_id, expires_at) where revoked_at is null;

create table if not exists public.plid_v27_oauth_codes (
  code_hash text primary key,
  user_id bigint not null references public.solicitantes(id) on delete cascade,
  app_id uuid not null references public.plid_v27_integrations(id) on delete cascade,
  redirect_uri text not null,
  code_challenge text,
  claims jsonb not null default '{}'::jsonb,
  scopes jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.plid_v27_authenticators enable row level security;
alter table public.plid_v27_user_access enable row level security;
alter table public.plid_v27_user_security enable row level security;
alter table public.plid_v27_sessions enable row level security;
alter table public.plid_v27_oauth_codes enable row level security;

revoke all on public.plid_v27_authenticators, public.plid_v27_user_access,
  public.plid_v27_user_security, public.plid_v27_sessions,
  public.plid_v27_oauth_codes from anon, authenticated;

grant all on public.plid_v27_authenticators, public.plid_v27_user_access,
  public.plid_v27_user_security, public.plid_v27_sessions,
  public.plid_v27_oauth_codes to service_role;
