import test from 'node:test'
import assert from 'node:assert/strict'
import { buildBadgePayload, isRegisteredOrigin, originOf, safeLogoUrl, SUPPORT_EMAIL } from './badge.js'

const baseApp = {
  id: 'app-1',
  name: 'Voley Club La Placeta',
  description: 'Área del jugador',
  category: 'Deporte',
  initials: 'VC',
  color: 'pink',
  logo_url: 'https://cdn.example.org/logo.png',
  brand_color: '#a45e70',
  status: 'authorized',
  redirect_uris: ['https://voley.example.org/auth/callback'],
  min_age: 0,
  allowed_roles: ['miembro', 'visitante'],
  scopes: { dip: false, email: true, phone: false, photo: true, identityVerified: false },
  client_secret_hash: 'SECRET-SHOULD-NEVER-LEAK',
  client_id: 'voley-club',
}

const services = [
  { name: 'Área del jugador', description: 'Perfil', min_age: 0, allowed_roles: null, enabled: true },
  { name: 'Competición', description: 'Inscripciones', min_age: 16, allowed_roles: ['miembro', 'administrador'], enabled: true },
  { name: 'Antiguo', description: 'Retirado', min_age: 0, allowed_roles: null, enabled: false },
]

test('verifica una aplicación autorizada cuando el origen está registrado', () => {
  const payload = buildBadgePayload({ app: baseApp, services, origin: 'https://voley.example.org', now: new Date('2026-10-19T10:00:00Z') })
  assert.equal(payload.verified, true)
  assert.equal(payload.domain, 'voley.example.org')
  assert.equal(payload.app.name, 'Voley Club La Placeta')
  assert.equal(payload.checkedAt, '2026-10-19T10:00:00.000Z')
  assert.equal(payload.contact, SUPPORT_EMAIL)
})

test('no expone secretos, URIs registradas ni reglas internas', () => {
  const payload = buildBadgePayload({ app: baseApp, services, origin: 'https://voley.example.org' })
  const json = JSON.stringify(payload)
  assert.equal(json.includes('SECRET-SHOULD-NEVER-LEAK'), false)
  assert.equal(json.includes('client_secret'), false)
  assert.equal(json.includes('/auth/callback'), false)
  assert.equal(json.includes('redirect_uris'), false)
  assert.equal(json.includes('voley-club'), false)
})

test('deriva los datos que recibe la aplicación de sus permisos', () => {
  const payload = buildBadgePayload({ app: baseApp, services, origin: 'https://voley.example.org' })
  assert.deepEqual(payload.data.base, ['login_correct', 'over_16', 'over_18', 'name', 'surname'])
  assert.deepEqual(payload.data.optional, ['email'])
  assert.deepEqual(payload.data.unavailable, ['photo'])
})

test('excluye los servicios desactivados y limita los roles de cada servicio', () => {
  const payload = buildBadgePayload({ app: baseApp, services, origin: 'https://voley.example.org' })
  assert.deepEqual(payload.services.map((s) => s.name), ['Área del jugador', 'Competición'])
  assert.deepEqual(payload.services[0].roles, ['miembro', 'visitante'])
  // "administrador" no está en los roles de la aplicación, así que no se muestra.
  assert.deepEqual(payload.services[1].roles, ['miembro'])
  assert.equal(payload.services[1].minAge, 16)
})

test('una aplicación pendiente no se muestra como verificada', () => {
  const payload = buildBadgePayload({ app: { ...baseApp, status: 'pending' }, services, origin: 'https://voley.example.org' })
  assert.deepEqual(payload, { verified: false, reason: 'not_authorized' })
})

test('una aplicación desconocida no se verifica', () => {
  assert.deepEqual(buildBadgePayload({ app: null, origin: 'https://voley.example.org' }), { verified: false, reason: 'unknown_app' })
})

test('un origen distinto de los registrados no se verifica (copia en otro dominio)', () => {
  const payload = buildBadgePayload({ app: baseApp, services, origin: 'https://voley-fake.example.net' })
  assert.deepEqual(payload, { verified: false, reason: 'origin_mismatch' })
})

test('el subdominio, el puerto o el esquema distintos no coinciden', () => {
  assert.equal(isRegisteredOrigin(['https://voley.example.org/cb'], 'https://evil.voley.example.org'), false)
  assert.equal(isRegisteredOrigin(['https://voley.example.org/cb'], 'https://voley.example.org:8443'), false)
  assert.equal(isRegisteredOrigin(['https://voley.example.org/cb'], 'http://voley.example.org'), false)
  assert.equal(isRegisteredOrigin(['https://voley.example.org/cb'], 'https://voley.example.org'), true)
})

test('localhost en http es válido para desarrollo', () => {
  assert.equal(isRegisteredOrigin(['http://localhost:3000/cb'], 'http://localhost:3000'), true)
  assert.equal(isRegisteredOrigin(['http://localhost:3000/cb'], 'http://localhost:4000'), false)
})

test('originOf rechaza esquemas peligrosos y credenciales', () => {
  assert.equal(originOf('javascript:alert(1)'), null)
  assert.equal(originOf('data:text/html,hola'), null)
  assert.equal(originOf('https://user:pass@voley.example.org'), null)
  assert.equal(originOf('no es una url'), null)
  assert.equal(originOf('https://voley.example.org/ruta?x=1'), 'https://voley.example.org')
})

test('solo acepta logos HTTPS o imágenes incrustadas válidas', () => {
  assert.equal(safeLogoUrl('https://cdn.example.org/logo.png'), 'https://cdn.example.org/logo.png')
  assert.equal(safeLogoUrl('data:image/png;base64,iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=')
  assert.equal(safeLogoUrl('javascript:alert(1)'), '')
  assert.equal(safeLogoUrl('http://insegura.example.org/logo.png'), '')
  assert.equal(safeLogoUrl('data:text/html;base64,PHNjcmlwdD4='), '')
  assert.equal(safeLogoUrl(''), '')
})

test('un logo peligroso no llega al payload aunque esté en la base de datos', () => {
  const payload = buildBadgePayload({ app: { ...baseApp, logo_url: 'javascript:alert(1)' }, services, origin: 'https://voley.example.org' })
  assert.equal(payload.app.logoUrl, '')
})
