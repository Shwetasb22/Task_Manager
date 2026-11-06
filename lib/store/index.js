import { localStore } from './local';
import { supabaseStore } from './supabase';

export function getRuntimeConfig() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  const configured = Boolean(url && key);
  const partial = Boolean((url || key) && !configured);

  return {
    configured,
    partial,
    mode: configured ? 'supabase' : partial ? 'invalid' : 'demo',
  };
}

export const runtimeConfig = getRuntimeConfig();
export const usingSupabase = runtimeConfig.configured;
export const store = usingSupabase ? supabaseStore : localStore;
