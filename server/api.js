import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { supabase, supabaseReady } from './supabase.js'
import { createRandomToken, hashDip, hashToken, isValidDip, secureEquals, signSession, verifySession } from './security.js'

export const api = Router()

const migrationTables = [
  'plid_v27_integrations',
  'plid_v27_services',
  'plid_v27_devices',
  'plid_v27_authenticators',
  'plid_v27_user_security',
  'plid_v27_user_access',
  'plid_v27_auth_requests',
  'plid_v27_sessions',
  'plid_v27_consents',
  'plid_v27_oauth_codes',
  'plid_v27_legal_acceptances',
  'plid_v27_audit',
]

const authLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false })

function fail(res, status, code, message) {
  return res.status(status).json({ error: code, message })
}

function handleDbError(res, error) {
  if (error?.code === 'PGRST205' || error?.code === '42P01') {
    return fail(res, 503, 'SCHEMA_MIGRATION_REQUIRED', 'Falta aplicar la migración Supabase de PlacetaID v27.')
  }
  if (error?.code === 'PGRST204' || error?.code === '42703') {
    return fail(res, 503, 'SCHEMA_OUTDATED', 'El esquema Supabase de PlacetaID v27 está desactualizado.')
  }
  console.error('[PlacetaID API]', error?.code || 'DB_ERROR', error?.message || 'Database error')
  return fail(res, 500, 'DATABASE_ERROR', 'No se pudo completar la operación.')
}

function calculateAge(user) {
  if (user.fecha_nacimiento) {
    const birth = new Date(`${user.fecha_nacimiento}T00:00:00`)
    if (!Number.isNaN(birth.getTime())) {
      const today = new Date()
      return today.getFullYear() - birth.getFullYear() - (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate()) ? 1 : 0)
    }
  }
  return Number.isFinite(Number(user.edad)) ? Number(user.edad) : null
}

function userStatus(user, controls) {
  if (Number(user.lista_negra) === 1) return 'suspended'
  if (controls?.status) return controls.status
  const status = String(user.estado || '').toLowerCase()
  if (['pendiente', 'pending'].includes(status)) return 'pending'
  if (['restringido', 'restricted'].includes(status)) return 'restricted'
  if (['suspendido', 'suspended', 'bloqueado', 'blocked'].includes(status)) return 'suspended'
  if (['cerrado', 'closed', 'inactivo', 'inactive'].includes(status)) return 'closed'
  return 'active'
}

function mapService(row) {
  return {
    id: row.id,
    key: row.service_key,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    minAge: row.min_age,
    roles: row.allowed_roles,
  }
}

function mapIntegration(row, services = []) {
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    description: row.description,
    category: row.category,
    initials: row.initials,
    color: row.color,
    status: row.status,
    minAge: row.min_age,
    roles: row.allowed_roles,
    redirectUris: row.redirect_uris,
    scopes: row.scopes,
    services: services.map(mapService),
    updated: row.updated_at,
  }
}

function sessionFromRequest(req) {
  const cookie = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('plid_v27='))
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : cookie?.slice('plid_v27='.length)
  return token ? verifySession(decodeURIComponent(token)) : null
}

async function requireAdmin(req, res, next) {
  const payload = sessionFromRequest(req)
  if (!payload || payload.aud !== 'plid-v27-admin') return fail(res, 401, 'ADMIN_SESSION_REQUIRED', 'Inicia sesión como Administración.')
  req.admin = payload
  next()
}

async function getUserById(id) {
  const { data, error } = await supabase.from('solicitantes')
    .select('id,alias,nombre_real,email,fecha_nacimiento,edad,dip,placeid,rol,estado,lista_negra,ultimo_acceso')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}

async function getAppAndServices(appId) {
  const [{ data: app, error: appError }, { data: services, error: servicesError }] = await Promise.all([
    supabase.from('plid_v27_integrations').select('*').eq('id', appId).maybeSingle(),
    supabase.from('plid_v27_services').select('*').eq('app_id', appId).order('created_at'),
  ])
  if (appError) throw appError
  if (servicesError) throw servicesError
  return app ? { ...app, services: services || [] } : null
}

