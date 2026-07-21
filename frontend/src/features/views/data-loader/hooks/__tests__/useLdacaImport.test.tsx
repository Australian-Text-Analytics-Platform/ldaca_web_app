import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataPortalRecord } from '@/api';
import {
  listFeaturedDataPortalCollectionsWithProviderCredential,
  searchDataPortalWithProviderCredential,
  submitDataPortalImportWithProviderCredential,
} from '@/features/provider-credentials/providerCredentialRequests';
import { useLdacaImport } from '../useLdacaImport';

vi.mock('@/features/provider-credentials/providerCredentialRequests', () => ({
  listFeaturedDataPortalCollectionsWithProviderCredential: vi.fn(),
  searchDataPortalWithProviderCredential: vi.fn(),
  submitDataPortalImportWithProviderCredential: vi.fn(),
}));

const record: DataPortalRecord = {
  id: 'arcp://name,hdl10.26180~23961609',
  crate_id: 'arcp://name,hdl10.26180~23961609',
  title: 'A COrpus of Oz Early English (COOEE)',
  description: 'Historical English corpus',
  types: ['Dataset'],
  license: 'https://creativecommons.org/licenses/by/4.0/',
  importable: true,
  collections: ['arcp://name,hdl10.26180~23961609'],
  file_formats: ['text/plain'],
};

const importResource = {
  id: 'import-1',
  state: 'queued' as const,
  request: { kind: 'data_portal' as const, identifier: record.id },
  progress: { fraction: 0, message: 'Queued' },
  error: null,
  cancellation_requested_at: null,
  created_at: '2026-01-01T00:00:00Z',
  started_at: null,
  finished_at: null,
  revision: 1,
  result: null,
};

describe('useLdacaImport', () => {
  const notify = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listFeaturedDataPortalCollectionsWithProviderCredential).mockResolvedValue({
      data: { items: [record], page: 1, page_size: 20, total: 1 },
      error: undefined,
    });
    vi.mocked(searchDataPortalWithProviderCredential).mockResolvedValue({
      data: { items: [record], page: 1, page_size: 25, total: 1 },
      error: undefined,
    });
    vi.mocked(submitDataPortalImportWithProviderCredential).mockResolvedValue({
      data: importResource,
      error: undefined,
    });
  });

  it('loads featured records through the canonical endpoint', async () => {
    const { result } = renderHook(() => useLdacaImport({ notify }));
    act(() => result.current.setLdacaImportOpen(true));
    await waitFor(() => expect(result.current.featuredRecords).toEqual([record]));
    expect(listFeaturedDataPortalCollectionsWithProviderCredential).toHaveBeenCalledWith();
  });

  it('searches with one-based pagination and the selected method', async () => {
    const { result } = renderHook(() => useLdacaImport({ notify }));
    act(() => {
      result.current.setSearchMethod('identifier');
      result.current.setSearchQuery(record.id);
    });
    await act(async () => result.current.handleLdacaSearch());
    expect(searchDataPortalWithProviderCredential).toHaveBeenCalledWith({
      method: 'identifier',
      query: record.id,
      page: 1,
      page_size: 25,
    });
    expect(result.current.searchResults).toEqual([record]);
  });

  it('submits the selected identifier and closes the dialog', async () => {
    const { result } = renderHook(() => useLdacaImport({ notify }));
    act(() => result.current.setLdacaImportOpen(true));
    await act(async () => result.current.handleLdacaImport(record.id));
    expect(submitDataPortalImportWithProviderCredential).toHaveBeenCalledWith({
      identifier: record.id,
    });
    expect(notify).toHaveBeenCalledWith('success', 'LDaCA import queued.');
    expect(result.current.ldacaImportOpen).toBe(false);
  });
});
