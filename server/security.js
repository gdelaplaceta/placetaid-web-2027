import crypto from 'node:crypto'

const sessionSecret = process.env.PLID27_SESSION_SECRET || process.env.SESSION_SECRET || ''
const encryptionSecret = process.env.PLID27_ENCRYPTION_KEY || process.env.PLACETAID_DNI_ENCRYPTION_KEY || sessionSecret
const encryptionKey = crypto.createHash('sha256').update(`placetaid-v27-secret:${encryptionSecret}`).digest()

export function normalizeDip(value) {
  return String(value || '').replace(/[\s-]/g, '').toUpperCase()
}

export function isValidDip(value) {
  return /^\d{8}[A-Z]$/.test(normalizeDip(value))
}

export function hashDip(value) {
  return crypto.createHmac('sha256', sessionSecret).update(normalizeDip(value)).digest('hex')
}

export function hashToken(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

export function secureEquals(left, right) {
  const a = Buffer.from(String(left || ''))
  const b = Buffer.from(String(right || ''))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export function encryptSecret(value) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv)
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.')
}

export function decryptSecret(value) {
  const [ivValue, tagValue, cipherValue] = String(value || '').split('.')
  if (!ivValue || !tagValue || !cipherValue) throw new Error('INVALID_ENCRYPTED_SECRET')
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(ivValue, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(cipherValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

function decodeBase32(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const normalized = String(value).replace(/=+$/g, '').toUpperCase()
  let bits = ''
  for (const character of normalized) {
    const index = alphabet.indexOf(character)
    if (index < 0) throw new Error('INVALID_TOTP_SECRET')
    bits += index.toString(2).padStart(5, '0')
  }
  const bytes = []
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(parseInt(bits.slice(offset, offset + 8), 2))
  return Buffer.from(bytes)
}

export function verifyTotp(secret, token, now = Date.now()) {
  if (!/^\d{6}$/.test(String(token))) return false
  const key = decodeBase32(secret)
  const counter = Math.floor(now / 30000)
  for (let drift = -1; drift <= 1; drift += 1) {
    const message = Buffer.alloc(8)
    message.writeBigUInt64BE(BigInt(counter + drift))
    const digest = crypto.createHmac('sha1', key).update(message).digest()
    const offset = digest[digest.length - 1] & 0x0f
    const number = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
    if (secureEquals(String(number).padStart(6, '0'), token)) return true
  }
  return false
}

export function signSession(payload, expiresInSeconds = 8 * 60 * 60) {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({ ...payload, iat: now, exp: now + expiresInSeconds })).toString('base64url')
  const unsigned = `${header}.${body}`
  const signature = crypto.createHmac('sha256', sessionSecret).update(unsigned).digest('base64url')
  return `${unsigned}.${signature}`
}

export function verifySession(token) {
  const [header, body, signature] = String(token || '').split('.')
  if (!header || !body || !signature) return null
  const unsigned = `${header}.${body}`
  const expected = crypto.createHmac('sha256', sessionSecret).update(unsigned).digest('base64url')
  if (!secureEquals(expected, signature)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

export function createRandomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url')
}

export function getSecurityConfiguration() {
  return {
    sessionSecretReady: sessionSecret.length >= 32,
    encryptionSecretReady: encryptionSecret.length >= 32,
  }
}