api.get('/health', async (_req, res) => {
  if (!supabaseReady) return res.status(503).json({ ok: false, code: 'SUPABASE_NOT_CONFIGURED' })
  const checks = await Promise.all(migrationTables.map(async (table) => {
    const { error } = await supabase.from(table).select('id', { head: true }).limit(0)
    return { table, ready: !error, code: error?.code }
  }))
  const missing = checks.filter((check) => !check.ready)
  res.status(missing.length ? 503 : 200).json({ ok: missing.length === 0, database: 'supabase', migrationRequired: missing.length > 0, missingTables: missing.map((item) => item.table) })
})

api.post('/admin/session', authLimiter, (req, res) => {
  const expected = process.env.PLACETAID_V27_ADMIN_KEY || process.env.PLACETAID_ADMIN_KEY || ''
  const supplied = String(req.body?.key || '')
  if (!expected) return fail(res, 503, 'ADMIN_AUTH_NOT_CONFIGURED', 'Configura PLACETAID_V27_ADMIN_KEY en el servidor.')
  if (!secureEquals(expected, supplied)) return fail(res, 401, 'INVALID_ADMIN_KEY', 'La clave de Administración no es válida.')
  res.json({ token: signSession({ aud: 'plid-v27-admin', sub: 'central-admin' }, 8 * 60 * 60), expiresIn: 8 * 60 * 60 })
})

api.get('/admin/apps', requireAdmin, async (_req, res) => {
  try {
    const [{ data: apps, error: appError }, { data: services, error: serviceError }] = await Promise.all([
      supabase.from('plid_v27_integrations').select('*').order('created_at', { ascending: false }),
      supabase.from('plid_v27_services').select('*').order('created_at'),
    ])
    if (appError) throw appError
    if (serviceError) throw serviceError
    res.json((apps || []).map((app) => mapIntegration(app, (services || []).filter((service) => service.app_id === app.id))))
  } catch (error) { handleDbError(res, error) }
})

api.post('/admin/apps', requireAdmin, async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 100)
  if (!name) return fail(res, 400, 'APP_NAME_REQUIRED', 'Indica el nombre de la aplicación.')
  try {
    const clientId = `plid27_${createRandomToken(12)}`
    const clientSecret = createRandomToken(32)
    const appRow = {
      client_id: clientId,
      client_secret_hash: hashToken(clientSecret),
      name,
      description: String(req.body?.description || '').slice(0, 500),
      category: String(req.body?.category || 'Ecosistema').slice(0, 80),
      initials: name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(),
      color: 'violet',
      redirect_uris: Array.isArray(req.body?.redirectUris) ? req.body.redirectUris.filter((value) => /^https:\/\//i.test(value)) : [],
      status: 'pending',
    }
    const { data, error } = await supabase.from('plid_v27_integrations').insert(appRow).select('*').single()
    if (error) throw error
    res.status(201).json({ app: mapIntegration(data), clientSecret })
  } catch (error) { handleDbError(res, error) }
})

api.patch('/admin/apps/:id', requireAdmin, async (req, res) => {
  const allowed = ['name', 'description', 'category', 'redirect_uris', 'status', 'min_age', 'allowed_roles', 'scopes']
  const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([key]) => allowed.includes(key)))
  patch.updated_at = new Date().toISOString()
  try {
    const { data, error } = await supabase.from('plid_v27_integrations').update(patch).eq('id', req.params.id).select('*').maybeSingle()
    if (error) throw error
    if (!data) return fail(res, 404, 'APP_NOT_FOUND', 'No se encontró la aplicación.')
    await supabase.from('plid_v27_audit').insert({ actor_user_id: null, app_id: data.id, event_type: 'integration_policy_updated', details: { fields: Object.keys(patch).filter((key) => key !== 'updated_at') } })
    res.json(mapIntegration(data))
  } catch (error) { handleDbError(res, error) }
})

