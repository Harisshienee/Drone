import { createClient, type RealtimeChannel } from '@supabase/supabase-js'

export interface Controls {
  leftY: number
  rightX: number
  rightY: number
}

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// null when the env vars are missing, so the world still runs on keyboard alone
export const channel: RealtimeChannel | null =
  url && key ? createClient(url, key).channel('harbour-drone-demo') : null
