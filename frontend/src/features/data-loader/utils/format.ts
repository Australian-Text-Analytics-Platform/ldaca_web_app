/**
 * 1024-based byte formatter used by Data Loader file/workspace sizes.
 * `lib/utils.ts` exports a 1000-based variant; do not merge — they target
 * different displays.
 */
export const formatBytes = (bytes?: number | null): string => {
  if (!bytes || Number.isNaN(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** idx;
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[idx]}`;
};

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

export const getWorkspaceId = (workspace: { id?: string; unique_id?: string }): string | null => {
  const id = workspace?.id;
  const uniqueId = workspace?.unique_id;
  if (typeof id === 'string' && id) return id;
  if (typeof uniqueId === 'string' && uniqueId) return uniqueId;
  return null;
};
