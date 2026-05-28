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

/** Explicit backend API base path override. */
export const BACKEND_API_BASE: string = import.meta.env.VITE_BACKEND_API_BASE ?? '';

/** Whether demo mode is enabled. */
export const VITE_DEMO_MODE: string = import.meta.env.VITE_DEMO_MODE ?? '';

/** Remote docs base URL for non-bundled documentation. */
export const DOCS_BASE_URL: string = import.meta.env.VITE_DOCS_BASE_URL ?? '';
