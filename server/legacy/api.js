import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import { randomBytes, randomUUID, createHmac } from 'node:crypto'
import { supabase } from '../supabase.js'
import { hashToken, isValidDip, normalizeDip, secureEquals } from '../security.js'

export const legacyApi = Router()

const deviceLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false })
const adminKey = () => process.env.PLACETAID_ADMIN_KEY || process.env.PLACETAID_V27_ADMIN_KEY || ''
const expiresIn = (value) => Number.isFinite(Date.parse(value || '')) ? Date.parse(value) : null
const activeState = (state) => ['activa', 'abierta', 'publicada', 'active'].includes(String(state || '').toLowerCase())

legacyApi.use((req, res, next) => {
  res.setHeader('X-API-Lifecycle', 'legacy-compatibility')
  res.setHeader('Deprecation', 'true')
  next()
})

legacyApi.get('/auth/fase1', (req, res) => {
  const clientId = String(req.query.client_id || '').trim()
  const state = String(req.query.state || '').trim()
  const callback = String(req.query.from || req.query.redirect_uri || '').trim()
  if (!clientId || !state || !callback) return res.status(400).json({ error: 'INVALID_LEGACY_OAUTH_REQUEST' })
  let callbackUrl
  try {
    callbackUrl = new URL(callback)
  } catch {
    return res.status(400).json({ error: 'INVALID_REDIRECT_URI' })
  }
  if (callbackUrl.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(callbackUrl.hostname)) {
    return res.status(400).json({ error: 'INVALID_REDIRECT_URI' })
  }
  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim()
  const protocol = req.secure || forwardedProto === 'https' ? 'https' : 'http'
  const login = new URL('/', `${protocol}://${req.get('host')}`)
  login.searchParams.set('client_id', clientId)
  login.searchParams.set('redirect_uri', callbackUrl.toString())
  login.searchParams.set('service', 'general')
  login.searchParams.set('state', state)
  res.redirect(302, login.toString())
})

function errorResponse(res, error) {
  const code = error?.code
  if (code === 'PGRST205' || code === '42P01') {
    return res.status(503).json({ error: 'SCHEMA_MIGRATION_REQUIRED', message: 'Aplica la migración legacy PlacetaID/RSP de Supabase.' })
  }
  if (code === 'PGRST204' || code === '42703' || code === 'PGRST202') {
    return res.status(503).json({ error: 'SCHEMA_OUTDATED', message: 'El esquema Supabase no incluye todos los campos legacy requeridos.' })
  }
  console.error('[PlacetaID legacy API]', code || 'DB_ERROR', error?.message || 'Database error')
  return res.status(500).json({ error: 'DATABASE_ERROR', message: 'No se pudo completar la operación.' })
}

function requireAdminKey(req, res) {
  const expected = adminKey()
  if (!expected) {
    res.status(503).json({ error: 'ADMIN_API_NOT_CONFIGURED' })
    return false
  }
  if (!secureEquals(expected, String(req.headers['x-api-key'] || ''))) {
    res.status(401).json({ error: 'INVALID_API_KEY' })
    return false
  }
  return true
}

async function getUser(dip) {
  const cleanDip = normalizeDip(dip)
  if (!isValidDip(cleanDip)) return null
  const { data, error } = await supabase.from('solicitantes')
    .select('id,dip,alias,nombre_real,email,fecha_nacimiento,edad,placeid,rol,estado,lista_negra,activo,bloqueado')
    .eq('dip', cleanDip).maybeSingle()
  if (error) throw error
  return data
}

function legacyUser(user) {
  const parts = String(user.nombre_real || user.alias || '').trim().split(/\s+/)
  return {
    dip: user.dip,
    placeid: user.placeid || null,
    nombre: parts.shift() || '',
    apellidos: parts.join(' '),
    nombreCompleto: user.nombre_real || user.alias || user.dip,
    rol: user.rol || 'miembro',
    edad: user.edad ?? null,
    activo: !['inactive', 'inactivo', 'closed', 'cerrado', 'suspended', 'suspendido'].includes(String(user.estado || '').toLowerCase()) && Number(user.lista_negra) !== 1,
    banned: Number(user.lista_negra) === 1,
    bloqueado: Boolean(user.bloqueado) || Number(user.lista_negra) === 1,
  }
}

async function getBoundDevice(req, dip) {
  const token = String(req.headers['x-device-token'] || req.headers['x-placetaid-device-token'] || '')
  if (token.length < 16 || token.length > 512) return null
  const user = await getUser(dip)
  if (!user) return null
  const { data, error } = await supabase.from('plid_v27_devices')
    .select('id,method,expires_at')
    .eq('user_id', user.id)
    .eq('session_token_hash', hashToken(token))
    .eq('active', true)
    .is('revoked_at', null)
    .maybeSingle()
  if (error) throw error
  if (!data || Date.parse(data.expires_at) <= Date.now()) return null
  return { user, device: data }
}

function requireBoundDevice(req, res, dip) {
  return getBoundDevice(req, dip).then((bound) => {
    if (!bound) res.status(401).json({ error: 'DEVICE_AUTHENTICATION_REQUIRED', message: 'Vuelve a vincular este dispositivo para continuar.' })
    return bound
  })
}

async function insertNotification({ dip, title, message, type, objectId }) {
  const { error } = await supabase.from('rsp_notificaciones').insert({
    id: randomUUID(),
    nivel: 'info',
    titulo: title,
    mensaje: message,
    servicio: 'placetaid',
    destinatario_dip: dip,
    objeto_tipo: type,
    objeto_id: objectId || null,
    leida: false,
    fecha: new Date().toISOString(),
    canal: 'inapp',
  })
  if (error) throw error
}

function mapVote(row) {
  return {
    ...row,
    id: row.id,
    aFavor: row.a_favor || 0,
    enContra: row.en_contra || 0,
    abstenciones: row.abstenciones || 0,
    totalVotos: row.total_votos || 0,
    totalEmitidos: row.total_emitidos || 0,
    fechaCreacion: row.fecha_creacion || row.created_at,
    fechaLimite: row.fecha_limite,
    reunionId: row.reunion_id,
    requiereQuorum: row.requiere_quorum,
  }
}

