import type { Column as TableColumn } from '@tanstack/react-table';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  Expand,
  Filter,
  Loader2,
  Minimize,
  Pin,
  Settings2,
  X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { ColumnFilterForm } from './ColumnFilterForm';
import { RenameInput } from './RenameInput';
import type { DataRow, FilterOperator } from '../types';

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
  colInst: TableColumn<DataRow, unknown>;

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
  isStringLike: boolean;

  // Wide column expand/collapse
  isWideColumn: boolean;
  isCollapsedColumn: boolean;
  onToggleExpand: () => void;

  // Sort
  sortState: SortState | undefined;
  onSort: () => void;

  // Filter
  isFiltered: boolean;
  currentFilterOp: FilterOperator;
  currentFilterValue: string;
  onApplyFilter: (column: string, value: string, op: FilterOperator) => void;
  onClearFilter: (column: string) => void;

  // Mutation actions
  onStartRename: () => void;
  onSubmitRename: (column: string, value: string) => Promise<void>;
  onCancelRename: () => void;
  onTypeChange: (newType: string) => void;
  onRequestDelete: () => void;
}

/**
 * The 160-LoC TanStack column-header render-prop, lifted out of
 * WorkspaceTable.tsx into its own component. Pin / rename / sort / data-type
 * cast / wide-column expand / column-settings dropdown / filter form / active
 * filter badge — all rendering, no state.
 * Rendered by: RenameInput component, ColumnFilterForm component, WorkspaceTable component (rg call sites/imports).
 * Why: because the table needs one header surface for sort, filter, rename, cast, and delete controls on each column.
 * Flow: render the label and sort affordance, then expose per-column actions through dropdown controls.
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
  isStringLike,
  isWideColumn,
  isCollapsedColumn,
  onToggleExpand,
  sortState,
  onSort,
  isFiltered,
  currentFilterOp,
  currentFilterValue,
  onApplyFilter,
  onClearFilter,
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
        onClick={() => colInst.pin(isPinnedLeft ? false : 'left')}
        className={cn(
          'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-transparent text-muted-foreground transition-colors hover:bg-muted-foreground/10 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
          isPinnedLeft && 'text-primary',
        )}
        aria-pressed={isPinnedLeft}
        aria-label={isPinnedLeft ? `Unpin column ${column}` : `Pin column ${column} to the left`}
      >
        <Pin className="h-3.5 w-3.5" fill={isPinnedLeft ? 'currentColor' : 'none'} />
      </button>

      {/* Name / rename */}
      {isRenaming ? (
        <RenameInput
          column={column}
          disabled={isColumnBusy}
          onSubmit={onSubmitRename}
          onCancel={onCancelRename}
        />
      ) : (
        <div className="min-w-0">
          {canRename ? (
            <button
              type="button"
              className="block max-w-[160px] truncate text-left text-xs font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => { if (!isColumnBusy) onStartRename(); }}
              disabled={isColumnBusy}
              title={column}
            >
              {column}
            </button>
          ) : (
            <span className="block max-w-[160px] truncate text-xs font-medium text-foreground" title={column}>
              {column}
            </span>
          )}
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
          sortState.desc
            ? <ArrowDown className="h-3.5 w-3.5 text-primary" />
            : <ArrowUp className="h-3.5 w-3.5 text-primary" />
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
            {isColumnBusy
              ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-40 p-1">
          <DropdownMenuRadioGroup
            value={currentType}
            onValueChange={(v) => { if (!isColumnBusy) onTypeChange(v); }}
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
          {isCollapsedColumn
            ? <Expand className="h-3.5 w-3.5" />
            : <Minimize className="h-3.5 w-3.5" />}
        </Button>
      )}

      {/* Settings dropdown: Rename / Delete / Filter */}
      {(canRename || canDelete || isStringLike) && (
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
              {isColumnBusy
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Settings2 className="h-3.5 w-3.5" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 p-1">
            {canRename && (
              <DropdownMenuItem
                disabled={isColumnBusy}
                onSelect={() => { if (!isColumnBusy) onStartRename(); }}
                className="text-xs"
              >
                Rename
              </DropdownMenuItem>
            )}
            {canDelete && (
              <DropdownMenuItem
                disabled={isColumnBusy}
                onSelect={() => { if (!isColumnBusy) onRequestDelete(); }}
                className="text-xs text-destructive focus:text-destructive"
              >
                Delete
              </DropdownMenuItem>
            )}
            {isStringLike && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="text-xs">
                    <Filter className={cn('mr-1.5 h-3.5 w-3.5', isFiltered && 'text-primary')} />
                    {isFiltered ? 'Edit Filter' : 'Filter'}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-56 p-0">
                    <ColumnFilterForm
                      column={column}
                      currentOp={currentFilterOp}
                      currentValue={currentFilterValue}
                      onApply={onApplyFilter}
                      onClear={onClearFilter}
                    />
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Active filter badge */}
      {isFiltered && (
        <button
          type="button"
          onClick={() => onClearFilter(column)}
          className="inline-flex h-5 items-center gap-0.5 rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary hover:bg-primary/20"
          aria-label={`Clear filter on ${column}`}
        >
          <Filter className="h-2.5 w-2.5" />
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  );
}
