import { describe, expect, it } from 'vitest';
import { queryKeys } from '../queryKeys';

describe('queryKeys.workspaceSql', () => {
  it('isolates complete SQL pages and their ordered Data Block dependencies', () => {
    const key = queryKeys.workspaceSql(
      'workspace-1',
      ['node-2', 'node-1'],
      'SELECT * FROM "node-2"',
      2,
      40,
    );

    expect(key).toEqual([
      'workspaces',
      'workspace-1',
      'sql',
      {
        nodeIds: ['node-2', 'node-1'],
        sql: 'SELECT * FROM "node-2"',
        page: 2,
        pageSize: 40,
      },
    ]);
    expect(key).not.toEqual(
      queryKeys.workspaceSql('workspace-1', ['node-1', 'node-2'], 'SELECT * FROM "node-2"', 2, 40),
    );
    expect(key).not.toEqual(
      queryKeys.workspaceSql(
        'workspace-1',
        ['node-2', 'node-1'],
        'SELECT * FROM "node-2" WHERE "speaker" = \'Ada\'',
        2,
        40,
      ),
    );
  });
});
