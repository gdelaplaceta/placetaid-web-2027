import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import { randomBytes, randomUUID } from 'node:crypto'
import { supabase, supabaseReady } from './supabase.js'
import { createRandomToken, encryptSecret, hashToken, isValidDip, normalizeDip, secureEquals, signSession, verifySession } from './security.js'
import { legacyApi } from './legacy/api.js'

export const api = Router()

const migrationTables = [
  ['plid_v27_integrations', 'status'],
  ['plid_v27_integrations', 'logo_url'],
  ['plid_v27_integrations', 'brand_color'],
  ['plid_v27_services', 'enabled'],
  ['plid_v27_devices', 'active'],
  ['plid_v27_authenticators', 'enabled'],
  ['plid_v27_user_security', 'status'],
  ['plid_v27_user_access', 'decision'],
  ['plid_v27_auth_requests', 'status'],
  ['plid_v27_auth_requests', 'method'],
  ['plid_v27_sessions', 'expires_at'],
  ['plid_v27_consents', 'status'],
  ['plid_v27_oauth_codes', 'expires_at'],
  ['plid_v27_legal_acceptances', 'document_type'],
  ['plid_v27_audit', 'event_type'],
  ['plid_v27_legacy_credentials', 'password_hash'],
  ['plid_v27_legacy_auth_requests', 'request_code'],
  ['rsp_votaciones', 'opciones'],
  ['rsp_registro_votos', 'votacion_id'],
  ['rsp_documentos', 'contenido'],
  ['rsp_notificaciones', 'destinatario_dip'],
]

const authLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false })
const identifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const resetAt = req.rateLimit?.resetTime?.getTime()
    const retryAfter = resetAt ? Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)) : 600
    res.setHeader('Retry-After', String(retryAfter))
    fail(res, 429, 'IDENTIFY_RATE_LIMITED', `Se alcanzó el límite temporal de identificaciones. Desactiva el autoclicker y espera ${Math.ceil(retryAfter / 60)} minuto(s) antes de volver a intentarlo.`)
  },
})
const deviceEnrollmentLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false })
const deviceLifetimeMs = 365 * 24 * 60 * 60 * 1000
const shareableConsentFields = ['dip', 'email', 'identityVerified']
const unavailableConsentFields = ['phone', 'photo']
const baseDisclosureFields = ['login_correct', 'over_16', 'over_18', 'name', 'surname']

function fail(res, status, code, message) {
  return res.status(status).json({ error: code, message })
}

function isAllowedRedirectUri(value) {
  try {
    const uri = new URL(String(value))
    if (uri.username || uri.password || uri.hash) return false
    if (uri.protocol === 'https:') return true
    return uri.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname)
  } catch {
    return false
  }
}

