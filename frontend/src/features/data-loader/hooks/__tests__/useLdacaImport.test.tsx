import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  importLdacaDataset,
  listLdacaFeaturedCollections,
  searchLdacaCollections,
} from '@/api/generated/sdk.gen';
import type { OniSearchResult as LdacaSearchResult } from '@/api/generated/types.gen';
import { useLdacaImport } from '../useLdacaImport';

vi.mock('@/api/generated/sdk.gen', () => ({
  listLdacaFeaturedCollections: vi.fn(),
  searchLdacaCollections: vi.fn(),
  importLdacaDataset: vi.fn(),
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
  const refetchFiles = vi.fn(() => Promise.resolve());
  const notify = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listLdacaFeaturedCollections).mockResolvedValue({
      data: {
        state: 'successful',
        data: [cooeeRecord],
        message: 'loaded',
      },
      error: undefined,
    });
    vi.mocked(searchLdacaCollections).mockResolvedValue({
      data: {
        state: 'successful',
        data: [cooeeRecord],
        message: 'searched',
      },
      error: undefined,
    });
    vi.mocked(importLdacaDataset).mockResolvedValue({
      data: {
        state: 'running',
        message: 'LDaCA import started',
        metadata: { task_id: 'task-1' },
      },
      error: undefined,
    });
  });

  it('loads staff picks when the dialog opens', async () => {
    const { result } = renderHook(() =>
      useLdacaImport({ authHeaders, ldacaApiToken, refetchFiles, notify }),
    );

    act(() => result.current.setLdacaImportOpen(true));

    await waitFor(() => expect(result.current.featuredRecords).toEqual([cooeeRecord]));
    expect(listLdacaFeaturedCollections).toHaveBeenCalledWith({
      headers: { ...authHeaders, 'X-LDACA-API-Token': ldacaApiToken },
      throwOnError: true,
    });
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

    expect(searchLdacaCollections).toHaveBeenCalledWith({
      body: {
        method: 'identifier',
        query: 'https://data.ldaca.edu.au/collection?id=arcp%3A%2F%2Fname%2Chdl10.26180~23961609',
        limit: 25,
        offset: 0,
      },
      headers: { ...authHeaders, 'X-LDACA-API-Token': ldacaApiToken },
      throwOnError: true,
    });
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

    expect(importLdacaDataset).toHaveBeenCalledWith({
      body: { url: cooeeRecord.id },
      headers: { ...authHeaders, 'X-LDACA-API-Token': ldacaApiToken },
      throwOnError: true,
    });
    expect(notify).toHaveBeenCalledWith('success', 'LDaCA import started');
    expect(refetchFiles).toHaveBeenCalled();
    expect(result.current.ldacaImportOpen).toBe(false);
    expect(result.current.hasSearched).toBe(false);
  });
});