api.post('/admin/apps/:id/services', requireAdmin, async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 100)
  if (!name) return fail(res, 400, 'SERVICE_NAME_REQUIRED', 'Indica el nombre del servicio.')
  try {
    const { data, error } = await supabase.from('plid_v27_services').insert({
      app_id: req.params.id,
      service_key: String(req.body?.key || name.toLowerCase().replace(/[^a-z0-9]+/g, '-')).slice(0, 80),
      name,
      description: String(req.body?.description || '').slice(0, 300),
      min_age: Number(req.body?.minAge) || 0,
      enabled: false,
    }).select('*').single()
    if (error) throw error
    res.status(201).json(mapService(data))
  } catch (error) { handleDbError(res, error) }
})

api.patch('/admin/services/:id', requireAdmin, async (req, res) => {
  const fields = { name: 'name', description: 'description', enabled: 'enabled', minAge: 'min_age', roles: 'allowed_roles' }
  const patch = Object.fromEntries(Object.entries(fields).filter(([key]) => Object.hasOwn(req.body || {}, key)).map(([key, column]) => [column, req.body[key]]))
  patch.updated_at = new Date().toISOString()
  try {
    const { data, error } = await supabase.from('plid_v27_services').update(patch).eq('id', req.params.id).select('*').maybeSingle()
    if (error) throw error
    if (!data) return fail(res, 404, 'SERVICE_NOT_FOUND', 'No se encontró el servicio.')
    res.json(mapService(data))
  } catch (error) { handleDbError(res, error) }
})

api.get('/admin/users', requireAdmin, async (req, res) => {
  try {
    let query = supabase.from('solicitantes').select('id,alias,nombre_real,email,fecha_nacimiento,edad,dip,placeid,rol,estado,lista_negra,ultimo_acceso').order('creado_en', { ascending: false }).limit(500)
    const search = String(req.query.q || '').trim()
    if (search) query = query.or(`dip.ilike.%${search}%,nombre_real.ilike.%${search}%,placeid.ilike.%${search}%,email.ilike.%${search}%`)
    const { data: users, error } = await query
    if (error) throw error
    const ids = (users || []).map((user) => user.id)
    const [{ data: controls, error: controlsError }, { data: devices, error: devicesError }, { data: consents, error: consentsError }, { data: access, error: accessError }] = await Promise.all([
      supabase.from('plid_v27_user_security').select('*').in('user_id', ids),
      supabase.from('plid_v27_devices').select('user_id,method,active,expires_at,revoked_at,last_seen_at').in('user_id', ids),
      supabase.from('plid_v27_consents').select('*').in('user_id', ids),
      supabase.from('plid_v27_user_access').select('*').in('user_id', ids),
    ])
    if (controlsError) throw controlsError
    if (devicesError) throw devicesError
    if (consentsError) throw consentsError
    if (accessError) throw accessError
    const controlsById = new Map((controls || []).map((row) => [row.user_id, row]))
    res.json((users || []).map((user) => {
      const security = controlsById.get(user.id)
      const sessions = (devices || []).filter((row) => row.user_id === user.id && row.active && !row.revoked_at && Date.parse(row.expires_at) > Date.now())
      return {
        id: String(user.id), dip: user.dip, placeid: user.placeid, name: user.alias || String(user.nombre_real || '').split(/\s+/)[0],
        surname: user.alias ? user.nombre_real || '' : String(user.nombre_real || '').split(/\s+/).slice(1).join(' '),
        birthDate: user.fecha_nacimiento, age: calculateAge(user), email: user.email, phone: null, role: user.rol,
        status: userStatus(user, security), identityVerified: Boolean(security?.identity_verified),
        auth: { mobile: sessions.some((row) => row.method === 'mobile'), authenticator: sessions.some((row) => row.method === 'authenticator'), desktop: sessions.some((row) => row.method === 'desktop') },
        appOverrides: Object.fromEntries((access || []).filter((row) => row.user_id === user.id).map((row) => [row.app_id, row.decision])),
        permissions: (consents || []).filter((row) => row.user_id === user.id).map((row) => ({ appId: row.app_id, field: row.field, status: row.status, updated: row.updated_at })),
        lastAccess: user.ultimo_acceso,
      }
    }))
  } catch (error) { handleDbError(res, error) }
})

