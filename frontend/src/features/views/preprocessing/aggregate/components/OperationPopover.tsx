import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { AggregateOperation } from '../hooks/aggregateExpressionModel';

interface OperationPopoverProps {
  workspaceId: string | null;
  nodeId: string;
  column: string;
  onSelect: (operation: AggregateOperation) => void;
  disabled?: boolean;
  children: React.ReactNode;
}

/**
 * Lazy-loads column operations for one aggregate-builder token. Column chips
 * use it to let users append generated Polars method calls without baking the
 * operation catalogue into the main sub-tab render.
 * Rendered by: AggregateSubTab module.
 * Flow: keep the operation menu open around a selected token, add operations from the dropdown,
 * and expose removal controls for existing operations.
 */
export function OperationPopover({ onSelect, disabled, children }: OperationPopoverProps) {
  const [open, setOpen] = useState(false);
  const operations: Record<string, { method: AggregateOperation; label: string }[]> = {
    '': [
      { method: 'count', label: 'Count' },
      { method: 'sum', label: 'Sum' },
      { method: 'mean', label: 'Mean' },
    ],
  };

  /**
   * Applies the chosen operation to the parent token and closes the popover.
   * Called by each operation menu item's click handler.
   */
  const handleSelect = (method: AggregateOperation) => {
    onSelect(method);
    setOpen(false);
  };

  /**
   * Converts backend operation namespaces into labels for collapsible groups.
   * Called while rendering each grouped operation section.
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
            {Object.entries(operations).map(([namespace, ops]) => {
              const label = namespaceLabel(namespace);
              const opButtons = ops.map((op) => {
                const qualifiedMethod = op.method;
                return (
                  <button
                    key={qualifiedMethod}
                    type="button"
                    onClick={() => {
                      handleSelect(qualifiedMethod);
                    }}
                    className={cn(
                      'flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-body',
                      'hover:bg-list-hover hover:text-foreground focus-visible:bg-list-hover focus-visible:text-foreground focus-visible:outline-hidden',
                    )}
                  >
                    <span className="font-mono text-label-secondary">.{qualifiedMethod}()</span>
                    <span className="ml-2 text-label-secondary text-description">{op.label}</span>
                  </button>
                );
              });
              return (
                <Collapsible key={namespace} defaultOpen={false} className="mb-2 last:mb-0">
                  <CollapsibleTrigger className="flex w-full items-center justify-between px-2 py-1 text-label-secondary font-semibold text-description hover:text-foreground focus-visible:outline-hidden [&[data-state=open]>svg]:rotate-180">
                    {label}
                    <ChevronDown className="size-3 transition-transform duration-200" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>{opButtons}</CollapsibleContent>
                </Collapsible>
              );
            })}
            {Object.keys(operations).length === 0 && (
              <p className="px-2 py-3 text-center text-body text-description">
                No operations available
              </p>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
