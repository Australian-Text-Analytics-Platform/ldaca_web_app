import { useUIStore } from '../../stores/uiStore';
import { isTauri } from '@/lib/isTauri';
import { DEPLOYMENT_ID, APP_VERSION, APP_BUILD } from '@/config/env';

/** Qualtrics endpoint used by `FeedbackPanel` when embedding the project survey. */
export const SURVEY_BASE_URL = 'https://sydney.au1.qualtrics.com/jfe/form/SV_0HrF3tzJBz3lQk6';

/**
 * Resolves the deployment label attached to survey submissions. It helps the
 * feedback form distinguish desktop builds, local development, and hosted web
 * instances without requiring callers to know environment details.
 * Called by: captureFeedbackContext when FeedbackPanel opens the survey.
 * Flow: prefer the build deployment id, classify Tauri by platform, then label local or hosted web origins from the hostname.
 */
const resolveDeployment = (): string => {
  const fromBuild = DEPLOYMENT_ID.trim() || undefined;
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

/**
 * Captures app/build/view context for `FeedbackPanel` just before the survey is
 * opened, giving Qualtrics enough metadata to route feedback to the right area.
 * Called by: FeedbackPanel before building the iframe URL.
 * Flow: read build metadata and current view, resolve deployment, merge user-role overrides, then stamp the submission timestamp.
 */
export const captureFeedbackContext = (
  overrides: Partial<Pick<FeedbackContext, 'user_role'>> = {},
): FeedbackContext => ({
  app_version: APP_VERSION,
  app_build: APP_BUILD,
  deployment: resolveDeployment(),
  feature: useUIStore.getState().currentView,
  user_role: overrides.user_role ?? 'anonymous',
  submitted_at: new Date().toISOString(),
});

/**
 * Encodes captured feedback metadata into the Qualtrics URL consumed by the iframe.
 */
export const buildSurveyUrl = (base: string, ctx: FeedbackContext): string => {
  const url = new URL(base);
  for (const [key, value] of Object.entries(ctx)) {
    if (value) url.searchParams.set(key, String(value));
  }
  return url.toString();
};
