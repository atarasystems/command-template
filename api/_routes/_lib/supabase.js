import { createClient } from '@supabase/supabase-js';

let client;

export function hasInitializedSupabaseClient() {
  return Boolean(client);
}

export function getSupabase() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    const error = new Error('Revenue CRM database is not configured');
    error.code = 'CRM_NOT_CONFIGURED';
    throw error;
  }

  client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}