api.patch('/admin/users/:id', requireAdmin, async (req, res) => {
  const statuses = new Set(['active', 'pending', 'restricted', 'suspended', 'closed'])
  if (req.body?.status && !statuses.has(req.body.status)) return fail(res, 400, 'INVALID_USER_STATUS', 'El estado de la identidad no es válido.')
  try {
    const { data, error } = await supabase.from('plid_v27_user_security').upsert({
      user_id: Number(req.params.id),
      ...(req.body?.status ? { status: req.body.status } : {}),
      ...(typeof req.body?.identityVerified === 'boolean' ? { identity_verified: req.body.identityVerified } : {}),
      updated_at: new Date().toISOString(),
    }).select('*').single()
    if (error) throw error
    await supabase.from('plid_v27_audit').insert({ target_user_id: Number(req.params.id), event_type: 'user_security_updated', details: { fields: Object.keys(req.body || {}) } })
    res.json(data)
  } catch (error) { handleDbError(res, error) }
})

api.post('/public/identify', authLimiter, async (req, res) => {
  const dip = normalizeDip(req.body?.dip)
  if (!isValidDip(dip)) return fail(res, 400, 'INVALID_DIP', 'Revisa el DIP: debe contener 8 números y una letra.')
  try {
    const { data: user, error } = await supabase.from('solicitantes')
      .select('id,dip,alias,nombre_real,fecha_nacimiento,edad,placeid,rol,estado,lista_negra')
      .eq('dip', dip).maybeSingle()
    if (error) throw error
    if (!user || Number(user.lista_negra) === 1 || !['activo', 'active', ''].includes(String(user.estado || '').toLowerCase())) {
      return fail(res, 401, 'IDENTITY_NOT_AVAILABLE', 'No se pudo iniciar la identificación. Revisa los datos o contacta con Administración.')
    }

    let app = null
    let service = null
    if (req.body?.clientId) {
      const { data, error: appError } = await supabase.from('plid_v27_integrations').select('*').eq('client_id', req.body.clientId).eq('status', 'authorized').maybeSingle()
      if (appError) throw appError
      app = data
      if (!app || !Array.isArray(app.redirect_uris) || !app.redirect_uris.includes(req.body.redirectUri)) return fail(res, 403, 'APP_NOT_AUTHORIZED', 'La aplicación solicitante no está autorizada para PlacetaID.')
      const serviceQuery = supabase.from('plid_v27_services').select('*').eq('app_id', app.id).eq('enabled', true)
      const { data: serviceData, error: serviceError } = req.body.serviceKey
        ? await serviceQuery.eq('service_key', req.body.serviceKey).maybeSingle()
        : await serviceQuery.order('created_at').limit(1).maybeSingle()
      if (serviceError) throw serviceError
      service = serviceData
      if (!service) return fail(res, 403, 'SERVICE_NOT_AVAILABLE', 'El servicio solicitado no está disponible.')
    }

    const [{ data: devices, error: devicesError }, { data: authenticator, error: authenticatorError }] = await Promise.all([
      supabase.from('plid_v27_devices').select('method').eq('user_id', user.id).eq('active', true).is('revoked_at', null).gt('expires_at', new Date().toISOString()),
      supabase.from('plid_v27_authenticators').select('enabled').eq('user_id', user.id).maybeSingle(),
    ])
    if (devicesError) throw devicesError
    if (authenticatorError) throw authenticatorError
    const sessions = new Set((devices || []).map((row) => row.method))
    const method = sessions.has('mobile') ? 'mobile' : authenticator?.enabled && sessions.has('authenticator') ? 'authenticator' : sessions.has('desktop') ? 'desktop' : null
    if (!method) return fail(res, 409, 'NO_ACTIVE_METHOD', 'No hay un método de identificación activo. Vincula PlacetaID móvil o Desktop desde un dispositivo seguro.')

    const { data: request, error: requestError } = await supabase.from('plid_v27_auth_requests').insert({
      request_code: createRandomToken(18), user_id: user.id, app_id: app?.id ?? null, service_id: service?.id ?? null,
      method, state: String(req.body?.state || '').slice(0, 300) || null,
      redirect_uri: app ? req.body.redirectUri : null,
      status: 'pending',
    }).select('id,method,expires_at').single()
    if (requestError) throw requestError
    res.status(201).json({ requestId: request.id, method: request.method, expiresAt: request.expires_at, app: app ? { name: app.name } : null, service: service ? { name: service.name } : null })
  } catch (error) { handleDbError(res, error) }
})

