import crypto from 'node:crypto'

export const PASSWORD_RESET_LINK_TTL_MS = 48 * 60 * 60 * 1000

export function createPasswordResetExpiry(now = Date.now()) {
  return new Date(now + PASSWORD_RESET_LINK_TTL_MS).toISOString()
}

export function generateDip(finalInitial, random = crypto.randomInt) {
  const normalizedInitial = String(finalInitial || '').trim().slice(0, 1).toUpperCase()
  if (!/^[A-Z]$/.test(normalizedInitial)) throw new Error('INVALID_FINAL_NAME_INITIAL')
  const digits = Array.from({ length: 8 }, () => String(random(0, 10))).join('')
  return `${digits}${normalizedInitial}`
}

export function makePasswordResetToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url')
}

export function hashPasswordResetToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

export function isValidPassword(password) {
  const value = String(password || '')
  return value.length >= 8 && value.length <= 256 && /[A-Za-z]/.test(value) && /\d/.test(value) && !/[^A-Za-z0-9]/.test(value)
}

export function buildPasswordResetUrl(baseUrl, token) {
  const url = new URL('/reset-password', baseUrl)
  url.searchParams.set('token', token)
  return url.toString()
}

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim().toLowerCase())
}
