/**
 * Per-workspace persistence for auto-selected node/text columns.
 *
 * Sole consumer: `hooks/useAutoNodeColumns.ts` (readAll + storeAll).
 * Stored as a JSON map `{ [entityId]: columnName }` under a single key so
 * a workspace writes/reads one small blob per scope.
 */

export type ColumnPersistenceStorage = 'session' | 'local';

export interface ColumnPersistenceContext {
  workspaceId?: string | null;
  scope?: string;
  storage?: ColumnPersistenceStorage;
}

const STORAGE_PREFIX = 'ldaca:column-pref:v1';

/** Selects the requested browser storage while keeping SSR/tests from touching `window`. */
/** Called by: columnPersistence in this utility module because the utility needs local normalization steps before returning a shared result. */
const getStorage = (storage: ColumnPersistenceStorage = 'session'): Storage | null => {
  if (typeof window === 'undefined') return null;
  return storage === 'local' ? window.localStorage : window.sessionStorage;
};

/** Namespaces column choices by workspace and feature scope so auto-selection state cannot bleed across contexts. */
/** Called by: columnPersistence in this utility module because the utility needs local normalization steps before returning a shared result. */
const buildKey = ({ workspaceId, scope }: ColumnPersistenceContext) =>
  `${STORAGE_PREFIX}:${workspaceId ?? 'global'}:${scope ?? 'default'}`;

/** Keeps only concrete column-name strings from user-persisted blobs before hooks consume them. */
/** Called by: columnPersistence in this utility module because the utility needs local normalization steps before returning a shared result. */
const sanitizeMap = (map: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(map).filter(([, v]) => typeof v === 'string' && v.trim().length > 0),
  ) as Record<string, string>;

/**
 * Storage adapter used by auto-column hooks to persist scoped selections as one blob.
 * Why: importers need one shared normalization boundary to keep behavior consistent.
 * Flow: validate inputs, normalize values, branch on runtime conditions, then return the shared result.
 */
const columnPersistence = {
  /** Restores all persisted column choices for `useAutoNodeColumns` at workspace/view startup. */
  /**
   * Called by: columnPersistence in this utility module because the utility needs local normalization steps before returning a shared result.
   * Flow: resolve storage and scoped key, parse the persisted JSON blob, sanitize string entries, and fall back to an empty map on bad data.
   */
  readAll(context: ColumnPersistenceContext = {}): Record<string, string> {
    const storage = getStorage(context.storage);
    const raw = storage?.getItem(buildKey(context));
    if (!raw) return {};
    // Narrow try/catch: user-persisted blob may be corrupt or schema-migrated.
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? sanitizeMap(parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  },

  /** Stores the current auto-column choices as one scoped blob and removes empty scopes. */
  /** Called by: columnPersistence in this utility module because the utility needs local normalization steps before returning a shared result. */
  storeAll(context: ColumnPersistenceContext, entries: Record<string, string>): void {
    const storage = getStorage(context.storage);
    if (!storage) return;
    const key = buildKey(context);
    const payload = sanitizeMap(entries);
    if (Object.keys(payload).length === 0) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, JSON.stringify(payload));
  },
};

export default columnPersistence;
