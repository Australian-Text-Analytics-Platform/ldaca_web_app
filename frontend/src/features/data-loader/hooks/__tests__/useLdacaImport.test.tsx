import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { filesApi, type LdacaSearchResult } from '@/api/files';
import { useLdacaImport } from '../useLdacaImport';

vi.mock('@/api/files', () => ({
  filesApi: {
    getLdacaFeatured: vi.fn(),
    searchLdaca: vi.fn(),
    importLdaca: vi.fn(),
  },
}));

const cooeeRecord: LdacaSearchResult = {
  id: 'arcp://name,hdl10.26180~23961609',
  crate_id: 'arcp://name,hdl10.26180~23961609',
  title: 'A COrpus of Oz Early English (COOEE)',
  description: 'Historical English corpus',
  types: ['Dataset'],
  license: 'https://creativecommons.org/licenses/by/4.0/',
  importable: true,
  collections: ['arcp://name,hdl10.26180~23961609'],
  file_formats: ['text/plain'],
  stats: { documents: 600 },
};

describe('useLdacaImport', () => {
  const authHeaders = { Authorization: 'Bearer token' };
  const ldacaApiToken = 'ldaca-secret-token';
  const refetchFiles = vi.fn(async () => undefined);
  const notify = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(filesApi.getLdacaFeatured).mockResolvedValue({
      state: 'successful',
      data: [cooeeRecord],
      message: 'loaded',
    });
    vi.mocked(filesApi.searchLdaca).mockResolvedValue({
      state: 'successful',
      data: [cooeeRecord],
      message: 'searched',
    });
    vi.mocked(filesApi.importLdaca).mockResolvedValue({
      state: 'running',
      message: 'LDaCA import started',
      metadata: { task_id: 'task-1' },
    });
  });

  it('loads staff picks when the dialog opens', async () => {
    const { result } = renderHook(() =>
      useLdacaImport({ authHeaders, ldacaApiToken, refetchFiles, notify }),
    );

    act(() => result.current.setLdacaImportOpen(true));

    await waitFor(() => expect(result.current.featuredRecords).toEqual([cooeeRecord]));
    expect(filesApi.getLdacaFeatured).toHaveBeenCalledWith(authHeaders, ldacaApiToken);
  });

  it('searches with the selected method and query', async () => {
    const { result } = renderHook(() =>
      useLdacaImport({ authHeaders, ldacaApiToken, refetchFiles, notify }),
    );

    act(() => {
      result.current.setSearchMethod('identifier');
      result.current.setSearchQuery(
        'https://data.ldaca.edu.au/collection?id=arcp%3A%2F%2Fname%2Chdl10.26180~23961609',
      );
    });
    await act(async () => {
      await result.current.handleLdacaSearch();
    });

    expect(filesApi.searchLdaca).toHaveBeenCalledWith(
      {
        method: 'identifier',
        query: 'https://data.ldaca.edu.au/collection?id=arcp%3A%2F%2Fname%2Chdl10.26180~23961609',
        limit: 25,
        offset: 0,
      },
      authHeaders,
      ldacaApiToken,
    );
    expect(result.current.searchResults).toEqual([cooeeRecord]);
    expect(result.current.hasSearched).toBe(true);
  });

  it('imports the chosen record id and closes the dialog', async () => {
    const { result } = renderHook(() =>
      useLdacaImport({ authHeaders, ldacaApiToken, refetchFiles, notify }),
    );

    act(() => result.current.setLdacaImportOpen(true));
    await act(async () => {
      await result.current.handleLdacaImport(cooeeRecord.id);
    });

    expect(filesApi.importLdaca).toHaveBeenCalledWith(cooeeRecord.id, authHeaders, ldacaApiToken);
    expect(notify).toHaveBeenCalledWith('success', 'LDaCA import started');
    expect(refetchFiles).toHaveBeenCalled();
    expect(result.current.ldacaImportOpen).toBe(false);
    expect(result.current.hasSearched).toBe(false);
  });
});
