import { useState } from 'react';
import type { ResultPublicationSource, RunAllSourceTableResource } from '@/api';
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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  nameSuffix: string;
  sources: RunAllSourceTableResource[];
  isSubmitting: boolean;
  onSubmit: (sources: ResultPublicationSource[]) => void;
}

const defaultColumns = (source: RunAllSourceTableResource): string[] => [
  source.document_column,
  ...source.analysis_columns.filter((column) => column !== source.document_column),
];

/** Selects the immutable Result columns used by a Result Publication Analysis. */
export function ResultPublicationDialog({
  open,
  onOpenChange,
  title,
  nameSuffix,
  sources,
  isSubmitting,
  onSubmit,
}: Props) {
  const [columnsBySource, setColumnsBySource] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(sources.map((source) => [source.node_id, defaultColumns(source)])),
  );
  const [namesBySource, setNamesBySource] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      sources.map((source) => [source.node_id, `${source.node_name}_${nameSuffix}`]),
    ),
  );

  const toggleColumn = (source: RunAllSourceTableResource, column: string) => {
    if (column === source.document_column) return;
    setColumnsBySource((current) => {
      const selected = current[source.node_id] ?? defaultColumns(source);
      return {
        ...current,
        [source.node_id]: selected.includes(column)
          ? selected.filter((value) => value !== column)
          : [...selected, column],
      };
    });
  };
  const canSubmit =
    sources.length > 0 &&
    sources.every(
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
            Choose which immutable Result columns to publish as new Workspace Data Blocks.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {sources.map((source) => {
            const selected = columnsBySource[source.node_id] ?? defaultColumns(source);
            return (
              <section key={source.node_id} className="space-y-3 rounded-lg border p-3">
                <h3 className="font-medium">{source.node_name}</h3>
                <div className="space-y-1">
                  <Label htmlFor={`publication-name-${source.node_id}`}>New Data Block name</Label>
                  <Input
                    id={`publication-name-${source.node_id}`}
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
                  <p className="text-sm font-medium">Columns</p>
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
                    {source.analysis_columns
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
                      ))}
                  </div>
                </div>
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
                sources.map((source) => ({
                  source_node_id: source.node_id,
                  selected_columns: columnsBySource[source.node_id] ?? defaultColumns(source),
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