function canVote(user, vote) {
  const age = Number(user.edad || 0)
  switch (String(vote.grupo || '').toLowerCase()) {
    case 'junta': return ['administrador', 'moderador'].includes(String(user.rol || '').toLowerCase())
    case '+18': return age >= 18
    case '16-17': return age >= 16 && age < 18
    case 'junior': return age < 16
    default: return true
  }
}

function timeRemaining(date) {
  const limit = expiresIn(date)
  if (!limit) return null
  const total = Math.max(0, limit - Date.now())
  return {
    expirada: total === 0,
    dias: Math.floor(total / 86400000),
    horas: Math.floor((total % 86400000) / 3600000),
    minutos: Math.floor((total % 3600000) / 60000),
    total,
  }
}

function voteHash(voteId, dip, choice, timestamp) {
  const secret = process.env.PLID27_SESSION_SECRET || ''
  if (secret.length < 32) throw Object.assign(new Error('PLID27_SESSION_SECRET_NOT_CONFIGURED'), { code: 'CONFIGURATION_REQUIRED' })
  return createHmac('sha256', secret).update(`${voteId}:${dip}:${choice}:${timestamp}`).digest('hex')
}

async function listVotes(voteId) {
  const { data, error } = await supabase.from('rsp_registro_votos').select('*').eq('votacion_id', voteId).order('timestamp', { ascending: false })
  if (error) throw error
  return data || []
}

async function listVotations() {
  const { data, error } = await supabase.from('rsp_votaciones').select('*').order('fecha_creacion', { ascending: false }).limit(500)
  if (error) throw error
  return (data || []).map(mapVote)
}

function mapDocument(doc) {
  return {
    ...doc,
    _id: doc.id,
    creadoEn: doc.creado_en,
    firmadoEn: doc.fecha_firma || null,
    destinatarios: Array.isArray(doc.destinatarios) ? doc.destinatarios : [],
  }
}

async function listDocuments() {
  const { data, error } = await supabase.from('rsp_documentos').select('*').order('creado_en', { ascending: false }).limit(1000)
  if (error) throw error
  return (data || []).map(mapDocument)
}

async function getDocument(id) {
  const { data, error } = await supabase.from('rsp_documentos').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data ? mapDocument(data) : null
}

function notification(row) {
  return {
    _id: row.id,
    id: row.id,
    tipo: row.objeto_tipo || row.canal || 'general',
    dip: row.destinatario_dip,
    titulo: row.titulo,
    cuerpo: row.mensaje,
    votacionId: row.objeto_tipo === 'votacion' ? row.objeto_id : null,
    documentoId: row.objeto_tipo === 'documento' ? row.objeto_id : null,
    leido: Boolean(row.leida),
    creadoEn: row.fecha || row.created_at,
  }
}

async function getNotifications(dips) {
  if (!dips.length) return []
  const { data, error } = await supabase.from('rsp_notificaciones').select('*')
    .in('destinatario_dip', dips)
    .order('fecha', { ascending: false })
    .limit(100)
  if (error) throw error
  return (data || []).map(notification)
}

legacyApi.post('/internal/legacy/credentials/import', deviceLimiter, async (req, res) => {
  const expected = String(process.env.PLACETAID_V27_DEVICE_KEY || '')
  if (expected.length < 32) return res.status(503).json({ error: 'DEVICE_LINKING_NOT_CONFIGURED' })
  if (!secureEquals(expected, String(req.headers['x-placetaid-device-key'] || ''))) return res.status(401).json({ error: 'INVALID_DEVICE_LINKING_KEY' })
  const entries = req.body?.entries
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 500) return res.status(400).json({ error: 'INVALID_CREDENTIAL_BATCH' })
  try {
    const rows = []
    let identitiesCreated = 0
    for (const entry of entries) {
      const dip = normalizeDip(entry?.dip)
      const passwordHash = String(entry?.passwordHash || '')
      if (!isValidDip(dip) || !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(passwordHash)) {
        return res.status(400).json({ error: 'INVALID_CREDENTIAL_ENTRY' })
      }
      let user = await getUser(dip)
      if (!user && entry.profile && typeof entry.profile === 'object') {
        const profile = entry.profile
        const fullName = String(profile.nombre || '').trim().slice(0, 160)
        const alias = String(profile.placeid || `PLID-${dip}`).trim().slice(0, 80)
        const role = ['administrador', 'miembro', 'entidad', 'visitante', 'moderador', 'empresa'].includes(String(profile.rol))
          ? String(profile.rol)
          : 'miembro'
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
        if (Number.isInteger(profile.edad) && profile.edad >= 0 && profile.edad <= 130) identity.edad = profile.edad
        const insertIdentity = () => supabase.from('solicitantes').insert(identity).select('id,dip,alias,nombre_real,email,fecha_nacimiento,edad,placeid,rol,estado,lista_negra').single()
        let insertResult = await insertIdentity()
        if (insertResult.error?.code === '23505') {
          user = await getUser(dip)
          if (!user && identity.alias !== `PLID-${dip}`) {
            identity.alias = `PLID-${dip}`
            identity.placeid = identity.alias
            insertResult = await insertIdentity()
            if (insertResult.error && insertResult.error.code !== '23505') throw insertResult.error
            if (insertResult.error?.code === '23505') user = await getUser(dip)
          }
          if (!user && insertResult.error) {
            return res.status(409).json({ error: 'LEGACY_IDENTITY_CONFLICT', message: 'No se pudo crear el perfil legado por un conflicto de identidad.' })
          }
          if (!user && !insertResult.data) {
            return res.status(409).json({ error: 'LEGACY_IDENTITY_REQUIRED', message: 'El usuario legado no tiene un perfil compatible para importar.' })
          }
        } else if (insertResult.error) {
          throw insertResult.error
        } else {
          user = insertResult.data
          identitiesCreated++
        }
        if (!user && insertResult.data) {
          user = insertResult.data
          identitiesCreated++
        }
      }
      if (!user) return res.status(409).json({ error: 'LEGACY_IDENTITY_REQUIRED', message: 'El usuario legado no tiene un perfil compatible para importar.' })
      rows.push({ user_id: user.id, password_hash: passwordHash, updated_at: new Date().toISOString() })
    }
    const uniqueRows = [...new Map(rows.map((row) => [row.user_id, row])).values()]
    let imported = 0
    if (uniqueRows.length) {
      const { data, error } = await supabase.from('plid_v27_legacy_credentials')
        .upsert(uniqueRows, { onConflict: 'user_id', ignoreDuplicates: true })
        .select('user_id')
      if (error) throw error
      imported = data?.length || 0
    }
    res.json({ ok: true, received: entries.length, imported, identitiesCreated })
  } catch (error) { errorResponse(res, error) }
})

