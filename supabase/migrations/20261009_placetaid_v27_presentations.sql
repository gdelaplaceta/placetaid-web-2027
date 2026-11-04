-- PlacetaID v27 · Códigos de presentación para QR y NFC.
-- Cada código es de un solo uso, caduca en 60 s y solo se guarda su hash.
create table if not exists public.plid_v27_presentations (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references public.solicitantes(id) on delete cascade,
  device_id uuid references public.plid_v27_devices(id) on delete set null,
  code_hash text not null unique,
  channel text not null check (channel in ('qr', 'nfc')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists plid_v27_presentations_user_idx
  on public.plid_v27_presentations (user_id, expires_at);

alter table public.plid_v27_presentations enable row level security;
revoke all on public.plid_v27_presentations from anon, authenticated;

-- Evidencia de aceptación legal al vincular una identidad o un dispositivo.
alter table public.plid_v27_legal_acceptances
  add column if not exists context text not null default 'gateway';
