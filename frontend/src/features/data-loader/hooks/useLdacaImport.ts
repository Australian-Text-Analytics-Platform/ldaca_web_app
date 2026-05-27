import { useState } from 'react';
import {
  importLdacaDataset,
  listLdacaFeaturedCollections,
  searchLdacaCollections,
} from '@/api/generated/sdk.gen';
import type { OniSearchRequest, OniSearchResult as LdacaSearchResult } from '@/api/generated/types.gen';

const LDACA_API_TOKEN_HEADER = 'X-LDACA-API-Token';

type LdacaSearchMethod = Extract<NonNullable<OniSearchRequest['method']>, 'keyword' | 'identifier'>;

type LdacaSearchRequest = Omit<OniSearchRequest, 'method' | 'query'> & {
  method: LdacaSearchMethod;
  query: string;
};

function withLdacaApiToken(
  headers: Record<string, string> = {},
  token?: string | null,
): Record<string, string> {
  const trimmed = token?.trim();
  return trimmed ? { ...headers, [LDACA_API_TOKEN_HEADER]: trimmed } : headers;
}

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;

interface UseLdacaImportParams {
  authHeaders: Record<string, string>;
  ldacaApiToken?: string | null;
  refetchFiles: () => Promise<unknown>;
  notify: Notify;
}

export function useLdacaImport({
  authHeaders,
  ldacaApiToken,
  refetchFiles,
  notify,
}: UseLdacaImportParams) {
  const [ldacaImportOpen, updateLdacaImportOpen] = useState(false);
  const [searchMethod, setSearchMethod] = useState<LdacaSearchMethod>('keyword');
  const [searchQuery, setSearchQuery] = useState('');
  const [collectionFilter, setCollectionFilter] = useState('all');
  const [fileFormatFilter, setFileFormatFilter] = useState('all');
  const [featuredRecords, setFeaturedRecords] = useState<LdacaSearchResult[]>([]);
  const [searchResults, setSearchResults] = useState<LdacaSearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [featuredLoaded, setFeaturedLoaded] = useState(false);
  const [featuredLoading, setFeaturedLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [importingId, setImportingId] = useState<string | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  const loadFeaturedRecords = async (tokenOverride = ldacaApiToken, force = false) => {
    if (featuredLoading || (!force && featuredLoaded)) return;

    setFeaturedLoading(true);
    setErrorMessage(undefined);
    try {
      const { data: response } = await listLdacaFeaturedCollections({
        headers: withLdacaApiToken(authHeaders, tokenOverride),
        throwOnError: true,
      });
      setFeaturedRecords(response.data);
      setFeaturedLoaded(true);
    } catch (error) {
      const message = (error as Error).message || 'Failed to load LDaCA staff picks.';
      setErrorMessage(message);
      notify('error', message);
    } finally {
      setFeaturedLoading(false);
    }
  };

  const reloadFeaturedRecords = async (tokenOverride = ldacaApiToken) => {
    setFeaturedLoaded(false);
    await loadFeaturedRecords(tokenOverride, true);
  };

  const setLdacaImportOpen = (open: boolean) => {
    updateLdacaImportOpen(open);
    if (open) {
      void loadFeaturedRecords();
    }
  };

  const handleLdacaSearch = async () => {
    const trimmedQuery = searchQuery.trim();
    if (!trimmedQuery) return;

    setSearching(true);
    setHasSearched(true);
    setSearchResults([]);
    setCollectionFilter('all');
    setFileFormatFilter('all');
    setErrorMessage(undefined);
    try {
      const request: LdacaSearchRequest = {
        method: searchMethod,
        query: trimmedQuery,
        limit: 25,
        offset: 0,
      };
      const { data: response } = await searchLdacaCollections({
        body: request,
        headers: withLdacaApiToken(authHeaders, ldacaApiToken),
        throwOnError: true,
      });
      setSearchResults(response.data);
    } catch (error) {
      const message = (error as Error).message || 'Failed to search LDaCA.';
      setErrorMessage(message);
      notify('error', message);
    } finally {
      setSearching(false);
    }
  };

  const handleLdacaImport = async (recordId?: string) => {
    const target = (recordId || searchQuery).trim();
    if (!target) return;

    setImportingId(target);
    try {
      const { data: response } = await importLdacaDataset({
        body: { url: target },
        headers: withLdacaApiToken(authHeaders, ldacaApiToken),
        throwOnError: true,
      });

      notify('success', response.message || 'LDaCA import started in background.');
      setSearchQuery('');
      setSearchResults([]);
      setHasSearched(false);
      updateLdacaImportOpen(false);
      await refetchFiles();
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to start LDaCA import.');
    } finally {
      setImportingId(undefined);
    }
  };

  return {
    ldacaImportOpen,
    setLdacaImportOpen,
    searchMethod,
    setSearchMethod,
    searchQuery,
    setSearchQuery,
    collectionFilter,
    setCollectionFilter,
    fileFormatFilter,
    setFileFormatFilter,
    featuredRecords,
    featuredLoading,
    reloadFeaturedRecords,
    searchResults,
    hasSearched,
    searching,
    importingId,
    ldacaImporting: Boolean(importingId),
    errorMessage,
    handleLdacaSearch,
    handleLdacaImport,
  };
}
