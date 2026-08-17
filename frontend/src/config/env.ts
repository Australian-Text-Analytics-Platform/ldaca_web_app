/**
 * Centralized access to Vite build-time environment variables.
 * All env reads should route through this module so defaults and
 * validation live in one place.
 */

/** Current app version, injected by Vite's define at build time. */
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? '';

/** Build date string, injected at build time. */
export const APP_BUILD_DATE: string = import.meta.env.VITE_APP_BUILD_DATE ?? '';

/** Git short SHA, injected at build time. */
export const APP_BUILD: string = import.meta.env.VITE_APP_BUILD ?? '';

/** Deployment identifier used by the feedback panel. */
export const DEPLOYMENT_ID: string = import.meta.env.VITE_DEPLOYMENT_ID ?? '';

/** Explicit backend port override (defaults to 8001). */
export const BACKEND_PORT: string = import.meta.env.VITE_BACKEND_PORT ?? '';

/** Explicit backend API base URL override for split development only. */
export const BACKEND_API_BASE: string = import.meta.env.VITE_BACKEND_API_BASE ?? '';

/** Derives the mutable minor-version tag used by the online documentation. */
export const docsMinorTagFor = (version: string): string => {
  const match = /^(\d+)\.(\d+)(?:\.|$)/.exec(version.trim());
  const major = match?.[1];
  const minor = match?.[2];
  return major && minor ? `v${major}.${minor}` : '';
};

/** Resolves one deployment origin to the app's matching minor-tag directory. */
export const docsBaseUrlFor = (origin: string, version: string): string => {
  const normalizedOrigin = origin.trim().replace(/\/+$/, '');
  const tag = docsMinorTagFor(version);
  return normalizedOrigin && tag ? `${normalizedOrigin}/${tag}` : '';
};

/** Reads the versioned docs base lazily so tests and runtime config share one contract. */
export const getDocsBaseUrl = (): string =>
  docsBaseUrlFor(import.meta.env.VITE_DOCS_ORIGIN ?? '', APP_VERSION);
