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
  const [namesBySource, setNamesBySource] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      sources.map((source) => [source.node_id, `${source.node_name}_${nameSuffix}`]),
    ),
  );

  const toggleColumn = (source: RunAllSourceTableResource, column: string) => {
    if (column === source.document_column) return;
    setColumnsBySource((current) => {
      const selected = current[source.node_id] ?? defaultColumns(source, mode);
      return {
        ...current,
        [source.node_id]: selected.includes(column)
          ? selected.filter((value) => value !== column)
          : [...selected, column],
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
                        setIncludedSourceIds((current) => {
                          const next = new Set(current);
                          if (next.has(source.node_id)) next.delete(source.node_id);
                          else next.add(source.node_id);
                          return next;
                        });
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
                        <p className="text-sm font-medium">Columns</p>
                        <ColumnSelectionActions
                          sourceName={source.node_name}
                          onSelectAll={() => {
                            setColumnsBySource((current) => ({
                              ...current,
                              [source.node_id]: selectableColumns(source, mode),
                            }));
                          }}
                          onSelectNone={() => {
                            setColumnsBySource((current) => ({
                              ...current,
                              [source.node_id]: requiredColumns(source, mode),
                            }));
                          }}
                        />
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox checked disabled />
                          <span>
                            {source.document_column}{' '}
                            <span className="text-muted-foreground">(document, required)</span>
                          </span>
                        </label>
                        {source.metadata_columns.map((column) => (
                          <label key={column} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={selected.includes(column)}
                              onCheckedChange={() => {
                                toggleColumn(source, column);
                              }}
                            />
                            <span>{column}</span>
                          </label>
                        ))}
                        {mode === 'document' ? (
                          <label className="flex items-center gap-2 text-sm">
                            <Checkbox checked disabled />
                            <span>
                              CONC_extraction{' '}
                              <span className="text-muted-foreground">(required)</span>
                            </span>
                          </label>
                        ) : (
                          source.analysis_columns
                            .filter((column) => column !== source.document_column)
                            .map((column) => (
                              <label key={column} className="flex items-center gap-2 text-sm">
                                <Checkbox
                                  checked={selected.includes(column)}
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
