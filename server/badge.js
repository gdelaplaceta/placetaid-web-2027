// Insignia "Sitio Verificado" de PlacetaID.
// Módulo sin dependencias: construye solo la información pública que el widget
// puede mostrar. Nunca incluye secretos, URIs registradas ni reglas internas.

export const SUPPORT_EMAIL = 'seguridaddigital@laplaceta.org'

export const shareableConsentFields = ['dip', 'email', 'identityVerified']
export const unavailableConsentFields = ['phone', 'photo']
export const baseDisclosureFields = ['login_correct', 'over_16', 'over_18', 'name', 'surname']

// Devuelve "https://host:puerto" de una URL válida, o null. Solo acepta http(s).
export function originOf(value) {
  try {
    const url = new URL(String(value))
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.username || url.password) return null
    return url.origin
  } catch {
    return null
  }
}

// Una web solo puede mostrar la insignia si su origen coincide exactamente con
// el origen de una URI de retorno registrada (mismo esquema, host y puerto).
export function isRegisteredOrigin(redirectUris, origin) {
  const wanted = originOf(origin)
  if (!wanted || !Array.isArray(redirectUris)) return false
  return redirectUris.some((uri) => originOf(uri) === wanted)
}

// Solo se muestran logos servidos por HTTPS o incrustados como imagen PNG, JPEG o WebP.
export function safeLogoUrl(value) {
  const text = String(value || '')
  if (/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(text)) return text
  try {
    const url = new URL(text)
    if (url.protocol === 'https:') return url.toString()
  } catch {
    // URL no válida: se ignora y el widget mostrará las iniciales.
  }
  return ''
}

function rolesFor(service, appRoles) {
  if (!Array.isArray(service.allowed_roles)) return appRoles
  return service.allowed_roles.filter((role) => appRoles.includes(role))
}

// Construye la respuesta pública de la insignia.
// `app` es la fila de plid_v27_integrations y `services` las filas de plid_v27_services.
export function buildBadgePayload({ app, services = [], origin, now = new Date() }) {
  if (!app) return { verified: false, reason: 'unknown_app' }
  if (app.status !== 'authorized') return { verified: false, reason: 'not_authorized' }
  if (!isRegisteredOrigin(app.redirect_uris, origin)) return { verified: false, reason: 'origin_mismatch' }

  const appRoles = Array.isArray(app.allowed_roles) ? app.allowed_roles : []
  const scopes = app.scopes && typeof app.scopes === 'object' ? app.scopes : {}

  return {
    verified: true,
    domain: new URL(originOf(origin)).host,
    app: {
      name: String(app.name || ''),
      description: String(app.description || ''),
      category: String(app.category || ''),
      initials: String(app.initials || ''),
      color: String(app.color || ''),
      logoUrl: safeLogoUrl(app.logo_url),
      brandColor: String(app.brand_color || ''),
    },
    services: services
      .filter((service) => service.enabled !== false)
      .map((service) => ({
        name: String(service.name || ''),
        description: String(service.description || ''),
        minAge: Number(service.min_age) || 0,
        roles: rolesFor(service, appRoles),
      })),
    login: {
      minAge: Number(app.min_age) || 0,
      allowedRoles: appRoles,
      activeAccount: true,
      linkedMethod: true,
    },
    data: {
      base: baseDisclosureFields,
      optional: shareableConsentFields.filter((field) => scopes[field]),
      unavailable: unavailableConsentFields.filter((field) => scopes[field]),
    },
    contact: SUPPORT_EMAIL,
    checkedAt: now.toISOString(),
  }
}
