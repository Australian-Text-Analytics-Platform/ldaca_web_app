import { describe, expect, it } from 'vitest';
import type { OniSearchResult as LdacaSearchResult } from '@/api';
import { initialLdacaImportState, ldacaImportReducer } from '../ldacaImportState';

const record: LdacaSearchResult = {
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

describe('ldacaImportReducer', () => {
  it('prepares a new search by clearing stale results, filters, and errors', () => {
    const state = {
      ...initialLdacaImportState,
      searchResults: [record],
      collectionFilter: 'old-collection',
      fileFormatFilter: 'old-format',
      errorMessage: 'stale error',
    };

    expect(ldacaImportReducer(state, { type: 'searchStarted' })).toEqual({
      ...state,
      searching: true,
      hasSearched: true,
      searchResults: [],
      collectionFilter: 'all',
      fileFormatFilter: 'all',
      errorMessage: undefined,
    });
  });

  it('closes and resets transient search fields after an import starts successfully', () => {
    const state = {
      ...initialLdacaImportState,
      ldacaImportOpen: true,
      searchQuery: 'COOEE',
      searchResults: [record],
      hasSearched: true,
      importingId: record.id,
    };

    expect(ldacaImportReducer(state, { type: 'importSucceeded' })).toEqual({
      ...state,
      ldacaImportOpen: false,
      searchQuery: '',
      searchResults: [],
      hasSearched: false,
    });
  });
});
