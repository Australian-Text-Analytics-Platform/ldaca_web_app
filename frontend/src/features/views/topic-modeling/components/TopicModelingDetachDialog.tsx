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

export interface TopicModelingDetachSource {
  id: string;
  name: string;
  columns: string[];
  documentColumn: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: TopicModelingDetachSource[];
  selectedSourceIds: Set<string>;
  selectedColumns: Record<string, string[]>;
  names: Record<string, string>;
  selectedTopicCount: number | null;
  isSubmitting: boolean;
  onToggleSource: (nodeId: string) => void;
  onToggleColumn: (nodeId: string, column: string) => void;
  onNameChange: (nodeId: string, name: string) => void;
  onSubmit: () => void;
}

export function TopicModelingDetachDialog({
  open,
  onOpenChange,
  sources,
  selectedSourceIds,
  selectedColumns,
  names,
  selectedTopicCount,
  isSubmitting,
  onToggleSource,
  onToggleColumn,
  onNameChange,
  onSubmit,
}: Props) {
  const canSubmit =
    selectedSourceIds.size > 0 && [...selectedSourceIds].every((nodeId) => names[nodeId]?.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-[calc(100vw-2rem)] lg:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Add Topic Modeling results to Workspace</DialogTitle>
          <DialogDescription>
            Creates topic-data and topic-meanings Data Blocks for each selected source.
            {selectedTopicCount === null
              ? ' All topics will be included.'
              : ` ${String(selectedTopicCount)} selected topic${selectedTopicCount === 1 ? '' : 's'} will be included.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {sources.map((source) => {
            const selected = selectedSourceIds.has(source.id);
            return (
              <div key={source.id} className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`detach-source-${source.id}`}
                    checked={selected}
                    onCheckedChange={() => {
                      onToggleSource(source.id);
                    }}
                  />
                  <Label htmlFor={`detach-source-${source.id}`} className="font-medium">
                    {source.name}
                  </Label>
                </div>
                {selected ? (
                  <>
                    <div className="space-y-1">
                      <Label htmlFor={`detach-name-${source.id}`}>New Data Block name</Label>
                      <Input
                        id={`detach-name-${source.id}`}
                        value={names[source.id] ?? ''}
                        maxLength={475}
                        onChange={(event) => {
                          onNameChange(source.id, event.target.value);
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Source columns</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox checked disabled />
                          <span title="The dominant topic assignment is always included.">
                            TOPIC_top1 <span className="text-muted-foreground">(required)</span>
                          </span>
                        </label>
                        {source.columns.map((column) => (
                          <label key={column} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={selectedColumns[source.id]?.includes(column) ?? false}
                              onCheckedChange={() => {
                                onToggleColumn(source.id, column);
                              }}
                            />
                            <span className="truncate" title={column}>
                              {column}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
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
          <Button onClick={onSubmit} disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? 'Adding…' : 'Add to Workspace'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
