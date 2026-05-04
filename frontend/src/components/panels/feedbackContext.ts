import { useUIStore } from '../../stores/uiStore';

export const SURVEY_BASE_URL = 'https://sydney.au1.qualtrics.com/jfe/form/SV_0HrF3tzJBz3lQk6';

const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const resolveDeployment = (): string => {
  const fromBuild = (import.meta.env.VITE_DEPLOYMENT_ID as string | undefined)?.trim();
  if (fromBuild) return fromBuild;
  if (isTauri()) {
    const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '').toLowerCase();
    if (ua.includes('mac')) return 'tauri-macos';
    if (ua.includes('win')) return 'tauri-windows';
    if (ua.includes('linux')) return 'tauri-linux';
    return 'tauri-unknown';
  }
  if (typeof window === 'undefined') return '';
  const host = window.location.hostname;
  if (!host || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) {
    return 'local';
  }
  return `web:${host}`;
};

export interface FeedbackContext {
  app_version: string;
  app_build: string;
  deployment: string;
  feature: string;
  user_role: string;
  submitted_at: string;
}

export const captureFeedbackContext = (
  overrides: Partial<Pick<FeedbackContext, 'user_role'>> = {},
): FeedbackContext => ({
  app_version: (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '',
  app_build: (import.meta.env.VITE_APP_BUILD as string | undefined) ?? '',
  deployment: resolveDeployment(),
  feature: useUIStore.getState().currentView ?? '',
  user_role: overrides.user_role ?? 'anonymous',
  submitted_at: new Date().toISOString(),
});

export const buildSurveyUrl = (base: string, ctx: FeedbackContext): string => {
  const url = new URL(base);
  for (const [key, value] of Object.entries(ctx)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
};
