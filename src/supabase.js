import { createClient } from '@supabase/supabase-js'

const URL = import.meta.env.VITE_SUPABASE_URL || ''
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const isConfigured = Boolean(URL && ANON)
export const supabase = isConfigured ? createClient(URL, ANON) : null
