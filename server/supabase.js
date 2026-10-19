import 'dotenv/config'
import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const envPath = process.env.PLID27_ENV_FILE || path.resolve(process.cwd(), '../rsp-web/server/.env')
if ((!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) && fs.existsSync(envPath)) {
  const fileValues = dotenv.parse(fs.readFileSync(envPath))
  for (const [name, value] of Object.entries(fileValues)) {
    if (!process.env[name]?.trim()) process.env[name] = value
  }
}

const supabaseUrl = process.env.SUPABASE_URL?.trim() || ''
const serviceKey = process.env.SUPABASE_SERVICE_KEY?.trim()
  || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  || process.env.SUPABASE_SECRET_KEY?.trim()
  || ''

export const supabase = supabaseUrl && serviceKey
  ? createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : null

export const supabaseReady = Boolean(supabase)
