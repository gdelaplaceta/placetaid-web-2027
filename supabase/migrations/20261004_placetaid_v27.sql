create extension if not exists pgcrypto;

create table if not exists public.plid_v27_integrations (
  id uuid primary key default gen_random_uuid(),
  client_id text not null unique,
  client_secret_hash text,
  name text not null,
  description text not null default '',
  category text not null default 'Ecosistema',
  initials text not null default 'ID',
  color text not null default 'violet',
  redirect_uris text[] not null default '{}',
  pkce_required boolean not null default true,
  status text not null default 'pending' check (status in ('pending', 'authorized', 'disabled')),
  min_age smallint not null default 0 check (min_age in (0, 16, 18)),
  allowed_roles text[] not null default '{miembro}',
  scopes jsonb not null default '{"dip":false,"email":false,"phone":false,"photo":false,"identityVerified":false}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plid_v27_services (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.plid_v27_integrations(id) on delete cascade,
  service_key text not null,
  name text not null,
  description text not null default '',
  enabled boolean not null default true,
  min_age smallint not null default 0 check (min_age in (0, 16, 18)),
  allowed_roles text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (app_id, service_key)
);

create table if not exists public.plid_v27_devices (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references public.solicitantes(id) on delete cascade,
  device_id text not null,
  device_name text not null default 'Dispositivo',
  method text not null check (method in ('mobile', 'authenticator', 'desktop')),
  session_token_hash text not null unique,
  active boolean not null default true,
  expires_at timestamptz not null,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, device_id)
);

create index if not exists plid_v27_devices_user_active_idx
  on public.plid_v27_devices (user_id, active, expires_at);

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

create table if not exists public.plid_v27_auth_requests (
  id uuid primary key default gen_random_uuid(),
  request_code text not null unique,
  user_id bigint not null references public.solicitantes(id) on delete cascade,
  app_id uuid references public.plid_v27_integrations(id) on delete cascade,
  service_id uuid references public.plid_v27_services(id) on delete cascade,
  method text not null check (method in ('mobile', 'authenticator', 'desktop')),
  status text not null default 'pending' check (status in ('pending', 'authorized', 'denied', 'expired')),
  state text,
  redirect_uri text,
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists plid_v27_auth_requests_user_status_idx
  on public.plid_v27_auth_requests (user_id, status, expires_at);

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

create table if not exists public.plid_v27_consents (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references public.solicitantes(id) on delete cascade,
  app_id uuid not null references public.plid_v27_integrations(id) on delete cascade,
  field text not null check (field in ('dip', 'email', 'phone', 'photo', 'identityVerified')),
  status text not null check (status in ('pending', 'granted', 'denied', 'revoked')),
  granted_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, app_id, field)
);

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

create table if not exists public.plid_v27_legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references public.solicitantes(id) on delete cascade,
  document_type text not null check (document_type in ('terms', 'privacy')),
  version text not null,
  accepted_at timestamptz not null default now(),
  unique (user_id, document_type, version)
);

create table if not exists public.plid_v27_audit (
  id bigint generated always as identity primary key,
  actor_user_id bigint references public.solicitantes(id) on delete set null,
  target_user_id bigint references public.solicitantes(id) on delete set null,
  app_id uuid references public.plid_v27_integrations(id) on delete set null,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists plid_v27_audit_created_idx
  on public.plid_v27_audit (created_at desc);
create index if not exists plid_v27_audit_target_idx
  on public.plid_v27_audit (target_user_id, created_at desc);

alter table public.plid_v27_integrations enable row level security;
alter table public.plid_v27_services enable row level security;
alter table public.plid_v27_devices enable row level security;
alter table public.plid_v27_authenticators enable row level security;
alter table public.plid_v27_user_access enable row level security;
alter table public.plid_v27_user_security enable row level security;
alter table public.plid_v27_auth_requests enable row level security;
alter table public.plid_v27_sessions enable row level security;
alter table public.plid_v27_consents enable row level security;
alter table public.plid_v27_oauth_codes enable row level security;
alter table public.plid_v27_legal_acceptances enable row level security;
alter table public.plid_v27_audit enable row level security;

revoke all on public.plid_v27_integrations, public.plid_v27_services,
  public.plid_v27_devices, public.plid_v27_authenticators,
  public.plid_v27_user_access, public.plid_v27_auth_requests,
  public.plid_v27_user_security, public.plid_v27_sessions, public.plid_v27_consents,
  public.plid_v27_oauth_codes, public.plid_v27_legal_acceptances,
  public.plid_v27_audit from anon, authenticated;

grant all on public.plid_v27_integrations, public.plid_v27_services,
  public.plid_v27_devices, public.plid_v27_authenticators,
  public.plid_v27_user_access, public.plid_v27_auth_requests,
  public.plid_v27_user_security, public.plid_v27_sessions, public.plid_v27_consents,
  public.plid_v27_oauth_codes, public.plid_v27_legal_acceptances,
  public.plid_v27_audit to service_role;
grant usage, select on sequence public.plid_v27_audit_id_seq to service_role;