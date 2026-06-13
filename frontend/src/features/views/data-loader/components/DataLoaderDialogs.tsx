import React from 'react';
import { Download, KeyRound, Loader2, Search, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  OniSearchRequest,
  OniSearchResult as LdacaSearchResult,
} from '@/api/generated/types.gen';
import type { FileTreeDirectory } from '@/features/views/data-loader/types';

type LdacaSearchMethod = Extract<NonNullable<OniSearchRequest['method']>, 'keyword' | 'identifier'>;

const LDACA_SEARCH_METHOD_LABELS: Record<LdacaSearchMethod, string> = {
  keyword: 'Keyword',
  identifier: 'ID',
};

const LDACA_SEARCH_PLACEHOLDERS: Record<LdacaSearchMethod, string> = {
  keyword: 'COOEE',
  identifier: 'arcp://...',
};

const LDACA_SEARCH_METHODS = Object.keys(LDACA_SEARCH_METHOD_LABELS) as LdacaSearchMethod[];
const ALL_FILTER_VALUE = 'all';
const LDACA_PORTAL_COLLECTION_URL = 'https://data.ldaca.edu.au/collection';

/**
 * Normalizes varied Oni record statistic values for the small metadata cards
 * shown inside each LDaCA search result.
 * Used by: local callers in data-loader/DataLoaderDialogs module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 */
function formatLdacaStat(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (value === undefined || value === null) return '';
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/**
 * Builds filter menu options from loaded records. The LDaCA import dialog uses
 * it so collection/file-format filters reflect the current search result set.
 * Used by: local callers in data-loader/DataLoaderDialogs module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 * Flow: collect unique metadata values across records, preserve first-seen uniqueness in a set, then return locale-sorted option labels.
 */
function ldacaFilterOptions(records: LdacaSearchResult[], field: 'collections' | 'file_formats') {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const record of records) {
    // record is an Oni API response; the array field may be absent at runtime despite the type
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    for (const value of record[field] ?? []) {
      if (!seen.has(value)) {
        seen.add(value);
        values.push(value);
      }
    }
  }
  return values.sort((first, second) => first.localeCompare(second));
}

/**
 * Applies the dialog's all-or-specific filter convention to record metadata.
 * Search-result filtering and staff-pick rendering share this helper.
 * Used by: local callers in data-loader/DataLoaderDialogs module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 */
function matchesLdacaFilter(values: string[] | undefined, selectedValue: string) {
  return selectedValue === ALL_FILTER_VALUE || (values ?? []).includes(selectedValue);
}

/**
 * Keeps long collection/format labels readable in select menus used by the
 * LDaCA search filters.
 * Used by: local callers in data-loader/DataLoaderDialogs module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 */
function formatLdacaFilterLabel(value: string) {
  return value.length > 64 ? `${value.slice(0, 61)}...` : value;
}

/**
 * Produces a stable portal URL for an Oni record. `LdacaRecordCard` uses this
 * so users can inspect the source collection before importing it.
 * Used by: local callers in data-loader/DataLoaderDialogs module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 */
