import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/backend/generatedClientConfig', () => ({
  getGeneratedApiBase: () => 'http://127.0.0.1:8123',
}));

import { buildExportNodesDownloadPath, buildExportNodesDownloadUrl } from './exportDownloadUrl';

const request = {
  path: { workspace_id: 'workspace/one' },
  query: { node_ids: 'first,second', format: 'parquet' as const },
};

describe('export download location', () => {
  it('builds the relative API path accepted by the supervised desktop downloader', () => {
    expect(buildExportNodesDownloadPath(request)).toBe(
      '/api/workspaces/workspace%2Fone/export?node_ids=first%2Csecond&format=parquet',
    );
  });

  it('adds the configured backend origin only for browser fetches', () => {
    expect(buildExportNodesDownloadUrl(request)).toBe(
      'http://127.0.0.1:8123/api/workspaces/workspace%2Fone/export?node_ids=first%2Csecond&format=parquet',
    );
  });
});
