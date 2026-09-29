/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Supabase-Projekt-URL, z. B. https://xyz.supabase.co */
  readonly VITE_SUPABASE_URL?: string;
  /** Publishable (anon) Key – öffentlich, durch RLS abgesichert. NIEMALS den service_role/secret Key! */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Alternativname (ältere Supabase-Doku) */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** 'supabase' | 'local' | 'mock' – Standard: supabase, wenn URL + Key gesetzt sind, sonst local */
  readonly VITE_AUTH_MODE?: string;
  /** 'true' = Tarif-Buttons rufen die Edge Function create-checkout-session auf (Phase 7) */
}
