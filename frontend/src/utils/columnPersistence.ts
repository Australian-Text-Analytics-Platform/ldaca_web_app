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

const getStorage = (storage: ColumnPersistenceStorage = 'session'): Storage | null => {
  if (typeof window === 'undefined') return null;
  return storage === 'local' ? window.localStorage : window.sessionStorage;
};

const buildKey = ({ workspaceId, scope }: ColumnPersistenceContext) =>
  `${STORAGE_PREFIX}:${workspaceId ?? 'global'}:${scope ?? 'default'}`;

const sanitizeMap = (map: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(map).filter(([, v]) => typeof v === 'string' && v.trim().length > 0),
  ) as Record<string, string>;

export const columnPersistence = {
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