api.post('/public/authenticate', authLimiter, async (req, res) => {
  const requestId = String(req.body?.requestId || '')
  const code = String(req.body?.code || '')
  if (!requestId || !/^\d{6}$/.test(code)) return fail(res, 400, 'TOTP_REQUIRED', 'Introduce el código de seis cifras del Autentificador.')
  try {
    const { data: request, error: requestError } = await supabase.from('plid_v27_auth_requests').select('*').eq('id', requestId).maybeSingle()
    if (requestError) throw requestError
    if (!request || request.status !== 'pending' || Date.parse(request.expires_at) <= Date.now()) return fail(res, 410, 'REQUEST_EXPIRED', 'La solicitud de acceso ha caducado. Empieza de nuevo.')
    if (request.method !== 'authenticator') return fail(res, 409, 'DEVICE_CONFIRMATION_REQUIRED', 'Confirma la solicitud desde el dispositivo indicado.')
    const { data: secret, error: secretError } = await supabase.from('plid_v27_authenticators').select('secret_encrypted,enabled').eq('user_id', request.user_id).maybeSingle()
    if (secretError) throw secretError
    if (!secret?.enabled || !verifyTotp(decryptSecret(secret.secret_encrypted), code)) return fail(res, 401, 'INVALID_TOTP', 'El código del Autentificador no es válido.')
    const { error: updateError } = await supabase.from('plid_v27_auth_requests').update({ status: 'authorized', completed_at: new Date().toISOString() }).eq('id', request.id)
    if (updateError) throw updateError
    await supabase.from('plid_v27_audit').insert({ actor_user_id: request.user_id, target_user_id: request.user_id, app_id: request.app_id, event_type: 'identity_authenticated', details: { method: 'authenticator' } })
    const { data: updated } = await supabase.from('plid_v27_auth_requests').select('*').eq('id', request.id).single()
    res.json(await completeAuthorizedRequest(updated, res))
  } catch (error) { handleDbError(res, error) }
})