legacyApi.post('/mobil/register', deviceLimiter, async (req, res) => {
  const dip = normalizeDip(req.body?.dip)
  const password = String(req.body?.password || '')
  const deviceToken = String(req.body?.deviceId || req.body?.deviceToken || '')
  if (!isValidDip(dip) || password.length < 1 || deviceToken.length < 16 || deviceToken.length > 512) {
    return res.status(400).json({ error: 'DIP, contraseña y deviceId requeridos' })
  }
  try {
    const user = await getUser(dip)
    if (!user || !legacyUser(user).activo) return res.status(403).json({ error: 'Identidad no disponible' })
    const { data: credential, error: credentialError } = await supabase.from('plid_v27_legacy_credentials')
      .select('password_hash').eq('user_id', user.id).maybeSingle()
    if (credentialError) throw credentialError
    if (!credential || !await bcrypt.compare(password, credential.password_hash)) return res.status(401).json({ error: 'DIP o contraseña incorrectos' })
    const method = String(req.body?.platform || '').toLowerCase() === 'windows' || String(req.body?.platform || '').toLowerCase() === 'desktop' ? 'desktop' : 'mobile'
    const { error } = await supabase.from('plid_v27_devices').upsert({
      user_id: user.id,
      device_id: deviceToken,
      device_name: String(req.body?.deviceName || (method === 'desktop' ? 'PC' : 'Dispositivo móvil')).slice(0, 100),
      method,
      session_token_hash: hashToken(deviceToken),
      active: true,
      expires_at: new Date(Date.now() + 365 * 86400000).toISOString(),
      last_seen_at: new Date().toISOString(),
      revoked_at: null,
    }, { onConflict: 'user_id,device_id' })
    if (error) throw error
    res.json({ ok: true, mensaje: 'Dispositivo vinculado correctamente', v27Synced: true })
  } catch (error) { errorResponse(res, error) }
})

