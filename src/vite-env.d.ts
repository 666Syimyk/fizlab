/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_REVENUECAT_GOOGLE_API_KEY?: string;
  readonly VITE_SUPPORT_EMAIL?: string;
  readonly VITE_DEVELOPER_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
