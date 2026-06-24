import { useReducer } from 'react';
import { importLdacaDataset, listLdacaFeaturedCollections, searchLdacaCollections } from '@/api';
import type { OniSearchRequest } from '@/api';
import {
  initialLdacaImportState,
  ldacaImportReducer,
  type LdacaSearchMethod,
} from './ldacaImportState';

const LDACA_API_TOKEN_HEADER = 'X-LDACA-API-Token';

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
  const [state, dispatch] = useReducer(ldacaImportReducer, initialLdacaImportState);

  /**
   * Lazily loads staff-picked collections for the import dialog, with an
   * optional token override after saving/deleting an Oni token.
   * Called by: useLdacaImport internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Steps: skip cached loads, apply token-aware headers, request featured records, update cached
   * results, and surface load errors through the dialog state.
   */
  const loadFeaturedRecords = async (tokenOverride = ldacaApiToken, force = false) => {
    if (state.featuredLoading || (!force && state.featuredLoaded)) return;

    dispatch({ type: 'featuredStarted' });
    try {
      const { data: response } = await listLdacaFeaturedCollections({
        headers: withLdacaApiToken(authHeaders, tokenOverride),
        throwOnError: true,
      });
      dispatch({ type: 'featuredSucceeded', records: response.data });
    } catch (error) {
      const message = (error as Error).message || 'Failed to load LDaCA staff picks.';
      dispatch({ type: 'featuredFailed', message });
      notify('error', message);
    }
  };

  /**
   * Forces staff picks to reload after token changes so the dialog reflects the
   * current authentication context.
   * Called by: useLdacaImport internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const reloadFeaturedRecords = async (tokenOverride = ldacaApiToken) => {
    dispatch({ type: 'featuredInvalidated' });
    await loadFeaturedRecords(tokenOverride, true);
  };

  /**
   * Opens/closes the import dialog and triggers the initial staff-picks load on
   * first open.
   * Called by: useLdacaImport internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const setLdacaImportOpen = (open: boolean) => {
    dispatch({ type: 'setOpen', open });
    if (open) {
      void loadFeaturedRecords();
    }
  };

  const setSearchMethod = (method: LdacaSearchMethod) => {
    dispatch({ type: 'setSearchMethod', method });
  };

  const setSearchQuery = (query: string) => {
    dispatch({ type: 'setSearchQuery', query });
  };

  const setCollectionFilter = (value: string) => {
    dispatch({ type: 'setCollectionFilter', value });
  };

  const setFileFormatFilter = (value: string) => {
    dispatch({ type: 'setFileFormatFilter', value });
  };

  /**
   * Searches the Oni portal using the current method/query and resets local
   * filters so result filtering starts from the full response.
   * Called by: useLdacaImport internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Steps: trim the query, clear stale results/filters, submit the search request, then publish
   * results or an error message for DataLoaderDialogs.
   */
  const handleLdacaSearch = async () => {
    const trimmedQuery = state.searchQuery.trim();
    if (!trimmedQuery) return;

    dispatch({ type: 'searchStarted' });
    try {
      const request: LdacaSearchRequest = {
        method: state.searchMethod,
        query: trimmedQuery,
        limit: 25,
        offset: 0,
      };
      const { data: response } = await searchLdacaCollections({
        body: request,
        headers: withLdacaApiToken(authHeaders, ldacaApiToken),
        throwOnError: true,
      });
      dispatch({ type: 'searchSucceeded', records: response.data });
    } catch (error) {
      const message = (error as Error).message || 'Failed to search LDaCA.';
      dispatch({ type: 'searchFailed', message });
      notify('error', message);
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
    // an empty recordId should fall through to the typed search query
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    const target = (recordId || state.searchQuery).trim();
    if (!target) return;

    dispatch({ type: 'importStarted', importingId: target });
    try {
      const { data: response } = await importLdacaDataset({
        body: { url: target },
        headers: withLdacaApiToken(authHeaders, ldacaApiToken),
        throwOnError: true,
      });

      notify('success', response.message || 'LDaCA import started in background.');
      dispatch({ type: 'importSucceeded' });
      await refetchFiles();
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to start LDaCA import.');
    } finally {
      dispatch({ type: 'importFinished' });
    }
  };

  return {
    ldacaImportOpen: state.ldacaImportOpen,
    setLdacaImportOpen,
    searchMethod: state.searchMethod,
    setSearchMethod,
    searchQuery: state.searchQuery,
    setSearchQuery,
    collectionFilter: state.collectionFilter,
    setCollectionFilter,
    fileFormatFilter: state.fileFormatFilter,
    setFileFormatFilter,
    featuredRecords: state.featuredRecords,
    featuredLoading: state.featuredLoading,
    reloadFeaturedRecords,
    searchResults: state.searchResults,
    hasSearched: state.hasSearched,
    searching: state.searching,
    importingId: state.importingId,
    ldacaImporting: Boolean(state.importingId),
    errorMessage: state.errorMessage,
    handleLdacaSearch,
    handleLdacaImport,
  };
}