async function completeAuthorizedRequest(request, res) {
  const user = await getUserById(request.user_id)
  if (!user) throw Object.assign(new Error('IDENTITY_NOT_FOUND'), { code: 'PGRST116' })
  if (Number(user.lista_negra) === 1 || !['activo', 'active', ''].includes(String(user.estado || '').toLowerCase())) return { stage: 'denied', reason: 'ACCOUNT_NOT_ACTIVE', login_correct: false }
  const [{ data: controls, error: controlsError }, { data: legal, error: legalError }] = await Promise.all([
    supabase.from('plid_v27_user_security').select('status,identity_verified').eq('user_id', user.id).maybeSingle(),
    supabase.from('plid_v27_legal_acceptances').select('document_type,version').eq('user_id', user.id),
  ])
  if (controlsError) throw controlsError
  if (legalError) throw legalError
  const status = controls?.status || 'active'
  if (status !== 'active' && status !== 'restricted') return { stage: 'denied', reason: 'ACCOUNT_NOT_ACTIVE', login_correct: false }
  const legalAccepted = new Set((legal || []).map((item) => `${item.document_type}:${item.version}`))
  const legalRequired = [{ type: 'terms', version: 'v27-2026-10' }, { type: 'privacy', version: 'v27-2026-10' }].filter((item) => !legalAccepted.has(`${item.type}:${item.version}`))
  if (legalRequired.length) return { stage: 'legal_required', requestId: request.id, documents: legalRequired }

  let app = null
  let service = null
  if (request.app_id) {
    const pair = await getAppAndServices(request.app_id)
    app = pair
    service = pair?.services.find((item) => item.id === request.service_id)
    if (!app || app.status !== 'authorized' || !service || !service.enabled) return { stage: 'denied', reason: 'APP_OR_SERVICE_DISABLED', login_correct: false }
    const age = calculateAge(user)
    const requiredAge = Math.max(Number(app.min_age) || 0, Number(service.min_age) || 0)
    const roles = Array.isArray(service.allowed_roles) ? service.allowed_roles : app.allowed_roles
    const { data: override, error: overrideError } = await supabase.from('plid_v27_user_access').select('decision').eq('user_id', user.id).eq('app_id', app.id).maybeSingle()
    if (overrideError) throw overrideError
    if (override?.decision === 'deny' || !app.allowed_roles.includes(user.rol) || (Array.isArray(roles) && !roles.includes(user.rol)) || (age !== null && age < requiredAge)) return { stage: 'denied', reason: 'ACCESS_POLICY', login_correct: false }
    if (status === 'restricted') return { stage: 'denied', reason: 'ACCOUNT_RESTRICTED', login_correct: false }

    const protectedFields = ['email', 'phone', 'photo', 'identityVerified'].filter((field) => app.scopes?.[field])
    if (protectedFields.length) {
      const { data: consents, error: consentError } = await supabase.from('plid_v27_consents').select('field,status').eq('user_id', user.id).eq('app_id', app.id)
      if (consentError) throw consentError
      const consentByField = new Map((consents || []).map((item) => [item.field, item.status]))
      const missing = protectedFields.filter((field) => !consentByField.has(field))
      if (missing.length) {
        const { error: pendingError } = await supabase.from('plid_v27_consents').upsert(missing.map((field) => ({ user_id: user.id, app_id: app.id, field, status: 'pending', updated_at: new Date().toISOString() })), { onConflict: 'user_id,app_id,field', ignoreDuplicates: true })
        if (pendingError) throw pendingError
        return { stage: 'consent_required', requestId: request.id, app: { id: app.id, name: app.name }, fields: missing }
      }
    }
  }

  const age = calculateAge(user)
  const { data: userConsents, error: userConsentError } = request.app_id
    ? await supabase.from('plid_v27_consents').select('field,status').eq('user_id', user.id).eq('app_id', request.app_id)
    : { data: [], error: null }
  if (userConsentError) throw userConsentError
  const granted = new Set((userConsents || []).filter((item) => item.status === 'granted').map((item) => item.field))
  const claims = {
    login_correct: true,
    over_16: age !== null && age >= 16,
    over_18: age !== null && age >= 18,
    name: String(user.alias || user.nombre_real || '').trim().split(/\s+/)[0] || '',
    surname: user.alias ? String(user.nombre_real || '') : String(user.nombre_real || '').trim().split(/\s+/).slice(1).join(' '),
    dip: user.dip,
    ...(app?.scopes?.email && granted.has('email') ? { email: user.email } : {}),
    ...(app?.scopes?.identityVerified && controls?.identity_verified && granted.has('identityVerified') ? { identity_verified: true } : {}),
  }
  if (request.app_id) {
    const code = createRandomToken(32)
    const { error: codeError } = await supabase.from('plid_v27_oauth_codes').insert({ code_hash: hashToken(code), user_id: user.id, app_id: app.id, redirect_uri: request.redirect_uri, scopes: app.scopes, claims, expires_at: new Date(Date.now() + 90_000).toISOString() })
    if (codeError) throw codeError
    const callback = new URL(request.redirect_uri)
    callback.searchParams.set('code', code)
    if (request.state) callback.searchParams.set('state', request.state)
    return { stage: 'complete', login_correct: true, redirectUrl: callback.toString(), claims }
  }

  const sessionToken = createRandomToken(32)
  const { error: sessionError } = await supabase.from('plid_v27_sessions').insert({ token_hash: hashToken(sessionToken), user_id: user.id, expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString() })
  if (sessionError) throw sessionError
  res.cookie('plid_v27', sessionToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 8 * 60 * 60 * 1000 })
  return { stage: 'complete', login_correct: true, claims: { ...claims, email: undefined } }
}

