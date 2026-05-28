import { useState } from 'react';
import {
  importLdacaDataset,
  listLdacaFeaturedCollections,
  searchLdacaCollections,
} from '@/api/generated/sdk.gen';
import type {
  OniSearchRequest,
  OniSearchResult as LdacaSearchResult,
} from '@/api/generated/types.gen';

const LDACA_API_TOKEN_HEADER = 'X-LDACA-API-Token';

type LdacaSearchMethod = Extract<NonNullable<OniSearchRequest['method']>, 'keyword' | 'identifier'>;

type LdacaSearchRequest = Omit<OniSearchRequest, 'method' | 'query'> & {
  method: LdacaSearchMethod;
  query: string;
};

/**
 * Adds an optional Oni API token to generated-client headers. LDaCA search,
 * featured records, and import calls all share this adapter.
 * Used by: local callers in data-loader/useLdacaImport module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 */
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

/**
 * Owns the LDaCA Oni import workflow for the Data Loader. It keeps search,
 * filters, staff picks, token-aware headers, and import progress outside the
 * dialog presentation component.
 * Used by: useLdacaImport tests, DataLoaderFeature module (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 * Flow: load featured records, run ONI search from dialog filters, import selected records
 * through backend APIs, and keep loading/error state isolated for DataLoaderDialogs.
 */
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

  /**
   * Lazily loads staff-picked collections for the import dialog, with an
   * optional token override after saving/deleting an Oni token.
   * Called by: useLdacaImport internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Steps: skip cached loads, apply token-aware headers, request featured records, update cached
   * results, and surface load errors through the dialog state.
   */
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

  /**
   * Forces staff picks to reload after token changes so the dialog reflects the
   * current authentication context.
   * Called by: useLdacaImport internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const reloadFeaturedRecords = async (tokenOverride = ldacaApiToken) => {
    setFeaturedLoaded(false);
    await loadFeaturedRecords(tokenOverride, true);
  };

  /**
   * Opens/closes the import dialog and triggers the initial staff-picks load on
   * first open.
   * Called by: useLdacaImport internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const setLdacaImportOpen = (open: boolean) => {
    updateLdacaImportOpen(open);
    if (open) {
      void loadFeaturedRecords();
    }
  };

  /**
   * Searches the Oni portal using the current method/query and resets local
   * filters so result filtering starts from the full response.
   * Called by: useLdacaImport internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Steps: trim the query, clear stale results/filters, submit the search request, then publish
   * results or an error message for DataLoaderDialogs.
   */
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

  /**
   * Starts a backend import for a selected Oni record or typed identifier, then
   * refreshes the file browser so new downloads can appear.
   * Called by: useLdacaImport internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Steps: resolve the selected record, call the import endpoint, close/reset dialog state,
   * refresh files, and clear the row-level importing flag.
   */
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
