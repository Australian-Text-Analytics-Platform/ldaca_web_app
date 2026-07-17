import type { Column as TableColumn } from '@tanstack/react-table';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  Expand,
  Loader2,
  Minimize,
  Pin,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import type { DataRow } from '../types';

interface DataTypeOption {
  value: string;
  label: string;
}

interface SortState {
  id: string;
  desc: boolean;
}

export interface WorkspaceColumnHeaderProps {
  column: string;
  /** TanStack column instance, used to drive pin state. */
  colInst: TableColumn<DataRow>;

  // Mutation state
  currentType: string;
  displayLabel: string;
  availableTypes: DataTypeOption[];
  isColumnBusy: boolean;

  // Capability flags
  canCast: boolean;

  // Wide column expand/collapse
  isWideColumn: boolean;
  isCollapsedColumn: boolean;
  onToggleExpand: () => void;

  // Sort
  sortState: SortState | undefined;
  onSort: () => void;

  onTypeChange: (newType: string) => void;
}

/**
 * Renders one server-backed table column header. Node names are editable at
 * the graph level; column names are fixed by the node representation, so this
 * component only exposes sorting, pinning, sizing, and dtype casts.
 */
export function WorkspaceColumnHeader({
  column,
  colInst,
  currentType,
  displayLabel,
  availableTypes,
  isColumnBusy,
  canCast,
  isWideColumn,
  isCollapsedColumn,
  onToggleExpand,
  sortState,
  onSort,
  onTypeChange,
}: WorkspaceColumnHeaderProps) {
  const isPinnedLeft = colInst.getIsPinned() === 'left';

  return (
    <div className="flex min-w-0 items-center gap-1">
      {/* Pin */}
      <button
        type="button"
        onClick={() => {
          colInst.pin(isPinnedLeft ? false : 'left');
        }}
        className={cn(
          'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-transparent text-muted-foreground transition-colors hover:bg-muted-foreground/10 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
          isPinnedLeft && 'text-primary',
        )}
        aria-pressed={isPinnedLeft}
        aria-label={isPinnedLeft ? `Unpin column ${column}` : `Pin column ${column} to the left`}
      >
        <Pin className="h-3.5 w-3.5" fill={isPinnedLeft ? 'currentColor' : 'none'} />
      </button>

      <div className="min-w-0">
        <span
          className="block max-w-[160px] truncate text-xs font-medium text-foreground"
          title={column}
        >
          {column}
        </span>
      </div>

      {/* Sort indicator + click-to-sort */}
      <button
        type="button"
        onClick={onSort}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
        aria-label={`Sort by ${column}`}
      >
        {sortState ? (
          sortState.desc ? (
            <ArrowDown className="h-3.5 w-3.5 text-primary" />
          ) : (
            <ArrowUp className="h-3.5 w-3.5 text-primary" />
          )
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5" />
        )}
      </button>

      {/* Data type selector */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isColumnBusy || !canCast}
            className={cn(
              'h-7 w-fit justify-between gap-1 px-1.5 text-xs font-medium',
              isColumnBusy && 'cursor-progress opacity-80',
            )}
            aria-label={`Change data type for column ${column}`}
          >
            <span className="truncate">{displayLabel}</span>
            {isColumnBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-40 p-1">
          <DropdownMenuRadioGroup
            value={currentType}
            onValueChange={(v) => {
              if (!isColumnBusy) onTypeChange(v);
            }}
          >
            {availableTypes.map((t) => (
              <DropdownMenuRadioItem key={t.value} value={t.value} className="text-xs">
                {t.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Expand / collapse wide column */}
      {isWideColumn && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onToggleExpand}
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary"
          aria-label={isCollapsedColumn ? `Expand column ${column}` : `Collapse column ${column}`}
        >
          {isCollapsedColumn ? (
            <Expand className="h-3.5 w-3.5" />
          ) : (
            <Minimize className="h-3.5 w-3.5" />
          )}
        </Button>
      )}
    </div>
  );
}