legacyApi.post('/mobil/cambiar-password', deviceLimiter, async (req, res) => {
  const dip = normalizeDip(req.body?.dip)
  const currentPassword = String(req.body?.passwordActual || '')
  const newPassword = String(req.body?.passwordNueva || '')
  if (!isValidDip(dip) || currentPassword.length < 1 || newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return res.status(400).json({ error: 'DIP y contraseñas válidas requeridos' })
  }
  try {
    const user = await getUser(dip)
    if (!user) return res.status(404).json({ error: 'Identidad no encontrada' })
    const { data: credential, error: credentialError } = await supabase.from('plid_v27_legacy_credentials').select('password_hash').eq('user_id', user.id).maybeSingle()
    if (credentialError) throw credentialError
    if (!credential || !await bcrypt.compare(currentPassword, credential.password_hash)) return res.status(401).json({ error: 'La contraseña actual no es correcta' })
    const passwordHash = await bcrypt.hash(newPassword, 12)
    const { error } = await supabase.from('plid_v27_legacy_credentials').upsert({ user_id: user.id, password_hash: passwordHash, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    if (error) throw error
    const { error: revokeError } = await supabase.from('plid_v27_devices').update({ active: false, revoked_at: new Date().toISOString() }).eq('user_id', user.id).eq('active', true)
    if (revokeError) throw revokeError
    res.json({ ok: true, mensaje: 'Contraseña actualizada. Vuelve a vincular tus dispositivos.', sesionesCerradas: true })
  } catch (error) { errorResponse(res, error) }
})

legacyApi.post('/admin/cambiar-password', async (req, res) => {
  if (!requireAdminKey(req, res)) return
  const dip = normalizeDip(req.body?.dip)
  const password = String(req.body?.passwordNueva || req.body?.password || req.body?.nuevaPassword || '')
  if (!isValidDip(dip) || password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return res.status(400).json({ error: 'DIP y contraseña válidos requeridos' })
  try {
    const user = await getUser(dip)
    if (!user) return res.status(404).json({ error: 'Identidad no encontrada' })
    const passwordHash = await bcrypt.hash(password, 12)
    const { error } = await supabase.from('plid_v27_legacy_credentials').upsert({ user_id: user.id, password_hash: passwordHash, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    if (error) throw error
    const { error: revokeError } = await supabase.from('plid_v27_devices').update({ active: false, revoked_at: new Date().toISOString() }).eq('user_id', user.id).eq('active', true)
    if (revokeError) throw revokeError
    res.json({ success: true, dip })
  } catch (error) { errorResponse(res, error) }
})

legacyApi.post('/mobil/unregister', async (req, res) => {
  const dip = normalizeDip(req.body?.dip)
  const deviceId = String(req.body?.deviceId || req.headers['x-device-token'] || '')
  if (!isValidDip(dip) || !deviceId) return res.status(400).json({ error: 'DIP y deviceId válidos requeridos' })
  try {
    const bound = await getBoundDevice(req, dip)
    if (!bound || deviceId !== String(req.headers['x-device-token'] || deviceId)) return res.status(401).json({ error: 'DEVICE_AUTHENTICATION_REQUIRED' })
    const { error } = await supabase.from('plid_v27_devices').update({ active: false, revoked_at: new Date().toISOString() })
      .eq('user_id', bound.user.id).eq('device_id', deviceId).eq('active', true)
    if (error) throw error
    res.json({ ok: true, mensaje: 'Dispositivo desvinculado', v27Synced: true })
  } catch (error) { errorResponse(res, error) }
})

legacyApi.get('/mobil/devices/:dip', async (req, res) => {
  const dip = normalizeDip(req.params.dip)
  try {
    const bound = await requireBoundDevice(req, res, dip)
    if (!bound) return
    const { data, error } = await supabase.from('plid_v27_devices').select('device_id,device_name,method,last_seen_at,created_at')
      .eq('user_id', bound.user.id).eq('active', true).is('revoked_at', null).order('created_at', { ascending: false })
    if (error) throw error
    res.json({ ok: true, devices: (data || []).map((d) => ({ deviceId: d.device_id, deviceName: d.device_name, platform: d.method, tipo: d.method === 'desktop' ? 'pc' : 'movil', ultimoAcceso: d.last_seen_at, registradoEn: d.created_at })) })
  } catch (error) { errorResponse(res, error) }
})

legacyApi.post('/mobil/request', deviceLimiter, async (req, res) => {
  const dip = normalizeDip(req.body?.dip)
  const service = String(req.body?.servicio || '').trim().slice(0, 120)
  const serviceUrl = req.body?.servicioUrl ? String(req.body.servicioUrl).slice(0, 500) : null
  if (!isValidDip(dip) || !service) return res.status(400).json({ error: 'DIP y servicio requeridos' })
  try {
    const user = await getUser(dip)
    if (!user || !legacyUser(user).activo) return res.status(404).json({ error: 'Identidad no disponible' })
    const requestCode = randomBytes(3).toString('hex').toUpperCase().slice(0, 4)
    const { data, error } = await supabase.from('plid_v27_legacy_auth_requests').insert({
      request_code: requestCode,
      user_id: user.id,
      service,
      service_url: serviceUrl,
      platform: String(req.body?.plataforma || 'web').slice(0, 30),
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    }).select('id').single()
    if (error) throw error
    res.json({ ok: true, codigo: requestCode, requestId: data.id, mensaje: `Código ${requestCode} generado. Revisa tu app PlacetaID Móvil.` })
  } catch (error) { errorResponse(res, error) }
})

legacyApi.get('/mobil/pending', async (req, res) => {
  const dip = normalizeDip(req.query.dip)
  if (!isValidDip(dip)) return res.status(400).json({ error: 'dip requerido' })
  try {
    const bound = await requireBoundDevice(req, res, dip)
    if (!bound) return
    const { data, error } = await supabase.from('plid_v27_legacy_auth_requests').select('*')
      .eq('user_id', bound.user.id).eq('status', 'pending').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(20)
    if (error) throw error
    res.json({ ok: true, requests: (data || []).map((r) => ({ _id: r.id, dip, codigo: r.request_code, servicio: r.service, servicioUrl: r.service_url, plataforma: r.platform, creadoEn: r.created_at, estado: r.status })) })
  } catch (error) { errorResponse(res, error) }
})

legacyApi.post('/mobil/authorize', async (req, res) => {
  const dip = normalizeDip(req.body?.dip)
  const requestId = String(req.body?.requestId || '')
  if (!isValidDip(dip) || !requestId) return res.status(400).json({ error: 'requestId y dip requeridos' })
  try {
    const bound = await requireBoundDevice(req, res, dip)
    if (!bound) return
    const { data: authRequest, error } = await supabase.from('plid_v27_legacy_auth_requests').select('id,user_id,status,expires_at')
      .eq('id', requestId).maybeSingle()
    if (error) throw error
    if (!authRequest || authRequest.user_id !== bound.user.id) return res.status(404).json({ error: 'Solicitud no encontrada' })
    if (authRequest.status !== 'pending' || Date.parse(authRequest.expires_at) <= Date.now()) return res.status(410).json({ error: 'La solicitud ha expirado o ya fue procesada' })
    const status = req.body?.authorized === true ? 'authorized' : 'denied'
    const { error: updateError } = await supabase.from('plid_v27_legacy_auth_requests').update({ status, completed_at: new Date().toISOString() }).eq('id', requestId).eq('status', 'pending')
    if (updateError) throw updateError
    res.json({ ok: true, estado: status })
  } catch (error) { errorResponse(res, error) }
})

legacyApi.get('/mobil/status/:dip', async (req, res) => {
  try {
    const user = await getUser(req.params.dip)
    if (!user) return res.status(404).json({ error: 'Registro no encontrado' })
    const registro = legacyUser(user)
    res.json({ ok: true, activo: registro.activo, bloqueado: registro.bloqueado, registro })
  } catch (error) { errorResponse(res, error) }
})

legacyApi.get('/auth/session', async (req, res) => {
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!bearer) return res.status(401).json({ ok: false, error: 'Sesión requerida' })
  try {
    const hash = hashToken(bearer)
    const { data: session, error } = await supabase.from('plid_v27_sessions').select('user_id,expires_at,revoked_at').eq('token_hash', hash).maybeSingle()
    if (error) throw error
    if (session && !session.revoked_at && Date.parse(session.expires_at) > Date.now()) {
      const { data: user, error: userError } = await supabase.from('solicitantes').select('id,dip,alias,nombre_real,placeid,rol,edad,estado,lista_negra').eq('id', session.user_id).maybeSingle()
      if (userError) throw userError
      if (user) return res.json({ ok: true, registro: legacyUser(user) })
    }
    const { data: device, error: deviceError } = await supabase.from('plid_v27_devices').select('user_id,expires_at,active,revoked_at').eq('session_token_hash', hash).maybeSingle()
    if (deviceError) throw deviceError
    if (!device || !device.active || device.revoked_at || Date.parse(device.expires_at) <= Date.now()) return res.status(401).json({ ok: false, error: 'Sesión no válida' })
    const { data: user, error: userError } = await supabase.from('solicitantes').select('id,dip,alias,nombre_real,placeid,rol,edad,estado,lista_negra').eq('id', device.user_id).maybeSingle()
    if (userError) throw userError
    if (!user) return res.status(401).json({ ok: false, error: 'Sesión no válida' })
    res.json({ ok: true, registro: legacyUser(user) })
  } catch (error) { errorResponse(res, error) }
})

legacyApi.get('/mobil/history/:dip', async (req, res) => {
  try {
    const bound = await requireBoundDevice(req, res, req.params.dip)
    if (!bound) return
    const { data, error } = await supabase.from('plid_v27_audit').select('id,event_type,details,created_at')
      .eq('target_user_id', bound.user.id).order('created_at', { ascending: false }).limit(Math.min(Number(req.query.limit) || 50, 100))
    if (error) throw error
    res.json({ ok: true, logs: (data || []).map((row) => ({ _id: String(row.id), dip: normalizeDip(req.params.dip), servicio: row.details?.service || 'PlacetaID', evento: row.event_type, ip: row.details?.ip || null, timestamp: row.created_at, fase: row.details?.phase || null })) })
  } catch (error) { errorResponse(res, error) }
})

legacyApi.get('/mobil/votaciones/activas', async (_req, res) => {
  try { res.json((await listVotations()).filter((v) => activeState(v.estado)).map((v) => ({ ...v, tiempoRestante: timeRemaining(v.fechaLimite) }))) }
  catch (error) { errorResponse(res, error) }
})

legacyApi.get('/mobil/votaciones/pendientes/:dip', async (req, res) => {
  try {
    const user = await getUser(req.params.dip)
    if (!user || !legacyUser(user).activo) return res.status(404).json({ error: 'Usuario no encontrado' })
    const [votes, cast] = await Promise.all([listVotations(), listVotesForDip(user.dip)])
    const voted = new Set(cast.map((row) => row.votacion_id))
    res.json(votes.filter((v) => activeState(v.estado) && !voted.has(v.id) && canVote(user, v)).map((v) => ({ ...v, tiempoRestante: timeRemaining(v.fechaLimite), esAnonimo: false, yaVoto: false })))
  } catch (error) { errorResponse(res, error) }
})

async function listVotesForDip(dip) {
  const { data, error } = await supabase.from('rsp_registro_votos').select('id,votacion_id,dip,nombre,categoria,voto,hash,oficial,timestamp').eq('dip', normalizeDip(dip))
  if (error) throw error
  return data || []
}

async function voteDetails(id) {
  const { data, error } = await supabase.from('rsp_votaciones').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) return null
  const vote = mapVote(data)
  const records = await listVotes(id)
  const anonymous = expiresIn(vote.fechaLimite) != null && Date.now() - expiresIn(vote.fechaLimite) > 30 * 86400000 && String(vote.categoria).toLowerCase() !== 'junta'
  return { ...vote, tiempoRestante: timeRemaining(vote.fechaLimite), esAnonimo: anonymous, votos: anonymous ? records.map(({ id: voteId, hash, oficial, timestamp, voto }) => ({ id: voteId, hash, oficial, timestamp, dip: '***', nombre: 'Voto anónimo', voto })) : records }
}

legacyApi.get('/mobil/votaciones/detalle/:id', async (req, res) => {
  try {
    const vote = await voteDetails(req.params.id)
    if (!vote) return res.status(404).json({ error: 'Votación no encontrada' })
    res.json(vote)
  } catch (error) { errorResponse(res, error) }
})

legacyApi.get('/mobil/votaciones/:id', async (req, res) => {
  try {
    if (isValidDip(req.params.id)) {
      const user = await getUser(req.params.id)
      if (!user || !legacyUser(user).activo) return res.status(404).json({ error: 'Usuario no encontrado' })
      const votes = (await listVotations()).filter((v) => activeState(v.estado) && canVote(user, v))
      return res.json(votes.map((v) => ({ ...v, tiempoRestante: timeRemaining(v.fechaLimite), esAnonimo: false })))
    }
    const vote = await voteDetails(req.params.id)
    if (!vote) return res.status(404).json({ error: 'Votación no encontrada' })
    res.json(vote)
  } catch (error) { errorResponse(res, error) }
})

legacyApi.post('/mobil/votaciones/:id/ejercer', async (req, res) => {
  const dip = normalizeDip(req.body?.dip)
  const choice = String(req.body?.voto || '')
  if (!isValidDip(dip) || !choice) return res.status(400).json({ error: 'DIP y voto requeridos' })
  try {
    const bound = await requireBoundDevice(req, res, dip)
    if (!bound) return
    const { data: vote, error } = await supabase.from('rsp_votaciones').select('*').eq('id', req.params.id).maybeSingle()
    if (error) throw error
    if (!vote) return res.status(404).json({ error: 'Votación no encontrada' })
    if (!activeState(vote.estado)) return res.status(400).json({ error: 'Esta votación ya está cerrada' })
    const options = Array.isArray(vote.opciones) ? vote.opciones : ['a_favor', 'en_contra', 'abstencion']
    if (!options.includes(choice)) return res.status(400).json({ error: 'Voto inválido' })
    if (!canVote(bound.user, vote)) return res.status(403).json({ error: 'No tienes derecho a voto en esta categoría' })
    const timestamp = new Date().toISOString()
    const hash = voteHash(req.params.id, dip, choice, timestamp)
    const { data: result, error: rpcError } = await supabase.rpc('plid_v27_legacy_cast_vote', {
      p_votacion_id: req.params.id,
      p_dip: dip,
      p_nombre: bound.user.nombre_real || bound.user.alias || dip,
      p_categoria: vote.categoria || vote.grupo || 'General',
      p_voto: choice,
      p_hash: hash,
      p_timestamp: timestamp,
    })
    if (rpcError) {
      if (rpcError.message?.includes('DUPLICATE_VOTE')) return res.status(409).json({ error: 'Ya has ejercido tu voto en esta votación' })
      if (rpcError.message?.includes('VOTATION_CLOSED') || rpcError.message?.includes('VOTATION_EXPIRED')) return res.status(400).json({ error: 'La votación está cerrada o ha expirado' })
      if (rpcError.message?.includes('VOTATION_NOT_FOUND')) return res.status(404).json({ error: 'Votación no encontrada' })
      throw rpcError
    }
    res.json({ success: true, message: 'Voto registrado oficialmente', registro: { id: result.id, hash, timestamp, oficial: true }, votacion: { id: req.params.id } })
  } catch (error) { errorResponse(res, error) }
})

legacyApi.get('/mobil/votaciones/verificar/:votacionId/:dip', async (req, res) => {
  try {
    const { data: record, error } = await supabase.from('rsp_registro_votos').select('*').eq('votacion_id', req.params.votacionId).eq('dip', normalizeDip(req.params.dip)).maybeSingle()
    if (error) throw error
    if (!record) return res.status(404).json({ error: 'Voto no encontrado' })
    const recomputed = voteHash(record.votacion_id, record.dip, record.voto, record.timestamp)
    const integro = secureEquals(recomputed, record.hash)
    res.json({ verificado: integro, oficial: Boolean(record.oficial), timestamp: record.timestamp, hash: record.hash, hashRecalculado: recomputed, voto: record.voto, integro })
  } catch (error) { errorResponse(res, error) }
})

legacyApi.get('/mobil/votaciones/historial/:dip', async (req, res) => {
  try {
    const dip = normalizeDip(req.params.dip)
    const bound = await requireBoundDevice(req, res, dip)
    if (!bound) return
    const [votes, records] = await Promise.all([listVotations(), listVotesForDip(dip)])
    const mine = new Map(records.map((row) => [row.votacion_id, row]))
    res.json(votes.map((v) => {
      const record = mine.get(v.id)
      return { id: v.id, titulo: v.titulo, descripcion: v.descripcion, categoria: v.categoria || v.grupo, grupo: v.grupo, estado: v.estado, resultado: v.resultado, fechaCreacion: v.fechaCreacion, fechaLimite: v.fechaLimite, reunionId: v.reunionId, aFavor: v.aFavor, enContra: v.enContra, abstenciones: v.abstenciones, totalVotos: v.totalVotos, totalEmitidos: v.totalEmitidos, miVoto: record ? { voto: record.voto, timestamp: record.timestamp, hash: record.hash, oficial: record.oficial } : null, esAnonimo: false, votos: [] }
    }).filter((entry) => entry.miVoto).sort((a, b) => String(b.fechaCreacion || '').localeCompare(String(a.fechaCreacion || ''))))
  } catch (error) { errorResponse(res, error) }
})

legacyApi.post('/mobil/multi/votaciones', async (req, res) => {
  try {
    const dips = Array.isArray(req.body?.dips) ? [...new Set(req.body.dips.map(normalizeDip).filter(isValidDip))] : []
    for (const dip of dips) if (!await requireBoundDevice(req, res, dip)) return
    const users = await Promise.all(dips.map(getUser))
    const votes = (await listVotations()).filter((v) => activeState(v.estado))
    const result = []
    for (const user of users.filter(Boolean)) for (const vote of votes) if (canVote(user, vote)) result.push({ ...vote, identidad: user.dip, identidadNombre: user.nombre_real || user.alias || user.dip })
    res.json(result)
  } catch (error) { errorResponse(res, error) }
})

legacyApi.post('/mobil/multi/votaciones/activas', async (req, res) => {
  try {
    const dips = Array.isArray(req.body?.dips) ? [...new Set(req.body.dips.map(normalizeDip).filter(isValidDip))] : []
    for (const dip of dips) if (!await requireBoundDevice(req, res, dip)) return
    const users = await Promise.all(dips.map(getUser))
    const votes = (await listVotations()).filter((v) => activeState(v.estado))
    const result = []
    for (const user of users.filter(Boolean)) {
      const records = await listVotesForDip(user.dip)
      const voted = new Set(records.map((r) => r.votacion_id))
      for (const vote of votes) if (!voted.has(vote.id) && canVote(user, vote)) result.push({ ...vote, identidad: user.dip, identidadNombre: user.nombre_real || user.alias || user.dip, tiempoRestante: timeRemaining(vote.fechaLimite) })
    }
    res.json(result)
  } catch (error) { errorResponse(res, error) }
})

legacyApi.post('/mobil/multi/votaciones/historial', async (req, res) => {
  try {
    const dips = Array.isArray(req.body?.dips) ? [...new Set(req.body.dips.map(normalizeDip).filter(isValidDip))] : []
    for (const dip of dips) if (!await requireBoundDevice(req, res, dip)) return
    const votes = await listVotations()
    const result = []
    for (const dip of dips) {
      const records = await listVotesForDip(dip)
      const byVote = new Map(records.map((r) => [r.votacion_id, r]))
      for (const vote of votes) {
        const record = byVote.get(vote.id)
        if (record) result.push({ id: vote.id, titulo: vote.titulo, identidad: dip, grupo: vote.grupo, estado: vote.estado, resultado: vote.resultado, aFavor: vote.aFavor, enContra: vote.enContra, abstenciones: vote.abstenciones, miVoto: { voto: record.voto, timestamp: record.timestamp, hash: record.hash } })
      }
    }
    res.json(result)
  } catch (error) { errorResponse(res, error) }
})

legacyApi.get('/mobil/documentos/:dip', async (req, res) => {
  try {
    const bound = await requireBoundDevice(req, res, req.params.dip)
    if (!bound) return
    res.json((await listDocuments()).filter((doc) => doc.destinatarios.some((recipient) => normalizeDip(recipient.dip) === bound.user.dip && !recipient.firmado && !recipient.rechazado)))
  } catch (error) { errorResponse(res, error) }
})

legacyApi.post('/admin/documentos', async (req, res) => {
  if (!requireAdminKey(req, res)) return
  const id = String(req.body?.id || '').trim()
  const title = String(req.body?.titulo || '').trim()
  if (!id || !title) return res.status(400).json({ error: 'id y titulo requeridos' })
  try {
    const existing = await getDocument(id)
    const dips = Array.isArray(req.body?.destinatariosDIP) ? [...new Set(req.body.destinatariosDIP.map(normalizeDip).filter(isValidDip))] : []
    const users = await Promise.all(dips.map(getUser))
    const recipients = users.filter(Boolean).map((user) => {
      const previous = existing?.destinatarios.find((recipient) => normalizeDip(recipient.dip) === user.dip)
      return previous || { dip: user.dip, nombre: user.nombre_real || user.alias || user.dip, firmado: false, rechazado: false, fechaFirma: null }
    })
    const row = {
      id,
      titulo: title,
      tipo: String(req.body?.tipo || 'documento'),
      entidad: String(req.body?.entidad || 'administracion'),
      csv: req.body?.csv || `CSV-${Date.now().toString(36).toUpperCase()}`,
      hash: req.body?.hash || null,
      contenido: req.body?.contenido || null,
      estado: existing?.estado || (recipients.length ? 'pendiente' : 'enviado'),
      firmado: existing?.firmado || false,
      destinatarios: recipients,
      dip: dips.length === 1 ? dips[0] : null,
      creado_en: existing?.creado_en || new Date().toISOString(),
    }
    const { data, error } = await supabase.from('rsp_documentos').upsert(row, { onConflict: 'id' }).select('*').single()
    if (error) throw error
    for (const dip of dips) await insertNotification({ dip, title: `Documento pendiente: ${title}`, message: `Tienes un documento pendiente de firma: ${title}.`, type: 'documento', objectId: id })
    res.json({ success: true, documento: mapDocument(data), notificacionesEnviadas: dips.length })
  } catch (error) { errorResponse(res, error) }
})

legacyApi.get('/admin/documentos', async (req, res) => {
  if (!requireAdminKey(req, res)) return
  try { res.json(await listDocuments()) } catch (error) { errorResponse(res, error) }
})

legacyApi.get('/admin/documentos/:id', async (req, res) => {
  if (!requireAdminKey(req, res)) return
  try {
    const doc = await getDocument(req.params.id)
    if (!doc) return res.status(404).json({ error: 'No encontrado' })
    res.json(doc)
  } catch (error) { errorResponse(res, error) }
})

async function updateSignature(req, res, rejected = false) {
  const dip = normalizeDip(req.body?.dip)
  if (!isValidDip(dip)) return res.status(400).json({ error: 'DIP requerido' })
  const bound = await requireBoundDevice(req, res, dip)
  if (!bound) return
  const doc = await getDocument(req.params.id)
  if (!doc) return res.status(404).json({ error: 'No encontrado' })
  const recipients = doc.destinatarios.map((recipient) => ({ ...recipient }))
  const recipient = recipients.find((item) => normalizeDip(item.dip) === dip)
  if (!recipient) return res.status(403).json({ error: 'No tienes documentos pendientes con este ID' })
  if (recipient.firmado || recipient.rechazado) return res.status(409).json({ error: 'El documento ya fue procesado' })
  if (rejected) recipient.rechazado = true
  else {
    recipient.firmado = true
    recipient.fechaFirma = new Date().toISOString()
    if (req.body?.firma_base64) recipient.firmaBase64 = String(req.body.firma_base64)
  }
  const allSigned = recipients.length > 0 && recipients.every((item) => item.firmado)
  const state = allSigned ? 'Oficial' : rejected ? 'rechazado' : 'firmado'
  const patch = {
    destinatarios: recipients,
    estado: state,
    firmado: allSigned,
    firmado_por: dip,
    fecha_firma: rejected ? null : recipient.fechaFirma,
    firma_base64: rejected ? null : recipient.firmaBase64 || null,
  }
  const { error } = await supabase.from('rsp_documentos').update(patch).eq('id', doc.id)
  if (error) throw error
  await insertNotification({ dip, title: rejected ? `Documento rechazado: ${doc.titulo}` : `Documento firmado: ${doc.titulo}`, message: rejected ? `Has rechazado el documento "${doc.titulo}".` : `Has firmado el documento "${doc.titulo}".`, type: 'documento', objectId: doc.id })
  if (req.path.includes('/admin/')) return res.json({ success: true, estado: state, firmado: !rejected, documento: { ...doc, ...patch } })
  res.json({ success: true, estado: state, firmado: !rejected, firmaRecibida: Boolean(req.body?.firma_base64) })
}

legacyApi.post('/mobil/documentos/:id/firmar', async (req, res) => {
  try { await updateSignature(req, res) } catch (error) { errorResponse(res, error) }
})
legacyApi.post('/mobil/documentos/:id/firmar-con-firma', async (req, res) => {
  if (!req.body?.firma_base64) return res.status(400).json({ error: 'firma_base64 requerida' })
  try { await updateSignature(req, res) } catch (error) { errorResponse(res, error) }
})
legacyApi.post('/mobil/documentos/:id/rechazar', async (req, res) => {
  try { await updateSignature(req, res, true) } catch (error) { errorResponse(res, error) }
})
legacyApi.post('/admin/documentos/:id/firmar', async (req, res) => {
  if (!requireAdminKey(req, res)) return
  try { await updateSignature(req, res) } catch (error) { errorResponse(res, error) }
})

legacyApi.post('/mobil/multi/documentos', async (req, res) => {
  try {
    const dips = Array.isArray(req.body?.dips) ? [...new Set(req.body.dips.map(normalizeDip).filter(isValidDip))] : []
    for (const dip of dips) if (!await requireBoundDevice(req, res, dip)) return
    const docs = (await listDocuments()).filter((doc) => doc.destinatarios.some((recipient) => dips.includes(normalizeDip(recipient.dip)) && req.body?.todos === true || dips.includes(normalizeDip(recipient.dip)) && !recipient.firmado && !recipient.rechazado && doc.estado !== 'Oficial'))
    res.json(docs.map((doc) => ({ ...doc, identidad: doc.destinatarios[0]?.dip || '', identidadNombre: doc.destinatarios[0]?.nombre || '' })))
  } catch (error) { errorResponse(res, error) }
})

legacyApi.post('/mobil/multi/documentos/todos', async (req, res) => {
  req.body = { ...req.body, todos: true }
  try {
    const dips = Array.isArray(req.body?.dips) ? [...new Set(req.body.dips.map(normalizeDip).filter(isValidDip))] : []
    for (const dip of dips) if (!await requireBoundDevice(req, res, dip)) return
    const docs = (await listDocuments()).filter((doc) => doc.destinatarios.some((recipient) => dips.includes(normalizeDip(recipient.dip))))
    res.json(docs.map((doc) => ({ ...doc, identidad: doc.destinatarios[0]?.dip || '', identidadNombre: doc.destinatarios[0]?.nombre || '' })))
  } catch (error) { errorResponse(res, error) }
})

legacyApi.post('/mobil/multi/documentos/:id/contenido', async (req, res) => {
  try {
    const dips = Array.isArray(req.body?.dips) ? [...new Set(req.body.dips.map(normalizeDip).filter(isValidDip))] : []
    let authorized = false
    for (const dip of dips) {
      const bound = await requireBoundDevice(req, res, dip)
      if (!bound) return
      authorized ||= bound.user.dip === dip
    }
    const doc = await getDocument(req.params.id)
    if (!doc) return res.status(404).json({ error: 'No encontrado' })
    if (!authorized || !doc.destinatarios.some((recipient) => dips.includes(normalizeDip(recipient.dip)))) return res.status(403).json({ error: 'Sin acceso a este documento' })
    res.json({ id: doc.id, titulo: doc.titulo, tipo: doc.tipo, csv: doc.csv, contenido: doc.contenido || null, estado: doc.estado, destinatarios: doc.destinatarios })
  } catch (error) { errorResponse(res, error) }
})

legacyApi.get('/mobil/notificaciones/:dip', async (req, res) => {
  try {
    const bound = await requireBoundDevice(req, res, req.params.dip)
    if (!bound) return
    res.json(await getNotifications([bound.user.dip]))
  } catch (error) { errorResponse(res, error) }
})

legacyApi.post('/mobil/notificaciones/leer', async (req, res) => {
  const dip = normalizeDip(req.body?.dip)
  const id = String(req.body?.id || req.body?.notificacionId || '')
  if (!id || !isValidDip(dip)) return res.status(400).json({ error: 'DIP e id de notificación requeridos' })
  try {
    const bound = await requireBoundDevice(req, res, dip)
    if (!bound) return
    const { error } = await supabase.from('rsp_notificaciones').update({ leida: true, leida_en: new Date().toISOString() }).eq('id', id).eq('destinatario_dip', dip)
    if (error) throw error
    res.json({ ok: true })
  } catch (error) { errorResponse(res, error) }
})

legacyApi.post('/mobil/multi/notificaciones', async (req, res) => {
  try {
    const dips = Array.isArray(req.body?.dips) ? [...new Set(req.body.dips.map(normalizeDip).filter(isValidDip))] : []
    for (const dip of dips) if (!await requireBoundDevice(req, res, dip)) return
    res.json(await getNotifications(dips))
  } catch (error) { errorResponse(res, error) }
})

legacyApi.post('/mobil/multi/pending', async (req, res) => {
  try {
    const dips = Array.isArray(req.body?.dips) ? [...new Set(req.body.dips.map(normalizeDip).filter(isValidDip))] : []
    const output = []
    for (const dip of dips) {
      const bound = await requireBoundDevice(req, res, dip)
      if (!bound) return
      const { data, error } = await supabase.from('plid_v27_legacy_auth_requests').select('*')
        .eq('user_id', bound.user.id).eq('status', 'pending').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false })
      if (error) throw error
      output.push(...(data || []).map((r) => ({ _id: r.id, identidad: dip, codigo: r.request_code, servicio: r.service, servicioUrl: r.service_url, plataforma: r.platform, creadoEn: r.created_at, estado: r.status })))
    }
    res.json(output)
  } catch (error) { errorResponse(res, error) }
})

legacyApi.post('/admin/votaciones', async (req, res) => {
  if (!requireAdminKey(req, res)) return
  const id = String(req.body?.id || '').trim()
  const title = String(req.body?.titulo || '').trim()
  if (!id || !title) return res.status(400).json({ error: 'id y titulo requeridos' })
  try {
    const group = String(req.body?.grupo || 'Publico_General')
    const { data: people, error: peopleError } = await supabase.from('solicitantes').select('id,dip,alias,nombre_real,edad,rol,estado,lista_negra').limit(5000)
    if (peopleError) throw peopleError
    const recipients = (people || []).filter((user) => legacyUser(user).activo && canVote(user, { grupo: group })).map((user) => ({ dip: user.dip, nombre: user.nombre_real || user.alias || user.dip }))
    const now = new Date().toISOString()
    const row = {
      id,
      titulo: title,
      descripcion: String(req.body?.descripcion || ''),
      categoria: String(req.body?.categoria || group),
      grupo: group,
      quorum: Number(req.body?.quorum) || 50,
      a_favor: Number(req.body?.aFavor) || 0,
      en_contra: Number(req.body?.enContra) || 0,
      abstenciones: Number(req.body?.abstenciones) || 0,
      total_votos: (Number(req.body?.aFavor) || 0) + (Number(req.body?.enContra) || 0) + (Number(req.body?.abstenciones) || 0),
      total_emitidos: 0,
      estado: String(req.body?.estado || 'Activa'),
      resultado: req.body?.resultado || null,
      opciones: Array.isArray(req.body?.opciones) && req.body.opciones.length >= 2 ? req.body.opciones.map(String) : ['a_favor', 'en_contra', 'abstencion'],
      resultados: {},
      destinatarios: recipients,
      reunion_id: req.body?.reunionId || null,
      requiere_quorum: req.body?.requiereQuorum !== false,
      fecha_limite: req.body?.fechaLimite || new Date(Date.now() + 7 * 86400000).toISOString(),
      fecha_creacion: now,
    }
    const { data, error } = await supabase.from('rsp_votaciones').upsert(row, { onConflict: 'id' }).select('*').single()
    if (error) throw error
    for (const recipient of recipients) await insertNotification({ dip: recipient.dip, title: `Nueva votación: ${title}`, message: `Se ha abierto una votación para ${group}.`, type: 'votacion', objectId: id })
    res.json({ success: true, votacion: mapVote(data), destinatarios: recipients.length })
  } catch (error) { errorResponse(res, error) }
})

legacyApi.get('/admin/votaciones', async (req, res) => {
  if (!requireAdminKey(req, res)) return
  try { res.json(await listVotations()) } catch (error) { errorResponse(res, error) }
})

legacyApi.get('/admin/votaciones/:id', async (req, res) => {
  if (!requireAdminKey(req, res)) return
  try {
    const vote = await voteDetails(req.params.id)
    if (!vote) return res.status(404).json({ error: 'No encontrada' })
    res.json(vote)
  } catch (error) { errorResponse(res, error) }
})

legacyApi.put('/admin/votaciones/:id/cerrar', async (req, res) => {
  if (!requireAdminKey(req, res)) return
  try {
    const { data: vote, error } = await supabase.from('rsp_votaciones').select('*').eq('id', req.params.id).maybeSingle()
    if (error) throw error
    if (!vote) return res.status(404).json({ error: 'No encontrada' })
    const result = Number(vote.a_favor || 0) > Number(vote.en_contra || 0) ? 'Aprobada' : 'Rechazada'
    const { error: updateError } = await supabase.from('rsp_votaciones').update({ estado: 'Cerrada', resultado: result, fecha_cierre: new Date().toISOString() }).eq('id', req.params.id)
    if (updateError) throw updateError
    const recipients = Array.isArray(vote.destinatarios) ? vote.destinatarios : []
    for (const recipient of recipients) await insertNotification({ dip: recipient.dip, title: `Resultado votación: ${vote.titulo}`, message: `La votación "${vote.titulo}" se cerró. Resultado: ${result}`, type: 'votacion', objectId: req.params.id })
    res.json({ success: true, estado: 'Cerrada', resultado: result })
  } catch (error) { errorResponse(res, error) }
})