function ldacaRecordUrl(record: LdacaSearchResult) {
  // crate_id may be '' on malformed records and must fall through to id to build a valid URL
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  const identifier = record.crate_id || record.id;
  if (/^https?:\/\//i.test(identifier)) return identifier;

  const encodedIdentifier = encodeURIComponent(identifier);
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  const encodedCrateId = encodeURIComponent(record.crate_id || identifier);
  return `${LDACA_PORTAL_COLLECTION_URL}?id=${encodedIdentifier}&_crateId=${encodedCrateId}`;
}

/**
 * Displays one LDaCA collection result with import affordances. The import
 * dialog uses it for both staff picks and search results.
 * Rendered by: data-loader/DataLoaderDialogs module JSX because the parent needs this component boundary to keep feature controls and state presentation isolated.
 * Flow: render record metadata, expose import disabled/busy state, and surface
 * collection/file-format context so the dialog can import a selected ONI record.
 */
function LdacaRecordCard({
  record,
  importingId,
  onImport,
}: {
  record: LdacaSearchResult;
  importingId?: string;
  onImport: (recordId: string) => void;
}) {
  // stats is an Oni API field; guard against malformed records that omit it
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const stats = Object.entries(record.stats || {}).slice(0, 3);
  const isImporting = importingId === record.id;

  return (
    <div className="bg-card text-card-foreground rounded-md border p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="space-y-1">
            <h3 className="text-sm leading-5 font-semibold">
              <a
                href={ldacaRecordUrl(record)}
                target="_blank"
                rel="noreferrer"
                className="rounded-sm underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                {record.title}
              </a>
            </h3>
            <p className="text-muted-foreground text-xs break-all">
              {/* crate_id may be '' on malformed records and must fall through to id */}
              {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing */}
              {record.crate_id || record.id}
            </p>
          </div>
          {record.description ? (
            <p className="text-muted-foreground line-clamp-3 text-sm">{record.description}</p>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {record.types.slice(0, 4).map((typeName) => (
              <Badge key={typeName} variant="secondary" className="text-xs">
                {typeName}
              </Badge>
            ))}
            {/* file_formats is an Oni API field that may be absent at runtime despite the type */}
            {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */}
            {(record.file_formats ?? []).slice(0, 3).map((fileFormat) => (
              <Badge key={fileFormat} variant="outline" className="text-xs">
                {fileFormat}
              </Badge>
            ))}
            {record.license ? (
              <Badge variant="outline" className="max-w-full truncate text-xs">
                {record.license}
              </Badge>
            ) : null}
          </div>
          {stats.length > 0 ? (
            <dl className="text-muted-foreground grid gap-2 text-xs sm:grid-cols-3">
              {stats.map(([label, value]) => (
                <div key={label} className="bg-background rounded border px-2 py-1">
                  <dt className="text-foreground font-medium capitalize">
                    {label.replace(/_/g, ' ')}
                  </dt>
                  <dd className="truncate">{formatLdacaStat(value)}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          className="shrink-0"
          onClick={() => { onImport(record.id); }}
          disabled={!record.importable || Boolean(importingId)}
        >
          {isImporting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Download
        </Button>
      </div>
    </div>
  );
}

export interface DataLoaderDialogsProps {
  noWorkspaceAlert: {
    open: boolean;
    onClose: () => void;
  };
  workspaceNameAlert: {
    message: string | null;
    onClose: () => void;
  };
  folderNameAlert: {
    message: string | null;
    onClose: () => void;
  };
  deleteWorkspace: {
    target: { id: string; name?: string | null } | null;
    deleting: boolean;
    onCancel: () => void;
    onConfirm: () => void;
  };
  ldacaImport: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    searchMethod: LdacaSearchMethod;
    onSearchMethodChange: (method: LdacaSearchMethod) => void;
    query: string;
    onQueryChange: (query: string) => void;
    collectionFilter: string;
    onCollectionFilterChange: (value: string) => void;
    fileFormatFilter: string;
    onFileFormatFilterChange: (value: string) => void;
    featuredRecords: LdacaSearchResult[];
    featuredLoading: boolean;
    hasToken: boolean;
    searchResults: LdacaSearchResult[];
    hasSearched: boolean;
    searching: boolean;
    importingId?: string;
    importing: boolean;
    errorMessage?: string;
    onTokenSave: (token: string) => void;
    onTokenDelete: () => void;
    onSearch: () => void;
    onImport: (recordId: string) => void;
  };
  createFolder: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    parentPath: string;
    parentLabel: string;
    name: string;
    onNameChange: (value: string) => void;
    creating: boolean;
    onCreate: () => void;
  };
  citation: {
    directory: FileTreeDirectory | null;
    path: string | null;
    content: string | null;
    loading: boolean;
    onClose: () => void;
  };
}

/**
 * Collects the modal/dialog surfaces owned by the Data Loader. The feature
 * passes state and callbacks here so destructive confirmations, token entry,
 * folder creation, citation viewing, and Oni imports stay visually colocated.
 * Rendered by: useFolderCreation hook, useDataLoaderWorkspaceActions hook, DataLoaderFeature module (rg call sites/imports) because the parent needs this component boundary to keep feature controls and state presentation isolated.
 * Flow: render each modal from hook-owned state, wire form fields to hook setters, then
 * delegate confirmations/import/search actions back to DataLoaderFeature hooks.
 */
export function DataLoaderDialogs({
  noWorkspaceAlert,
  workspaceNameAlert,
  folderNameAlert,
  deleteWorkspace,
  ldacaImport,
  createFolder,
  citation,
}: DataLoaderDialogsProps) {
  const [tokenDialogOpen, setTokenDialogOpen] = React.useState(false);
  const [tokenDraft, setTokenDraft] = React.useState('');
  const [tokenError, setTokenError] = React.useState<string | undefined>();
  const canSearch = ldacaImport.query.trim().length > 0;
  const showingSearchResults = ldacaImport.hasSearched || ldacaImport.searching;
  const collectionOptions = ldacaFilterOptions(ldacaImport.searchResults, 'collections');
  const fileFormatOptions = ldacaFilterOptions(ldacaImport.searchResults, 'file_formats');
  const filteredSearchResults = ldacaImport.searchResults.filter(
    (record) =>
      matchesLdacaFilter(record.collections, ldacaImport.collectionFilter) &&
      matchesLdacaFilter(record.file_formats, ldacaImport.fileFormatFilter),
  );
  const hasSearchFilters = collectionOptions.length > 0 || fileFormatOptions.length > 0;
  const listTitle = showingSearchResults ? 'Search Results' : 'Staff Picks';
  const listRecords = showingSearchResults ? filteredSearchResults : ldacaImport.featuredRecords;
  const listLoading = showingSearchResults ? ldacaImport.searching : ldacaImport.featuredLoading;
  /**
   * Toggles between deleting an existing Oni token and opening the save-token
   * dialog. The token button is the only control that owns that branch.
   * Called by: DataLoaderDialogs internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleLdacaTokenClick = () => {
    if (ldacaImport.hasToken) {
      ldacaImport.onTokenDelete();
      return;
    }

    setTokenDraft('');
    setTokenError(undefined);
    setTokenDialogOpen(true);
  };

  /**
   * Resets token draft state when the Radix dialog closes so later opens start
   * from a clean form.
   * Called by: DataLoaderDialogs internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleTokenDialogOpenChange = (open: boolean) => {
    setTokenDialogOpen(open);
    if (!open) {
      setTokenDraft('');
      setTokenError(undefined);
    }
  };

  /**
   * Validates and forwards the Oni token form submission to the parent-owned
   * preference action used by `DataLoaderFeature`.
   * Called by: DataLoaderDialogs internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleTokenSubmit = (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedToken = tokenDraft.trim();
    if (!trimmedToken) {
      setTokenError('Enter a token before saving.');
      return;
    }

    ldacaImport.onTokenSave(trimmedToken);
    handleTokenDialogOpenChange(false);
  };

  return (
    <>
      <AlertDialog
        open={noWorkspaceAlert.open}
        onOpenChange={(open) => {
          if (!open) noWorkspaceAlert.onClose();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>No workspace selected</AlertDialogTitle>
            <AlertDialogDescription>
              Choose or create a workspace in the Active workspace panel before adding files. The
              Add action will be available once a workspace is active.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={noWorkspaceAlert.onClose}>Got it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(workspaceNameAlert.message)}
        onOpenChange={(open) => {
          if (!open) workspaceNameAlert.onClose();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Invalid workspace name</AlertDialogTitle>
            <AlertDialogDescription>
              {/* an empty alert message should fall through to the default copy */}
              {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing */}
              {workspaceNameAlert.message ||
                'Workspace names cannot include path separators or traversal sequences.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={workspaceNameAlert.onClose}>Got it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(deleteWorkspace.target)}
        onOpenChange={(open) => {
          if (!open) deleteWorkspace.onCancel();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteWorkspace.target
                ? // an empty workspace name should fall through to the id
                  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
                  `This will permanently delete "${deleteWorkspace.target.name || deleteWorkspace.target.id}" and its data. This action cannot be undone.`
                : 'This will permanently delete the workspace and its data. This action cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={deleteWorkspace.onCancel}
              disabled={deleteWorkspace.deleting}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteWorkspace.onConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteWorkspace.deleting}
            >
              {deleteWorkspace.deleting ? 'Deleting…' : 'Delete workspace'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={ldacaImport.open}
        onOpenChange={(open) => {
          if (!open && ldacaImport.importing) return;
          ldacaImport.onOpenChange(open);
        }}
      >
        <DialogContent className="flex max-h-[88vh] max-w-[calc(100vw-2rem)] flex-col overflow-hidden sm:max-w-3xl">
          <div className="flex flex-col gap-1.5 pr-8">
            <div className="flex items-start justify-between gap-2">
              <DialogTitle>Import from LDaCA</DialogTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={handleLdacaTokenClick}
              >
                {ldacaImport.hasToken ? (
                  <Trash2 className="mr-2 h-4 w-4" />
                ) : (
                  <KeyRound className="mr-2 h-4 w-4" />
                )}
                {ldacaImport.hasToken ? 'Delete Token' : 'Add Your Own Token'}
              </Button>
            </div>
            <DialogDescription>
              Search the{' '}
              <a
                href="https://data.ldaca.edu.au"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                LDaCA Data Portal
              </a>
              , then download a collection into your data folder as parquet.
            </DialogDescription>
          </div>
          <div className="flex min-h-0 flex-col gap-5 py-2">
            <div className="grid gap-3 sm:grid-cols-[180px_1fr_auto] sm:items-end">
              <div className="space-y-2">
                <Label htmlFor="ldaca-search-method">Search by</Label>
                <Select
                  value={ldacaImport.searchMethod}
                  onValueChange={(value) =>
                    { ldacaImport.onSearchMethodChange(value as LdacaSearchMethod); }
                  }
                >
                  <SelectTrigger id="ldaca-search-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LDACA_SEARCH_METHODS.map((method) => (
                      <SelectItem key={method} value={method}>
                        {LDACA_SEARCH_METHOD_LABELS[method]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ldaca-search-query">Search</Label>
                <Input
                  id="ldaca-search-query"
                  value={ldacaImport.query}
                  onChange={(event) => { ldacaImport.onQueryChange(event.target.value); }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && canSearch && !ldacaImport.searching) {
                      event.preventDefault();
                      ldacaImport.onSearch();
                    }
                  }}
                  placeholder={LDACA_SEARCH_PLACEHOLDERS[ldacaImport.searchMethod]}
                />
              </div>
              <Button
                type="button"
                onClick={ldacaImport.onSearch}
                disabled={!canSearch || ldacaImport.searching}
              >
                {ldacaImport.searching ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                Search
              </Button>
            </div>

            {ldacaImport.errorMessage ? (
              <p
                role="alert"
                className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
              >
                {ldacaImport.errorMessage}
              </p>
            ) : null}

            <section className="flex min-h-0 flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">{listTitle}</h2>
                <div className="text-muted-foreground flex items-center gap-2 text-xs">
                  {showingSearchResults ? (
                    <span>
                      {filteredSearchResults.length} of {ldacaImport.searchResults.length}
                    </span>
                  ) : null}
                  {listLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                </div>
              </div>
              {showingSearchResults && hasSearchFilters ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {collectionOptions.length > 0 ? (
                    <div className="space-y-2">
                      <Label htmlFor="ldaca-collection-filter">Collection</Label>
                      <Select
                        value={ldacaImport.collectionFilter}
                        onValueChange={ldacaImport.onCollectionFilterChange}
                      >
                        <SelectTrigger id="ldaca-collection-filter">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ALL_FILTER_VALUE}>All collections</SelectItem>
                          {collectionOptions.map((collection) => (
                            <SelectItem key={collection} value={collection}>
                              {formatLdacaFilterLabel(collection)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                  {fileFormatOptions.length > 0 ? (
                    <div className="space-y-2">
                      <Label htmlFor="ldaca-file-format-filter">File type</Label>
                      <Select
                        value={ldacaImport.fileFormatFilter}
                        onValueChange={ldacaImport.onFileFormatFilterChange}
                      >
                        <SelectTrigger id="ldaca-file-format-filter">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ALL_FILTER_VALUE}>All file types</SelectItem>
                          {fileFormatOptions.map((fileFormat) => (
                            <SelectItem key={fileFormat} value={fileFormat}>
                              {formatLdacaFilterLabel(fileFormat)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="max-h-[min(48vh,30rem)] space-y-3 overflow-y-auto pr-1">
                {listRecords.map((record) => (
                  <LdacaRecordCard
                    key={record.id}
                    record={record}
                    importingId={ldacaImport.importingId}
                    onImport={ldacaImport.onImport}
                  />
                ))}
                {showingSearchResults && !ldacaImport.searching && listRecords.length === 0 ? (
                  <p className="text-muted-foreground rounded-md border border-dashed px-3 py-2 text-sm">
                    No results match the selected filters.
                  </p>
                ) : null}
              </div>
            </section>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { ldacaImport.onOpenChange(false); }}
              disabled={ldacaImport.importing}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={tokenDialogOpen} onOpenChange={handleTokenDialogOpenChange}>
        <DialogContent>
          <form onSubmit={handleTokenSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Add LDaCA Token</DialogTitle>
              <DialogDescription>
                Save a LDaCA Data Portal token for staff picks, search, and imports.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="ldaca-token">Token key</Label>
              <Input
                id="ldaca-token"
                type="password"
                autoComplete="off"
                value={tokenDraft}
                onChange={(event) => {
                  setTokenDraft(event.target.value);
                  if (tokenError) setTokenError(undefined);
                }}
                aria-invalid={Boolean(tokenError)}
                aria-describedby={tokenError ? 'ldaca-token-error' : undefined}
                placeholder="Paste token key"
              />
              {tokenError ? (
                <p id="ldaca-token-error" className="text-destructive text-sm" role="alert">
                  {tokenError}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => { handleTokenDialogOpenChange(false); }}
              >
                Cancel
              </Button>
              <Button type="submit">Save Token</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createFolder.open}
        onOpenChange={(open) => {
          createFolder.onOpenChange(open);
          if (!open) createFolder.onNameChange('');
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create folder</DialogTitle>
            <DialogDescription>
              {createFolder.parentPath
                ? `Create a subfolder inside ${createFolder.parentLabel}.`
                : 'Create a folder under the root files directory.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-folder-name">Folder name</Label>
              <Input
                id="new-folder-name"
                value={createFolder.name}
                onChange={(event) => { createFolder.onNameChange(event.target.value); }}
                placeholder="Enter folder name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { createFolder.onOpenChange(false); }}>
              Cancel
            </Button>
            <Button
              onClick={createFolder.onCreate}
              disabled={createFolder.creating || !createFolder.name.trim()}
            >
              {createFolder.creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(citation.directory)}
        onOpenChange={(open) => {
          if (!open) citation.onClose();
        }}
      >
        <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Citation</DialogTitle>
            <DialogDescription>
              {citation.path ? `Source: ${citation.path}` : 'Citation metadata'}
            </DialogDescription>
          </DialogHeader>
          {citation.loading ? (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading citation…
            </div>
          ) : citation.content ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{citation.content}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No citation available for this folder.</p>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(folderNameAlert.message)}
        onOpenChange={(open) => {
          if (!open) folderNameAlert.onClose();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Invalid folder name</AlertDialogTitle>
            <AlertDialogDescription>
              {/* an empty alert message should fall through to the default copy */}
              {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing */}
              {folderNameAlert.message ||
                'Folder names cannot include path separators or traversal sequences.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={folderNameAlert.onClose}>Got it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
