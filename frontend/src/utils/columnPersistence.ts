export type ColumnPersistenceStorage = 'session' | 'local';

export interface ColumnPersistenceContext {
  workspaceId?: string | null;
  scope?: string;
  storage?: ColumnPersistenceStorage;
}

const STORAGE_PREFIX = 'ldaca:column-pref:v1';

const getStorage = (storage: ColumnPersistenceStorage = 'session'): Storage | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return storage === 'local' ? window.localStorage : window.sessionStorage;
  } catch (error) {
    console.warn('Column persistence storage unavailable', error);
    return null;
  }
};

const buildKey = ({ workspaceId, scope }: ColumnPersistenceContext) => {
  const workspaceSegment = workspaceId ?? 'global';
  const scopeSegment = scope ? `:${scope}` : ':default';
  return `${STORAGE_PREFIX}:${workspaceSegment}${scopeSegment}`;
};

const sanitizeMap = (map: Record<string, unknown>): Record<string, string> => {
  const entries = Object.entries(map).filter(([, value]) => typeof value === 'string' && value.trim().length > 0);
  return Object.fromEntries(entries) as Record<string, string>;
};

const readRaw = (context: ColumnPersistenceContext): Record<string, string> => {
  const storage = getStorage(context.storage);
  if (!storage) return {};

  try {
    const raw = storage.getItem(buildKey(context));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return sanitizeMap(parsed as Record<string, unknown>);
    }
  } catch (error) {
    console.warn('Failed to read column persistence payload', error);
  }
  return {};
};

const writeRaw = (context: ColumnPersistenceContext, map: Record<string, string>) => {
  const storage = getStorage(context.storage);
  if (!storage) return;

  try {
    const key = buildKey(context);
    const payload = sanitizeMap(map);
    if (Object.keys(payload).length === 0) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, JSON.stringify(payload));
  } catch (error) {
    console.warn('Failed to persist column preferences', error);
  }
};

export const columnPersistence = {
  readAll(context: ColumnPersistenceContext = {}): Record<string, string> {
    return readRaw(context);
  },

  get(context: ColumnPersistenceContext, entityId: string): string | null {
    if (!entityId) return null;
    const map = readRaw(context);
    return map[entityId] ?? null;
  },

  storeAll(context: ColumnPersistenceContext, entries: Record<string, string>): void {
    writeRaw(context, entries);
  },

  set(context: ColumnPersistenceContext, entityId: string, column: string | null | undefined): void {
    if (!entityId) return;
    const map = readRaw(context);
    if (column && column.trim().length > 0) {
      map[entityId] = column;
    } else {
      Reflect.deleteProperty(map, entityId);
    }
    writeRaw(context, map);
  },

  clear(context: ColumnPersistenceContext, entityId?: string): void {
    if (!entityId) {
      const storage = getStorage(context.storage);
      if (!storage) return;
      try {
        storage.removeItem(buildKey(context));
      } catch (error) {
        console.warn('Failed to clear column persistence bucket', error);
      }
      return;
    }

    const map = readRaw(context);
    if (Object.prototype.hasOwnProperty.call(map, entityId)) {
      Reflect.deleteProperty(map, entityId);
      writeRaw(context, map);
    }
  },
};

export default columnPersistence;
