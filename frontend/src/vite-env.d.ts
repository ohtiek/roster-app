/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_APP_STORE_NAME?: string
  readonly VITE_APP_STORE_LOCATION?: string
  readonly VITE_APP_LOCALE?: string
  readonly VITE_DEBUG_SUPABASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
