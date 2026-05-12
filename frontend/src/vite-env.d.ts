/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_BACKEND_API_BASE?: string;
  readonly VITE_BACKEND_PORT?: string;
  /** App version, injected by `vite.config.ts` from `package.json`. */
  readonly VITE_APP_VERSION?: string;
  /** Short git SHA at build/dev start, injected by `vite.config.ts`. */
  readonly VITE_APP_BUILD?: string;
  /** Build date as `DD/MMM/YYYY`, injected by `vite.config.ts`. */
  readonly VITE_APP_BUILD_DATE?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __BASE_PATH__?: string;
  __BACKEND_URL__?: string;
  __GOOGLE_CLIENT_ID__?: string;
  __MULTI_USER__?: boolean;
  __CILOGON_CLIENT_ID__?: string;
}
