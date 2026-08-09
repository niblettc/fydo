import { createClient } from '@supabase/supabase-js'
import { config } from './config'

const supabase =
  config.supabase.url && config.supabase.anonKey
    ? createClient(config.supabase.url, config.supabase.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null

export function supabaseConfigured(): boolean {
  return supabase !== null
}

/** Validate a Supabase access token from an Authorization: Bearer header.
 * Returns the user id, or null when the token is missing or invalid. */
export async function verifySupabaseUser(authorization: unknown): Promise<string | null> {
  if (!supabase) return null
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return null
  const token = authorization.slice('Bearer '.length).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  return data.user.id
}
