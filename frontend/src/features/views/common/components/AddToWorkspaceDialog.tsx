import { useState, type ReactNode } from 'react';
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

export interface AddToWorkspaceColumn {
  name: string;
  required?: boolean;
  defaultSelected?: boolean;
  includeInSubmission?: boolean;
  requiredDescription?: string;
  title?: string;
}

export interface AddToWorkspaceSource {
  id: string;
  name: string;
  defaultName: string;
  columns: AddToWorkspaceColumn[];
}

export interface AddToWorkspaceSelection {
  sourceId: string;
  selectedColumns: string[];
  newName: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  sources: AddToWorkspaceSource[];
  isSubmitting: boolean;
  onSubmit: (sources: AddToWorkspaceSelection[]) => void;
  allowSourceSelection?: boolean;
  columnsLabel?: string;
}

const defaultColumns = (source: AddToWorkspaceSource): string[] =>
  source.columns
    .filter((column) => column.required === true || column.defaultSelected === true)
    .map((column) => column.name);

const optionalColumns = (source: AddToWorkspaceSource): string[] =>
  source.columns.filter((column) => !column.required).map((column) => column.name);

const normalizeSelectedColumns = (
  source: AddToWorkspaceSource,
  selected: readonly string[],
): string[] => {
  const selectedSet = new Set(selected);
  return source.columns
    .filter((column) => column.required === true || selectedSet.has(column.name))
    .map((column) => column.name);
};

const sharedOptionalColumns = (sources: readonly AddToWorkspaceSource[]): string[] => {
  const [first, ...remaining] = sources;
  if (!first || remaining.length === 0) return [];
  return optionalColumns(first).filter((column) =>
    remaining.every((source) => optionalColumns(source).includes(column)),
  );
};

const reconcileSyncedColumns = (
  current: Record<string, string[]>,
  sources: readonly AddToWorkspaceSource[],
) => {
  const shared = sharedOptionalColumns(sources);
  const selectedShared = shared.filter((column) =>
    sources.some((source) => (current[source.id] ?? defaultColumns(source)).includes(column)),
  );
  const next = { ...current };
  for (const source of sources) {
    next[source.id] = normalizeSelectedColumns(source, selectedShared);
  }
  return next;
};

