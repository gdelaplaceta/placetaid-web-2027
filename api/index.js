import express from 'express'
import { api } from '../server/api.js'

const app = express()
app.disable('x-powered-by')
app.use('/api/admin/apps/:id/logo', express.json({ limit: '1400kb' }))
app.use(express.json({ limit: '48kb' }))
app.get('/api/auth/fase1', (req, res) => {
  const clientId = String(req.query.client_id || '').trim()
  const state = String(req.query.state || '').trim()
  const callback = String(req.query.from || req.query.redirect_uri || '').trim()
  if (!clientId || clientId.length > 200 || !state || state.length > 512 || !callback) {
    return res.status(400).json({ error: 'INVALID_LEGACY_OAUTH_REQUEST' })
  }

  let callbackUrl
  try {
    callbackUrl = new URL(callback)
  } catch {
    return res.status(400).json({ error: 'INVALID_REDIRECT_URI' })
  }
  if (callbackUrl.username || callbackUrl.password || callbackUrl.hash ||
      (callbackUrl.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(callbackUrl.hostname))) {
    return res.status(400).json({ error: 'INVALID_REDIRECT_URI' })
  }

  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim()
  const protocol = req.secure || forwardedProto === 'https' ? 'https' : 'http'
  const login = new URL('/', `${protocol}://${req.get('host')}`)
  login.searchParams.set('client_id', clientId)
  login.searchParams.set('redirect_uri', callbackUrl.toString())
  login.searchParams.set('service', 'general')
  login.searchParams.set('state', state)
  return res.redirect(302, login.toString())
})
app.use('/api', api)

export default app
