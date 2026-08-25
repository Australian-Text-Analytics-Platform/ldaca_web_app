import { useState } from 'react';
import type { DataBlockCreationSource, RunAllSourceTableResource } from '@/api';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ColumnSelectionActions } from './ColumnSelectionActions';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  nameSuffix: string;
  sources: RunAllSourceTableResource[];
  isSubmitting: boolean;
  onSubmit: (sources: DataBlockCreationSource[]) => void;
  mode?: 'match' | 'document';
  allowSourceSelection?: boolean;
}

const defaultColumns = (source: RunAllSourceTableResource, mode: 'match' | 'document'): string[] =>
  mode === 'document'
    ? [source.document_column, 'CONC_extraction']
    : [
        source.document_column,
        ...source.analysis_columns.filter((column) => column !== source.document_column),
      ];

const uniqueColumns = (columns: readonly string[]) => [...new Set(columns)];

const requiredColumns = (
  source: RunAllSourceTableResource,
  mode: 'match' | 'document',
): string[] =>
  mode === 'document'
    ? uniqueColumns([source.document_column, 'CONC_extraction'])
    : [source.document_column];

const selectableColumns = (
  source: RunAllSourceTableResource,
  mode: 'match' | 'document',
): string[] =>
  mode === 'document'
    ? uniqueColumns([...requiredColumns(source, mode), ...source.metadata_columns])
    : uniqueColumns([
        ...requiredColumns(source, mode),
        ...source.metadata_columns,
        ...source.analysis_columns,
      ]);

const normalizeSelectedColumns = (
  source: RunAllSourceTableResource,
  mode: 'match' | 'document',
  selected: readonly string[],
) => {
  const selectedSet = new Set(selected);
  const requiredSet = new Set(requiredColumns(source, mode));
  return selectableColumns(source, mode).filter(
    (column) => requiredSet.has(column) || selectedSet.has(column),
  );
};

const optionalColumns = (
  source: RunAllSourceTableResource,
  mode: 'match' | 'document',
): string[] => {
  const required = new Set(requiredColumns(source, mode));
  return selectableColumns(source, mode).filter((column) => !required.has(column));
};

const sharedOptionalColumns = (
  sources: readonly RunAllSourceTableResource[],
  mode: 'match' | 'document',
): string[] => {
  const [first, ...remaining] = sources;
  if (!first || remaining.length === 0) return [];
  return optionalColumns(first, mode).filter((column) =>
    remaining.every((source) => optionalColumns(source, mode).includes(column)),
  );
};

const reconcileSyncedColumns = (
  current: Record<string, string[]>,
  sources: readonly RunAllSourceTableResource[],
  mode: 'match' | 'document',
) => {
  const shared = sharedOptionalColumns(sources, mode);
  const selectedShared = shared.filter((column) =>
    sources.some((source) =>
      (current[source.node_id] ?? defaultColumns(source, mode)).includes(column),
    ),
  );
  const next = { ...current };
  for (const source of sources) {
    next[source.node_id] = normalizeSelectedColumns(source, mode, selectedShared);
  }
  return next;
};

