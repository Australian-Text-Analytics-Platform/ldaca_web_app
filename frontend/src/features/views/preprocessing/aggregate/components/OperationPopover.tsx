import React, { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';

import { columnOperations } from '@/api';
import type { ColumnOperationsResponse } from '@/api';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface OperationPopoverProps {
  workspaceId: string | null;
  nodeId: string;
  column: string;
  onSelect: (operation: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}

/**
 * Lazy-loads column operations for one aggregate-builder token. Column chips
 * use it to let users append generated Polars method calls without baking the
 * operation catalogue into the main sub-tab render.
 * Rendered by: AggregateSubTab module (rg call sites/imports) because the parent needs this component boundary to keep feature controls and state presentation isolated.
 * Flow: keep the operation menu open around a selected token, add operations from the dropdown,
 * and expose removal controls for existing operations.
 */
export function OperationPopover({
  workspaceId,
  nodeId,
  column,
  onSelect,
  disabled,
  children,
}: OperationPopoverProps) {
  const { getAuthHeaders } = useAuth();
  const [open, setOpen] = useState(false);
  const [operations, setOperations] = useState<ColumnOperationsResponse['operations'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = open && operations === null && error === null;

  useEffect(() => {
    if (!open) return;
    if (!workspaceId || !nodeId || !column) return;
    let cancelled = false;
    columnOperations({
      headers: getAuthHeaders(),
      path: { workspace_id: workspaceId, column_name: column, node_id: nodeId },
      throwOnError: true,
    })
      .then((res) => {
        if (!cancelled) setOperations(res.data.operations);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open, workspaceId, nodeId, column, getAuthHeaders]);

  /**
   * Applies the chosen operation to the parent token and closes the popover.
   * Called by: OperationPopover internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleSelect = (method: string) => {
    onSelect(method);
    setOpen(false);
  };

  /**
   * Converts backend operation namespaces into labels for collapsible groups.
   * Called by: OperationPopover internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const namespaceLabel = (ns: string) => {
    if (ns === '') return 'General';
    if (ns === 'str') return 'String (.str)';
    if (ns === 'dt') return 'Datetime (.dt)';
    if (ns === 'list') return 'List (.list)';
    return ns;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {children}
      </PopoverTrigger>
      <PopoverContent className="w-max min-w-60 p-0" align="start" sideOffset={8}>
        <ScrollArea className="max-h-72">
          <div className="p-2">
            {loading && (
              <p className="px-2 py-3 text-center text-sm text-muted-foreground">Loading…</p>
            )}
            {error && <p className="px-2 py-3 text-center text-sm text-destructive">{error}</p>}
            {operations?.str && (
              <div className="mb-2">
                <p className="px-2 py-1 text-xs font-semibold text-muted-foreground">Special</p>
                {[
                  { label: 'Title case', op: 'str.to_titlecase' },
                  { label: 'Word count', op: "str.split(' ').list.len" },
                ].map(({ label, op }) => (
                  <button
                    key={op}
                    type="button"
                    onClick={() => {
                      handleSelect(op);
                    }}
                    className={cn(
                      'flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm',
                      'hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-hidden',
                    )}
                  >
                    <span className="text-sm">{label}</span>
                  </button>
                ))}
              </div>
            )}
            {operations &&
              Object.entries(operations).map(([namespace, ops]) => {
                const label = namespaceLabel(namespace);
                const opButtons = ops.map((op) => {
                  const qualifiedMethod = namespace ? `${namespace}.${op.method}` : op.method;
                  return (
                    <button
                      key={qualifiedMethod}
                      type="button"
                      onClick={() => {
                        handleSelect(qualifiedMethod);
                      }}
                      className={cn(
                        'flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm',
                        'hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-hidden',
                      )}
                    >
                      <span className="font-mono text-xs">.{qualifiedMethod}()</span>
                      <span className="ml-2 text-xs text-muted-foreground">{op.label}</span>
                    </button>
                  );
                });
                return (
                  <Collapsible key={namespace} defaultOpen={false} className="mb-2 last:mb-0">
                    <CollapsibleTrigger className="flex w-full items-center justify-between px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-hidden [&[data-state=open]>svg]:rotate-180">
                      {label}
                      <ChevronDown className="size-3 transition-transform duration-200" />
                    </CollapsibleTrigger>
                    <CollapsibleContent>{opButtons}</CollapsibleContent>
                  </Collapsible>
                );
              })}
            {operations && Object.keys(operations).length === 0 && (
              <p className="px-2 py-3 text-center text-sm text-muted-foreground">
                No operations available
              </p>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