/** Selects immutable Result columns for Derived Data Block Creation. */
export function AddToWorkspaceDialog({
  open,
  onOpenChange,
  title,
  description,
  sources,
  isSubmitting,
  onSubmit,
  allowSourceSelection = false,
  columnsLabel = 'Columns',
}: Props) {
  const [columnsBySource, setColumnsBySource] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(sources.map((source) => [source.id, defaultColumns(source)])),
  );
  const [includedSourceIds, setIncludedSourceIds] = useState<Set<string>>(
    () => new Set(sources.map((source) => source.id)),
  );
  const [syncColumns, setSyncColumns] = useState(false);
  const [namesBySource, setNamesBySource] = useState<Record<string, string>>(() =>
    Object.fromEntries(sources.map((source) => [source.id, source.defaultName])),
  );

  const includedSources = sources.filter((source) => includedSourceIds.has(source.id));
  const sharedOptional = sharedOptionalColumns(includedSources);
  const sharedOptionalSet = new Set(sharedOptional);

  const toggleSource = (source: AddToWorkspaceSource) => {
    const nextIncludedSourceIds = new Set(includedSourceIds);
    if (nextIncludedSourceIds.has(source.id)) nextIncludedSourceIds.delete(source.id);
    else nextIncludedSourceIds.add(source.id);
    setIncludedSourceIds(nextIncludedSourceIds);

    if (!syncColumns) return;
    const nextIncludedSources = sources.filter((candidate) =>
      nextIncludedSourceIds.has(candidate.id),
    );
    if (nextIncludedSources.length < 2) {
      setSyncColumns(false);
      return;
    }
    setColumnsBySource((current) => reconcileSyncedColumns(current, nextIncludedSources));
  };

  const toggleColumn = (source: AddToWorkspaceSource, column: string) => {
    if (source.columns.some((candidate) => candidate.name === column && candidate.required)) return;
    setColumnsBySource((current) => {
      const selected = current[source.id] ?? defaultColumns(source);
      if (syncColumns) {
        if (!includedSourceIds.has(source.id) || !sharedOptionalSet.has(column)) return current;
        const shouldSelect = !selected.includes(column);
        const next = { ...current };
        for (const includedSource of includedSources) {
          const includedSelected = current[includedSource.id] ?? defaultColumns(includedSource);
          next[includedSource.id] = normalizeSelectedColumns(
            includedSource,
            shouldSelect
              ? [...includedSelected, column]
              : includedSelected.filter((value) => value !== column),
          );
        }
        return next;
      }
      return {
        ...current,
        [source.id]: selected.includes(column)
          ? selected.filter((value) => value !== column)
          : normalizeSelectedColumns(source, [...selected, column]),
      };
    });
  };

  const selectOptionalColumns = (source: AddToWorkspaceSource, selectAll: boolean) => {
    setColumnsBySource((current) => {
      if (syncColumns) {
        const next = { ...current };
        for (const includedSource of includedSources) {
          next[includedSource.id] = normalizeSelectedColumns(
            includedSource,
            selectAll ? sharedOptional : [],
          );
        }
        return next;
      }
      return {
        ...current,
        [source.id]: normalizeSelectedColumns(source, selectAll ? optionalColumns(source) : []),
      };
    });
  };

  const canSubmit =
    includedSourceIds.size > 0 &&
    includedSources.every((source) => namesBySource[source.id]?.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-[calc(100vw-2rem)] lg:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
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
                  setColumnsBySource((current) => reconcileSyncedColumns(current, includedSources));
                  setSyncColumns(true);
                }}
              />
            </div>
          ) : null}
          {sources.map((source) => {
            const selected = columnsBySource[source.id] ?? defaultColumns(source);
            const included = includedSourceIds.has(source.id);
            return (
              <section key={source.id} className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  {allowSourceSelection ? (
                    <Checkbox
                      id={`add-to-workspace-source-${source.id}`}
                      checked={included}
                      onCheckedChange={() => {
                        toggleSource(source);
                      }}
                    />
                  ) : null}
                  <Label
                    htmlFor={
                      allowSourceSelection ? `add-to-workspace-source-${source.id}` : undefined
                    }
                    className="font-medium"
                  >
                    {source.name}
                  </Label>
                </div>
                {included ? (
                  <>
                    <div className="space-y-1">
                      <Label htmlFor={`add-to-workspace-name-${source.id}`}>
                        New Data Block name
                      </Label>
                      <Input
                        id={`add-to-workspace-name-${source.id}`}
                        value={namesBySource[source.id] ?? ''}
                        maxLength={475}
                        onChange={(event) => {
                          setNamesBySource((current) => ({
                            ...current,
                            [source.id]: event.target.value,
                          }));
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-body font-medium">{columnsLabel}</p>
                        <ColumnSelectionActions
                          sourceName={source.name}
                          onSelectAll={() => {
                            selectOptionalColumns(source, true);
                          }}
                          onSelectNone={() => {
                            selectOptionalColumns(source, false);
                          }}
                        />
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {source.columns.map((column) => {
                          const required = column.required ?? false;
                          return (
                            <label key={column.name} className="flex items-center gap-2 text-body">
                              <Checkbox
                                checked={required || selected.includes(column.name)}
                                disabled={
                                  required || (syncColumns && !sharedOptionalSet.has(column.name))
                                }
                                onCheckedChange={() => {
                                  toggleColumn(source, column.name);
                                }}
                              />
                              <span className="truncate" title={column.title ?? column.name}>
                                {column.name}{' '}
                                {required ? (
                                  <span className="text-description">
                                    ({column.requiredDescription ?? 'required'})
                                  </span>
                                ) : null}
                              </span>
                            </label>
                          );
                        })}
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
                includedSources.map((source) => {
                  const selected = new Set(
                    normalizeSelectedColumns(
                      source,
                      columnsBySource[source.id] ?? defaultColumns(source),
                    ),
                  );
                  return {
                    sourceId: source.id,
                    selectedColumns: source.columns
                      .filter(
                        (column) =>
                          selected.has(column.name) && column.includeInSubmission !== false,
                      )
                      .map((column) => column.name),
                    newName: namesBySource[source.id]?.trim() ?? '',
                  };
                }),
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
