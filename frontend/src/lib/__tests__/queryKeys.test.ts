import { describe, expect, it } from 'vitest';
import { queryKeys } from '../queryKeys';

describe('queryKeys workspace hierarchy', () => {
  it('keeps the Workspace list separate from every Workspace detail subtree', () => {
    expect(queryKeys.workspaceList).toEqual(['workspaces', 'list']);
    expect(queryKeys.workspaceGraph('workspace-1')).toEqual(['workspaces', 'workspace-1', 'graph']);
    expect(
      queryKeys.workspaceGraph('workspace-1').slice(0, queryKeys.workspaceList.length),
    ).not.toEqual(queryKeys.workspaceList);
  });
});

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

describe('queryKeys preprocessing hierarchy', () => {
  it('keeps operation, Data Block dependencies, request, and pagination structured', () => {
    expect(
      queryKeys.preprocessingPreview(
        'workspace-1',
        'join',
        ['left', 'right'],
        { how: 'left', leftOn: 'id', rightOn: 'id' },
        2,
        50,
      ),
    ).toEqual([
      'workspaces',
      'workspace-1',
      'preprocessing-previews',
      {
        operation: 'join',
        nodeIds: ['left', 'right'],
        request: { how: 'left', leftOn: 'id', rightOn: 'id' },
        page: 2,
        pageSize: 50,
      },
    ]);
  });
});

describe('queryKeys file hierarchy', () => {
  it('nests worksheets, raw content, and preview pages below one file identity', () => {
    expect(queryKeys.fileList).toEqual(['files', 'list']);
    expect(queryKeys.file('sample/book.xlsx')).toEqual(['files', 'items', 'sample/book.xlsx']);
    expect(queryKeys.fileWorksheets('sample/book.xlsx')).toEqual([
      'files',
      'items',
      'sample/book.xlsx',
      'worksheets',
    ]);
    expect(queryKeys.fileRaw('sample/README.md')).toEqual([
      'files',
      'items',
      'sample/README.md',
      'raw',
    ]);
    expect(queryKeys.filePreview('sample/book.xlsx', 3, 20, 'Sheet 2')).toEqual([
      'files',
      'items',
      'sample/book.xlsx',
      'preview',
      { page: 3, pageSize: 20, sheet: 'Sheet 2' },
    ]);
  });
});

describe('queryKeys catalogue hierarchy', () => {
  it('keeps global catalogues independent of Workspace detail invalidation', () => {
    expect(queryKeys.tokenizerModels).toEqual(['catalogues', 'tokenizer-models']);
    expect(queryKeys.sampleCollections).toEqual(['catalogues', 'sample-collections']);
    expect(
      queryKeys.annotationModelList('provider-1', 4, 'custom', 'http://localhost:8000/v1'),
    ).toEqual([
      'catalogues',
      'annotation-models',
      'provider-1',
      {
        credentialRevision: 4,
        provider: 'custom',
        baseUrl: 'http://localhost:8000/v1',
      },
    ]);
  });
});

describe('queryKeys inactive observers', () => {
  it('keeps disabled Result projections distinct and outside live resources', () => {
    const first = queryKeys.inactiveAnalysisResult({ kind: 'concordance', node_id: 'node-1' });
    const second = queryKeys.inactiveAnalysisResult({ kind: 'concordance', node_id: 'node-2' });

    expect(first).not.toEqual(second);
    expect(first[0]).toBe('inactive');
  });
});

describe('queryKeys.detectedColumnLanguage', () => {
  it('uses the sampled resource revision without putting sampled text in the key', () => {
    const key = queryKeys.detectedColumnLanguage(
      'workspace-1',
      'node-1',
      'document',
      '"revision-3"',
    );

    expect(key).toEqual([
      'workspaces',
      'workspace-1',
      'nodes',
      'node-1',
      'columns',
      'document',
      'detected-language',
      { sourceRevision: '"revision-3"' },
    ]);
    expect(JSON.stringify(key)).not.toContain('sampled document text');
  });
});
