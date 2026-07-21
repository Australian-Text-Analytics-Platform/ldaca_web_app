/** SQL fragments used by frontend-owned Workspace queries. */

export const sqlIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;

export const sqlString = (value: string): string => `'${value.replaceAll("'", "''")}'`;

export const sqlOrder = (
  column: string,
  descending = false,
  nulls: 'first' | 'last' = 'first',
): string => `${sqlIdentifier(column)} ${descending ? 'DESC' : 'ASC'} NULLS ${nulls.toUpperCase()}`;

export const sqlGlobPattern = (value: string): string => {
  const query = value.trim();
  let pattern = '';
  let escaped = false;
  let hasWildcard = false;
  for (const character of query) {
    if (escaped) {
      pattern += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '*') {
      pattern += '.*';
      hasWildcard = true;
    } else if (character === '?') {
      pattern += '.';
      hasWildcard = true;
    } else {
      pattern += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  if (escaped) pattern += '\\\\';
  return hasWildcard ? `^${pattern}$` : `.*${pattern}.*`;
};

export const sqlTable = (nodeId: string): string => sqlIdentifier(nodeId);
