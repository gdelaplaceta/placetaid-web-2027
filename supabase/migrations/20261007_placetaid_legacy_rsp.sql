create table if not exists public.plid_v27_legacy_credentials (
  user_id bigint primary key references public.solicitantes(id) on delete cascade,
  password_hash text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.plid_v27_legacy_auth_requests (
  id uuid primary key default gen_random_uuid(),
  request_code text not null unique,
  user_id bigint not null references public.solicitantes(id) on delete cascade,
  service text not null,
  service_url text,
  platform text not null default 'web',
  status text not null default 'pending' check (status in ('pending', 'authorized', 'denied', 'expired')),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists plid_v27_legacy_auth_requests_pending_idx
  on public.plid_v27_legacy_auth_requests (user_id, status, expires_at);

alter table public.rsp_votaciones
  add column if not exists descripcion text not null default '',
  add column if not exists opciones jsonb not null default '["a_favor","en_contra","abstencion"]'::jsonb,
  add column if not exists resultados jsonb not null default '{}'::jsonb,
  add column if not exists destinatarios jsonb not null default '[]'::jsonb,
  add column if not exists reunion_id text,
  add column if not exists requiere_quorum boolean not null default true,
  add column if not exists fecha_limite timestamptz,
  add column if not exists fecha_cierre timestamptz,
  add column if not exists fecha_publicacion timestamptz;

create table if not exists public.rsp_documentos (
  id text primary key,
  titulo text not null,
  tipo text not null default 'documento',
  entidad text not null default 'rsp',
  csv text,
  hash text,
  tramite_id text,
  accion text,
  dip text,
  estado text not null default 'pendiente',
  firmado boolean not null default false,
  creado_en timestamptz not null default now(),
  contenido text,
  destinatarios jsonb not null default '[]'::jsonb,
  firmado_por text,
  fecha_firma timestamptz,
  firma_base64 text
);

create index if not exists rsp_documentos_dip_estado_idx
  on public.rsp_documentos (dip, estado);

alter table public.plid_v27_legacy_credentials enable row level security;
alter table public.plid_v27_legacy_auth_requests enable row level security;
alter table public.rsp_documentos enable row level security;

create or replace function public.plid_v27_legacy_cast_vote(
  p_votacion_id text,
  p_dip text,
  p_nombre text,
  p_categoria text,
  p_voto text,
  p_hash text,
  p_timestamp timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.rsp_votaciones%rowtype;
  vote_id text := 'REG-' || replace(gen_random_uuid()::text, '-', '');
  new_total integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_votacion_id || ':' || p_dip, 0));

  select * into v
    from public.rsp_votaciones
    where id = p_votacion_id
    for update;

  if not found then
    raise exception 'VOTATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if lower(v.estado) not in ('activa', 'abierta', 'publicada') then
    raise exception 'VOTATION_CLOSED' using errcode = 'P0001';
  end if;
  if v.fecha_limite is not null and v.fecha_limite <= now() then
    raise exception 'VOTATION_EXPIRED' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.rsp_registro_votos
    where votacion_id = p_votacion_id and dip = p_dip
  ) then
    raise exception 'DUPLICATE_VOTE' using errcode = '23505';
  end if;

  insert into public.rsp_registro_votos
    (id, votacion_id, dip, nombre, categoria, voto, hash, oficial, "timestamp")
  values
    (vote_id, p_votacion_id, p_dip, p_nombre, p_categoria, p_voto, p_hash, true, p_timestamp);

  update public.rsp_votaciones
  set a_favor = coalesce(a_favor, 0) + case when p_voto = 'a_favor' then 1 else 0 end,
      en_contra = coalesce(en_contra, 0) + case when p_voto = 'en_contra' then 1 else 0 end,
      abstenciones = coalesce(abstenciones, 0) + case when p_voto = 'abstencion' then 1 else 0 end,
      total_votos = coalesce(total_votos, 0) + 1,
      total_emitidos = coalesce(total_emitidos, 0) + 1,
      resultados = jsonb_set(
        coalesce(resultados, '{}'::jsonb),
        array[p_voto],
        to_jsonb(coalesce((resultados ->> p_voto)::integer, 0) + 1),
        true
      )
  where id = p_votacion_id
  returning total_votos into new_total;

  return jsonb_build_object('id', vote_id, 'hash', p_hash, 'timestamp', p_timestamp, 'totalVotos', new_total);
end;
$$;

revoke all on function public.plid_v27_legacy_cast_vote(text, text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.plid_v27_legacy_cast_vote(text, text, text, text, text, text, timestamptz) to service_role;
