import 'dotenv/config'
import dotenv from 'dotenv'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  dotenv.config({ path: process.env.PLID27_ENV_FILE || path.resolve(process.cwd(), '../rsp-web/server/.env') })
}

const supabaseUrl = process.env.SUPABASE_URL || ''
const serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY || ''

export const supabase = supabaseUrl && serviceKey
  ? createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : null

export const supabaseReady = Boolean(supabase)
