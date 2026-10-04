import 'dotenv/config'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { api } from './api.js'
import { supabaseReady } from './supabase.js'

const app = express()
const port = Number(process.env.API_PORT || 4174)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

app.disable('x-powered-by')
app.use(express.json({ limit: '48kb' }))
app.use('/api', api)
app.use(express.static(path.join(root, 'dist')))
app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')))

app.listen(port, () => {
  console.log(`PlacetaID v27 API: http://127.0.0.1:${port}`)
  console.log(`Supabase: ${supabaseReady ? 'configurado' : 'sin configurar'}`)
})