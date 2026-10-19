alter table public.plid_v27_integrations
  alter column scopes set default '{"dip":false,"email":false,"phone":false,"photo":false,"identityVerified":false}'::jsonb;

update public.plid_v27_integrations
set scopes = jsonb_set(coalesce(scopes, '{}'::jsonb), '{dip}', 'false'::jsonb, true)
where not (coalesce(scopes, '{}'::jsonb) ? 'dip');

alter table public.plid_v27_consents
  drop constraint if exists plid_v27_consents_field_check;

alter table public.plid_v27_consents
  add constraint plid_v27_consents_field_check
  check (field in ('dip', 'email', 'phone', 'photo', 'identityVerified'));