/** Selects immutable Result columns for Derived Data Block Creation. */
export function ResultAddToWorkspaceDialog({
  open,
  onOpenChange,
  title,
  nameSuffix,
  sources,
  isSubmitting,
  onSubmit,
  mode = 'match',
  allowSourceSelection = false,
}: Props) {
  const [columnsBySource, setColumnsBySource] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(sources.map((source) => [source.node_id, defaultColumns(source, mode)])),
  );
  const [includedSourceIds, setIncludedSourceIds] = useState<Set<string>>(
    () => new Set(sources.map((source) => source.node_id)),
  );
  const [syncColumns, setSyncColumns] = useState(false);
  const [namesBySource, setNamesBySource] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      sources.map((source) => [source.node_id, `${source.node_name}_${nameSuffix}`]),
    ),
  );

  const includedSources = sources.filter((source) => includedSourceIds.has(source.node_id));
  const sharedOptional = sharedOptionalColumns(includedSources, mode);
  const sharedOptionalSet = new Set(sharedOptional);

  const toggleSource = (source: RunAllSourceTableResource) => {
    const nextIncludedSourceIds = new Set(includedSourceIds);
    if (nextIncludedSourceIds.has(source.node_id)) nextIncludedSourceIds.delete(source.node_id);
    else nextIncludedSourceIds.add(source.node_id);
    setIncludedSourceIds(nextIncludedSourceIds);

    if (!syncColumns) return;
    const nextIncludedSources = sources.filter((candidate) =>
      nextIncludedSourceIds.has(candidate.node_id),
    );
    if (nextIncludedSources.length < 2) {
      setSyncColumns(false);
      return;
    }
    setColumnsBySource((current) => reconcileSyncedColumns(current, nextIncludedSources, mode));
  };

  const toggleColumn = (source: RunAllSourceTableResource, column: string) => {
    if (requiredColumns(source, mode).includes(column)) return;
    setColumnsBySource((current) => {
      const selected = current[source.node_id] ?? defaultColumns(source, mode);
      if (syncColumns) {
        if (!includedSourceIds.has(source.node_id) || !sharedOptionalSet.has(column))
          return current;
        const shouldSelect = !selected.includes(column);
        const next = { ...current };
        for (const includedSource of includedSources) {
          const includedSelected =
            current[includedSource.node_id] ?? defaultColumns(includedSource, mode);
          next[includedSource.node_id] = normalizeSelectedColumns(
            includedSource,
            mode,
            shouldSelect
              ? [...includedSelected, column]
              : includedSelected.filter((value) => value !== column),
          );
        }
        return next;
      }
      return {
        ...current,
        [source.node_id]: selected.includes(column)
          ? selected.filter((value) => value !== column)
          : [...selected, column],
      };
    });
  };

  const selectOptionalColumns = (source: RunAllSourceTableResource, selectAll: boolean) => {
    setColumnsBySource((current) => {
      if (syncColumns) {
        const next = { ...current };
        for (const includedSource of includedSources) {
          next[includedSource.node_id] = normalizeSelectedColumns(
            includedSource,
            mode,
            selectAll ? sharedOptional : [],
          );
        }
        return next;
      }
      return {
        ...current,
        [source.node_id]: selectAll
          ? selectableColumns(source, mode)
          : requiredColumns(source, mode),
      };
    });
  };
  const canSubmit =
    includedSourceIds.size > 0 &&
    sources
      .filter((source) => includedSourceIds.has(source.node_id))
      .every(
        (source) =>
          namesBySource[source.node_id]?.trim() &&
          columnsBySource[source.node_id]?.includes(source.document_column),
      );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-[calc(100vw-2rem)] lg:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Choose which immutable Result columns create new Workspace Data Blocks.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {sources.length >= 2 ? (
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="space-y-1">
                <Label htmlFor="sync-add-to-workspace-columns">Sync columns</Label>
                <p className="text-body text-description">
                  Apply shared optional-column selections to every checked Data Block.
                </p>
              </div>
              <Switch
                id="sync-add-to-workspace-columns"
                checked={syncColumns}
                disabled={includedSources.length < 2}
                onCheckedChange={(checked) => {
                  if (!checked) {
                    setSyncColumns(false);
                    return;
                  }
                  if (includedSources.length < 2) return;
                  setColumnsBySource((current) =>
                    reconcileSyncedColumns(current, includedSources, mode),
                  );
                  setSyncColumns(true);
                }}
              />
            </div>
          ) : null}
          {sources.map((source) => {
            const selected = columnsBySource[source.node_id] ?? defaultColumns(source, mode);
            const included = includedSourceIds.has(source.node_id);
            return (
              <section key={source.node_id} className="space-y-3 rounded-lg border p-3">
                <label className="flex items-center gap-2 font-medium">
                  {allowSourceSelection ? (
                    <Checkbox
                      checked={included}
                      onCheckedChange={() => {
                        toggleSource(source);
                      }}
                    />
                  ) : null}
                  <span>{source.node_name}</span>
                </label>
                {included ? (
                  <>
                    <div className="space-y-1">
                      <Label htmlFor={`add-to-workspace-name-${source.node_id}`}>
                        New Data Block name
                      </Label>
                      <Input
                        id={`add-to-workspace-name-${source.node_id}`}
                        value={namesBySource[source.node_id] ?? ''}
                        maxLength={475}
                        onChange={(event) => {
                          setNamesBySource((current) => ({
                            ...current,
                            [source.node_id]: event.target.value,
                          }));
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-body font-medium">Columns</p>
                        <ColumnSelectionActions
                          sourceName={source.node_name}
                          onSelectAll={() => {
                            selectOptionalColumns(source, true);
                          }}
                          onSelectNone={() => {
                            selectOptionalColumns(source, false);
                          }}
                        />
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="flex items-center gap-2 text-body">
                          <Checkbox checked disabled />
                          <span>
                            {source.document_column}{' '}
                            <span className="text-description">(document, required)</span>
                          </span>
                        </label>
                        {source.metadata_columns.map((column) => (
                          <label key={column} className="flex items-center gap-2 text-body">
                            <Checkbox
                              checked={selected.includes(column)}
                              disabled={syncColumns && !sharedOptionalSet.has(column)}
                              onCheckedChange={() => {
                                toggleColumn(source, column);
                              }}
                            />
                            <span>{column}</span>
                          </label>
                        ))}
                        {mode === 'document' ? (
                          <label className="flex items-center gap-2 text-body">
                            <Checkbox checked disabled />
                            <span>
                              CONC_extraction <span className="text-description">(required)</span>
                            </span>
                          </label>
                        ) : (
                          source.analysis_columns
                            .filter((column) => column !== source.document_column)
                            .map((column) => (
                              <label key={column} className="flex items-center gap-2 text-body">
                                <Checkbox
                                  checked={selected.includes(column)}
                                  disabled={syncColumns && !sharedOptionalSet.has(column)}
                                  onCheckedChange={() => {
                                    toggleColumn(source, column);
                                  }}
                                />
                                <span>{column}</span>
                              </label>
                            ))
                        )}
                      </div>
                    </div>
                  </>
                ) : null}
              </section>
            );
          })}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            disabled={!canSubmit || isSubmitting}
            onClick={() => {
              onSubmit(
                sources
                  .filter((source) => includedSourceIds.has(source.node_id))
                  .map((source) => ({
                    source_node_id: source.node_id,
                    selected_columns: normalizeSelectedColumns(
                      source,
                      mode,
                      columnsBySource[source.node_id] ?? defaultColumns(source, mode),
                    ),
                    new_node_name: namesBySource[source.node_id]?.trim() ?? '',
                  })),
              );
            }}
          >
            {isSubmitting ? 'Adding…' : 'Add to Workspace'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
