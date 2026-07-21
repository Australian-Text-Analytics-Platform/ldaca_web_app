import { describe, expect, it } from 'vitest';

import { sqlGlobPattern, sqlIdentifier, sqlOrder, sqlString } from '../workspaceSql';

describe('workspace SQL builders', () => {
  it('quotes identifiers and literals without accepting SQL structure', () => {
    expect(sqlIdentifier('column"name')).toBe('"column""name"');
    expect(sqlString("O'Brien")).toBe("'O''Brien'");
  });

  it('preserves Data View null ordering explicitly', () => {
    expect(sqlOrder('score')).toBe('"score" ASC NULLS FIRST');
    expect(sqlOrder('score', true)).toBe('"score" DESC NULLS FIRST');
  });

  it('preserves checklist substring, wildcard, and escaped-literal semantics', () => {
    expect(sqlGlobPattern('defence')).toBe('.*defence.*');
    expect(sqlGlobPattern('a*?')).toBe('^a.*.$');
    expect(sqlGlobPattern('topic\\*star')).toBe('.*topic\\*star.*');
  });
});
