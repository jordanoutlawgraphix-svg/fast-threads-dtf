import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// Lazy initialization to avoid build-time errors when env vars aren't available
let _supabase: SupabaseClient | null = null

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    if (!supabaseUrl || !supabaseAnonKey) {
      // During build/SSR, return a dummy that won't crash
      // Client-side code will have the env vars available
      _supabase = createClient('https://placeholder.supabase.co', 'placeholder-key')
    } else {
      _supabase = createClient(supabaseUrl, supabaseAnonKey)
    }
  }
  return _supabase
}

// Export as a getter proxy so imports work like before: supabase.from(...)
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabase() as unknown as Record<string, unknown>)[prop as string]
  },
})

// Check if Supabase is configured
export const isSupabaseConfigured = () => {
  return supabaseUrl.length > 0 && supabaseAnonKey.length > 0
}
