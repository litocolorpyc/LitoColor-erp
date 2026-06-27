// Conexión única a Supabase — todos los demás módulos importan `sb` de aquí.
export const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