function setSessionCookie(res, token) {
  const attributes = [
    `plid_v27=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=28800',
  ]
  if (process.env.NODE_ENV === 'production') attributes.push('Secure')
  res.setHeader('Set-Cookie', attributes.join('; '))
}

function handleDbError(res, error) {
  if (error?.code === 'INVALID_OAUTH_REQUEST') {
    return fail(res, 400, error.message, 'No se pudo validar la aplicación solicitante o su dirección de retorno. Vuelve a iniciar el acceso desde la aplicación.')
  }
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

async function findOrCreateLinkedIdentity(dip, profile) {
  const { data: existing, error: lookupError } = await supabase.from('solicitantes')
    .select('id,dip,estado,lista_negra')
    .eq('dip', dip)
    .maybeSingle()
  if (lookupError) throw lookupError
  if (existing || !profile || typeof profile !== 'object') return existing

  const alias = String(profile.placeid || `PLID-${dip}`).trim().slice(0, 80) || `PLID-${dip}`
  const fullName = [profile.nombre, profile.apellidos].filter(Boolean).map((value) => String(value).trim()).join(' ').slice(0, 160)
  const role = ['administrador', 'miembro', 'entidad', 'visitante', 'moderador', 'empresa'].includes(String(profile.rol))
    ? String(profile.rol)
    : 'miembro'
  const blocked = profile.bloqueado === true || profile.banned === true || profile.activo === false
  const birthDate = profile.fechaNacimiento && Number.isFinite(Date.parse(profile.fechaNacimiento))
    ? new Date(profile.fechaNacimiento).toISOString().slice(0, 10)
    : null
  const email = String(profile.correo || '').trim().toLowerCase()
  const identity = {
    dip,
    alias,
    nombre_real: fullName || alias,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    fecha_nacimiento: birthDate,
    placeid: alias,
    rol: role,
    estado: blocked ? 'suspendido' : 'activo',
    lista_negra: blocked ? 1 : 0,
  }
  if (Number.isInteger(profile.edad) && profile.edad >= 0 && profile.edad <= 130) identity.edad = profile.edad

  const insertIdentity = () => supabase.from('solicitantes')
    .insert(identity)
    .select('id,dip,estado,lista_negra')
    .single()
  let result = await insertIdentity()
  if (result.error?.code === '23505') {
    const { data: raced, error: racedError } = await supabase.from('solicitantes')
      .select('id,dip,estado,lista_negra')
      .eq('dip', dip)
      .maybeSingle()
    if (racedError) throw racedError
    if (raced) return raced
    identity.alias = `PLID-${dip}`
    identity.placeid = identity.alias
    identity.email = null
    result = await insertIdentity()
    if (result.error?.code === '23505') {
      const { data: retried, error: retryError } = await supabase.from('solicitantes')
        .select('id,dip,estado,lista_negra')
        .eq('dip', dip)
        .maybeSingle()
      if (retryError) throw retryError
      if (retried) return retried
    }
  }
  if (result.error) throw result.error
  return result.data
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
    logoUrl: row.logo_url || '',
    brandColor: row.brand_color || '',
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

function requireDeviceEnrollmentKey(req, res, next) {
  const expected = String(process.env.PLACETAID_V27_DEVICE_KEY || '')
  if (expected.length < 32) return fail(res, 503, 'DEVICE_LINKING_NOT_CONFIGURED', 'La sincronización segura de dispositivos v27 no está configurada.')
  const supplied = String(req.headers['x-placetaid-device-key'] || '')
  if (!secureEquals(expected, supplied)) return fail(res, 401, 'INVALID_DEVICE_LINKING_KEY', 'No se autorizó la vinculación del dispositivo.')
  next()
}

async function requireUserSession(req, res, next) {
  const cookie = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('plid_v27='))
  const token = cookie?.slice('plid_v27='.length)
  if (!token) return fail(res, 401, 'USER_SESSION_REQUIRED', 'Inicia sesión en PlacetaID para continuar.')
  try {
    const { data: session, error } = await supabase.from('plid_v27_sessions')
      .select('user_id,expires_at,revoked_at')
      .eq('token_hash', hashToken(decodeURIComponent(token)))
      .maybeSingle()
    if (error) throw error
    if (!session || session.revoked_at || Date.parse(session.expires_at) <= Date.now()) {
      return fail(res, 401, 'USER_SESSION_EXPIRED', 'La sesión de PlacetaID ha caducado.')
    }
    req.userId = session.user_id
    next()
  } catch (error) { handleDbError(res, error) }
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
  const checks = await Promise.all(migrationTables.map(async ([table, column]) => {
    const { error } = await supabase.from(table).select(column).limit(1)
    return { table, ready: !error, code: error?.code }
  }))
  const missing = checks.filter((check) => !check.ready)
  res.status(missing.length ? 503 : 200).json({
    ok: missing.length === 0,
    database: 'supabase',
    migrationRequired: missing.length > 0,
    missingTables: missing.map((item) => item.table),
    deviceBridgeConfigured: String(process.env.PLACETAID_V27_DEVICE_KEY || '').length >= 32,
    passwordLoginEnabled: process.env.PLACETAID_V27_PASSWORD_LOGIN_ENABLED !== 'false',
  })
})

api.post('/admin/session', authLimiter, (req, res) => {
  const expected = process.env.PLACETAID_V27_ADMIN_KEY || process.env.PLACETAID_ADMIN_KEY || process.env.ADMIN_PASSWORD || ''
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
  const redirectUris = Array.isArray(req.body?.redirectUris)
    ? [...new Set(req.body.redirectUris.map((value) => String(value).trim()))]
    : []
  if (!redirectUris.length || redirectUris.some((uri) => !isAllowedRedirectUri(uri))) {
    return fail(res, 400, 'INVALID_REDIRECT_URI', 'Registra al menos una URL HTTPS válida; HTTP solo se permite en localhost.')
  }
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
      logo_url: null,
      brand_color: null,
      redirect_uris: redirectUris,
      allowed_roles: ['administrador', 'miembro'],
      status: 'pending',
    }
    const { data, error } = await supabase.from('plid_v27_integrations').insert(appRow).select('*').single()
    if (error) throw error
    const { data: service, error: serviceError } = await supabase.from('plid_v27_services').insert({
      app_id: data.id,
      service_key: 'general',
      name: 'Acceso general',
      description: 'Inicio de sesión en la aplicación',
      enabled: true,
      min_age: 0,
      allowed_roles: ['administrador', 'miembro'],
    }).select('*').single()
    if (serviceError) {
      const { error: rollbackError } = await supabase.from('plid_v27_integrations').delete().eq('id', data.id)
      if (rollbackError) console.error('[PlacetaID API] No se pudo revertir la integración incompleta:', rollbackError.code || rollbackError.message)
      throw serviceError
    }
    res.status(201).json({ app: mapIntegration(data, [service]), clientSecret })
  } catch (error) { handleDbError(res, error) }
})

api.patch('/admin/apps/:id', requireAdmin, async (req, res) => {
  const allowed = ['name', 'description', 'category', 'redirect_uris', 'status', 'min_age', 'allowed_roles', 'scopes', 'brand_color']
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

api.post('/admin/apps/:id/logo', requireAdmin, async (req, res) => {
  const contentType = String(req.body?.contentType || '')
  const encoded = String(req.body?.data || '')
  const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])
  if (!allowedTypes.has(contentType) || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(encoded)) {
    return fail(res, 400, 'INVALID_APP_LOGO', 'El logo debe ser PNG, JPEG o WebP.')
  }
  const image = Buffer.from(encoded.slice(encoded.indexOf(',') + 1), 'base64')
  if (!image.length || image.length > 1024 * 1024) return fail(res, 413, 'APP_LOGO_TOO_LARGE', 'El logo no puede superar 1 MB.')
  try {
    const { data: app, error: appError } = await supabase.from('plid_v27_integrations')
      .select('id')
      .eq('id', req.params.id)
      .maybeSingle()
    if (appError) throw appError
    if (!app) return fail(res, 404, 'APP_NOT_FOUND', 'No se encontró la aplicación.')
    const extension = contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1]
    const path = `${app.id}/logo.${extension}`
    const { error: uploadError } = await supabase.storage.from('plid27-app-logos').upload(path, image, {
      contentType,
      upsert: true,
      cacheControl: '3600',
    })
    if (uploadError) throw uploadError
    const { data: publicUrl } = supabase.storage.from('plid27-app-logos').getPublicUrl(path)
    const logoUrl = `${publicUrl.publicUrl}?v=${Date.now()}`
    const brandColor = /^#[\da-f]{6}$/i.test(String(req.body?.brandColor || '')) ? req.body.brandColor : null
    const { data, error: updateError } = await supabase.from('plid_v27_integrations')
      .update({ logo_url: logoUrl, brand_color: brandColor, updated_at: new Date().toISOString() })
      .eq('id', app.id)
      .select('*')
      .single()
    if (updateError) throw updateError
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

api.post('/admin/users/:id/password', authLimiter, requireAdmin, async (req, res) => {
  const userId = Number(req.params.id)
  const password = String(req.body?.password || '')
  if (!Number.isInteger(userId) || userId <= 0) return fail(res, 400, 'INVALID_USER_ID', 'La identidad indicada no es válida.')
  if (password.length < 8 || password.length > 256 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return fail(res, 400, 'WEAK_PASSWORD', 'La contraseña debe tener entre 8 y 256 caracteres e incluir letras y números.')
  }
  try {
    const { data: user, error: userError } = await supabase.from('solicitantes')
      .select('id,dip')
      .eq('id', userId)
      .maybeSingle()
    if (userError) throw userError
    if (!user) return fail(res, 404, 'USER_NOT_FOUND', 'No se encontró la identidad.')

    const passwordHash = await bcrypt.hash(password, 12)
    let legacySynced
    try {
      legacySynced = await updateLegacyPasswordHash(user.dip, passwordHash)
    } catch (error) {
      console.error('[PlacetaID API] Could not update the legacy account password:', error.message)
      return fail(res, 503, 'LEGACY_PASSWORD_UPDATE_UNAVAILABLE', 'No se pudo confirmar la sincronización con PL26. V27 no ha guardado la credencial; comprueba PL26 antes de dar la contraseña por cambiada.')
    }

    const { error: credentialError } = await supabase.from('plid_v27_legacy_credentials').upsert({
      user_id: user.id,
      password_hash: passwordHash,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    if (credentialError) {
      console.error('[PlacetaID API] PL26 password changed, but the v27 credential could not be saved:', credentialError.message)
      return fail(res, 503, 'LEGACY_PASSWORD_UPDATED_V27_SYNC_FAILED', 'La contraseña se actualizó en PL26, pero no pudo sincronizarse con PlacetaID v27. Repite el cambio desde Administración para completar la sincronización.')
    }

    const now = new Date().toISOString()
    const [{ error: devicesError }, { error: sessionsError }] = await Promise.all([
      supabase.from('plid_v27_devices').update({ active: false, revoked_at: now }).eq('user_id', user.id).eq('active', true).is('revoked_at', null),
      supabase.from('plid_v27_sessions').update({ revoked_at: now }).eq('user_id', user.id).is('revoked_at', null),
    ])
    if (devicesError || sessionsError) {
      console.error('[PlacetaID API] Password changed but session revocation failed:', devicesError?.message || sessionsError?.message)
      return fail(res, 503, 'PASSWORD_UPDATED_REVOCATION_FAILED', 'La contraseña se actualizó, pero no se pudo confirmar la revocación de todas las sesiones. Revisa la seguridad de la cuenta.')
    }
    const { error: auditError } = await supabase.from('plid_v27_audit').insert({
      target_user_id: user.id,
      event_type: 'admin_password_reset',
      details: { legacySynced, sessionsRevoked: true },
    })
    if (auditError) {
      console.error('[PlacetaID API] Password changed but the audit record could not be saved:', auditError.message)
      return fail(res, 503, 'PASSWORD_UPDATED_AUDIT_FAILED', 'La contraseña y la revocación se completaron, pero no se pudo registrar la auditoría. Contacta con Administración.')
    }
    res.json({ ok: true, legacySynced, sessionsRevoked: true })
  } catch (error) { handleDbError(res, error) }
})

api.patch('/admin/users/:id/access/:appId', requireAdmin, async (req, res) => {
  const decision = String(req.body?.decision || '')
  if (!['allow', 'deny'].includes(decision)) return fail(res, 400, 'INVALID_ACCESS_DECISION', 'La decisión de acceso no es válida.')
  try {
    const { error } = await supabase.from('plid_v27_user_access').upsert({
      user_id: Number(req.params.id),
      app_id: req.params.appId,
      decision,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,app_id' })
    if (error) throw error
    const { error: auditError } = await supabase.from('plid_v27_audit').insert({
      target_user_id: Number(req.params.id),
      app_id: req.params.appId,
      event_type: 'user_app_access_updated',
      details: { decision },
    })
    if (auditError) throw auditError
    res.json({ ok: true, decision })
  } catch (error) { handleDbError(res, error) }
})

api.post('/admin/users/:id/revoke-sessions', requireAdmin, async (req, res) => {
  const userId = Number(req.params.id)
  if (!Number.isInteger(userId) || userId <= 0) return fail(res, 400, 'INVALID_USER_ID', 'La identidad indicada no es válida.')
  try {
    const now = new Date().toISOString()
    const [{ error: devicesError }, { error: sessionsError }] = await Promise.all([
      supabase.from('plid_v27_devices').update({ active: false, revoked_at: now }).eq('user_id', userId).eq('active', true).is('revoked_at', null),
      supabase.from('plid_v27_sessions').update({ revoked_at: now }).eq('user_id', userId).is('revoked_at', null),
    ])
    if (devicesError) throw devicesError
    if (sessionsError) throw sessionsError
    const { error: auditError } = await supabase.from('plid_v27_audit').insert({
      target_user_id: userId,
      event_type: 'user_sessions_revoked',
      details: {},
    })
    if (auditError) throw auditError
    res.json({ ok: true })
  } catch (error) { handleDbError(res, error) }
})

api.post('/internal/devices/register', deviceEnrollmentLimiter, requireDeviceEnrollmentKey, async (req, res) => {
  const dip = normalizeDip(req.body?.dip)
  const deviceId = String(req.body?.deviceId || '').trim()
  const deviceName = String(req.body?.deviceName || 'Dispositivo').trim().slice(0, 100)
  const method = String(req.body?.method || '')
  if (!isValidDip(dip) || !deviceId || deviceId.length > 256 || /[\u0000-\u001f]/.test(deviceId) || !['mobile', 'desktop'].includes(method)) {
    return fail(res, 400, 'INVALID_DEVICE_REGISTRATION', 'Los datos del dispositivo no son válidos.')
  }
  try {
    const user = await findOrCreateLinkedIdentity(dip, req.body?.profile)
    if (!user || userStatus(user, null) !== 'active') return fail(res, 403, 'IDENTITY_NOT_AVAILABLE', 'No se puede vincular un dispositivo a esta identidad.')
    const { data: controls, error: controlsError } = await supabase.from('plid_v27_user_security')
      .select('status')
      .eq('user_id', user.id)
      .maybeSingle()
    if (controlsError) throw controlsError
    if (controls?.status && controls.status !== 'active') return fail(res, 403, 'IDENTITY_NOT_AVAILABLE', 'La identidad no está habilitada para vincular dispositivos.')

    const now = new Date()
    const { data: device, error } = await supabase.from('plid_v27_devices').upsert({
      user_id: user.id,
      device_id: deviceId,
      device_name: deviceName || 'Dispositivo',
      method,
      session_token_hash: hashToken(deviceId),
      active: true,
      expires_at: new Date(now.getTime() + deviceLifetimeMs).toISOString(),
      last_seen_at: now.toISOString(),
      revoked_at: null,
    }, { onConflict: 'user_id,device_id' }).select('id,method,expires_at').single()
    if (error) throw error
    const { error: auditError } = await supabase.from('plid_v27_audit').insert({
      actor_user_id: user.id,
      target_user_id: user.id,
      event_type: 'device_linked',
      details: { method },
    })
    if (auditError) throw auditError
    res.json({ ok: true, deviceId: device.id, method: device.method, expiresAt: device.expires_at })
  } catch (error) { handleDbError(res, error) }
})

api.post('/internal/devices/migrate', deviceEnrollmentLimiter, requireDeviceEnrollmentKey, async (req, res) => {
  const entries = req.body?.entries
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 500) {
    return fail(res, 400, 'INVALID_DEVICE_BATCH', 'El lote debe contener entre 1 y 500 dispositivos.')
  }
  try {
    const now = new Date()
    const rows = new Map()
    let skippedInactive = 0
    for (const entry of entries) {
      const dip = normalizeDip(entry?.dip)
      const deviceId = String(entry?.deviceId || '').trim()
      const method = String(entry?.method || '')
      if (!isValidDip(dip) || !deviceId || deviceId.length > 256 || /[\u0000-\u001f]/.test(deviceId) || !['mobile', 'desktop'].includes(method)) {
        return fail(res, 400, 'INVALID_DEVICE_ENTRY', 'El lote contiene un dispositivo con datos no válidos.')
      }
      const user = await findOrCreateLinkedIdentity(dip, entry.profile)
      if (!user || userStatus(user, null) !== 'active') {
        skippedInactive++
        continue
      }
      rows.set(`${user.id}:${deviceId}`, {
        user_id: user.id,
        device_id: deviceId,
        device_name: String(entry.deviceName || 'Dispositivo').trim().slice(0, 100) || 'Dispositivo',
        method,
        session_token_hash: hashToken(deviceId),
        active: true,
        expires_at: new Date(now.getTime() + deviceLifetimeMs).toISOString(),
        last_seen_at: now.toISOString(),
        revoked_at: null,
      })
    }

    const devices = [...rows.values()]
    if (devices.length) {
      const { error } = await supabase.from('plid_v27_devices')
        .upsert(devices, { onConflict: 'user_id,device_id' })
      if (error) throw error
      const userIds = [...new Set(devices.map((device) => device.user_id))]
      const { error: auditError } = await supabase.from('plid_v27_audit').insert(userIds.map((userId) => ({
        target_user_id: userId,
        event_type: 'legacy_devices_migrated',
        details: { device_count: devices.filter((device) => device.user_id === userId).length },
      })))
      if (auditError) throw auditError
    }
    res.json({ ok: true, processed: entries.length, migrated: devices.length, skippedInactive })
  } catch (error) { handleDbError(res, error) }
})

api.post('/internal/authenticators/migrate', deviceEnrollmentLimiter, requireDeviceEnrollmentKey, async (req, res) => {
  const entries = req.body?.entries
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 500) {
    return fail(res, 400, 'INVALID_AUTHENTICATOR_BATCH', 'El lote debe contener entre 1 y 500 autenticadores.')
  }
  try {
    let migrated = 0
    let skippedInactive = 0
    let skippedExisting = 0
    const now = new Date()
    for (const entry of entries) {
      const dip = normalizeDip(entry?.dip)
      const secret = String(entry?.secret || '').replace(/=+$/g, '').toUpperCase()
      if (!isValidDip(dip) || !/^[A-Z2-7]{16,64}$/.test(secret)) {
        return fail(res, 400, 'INVALID_AUTHENTICATOR_ENTRY', 'El lote contiene un autenticador no válido.')
      }
      const user = await findOrCreateLinkedIdentity(dip, entry.profile)
      if (!user || userStatus(user, null) !== 'active') {
        skippedInactive++
        continue
      }
      const { data: inserted, error: authenticatorError } = await supabase.from('plid_v27_authenticators')
        .upsert({ user_id: user.id, secret_encrypted: encryptSecret(secret), enabled: true, updated_at: now.toISOString() }, { onConflict: 'user_id', ignoreDuplicates: true })
        .select('user_id')
      if (authenticatorError) throw authenticatorError
      let enabled = Boolean(inserted?.length)
      if (!enabled) {
        const { data: existing, error: existingError } = await supabase.from('plid_v27_authenticators')
          .select('enabled')
          .eq('user_id', user.id)
          .maybeSingle()
        if (existingError) throw existingError
        enabled = existing?.enabled === true
        if (!enabled) {
          skippedExisting++
          continue
        }
      }
      if (inserted?.length) migrated++
      else skippedExisting++
      const { error: deviceError } = await supabase.from('plid_v27_devices').upsert({
        user_id: user.id,
        device_id: 'legacy-authenticator',
        device_name: 'Autentificador',
        method: 'authenticator',
        session_token_hash: hashToken(createRandomToken()),
        active: true,
        expires_at: new Date(now.getTime() + deviceLifetimeMs).toISOString(),
        last_seen_at: now.toISOString(),
        revoked_at: null,
      }, { onConflict: 'user_id,device_id' })
      if (deviceError) throw deviceError
      if (inserted?.length) {
        const { error: auditError } = await supabase.from('plid_v27_audit').insert({
          actor_user_id: user.id,
          target_user_id: user.id,
          event_type: 'legacy_authenticator_migrated',
          details: {},
        })
        if (auditError) throw auditError
      }
    }
    res.json({ ok: true, processed: entries.length, migrated, skippedInactive, skippedExisting })
  } catch (error) { handleDbError(res, error) }
})

api.post('/internal/devices/revoke', deviceEnrollmentLimiter, requireDeviceEnrollmentKey, async (req, res) => {
  const dip = normalizeDip(req.body?.dip)
  const deviceId = String(req.body?.deviceId || '').trim()
  if (!isValidDip(dip) || !deviceId || deviceId.length > 256) return fail(res, 400, 'INVALID_DEVICE_REGISTRATION', 'Los datos del dispositivo no son válidos.')
  try {
    const { data: user, error: userError } = await supabase.from('solicitantes')
      .select('id')
      .eq('dip', dip)
      .maybeSingle()
    if (userError) throw userError
    if (!user) return res.json({ ok: true, revoked: false })
    const now = new Date().toISOString()
    const { data: device, error } = await supabase.from('plid_v27_devices')
      .update({ active: false, revoked_at: now })
      .eq('user_id', user.id)
      .eq('device_id', deviceId)
      .eq('active', true)
      .is('revoked_at', null)
      .select('id,method')
      .maybeSingle()
    if (error) throw error
    if (device) {
      const { error: auditError } = await supabase.from('plid_v27_audit').insert({
        actor_user_id: user.id,
        target_user_id: user.id,
        event_type: 'device_revoked',
        details: { method: device.method },
      })
      if (auditError) throw auditError
    }
    res.json({ ok: true, revoked: Boolean(device) })
  } catch (error) { handleDbError(res, error) }
})

api.post('/public/identify', identifyLimiter, async (req, res) => {
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
      if (!app || !isAllowedRedirectUri(req.body.redirectUri) || !Array.isArray(app.redirect_uris) || !app.redirect_uris.includes(req.body.redirectUri)) return fail(res, 403, 'APP_NOT_AUTHORIZED', 'La aplicación solicitante o su redirect_uri no están autorizados para PlacetaID.')
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
    if (!method) return fail(res, 409, 'NO_ACTIVE_METHOD', 'No hay un método de identificación activo. Puedes usar temporalmente tu contraseña de PlacetaID o vincular un dispositivo.')

    const confirmationCode = randomBytes(4).toString('hex').toUpperCase()
    const { data: request, error: requestError } = await supabase.from('plid_v27_auth_requests').insert({
      request_code: confirmationCode, user_id: user.id, app_id: app?.id ?? null, service_id: service?.id ?? null,
      method, state: String(req.body?.state || '').slice(0, 300) || null,
      redirect_uri: app ? req.body.redirectUri : null,
      status: 'pending',
    }).select('id,request_code,method,expires_at').single()
    if (requestError) throw requestError
    if (method === 'mobile') {
      const appName = app?.name || 'PlacetaID'
      const serviceName = service?.name || 'acceso seguro'
      const { error: notificationError } = await supabase.from('rsp_notificaciones').insert({
        id: randomUUID(),
        nivel: 'info',
        titulo: `Solicitud de acceso: ${appName}`,
        mensaje: `${appName} · ${serviceName} solicita una identificación. Comprueba que el código ${confirmationCode} coincide con el de la pasarela antes de aprobar.`,
        servicio: 'placetaid',
        destinatario_dip: dip,
        objeto_tipo: 'auth_request',
        objeto_id: request.id,
        leida: false,
        fecha: new Date().toISOString(),
        canal: 'inapp',
      })

      if (notificationError) {
        const { error: cleanupError } = await supabase.from('plid_v27_auth_requests')
          .delete().eq('id', request.id).eq('status', 'pending')
        if (cleanupError) {
          console.error('[PlacetaID API] Could not remove request after notification failure:', cleanupError.message)
        }
        throw notificationError
      }
    }
    res.status(201).json({
      requestId: request.id,
      method: request.method,
      confirmationCode: request.request_code,
      expiresAt: request.expires_at,
      app: app ? { name: app.name } : null,
      service: service ? { name: service.name } : null,
      disclosure: {
        base: baseDisclosureFields,
        optional: shareableConsentFields.filter((field) => app?.scopes?.[field]),
        unavailable: unavailableConsentFields.filter((field) => app?.scopes?.[field]),
        destination: app ? req.body.redirectUri : null,
      },
    })
  } catch (error) { handleDbError(res, error) }
})

async function verifyLegacyPassword(dip, password) {
  const deviceKey = String(process.env.PLACETAID_V27_DEVICE_KEY || '')
  if (deviceKey.length < 32) return { status: 'unavailable' }
  const apiBase = String(process.env.PLACETAID_V27_LEGACY_AUTH_URL || 'https://id.laplaceta.org').trim()
  try {
    const baseUrl = new URL(apiBase)
    if (baseUrl.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(baseUrl.hostname)) {
      throw new Error('Legacy credential bridge must use HTTPS')
    }
    const response = await fetch(new URL('/api/internal/legacy/credentials/verify', baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PlacetaID-Device-Key': deviceKey,
      },
      body: JSON.stringify({ dip, password }),
      signal: AbortSignal.timeout(8000),
    })
    const payload = await response.json().catch(() => null)
    if (response.status === 404) return { status: 'not_found' }
    if (response.status === 401 && payload?.error === 'INVALID_DEVICE_LINKING_KEY') {
      throw new Error('Legacy credential bridge key mismatch')
    }
    if ([401, 403, 409].includes(response.status)) return { status: 'rejected' }
    if (!response.ok) throw new Error(`Legacy credential bridge returned HTTP ${response.status}`)
    if (payload?.ok !== true || !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(String(payload.passwordHash || ''))) {
      throw new Error('Legacy credential bridge returned an invalid response')
    }
    return { status: 'verified', passwordHash: payload.passwordHash, profile: payload.profile || {} }
  } catch (error) {
    console.error('[PlacetaID API] Legacy credential bridge unavailable:', error.message)
    return { status: 'unavailable' }
  }
}

async function updateLegacyPasswordHash(dip, passwordHash) {
  const deviceKey = String(process.env.PLACETAID_V27_DEVICE_KEY || '')
  if (deviceKey.length < 32) throw new Error('LEGACY_PASSWORD_BRIDGE_NOT_CONFIGURED')
  const apiBase = String(process.env.PLACETAID_V27_LEGACY_AUTH_URL || 'https://id.laplaceta.org').trim()
  const baseUrl = new URL(apiBase)
  if (baseUrl.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(baseUrl.hostname)) {
    throw new Error('Legacy credential bridge must use HTTPS')
  }
  const response = await fetch(new URL('/api/internal/legacy/credentials/set', baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PlacetaID-Device-Key': deviceKey,
    },
    body: JSON.stringify({ dip, passwordHash }),
    signal: AbortSignal.timeout(8000),
  })
  const payload = await response.json().catch(() => null)
  if (response.status === 404 && payload?.error === 'LEGACY_IDENTITY_NOT_FOUND') return false
  if (!response.ok || payload?.ok !== true) {
    throw new Error(`Legacy password update failed with HTTP ${response.status}`)
  }
  return true
}

async function importLegacyIdentity(dip, profile) {
  const fullName = String(profile.nombre || '').trim().slice(0, 160)
  const alias = String(profile.placeid || `PLID-${dip}`).trim().slice(0, 80)
  const roles = ['administrador', 'miembro', 'entidad', 'visitante', 'moderador', 'empresa']
  const role = roles.includes(String(profile.rol)) ? String(profile.rol) : 'miembro'
  const blocked = profile.bloqueado === true || profile.banned === true || profile.activo === false
  const birthDate = profile.fechaNacimiento && Number.isFinite(Date.parse(profile.fechaNacimiento))
    ? new Date(profile.fechaNacimiento).toISOString().slice(0, 10)
    : null
  const identity = {
    dip,
    alias,
    nombre_real: fullName || alias,
    email: String(profile.correo || '').trim().toLowerCase() || null,
    fecha_nacimiento: birthDate,
    placeid: alias,
    rol: role,
    estado: blocked ? 'suspendido' : 'activo',
    lista_negra: blocked ? 1 : 0,
  }
  const insertIdentity = () => supabase.from('solicitantes').insert(identity).select('id,dip,estado,lista_negra').single()
  let { data, error } = await insertIdentity()
  if (error?.code === '23505') {
    const { data: existing, error: lookupError } = await supabase.from('solicitantes')
      .select('id,dip,estado,lista_negra').eq('dip', dip).maybeSingle()
    if (lookupError) throw lookupError
    if (existing) return existing
    identity.alias = `PLID-${dip}`
    identity.placeid = identity.alias
    ;({ data, error } = await insertIdentity())
    if (error?.code === '23505') {
      const { data: raced, error: raceError } = await supabase.from('solicitantes')
        .select('id,dip,estado,lista_negra').eq('dip', dip).maybeSingle()
      if (raceError) throw raceError
      if (raced) return raced
    }
  }
  if (error) throw error
  return data
}

api.post('/public/password-authenticate', authLimiter, async (req, res) => {
  if (process.env.PLACETAID_V27_PASSWORD_LOGIN_ENABLED === 'false') {
    return fail(res, 403, 'PASSWORD_LOGIN_DISABLED', 'El acceso temporal con contraseña está desactivado.')
  }
  const dip = normalizeDip(req.body?.dip)
  const password = String(req.body?.password || '')
  if (!isValidDip(dip) || !password || password.length > 256) return fail(res, 400, 'INVALID_CREDENTIALS', 'Introduce tu DIP y contraseña de PlacetaID.')
  try {
    let { data: user, error: userError } = await supabase.from('solicitantes')
      .select('id,dip,estado,lista_negra')
      .eq('dip', dip)
      .maybeSingle()
    if (userError) throw userError
    if (user && (Number(user.lista_negra) === 1 || !['activo', 'active', ''].includes(String(user.estado || '').toLowerCase()))) {
      return fail(res, 401, 'INVALID_CREDENTIALS', 'El DIP o la contraseña no son correctos.')
    }

    let credential = null
    if (user) {
      const { data, error: credentialError } = await supabase.from('plid_v27_legacy_credentials')
        .select('password_hash')
        .eq('user_id', user.id)
        .maybeSingle()
      if (credentialError) throw credentialError
      credential = data
    }

    const legacyResult = await verifyLegacyPassword(dip, password)
    if (legacyResult.status === 'verified') {
      if (!user) {
        user = await importLegacyIdentity(dip, legacyResult.profile)
      }
      if (Number(user.lista_negra) === 1 || !['activo', 'active', ''].includes(String(user.estado || '').toLowerCase())) {
        return fail(res, 401, 'INVALID_CREDENTIALS', 'El DIP o la contraseña no son correctos.')
      }
      const { error: credentialUpsertError } = await supabase.from('plid_v27_legacy_credentials').upsert({
        user_id: user.id,
        password_hash: legacyResult.passwordHash,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      if (credentialUpsertError) throw credentialUpsertError
    } else if (legacyResult.status === 'not_found') {
      if (!credential || !await bcrypt.compare(password, credential.password_hash)) {
        return fail(res, 401, 'INVALID_CREDENTIALS', 'El DIP o la contraseña no son correctos.')
      }
    } else if (legacyResult.status === 'unavailable') {
      if (!credential || !await bcrypt.compare(password, credential.password_hash)) {
        return fail(res, 503, 'LEGACY_CREDENTIAL_SERVICE_UNAVAILABLE', 'No se puede comprobar la contraseña ahora. Inténtalo de nuevo en unos minutos.')
      }
    } else {
      return fail(res, 401, 'INVALID_CREDENTIALS', 'El DIP o la contraseña no son correctos.')
    }

    let request = null
    if (req.body?.requestId) {
      const { data: existing, error: requestError } = await supabase.from('plid_v27_auth_requests')
        .select('*')
        .eq('id', String(req.body.requestId))
        .maybeSingle()
      if (requestError) throw requestError
      if (!existing || existing.user_id !== user.id || existing.status !== 'pending' || Date.parse(existing.expires_at) <= Date.now()) {
        return fail(res, 410, 'REQUEST_EXPIRED', 'La solicitud ha caducado. Empieza de nuevo.')
      }
      const { data: authorized, error: updateError } = await supabase.from('plid_v27_auth_requests')
        .update({ method: 'password', status: 'authorized', completed_at: new Date().toISOString() })
        .eq('id', existing.id)
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .select('*')
        .maybeSingle()
      if (updateError) throw updateError
      if (!authorized) return fail(res, 409, 'REQUEST_ALREADY_PROCESSED', 'La solicitud ya se ha procesado. Inicia un nuevo acceso.')
      request = authorized
    } else {
      let app = null
      let service = null
      if (req.body?.clientId) {
        const { data, error: appError } = await supabase.from('plid_v27_integrations')
          .select('*')
          .eq('client_id', req.body.clientId)
          .eq('status', 'authorized')
          .maybeSingle()
        if (appError) throw appError
        app = data
        if (!app || !isAllowedRedirectUri(req.body.redirectUri) || !Array.isArray(app.redirect_uris) || !app.redirect_uris.includes(req.body.redirectUri)) {
          return fail(res, 403, 'APP_NOT_AUTHORIZED', 'La aplicación solicitante o su redirect_uri no están autorizados.')
        }
        let serviceQuery = supabase.from('plid_v27_services').select('*').eq('app_id', app.id).eq('enabled', true)
        serviceQuery = req.body.serviceKey
          ? serviceQuery.eq('service_key', String(req.body.serviceKey))
          : serviceQuery.order('created_at').limit(1)
        const { data: serviceData, error: serviceError } = await serviceQuery.maybeSingle()
        if (serviceError) throw serviceError
        service = serviceData
        if (!service) return fail(res, 403, 'SERVICE_NOT_AVAILABLE', 'El servicio solicitado no está disponible.')
      }
      const { data, error: requestError } = await supabase.from('plid_v27_auth_requests').insert({
        request_code: randomBytes(4).toString('hex').toUpperCase(),
        user_id: user.id,
        app_id: app?.id ?? null,
        service_id: service?.id ?? null,
        method: 'password',
        status: 'authorized',
        state: String(req.body?.state || '').slice(0, 300) || null,
        redirect_uri: app ? req.body.redirectUri : null,
        completed_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      }).select('*').single()
      if (requestError) throw requestError
      request = data
    }

    const { error: auditError } = await supabase.from('plid_v27_audit').insert({
      actor_user_id: user.id,
      target_user_id: user.id,
      app_id: request.app_id,
      event_type: 'identity_authenticated',
      details: { method: 'password', temporary: true },
    })
    if (auditError) throw auditError
    res.json(await completeAuthorizedRequest(request, res))
  } catch (error) { handleDbError(res, error) }
})

api.get('/public/authorize/preview', authLimiter, async (req, res) => {
  const clientId = String(req.query.client_id || '')
  const redirectUri = String(req.query.redirect_uri || '')
  const serviceKey = String(req.query.service || '')
  if (!clientId || !redirectUri || !isAllowedRedirectUri(redirectUri)) {
    return fail(res, 400, 'INVALID_AUTHORIZATION_REQUEST', 'Faltan los datos válidos de la solicitud de autorización.')
  }
  try {
    const { data: app, error: appError } = await supabase.from('plid_v27_integrations')
      .select('id,name,description,category,initials,color,logo_url,brand_color,redirect_uris,status,min_age,allowed_roles,scopes')
      .eq('client_id', clientId)
      .eq('status', 'authorized')
      .maybeSingle()
    if (appError) throw appError
    if (!app || !Array.isArray(app.redirect_uris) || !app.redirect_uris.includes(redirectUri)) {
      return fail(res, 403, 'APP_NOT_AUTHORIZED', 'La aplicación o la dirección de retorno no están autorizadas.')
    }

    let serviceQuery = supabase.from('plid_v27_services')
      .select('name,description,min_age,allowed_roles')
      .eq('app_id', app.id)
      .eq('enabled', true)
    if (serviceKey) serviceQuery = serviceQuery.eq('service_key', serviceKey)
    else serviceQuery = serviceQuery.order('created_at').limit(1)
    const { data: service, error: serviceError } = await serviceQuery.maybeSingle()
    if (serviceError) throw serviceError
    if (!service) return fail(res, 403, 'SERVICE_NOT_AVAILABLE', 'El servicio solicitado no está disponible.')

    const appRoles = Array.isArray(app.allowed_roles) ? app.allowed_roles : []
    const serviceRoles = Array.isArray(service.allowed_roles) ? service.allowed_roles : appRoles
    const allowedRoles = appRoles.filter((role) => serviceRoles.includes(role))
    res.json({
      app: { name: app.name, description: app.description, category: app.category, initials: app.initials, color: app.color, logoUrl: app.logo_url || '', brandColor: app.brand_color || '' },
      service: { name: service.name, description: service.description },
      destination: redirectUri,
      requirements: {
        minAge: Math.max(Number(app.min_age) || 0, Number(service.min_age) || 0),
        allowedRoles,
        activeAccount: true,
        linkedMethod: true,
      },
      disclosure: {
        base: baseDisclosureFields,
        optional: shareableConsentFields.filter((field) => app.scopes?.[field]),
        unavailable: unavailableConsentFields.filter((field) => app.scopes?.[field]),
      },
    })
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
  if (request.redirect_uri && !request.app_id) {
    throw Object.assign(new Error('OAUTH_APPLICATION_MISSING'), { code: 'INVALID_OAUTH_REQUEST' })
  }
  if (request.app_id && (!request.redirect_uri || !isAllowedRedirectUri(request.redirect_uri))) {
    throw Object.assign(new Error('OAUTH_CALLBACK_MISSING'), { code: 'INVALID_OAUTH_REQUEST' })
  }
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
    if (!Array.isArray(app.redirect_uris) || !app.redirect_uris.includes(request.redirect_uri)) {
      throw Object.assign(new Error('OAUTH_CALLBACK_NOT_REGISTERED'), { code: 'INVALID_OAUTH_REQUEST' })
    }
    const age = calculateAge(user)
    const requiredAge = Math.max(Number(app.min_age) || 0, Number(service.min_age) || 0)
    const roles = Array.isArray(service.allowed_roles) ? service.allowed_roles : app.allowed_roles
    const { data: override, error: overrideError } = await supabase.from('plid_v27_user_access').select('decision').eq('user_id', user.id).eq('app_id', app.id).maybeSingle()
    if (overrideError) throw overrideError
    if (override?.decision === 'deny' || !app.allowed_roles.includes(user.rol) || (Array.isArray(roles) && !roles.includes(user.rol)) || (age !== null && age < requiredAge)) return { stage: 'denied', reason: 'ACCESS_POLICY', login_correct: false }
    if (status === 'restricted') return { stage: 'denied', reason: 'ACCOUNT_RESTRICTED', login_correct: false }

    const protectedFields = shareableConsentFields.filter((field) => app.scopes?.[field])
    if (protectedFields.length) {
      const { data: consents, error: consentError } = await supabase.from('plid_v27_consents')
        .select('field,status,updated_at')
        .eq('user_id', user.id)
        .eq('app_id', app.id)
      if (consentError) throw consentError
      const consentByField = new Map((consents || []).map((item) => [item.field, item]))
      const requestCreatedAt = Date.parse(request.created_at || '')
      const fieldsToReview = protectedFields.filter((field) => {
        const consent = consentByField.get(field)
        if (!consent) return true
        if (consent.status === 'granted') return false
        if (consent.status === 'denied' && Number.isFinite(requestCreatedAt) && Date.parse(consent.updated_at) >= requestCreatedAt) return false
        return true
      })
      if (fieldsToReview.length) {
        const { error: pendingError } = await supabase.from('plid_v27_consents').upsert(fieldsToReview.map((field) => ({ user_id: user.id, app_id: app.id, field, status: 'pending', updated_at: new Date().toISOString() })), { onConflict: 'user_id,app_id,field', ignoreDuplicates: true })
        if (pendingError) throw pendingError
        return { stage: 'consent_required', requestId: request.id, app: { id: app.id, name: app.name }, fields: fieldsToReview }
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
    ...(app?.scopes?.dip && granted.has('dip') ? { dip: user.dip } : {}),
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
  setSessionCookie(res, sessionToken)
  return { stage: 'complete', login_correct: true, claims: { ...claims, email: undefined } }
}

api.post('/public/exchange', authLimiter, async (req, res) => {
  const clientId = String(req.body?.client_id || '')
  const clientSecret = String(req.body?.client_secret || '')
  const code = String(req.body?.code || '')
  const redirectUri = String(req.body?.redirect_uri || '')
  if (!clientId || !clientSecret || !code || !redirectUri) return fail(res, 400, 'INVALID_EXCHANGE', 'Se requieren client_id, client_secret, code y redirect_uri.')
  try {
    const { data: app, error: appError } = await supabase.from('plid_v27_integrations')
      .select('id,client_secret_hash,status')
      .eq('client_id', clientId)
      .maybeSingle()
    if (appError) throw appError
    if (!app || app.status !== 'authorized' || !app.client_secret_hash || !secureEquals(hashToken(clientSecret), app.client_secret_hash)) {
      return fail(res, 401, 'INVALID_CLIENT', 'La aplicación no está autorizada o sus credenciales no son válidas.')
    }
    if (!isAllowedRedirectUri(redirectUri)) return fail(res, 400, 'INVALID_REDIRECT_URI', 'El redirect_uri no es válido.')
    const now = new Date().toISOString()
    const { data: grant, error } = await supabase.from('plid_v27_oauth_codes')
      .update({ consumed_at: now })
      .eq('code_hash', hashToken(code))
      .eq('app_id', app.id)
      .eq('redirect_uri', redirectUri)
      .is('consumed_at', null)
      .gt('expires_at', now)
      .select('claims')
      .maybeSingle()
    if (error) throw error
    if (!grant) return fail(res, 400, 'INVALID_OR_EXPIRED_CODE', 'El código ya se utilizó, ha caducado o no coincide con la solicitud.')
    res.json({ login_correct: true, claims: grant.claims })
  } catch (error) { handleDbError(res, error) }
})

api.get('/public/auth-requests/:id', async (req, res) => {
  try {
    const { data: request, error } = await supabase.from('plid_v27_auth_requests').select('*').eq('id', req.params.id).maybeSingle()
    if (error) throw error
    if (!request || Date.parse(request.expires_at) <= Date.now()) return fail(res, 410, 'REQUEST_EXPIRED', 'La solicitud de acceso ha caducado.')
    if (request.status !== 'authorized') return res.json({ stage: request.status === 'denied' ? 'denied' : 'waiting', method: request.method })
    res.json(await completeAuthorizedRequest(request, res))
  } catch (error) { handleDbError(res, error) }
})

api.get('/public/session', requireUserSession, async (req, res) => {
  try {
    const [
      { data: user, error: userError },
      { data: consents, error: consentError },
      { data: devices, error: deviceError },
      { data: apps, error: appsError },
      { data: services, error: servicesError },
    ] = await Promise.all([
      supabase.from('solicitantes').select('id,alias,nombre_real,email,fecha_nacimiento,edad,dip,placeid,rol,estado,lista_negra,ultimo_acceso').eq('id', req.userId).maybeSingle(),
      supabase.from('plid_v27_consents').select('app_id,field,status,updated_at').eq('user_id', req.userId),
      supabase.from('plid_v27_devices').select('method,active,expires_at,revoked_at').eq('user_id', req.userId),
      supabase.from('plid_v27_integrations').select('id,name,description,category,initials,color,status,min_age,allowed_roles,redirect_uris,scopes,updated_at'),
      supabase.from('plid_v27_services').select('*').order('created_at'),
    ])
    if (userError) throw userError
    if (consentError) throw consentError
    if (deviceError) throw deviceError
    if (appsError) throw appsError
    if (servicesError) throw servicesError
    if (!user) return fail(res, 404, 'IDENTITY_NOT_FOUND', 'No se encontró la identidad de esta sesión.')
    const security = await supabase.from('plid_v27_user_security').select('status,identity_verified').eq('user_id', req.userId).maybeSingle()
    if (security.error) throw security.error
    const activeDevices = (devices || []).filter((device) => device.active && !device.revoked_at && Date.parse(device.expires_at) > Date.now())
    res.json({
      user: {
        id: String(user.id),
        dip: user.dip,
        placeid: user.placeid,
        name: user.alias || String(user.nombre_real || '').split(/\s+/)[0],
        surname: user.alias ? user.nombre_real || '' : String(user.nombre_real || '').split(/\s+/).slice(1).join(' '),
        birthDate: user.fecha_nacimiento,
        email: user.email,
        role: user.rol,
        status: userStatus(user, security.data),
        identityVerified: Boolean(security.data?.identity_verified),
        auth: {
          mobile: activeDevices.some((device) => device.method === 'mobile'),
          authenticator: activeDevices.some((device) => device.method === 'authenticator'),
          desktop: activeDevices.some((device) => device.method === 'desktop'),
        },
        appOverrides: {},
        permissions: (consents || []).map((consent) => ({ appId: consent.app_id, field: consent.field, status: consent.status, updated: consent.updated_at })),
        legalAcceptedVersions: [],
        lastAccess: user.ultimo_acceso || '',
      },
      integrations: (apps || []).map((app) => mapIntegration(app, (services || []).filter((service) => service.app_id === app.id))),
    })
  } catch (error) { handleDbError(res, error) }
})

api.post('/public/logout', requireUserSession, async (req, res) => {
  const cookie = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('plid_v27='))
  const token = cookie?.slice('plid_v27='.length)
  if (!token) return fail(res, 401, 'USER_SESSION_REQUIRED', 'La sesión de PlacetaID no está activa.')
  try {
    const { error } = await supabase.from('plid_v27_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('token_hash', hashToken(decodeURIComponent(token)))
      .eq('user_id', req.userId)
      .is('revoked_at', null)
    if (error) throw error
    const { error: auditError } = await supabase.from('plid_v27_audit').insert({
      actor_user_id: req.userId,
      target_user_id: req.userId,
      event_type: 'identity_logged_out',
      details: {},
    })
    if (auditError) throw auditError
    res.setHeader('Set-Cookie', 'plid_v27=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (process.env.NODE_ENV === 'production' ? '; Secure' : ''))
    res.json({ ok: true })
  } catch (error) { handleDbError(res, error) }
})

api.patch('/public/session/consents', requireUserSession, async (req, res) => {
  const appId = String(req.body?.appId || '')
  const field = String(req.body?.field || '')
  const decision = String(req.body?.decision || '')
  if (!appId || !['dip', 'email', 'phone', 'photo', 'identityVerified'].includes(field) || !['granted', 'denied', 'revoked'].includes(decision)) {
    return fail(res, 400, 'INVALID_CONSENT', 'La decisión de consentimiento no es válida.')
  }
  if (decision === 'granted' && !shareableConsentFields.includes(field)) {
    return fail(res, 409, 'FIELD_NOT_AVAILABLE', 'Este dato no está disponible para compartir en PlacetaID v27.')
  }
  try {
    const { data: app, error: appError } = await supabase.from('plid_v27_integrations')
      .select('id,name,status,scopes')
      .eq('id', appId)
      .maybeSingle()
    if (appError) throw appError
    if (!app || app.status !== 'authorized' || !app.scopes?.[field]) {
      return fail(res, 403, 'SCOPE_NOT_ALLOWED', 'La aplicación no está autorizada para este dato.')
    }
    const now = new Date().toISOString()
    const { error } = await supabase.from('plid_v27_consents').upsert({
      user_id: req.userId,
      app_id: app.id,
      field,
      status: decision,
      granted_at: decision === 'granted' ? now : null,
      revoked_at: decision === 'revoked' ? now : null,
      updated_at: now,
    }, { onConflict: 'user_id,app_id,field' })
    if (error) throw error
    const { error: auditError } = await supabase.from('plid_v27_audit').insert({
      actor_user_id: req.userId,
      target_user_id: req.userId,
      app_id: app.id,
      event_type: decision === 'granted' ? 'consent_granted' : decision === 'denied' ? 'consent_denied' : 'consent_revoked',
      details: { field },
    })
    if (auditError) throw auditError
    res.json({ ok: true, appId, field, status: decision, updated: now })
  } catch (error) { handleDbError(res, error) }
})

// PlacetaID móvil y Desktop confirman la solicitud usando el token secreto
// del dispositivo previamente vinculado. La aplicación nunca recibe el DIP
// ni puede aprobar una solicitud de otro usuario.
api.post('/public/auth-requests/:id/approve', authLimiter, async (req, res) => {
  const requestId = String(req.params.id || '')
  const deviceToken = String(req.body?.deviceToken || '')
  if (!requestId || !deviceToken) return fail(res, 400, 'DEVICE_TOKEN_REQUIRED', 'Se requiere el token del dispositivo.')
  try {
    const { data: request, error: requestError } = await supabase.from('plid_v27_auth_requests').select('id,user_id,method,status,expires_at').eq('id', requestId).maybeSingle()
    if (requestError) throw requestError
    if (!request || request.status !== 'pending' || Date.parse(request.expires_at) <= Date.now()) return fail(res, 410, 'REQUEST_EXPIRED', 'La solicitud ha caducado.')
    if (!['mobile', 'desktop'].includes(request.method)) return fail(res, 409, 'METHOD_MISMATCH', 'Esta solicitud requiere el Autentificador.')
    const { data: device, error: deviceError } = await supabase.from('plid_v27_devices').select('id,user_id,method,active,expires_at,revoked_at').eq('session_token_hash', hashToken(deviceToken)).eq('user_id', request.user_id).maybeSingle()
    if (deviceError) throw deviceError
    if (!device || device.method !== request.method || !device.active || device.revoked_at || Date.parse(device.expires_at) <= Date.now()) return fail(res, 401, 'INVALID_DEVICE', 'El dispositivo no está vinculado o ha caducado.')
    const { data: updated, error: updateError } = await supabase.from('plid_v27_auth_requests').update({ status: 'authorized', completed_at: new Date().toISOString() }).eq('id', request.id).eq('status', 'pending').select('id,status,completed_at').maybeSingle()
    if (updateError) throw updateError
    if (!updated) return fail(res, 409, 'REQUEST_ALREADY_COMPLETED', 'La solicitud ya ha sido resuelta.')
    await supabase.from('plid_v27_devices').update({
      last_seen_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + deviceLifetimeMs).toISOString(),
    }).eq('id', device.id)
    await supabase.from('plid_v27_audit').insert({ actor_user_id: request.user_id, target_user_id: request.user_id, event_type: 'device_authentication_approved', details: { method: request.method, request_id: request.id } })
    res.json({ ok: true, status: 'authorized' })
  } catch (error) { handleDbError(res, error) }
})

api.post('/public/auth-requests/:id/deny', authLimiter, async (req, res) => {
  const requestId = String(req.params.id || '')
  const deviceToken = String(req.body?.deviceToken || '')
  if (!requestId || !deviceToken) return fail(res, 400, 'DEVICE_TOKEN_REQUIRED', 'Se requiere el token del dispositivo.')
  try {
    const { data: request, error: requestError } = await supabase.from('plid_v27_auth_requests').select('id,user_id,method,status,expires_at').eq('id', requestId).maybeSingle()
    if (requestError) throw requestError
    const { data: device, error: deviceError } = await supabase.from('plid_v27_devices').select('id,method,active,expires_at,revoked_at').eq('session_token_hash', hashToken(deviceToken)).eq('user_id', request?.user_id).maybeSingle()
    if (deviceError) throw deviceError
    if (!request || !device || device.method !== request.method || !device.active || device.revoked_at || Date.parse(device.expires_at) <= Date.now()) return fail(res, 401, 'INVALID_DEVICE', 'El dispositivo no está vinculado o ha caducado.')
    const { error: updateError } = await supabase.from('plid_v27_auth_requests').update({ status: 'denied', completed_at: new Date().toISOString() }).eq('id', request.id).eq('status', 'pending')
    if (updateError) throw updateError
    await supabase.from('plid_v27_audit').insert({ actor_user_id: request.user_id, target_user_id: request.user_id, event_type: 'device_authentication_denied', details: { method: request.method, request_id: request.id } })
    res.json({ ok: true, status: 'denied' })
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
  if (!requestId || !shareableConsentFields.includes(field) || !decision) return fail(res, 400, 'INVALID_CONSENT', 'La decisión de consentimiento no es válida.')
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

api.use(legacyApi)

export { calculateAge, mapIntegration, mapService, requireAdmin }
