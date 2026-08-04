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
  /** Root of the externally hosted docs; the app appends its `v{major}.{minor}` tag. */
  readonly VITE_DOCS_ORIGIN?: string;
  /** Deployment identifier surfaced in the feedback panel, injected at build time. */
  readonly VITE_DEPLOYMENT_ID?: string;
  /** Sentry DSN for error monitoring; when unset, Sentry stays disabled. */
  readonly VITE_SENTRY_DSN?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __BACKEND_URL__?: string;
  __WORDFLOW_CONFIG__?: {
    basePath?: string;
  };
}
