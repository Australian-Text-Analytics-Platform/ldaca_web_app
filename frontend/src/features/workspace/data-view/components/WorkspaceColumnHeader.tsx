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
  Settings2,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import type { DataRow } from '../types';
import { RenameInput } from './RenameInput';

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
  isRenaming: boolean;

  // Capability flags
  canCast: boolean;
  canRename: boolean;
  canDelete: boolean;

  // Wide column expand/collapse
  isWideColumn: boolean;
  isCollapsedColumn: boolean;
  onToggleExpand: () => void;

  // Sort
  sortState: SortState | undefined;
  onSort: () => void;

  onStartRename: () => void;
  onSubmitRename: (column: string, value: string) => Promise<void>;
  onCancelRename: () => void;
  onTypeChange: (newType: string) => void;
  onRequestDelete: () => void;
}

/**
 * Renders one server-backed table column header with identity-preserving cast,
 * rename, and delete controls.
 */
export function WorkspaceColumnHeader({
  column,
  colInst,
  currentType,
  displayLabel,
  availableTypes,
  isColumnBusy,
  isRenaming,
  canCast,
  canRename,
  canDelete,
  isWideColumn,
  isCollapsedColumn,
  onToggleExpand,
  sortState,
  onSort,
  onStartRename,
  onSubmitRename,
  onCancelRename,
  onTypeChange,
  onRequestDelete,
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

      {isRenaming ? (
        <RenameInput
          column={column}
          disabled={isColumnBusy}
          onSubmit={(currentColumn, value) => {
            void onSubmitRename(currentColumn, value);
          }}
          onCancel={onCancelRename}
        />
      ) : (
        <div className="min-w-0">
          <span
            className="block max-w-[160px] truncate text-xs font-medium text-foreground"
            title={column}
          >
            {column}
          </span>
        </div>
      )}

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

      {(canRename || canDelete) && !isRenaming && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={isColumnBusy}
              className={cn(
                'h-7 w-7 shrink-0 text-muted-foreground hover:text-primary',
                isColumnBusy && 'cursor-progress opacity-80',
              )}
              aria-label={`Column settings for ${column}`}
            >
              {isColumnBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Settings2 className="h-3.5 w-3.5" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40 p-1">
            {canRename && (
              <DropdownMenuItem
                disabled={isColumnBusy}
                onSelect={onStartRename}
                className="text-xs"
              >
                Rename
              </DropdownMenuItem>
            )}
            {canDelete && (
              <DropdownMenuItem
                disabled={isColumnBusy}
                onSelect={onRequestDelete}
                className="text-xs text-destructive focus:text-destructive"
              >
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
