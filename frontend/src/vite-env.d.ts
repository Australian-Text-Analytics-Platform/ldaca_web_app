/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_BACKEND_API_BASE?: string;
  readonly VITE_BACKEND_PORT?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __BASE_PATH__?: string;
  __BACKEND_URL__?: string;
  __GOOGLE_CLIENT_ID__?: string;
  __MULTI_USER__?: boolean;
}
