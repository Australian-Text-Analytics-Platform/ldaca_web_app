/**
 * Lightweight view id source of truth.
 *
 * Used by: UI state, preferences, and URL routing because those layers need
 * stable view ids without importing icon or feature-loader modules.
 */
export const ALL_VIEWS = [
  'data-loader',
  'filter',
  'token-frequency',
  'concordance',
  'analysis',
  'topic-modeling',
  'quotation',
  'annotation',
  'export',
] as const;

export type ViewType = (typeof ALL_VIEWS)[number];

export const DEFAULT_VIEW: ViewType = 'data-loader';
export const DEFAULT_VISIBLE_VIEWS: ViewType[] = [...ALL_VIEWS];

export const isViewType = (value: unknown): value is ViewType =>
  typeof value === 'string' && ALL_VIEWS.includes(value as ViewType);