api.get('/public/auth-requests/:id', async (req, res) => {
  try {
    const { data: request, error } = await supabase.from('plid_v27_auth_requests').select('*').eq('id', req.params.id).maybeSingle()
    if (error) throw error
    if (!request || Date.parse(request.expires_at) <= Date.now()) return fail(res, 410, 'REQUEST_EXPIRED', 'La solicitud de acceso ha caducado.')
    if (request.status !== 'authorized') return res.json({ stage: request.status === 'denied' ? 'denied' : 'waiting', method: request.method })
    res.json(await completeAuthorizedRequest(request, res))
  } catch (error) { handleDbError(res, error) }
})

api.post('/public/accept-legal', async (req, res) => {
  const requestId = String(req.body?.requestId || '')
  const accepted = req.body?.accepted === true
  if (!requestId || !accepted) return fail(res, 400, 'LEGAL_ACCEPTANCE_REQUIRED', 'Debes aceptar los documentos para continuar.')
  try {
    const { data: request, error } = await supabase.from('plid_v27_auth_requests').select('id,user_id,status,expires_at').eq('id', requestId).maybeSingle()
    if (error) throw error
    if (!request || request.status !== 'authorized' || Date.parse(request.expires_at) <= Date.now()) return fail(res, 410, 'REQUEST_EXPIRED', 'La solicitud de acceso ha caducado.')
    const rows = ['terms', 'privacy'].map((document_type) => ({ user_id: request.user_id, document_type, version: 'v27-2026-10' }))
    const { error: acceptError } = await supabase.from('plid_v27_legal_acceptances').upsert(rows, { onConflict: 'user_id,document_type,version', ignoreDuplicates: true })
    if (acceptError) throw acceptError
    res.json(await completeAuthorizedRequest(request, res))
  } catch (error) { handleDbError(res, error) }
})

api.post('/public/consents', async (req, res) => {
  const requestId = String(req.body?.requestId || '')
  const field = String(req.body?.field || '')
  const decision = req.body?.decision === 'granted' ? 'granted' : req.body?.decision === 'denied' ? 'denied' : ''
  if (!requestId || !['email', 'phone', 'photo', 'identityVerified'].includes(field) || !decision) return fail(res, 400, 'INVALID_CONSENT', 'La decisión de consentimiento no es válida.')
  try {
    const { data: request, error } = await supabase.from('plid_v27_auth_requests').select('*').eq('id', requestId).maybeSingle()
    if (error) throw error
    if (!request || request.status !== 'authorized' || Date.parse(request.expires_at) <= Date.now()) return fail(res, 410, 'REQUEST_EXPIRED', 'La solicitud de acceso ha caducado.')
    if (!request.app_id) return fail(res, 400, 'APP_REQUIRED', 'Esta solicitud no pertenece a una aplicación.')
    const { data: app, error: appError } = await supabase.from('plid_v27_integrations').select('id,name,status,scopes').eq('id', request.app_id).maybeSingle()
    if (appError) throw appError
    if (!app || app.status !== 'authorized' || !app.scopes?.[field]) return fail(res, 403, 'SCOPE_NOT_ALLOWED', 'La aplicación no tiene permiso para solicitar este dato.')
    const { error: consentError } = await supabase.from('plid_v27_consents').upsert({ user_id: request.user_id, app_id: app.id, field, status: decision, granted_at: decision === 'granted' ? new Date().toISOString() : null, revoked_at: null, updated_at: new Date().toISOString() }, { onConflict: 'user_id,app_id,field' })
    if (consentError) throw consentError
    await supabase.from('plid_v27_audit').insert({ actor_user_id: request.user_id, target_user_id: request.user_id, app_id: app.id, event_type: decision === 'granted' ? 'consent_granted' : 'consent_denied', details: { field } })
    res.json(await completeAuthorizedRequest(request, res))
  } catch (error) { handleDbError(res, error) }
})

export { calculateAge, mapIntegration, mapService, requireAdmin }