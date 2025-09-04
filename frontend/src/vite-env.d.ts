/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly REACT_APP_GOOGLE_CLIENT_ID?: string; // legacy support
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
