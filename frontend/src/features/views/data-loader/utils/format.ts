/**
 * 1024-based byte formatter used by Data Loader file/workspace sizes.
 * `lib/utils.ts` exports a 1000-based variant; do not merge — they target
 * different displays.
 * Used by: Data Loader components and tests because those callers need a shared helper boundary for consistent file-size display formatting.
 * Steps: reject missing values, choose the largest 1024 unit, and format precision by display size.
 */
export const formatBytes = (bytes?: number | null): string => {
  if (!bytes || Number.isNaN(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** idx;
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[idx] ?? ''}`;
};

/**
 * Formats workspace timestamps for compact card metadata. Data Loader cards
 * call this for both backend epoch values and ISO strings.
 * Used by: RefreshStatusBanner component, authPhaseCopy component, ActiveWorkspaceCard component (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 * Steps: normalize epoch seconds/milliseconds or ISO text into a Date, then fall back when parsing fails.
 */
export const formatTimestamp = (value?: number | string | null): string => {
  if (!value) return '—';
  let date: Date | null = null;
  if (typeof value === 'number') {
    date = new Date(value * (value > 1e12 ? 1 : 1000));
  } else if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      date = new Date(parsed);
    }
  }
  return date ? date.toLocaleString() : '—';
};

/**
 * Normalizes legacy/new workspace summary identifiers for code that needs a
 * single id key across cards, sorting, and actions.
 * Used by: useDataLoaderWorkspaceActions hook, WorkspaceManagerCard component, DataLoaderFeature module (rg call sites/imports).
 */
export const getWorkspaceId = (workspace: { id?: string; unique_id?: string }): string | null => {
  const id = workspace.id;
  const uniqueId = workspace.unique_id;
  if (typeof id === 'string' && id) return id;
  if (typeof uniqueId === 'string' && uniqueId) return uniqueId;
  return null;
};
