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

import { isColumnCastType, type ColumnCastType } from '../services/schemaMutations';
import { RenameInput } from './RenameInput';
import type { WorkspaceTableColumn } from './workspaceTableFeatures';

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
  colInst: WorkspaceTableColumn;

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
  onTypeChange: (newType: ColumnCastType) => void;
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
  const isPinnedStart = colInst.getIsPinned() === 'start';

  return (
    <div className="flex min-w-0 items-center gap-1">
      {/* Pin */}
      <button
        type="button"
        onClick={() => {
          colInst.pin(isPinnedStart ? false : 'start');
        }}
        className={cn(
          'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-transparent text-description transition-colors hover:bg-panel-foreground/10 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus',
          isPinnedStart && 'text-link',
        )}
        aria-pressed={isPinnedStart}
        aria-label={isPinnedStart ? `Unpin column ${column}` : `Pin column ${column} to the start`}
      >
        <Pin className="h-3.5 w-3.5" fill={isPinnedStart ? 'currentColor' : 'none'} />
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
            className="block max-w-[160px] truncate text-label-secondary font-medium text-foreground"
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
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-description transition-colors hover:text-foreground"
        aria-label={`Sort by ${column}`}
      >
        {sortState ? (
          sortState.desc ? (
            <ArrowDown className="h-3.5 w-3.5 text-link" />
          ) : (
            <ArrowUp className="h-3.5 w-3.5 text-link" />
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
              'h-7 w-fit justify-between gap-1 px-1.5 text-label-secondary font-medium',
              isColumnBusy && 'cursor-progress opacity-80',
            )}
            aria-label={`Change data type for column ${column}`}
          >
            <span className="truncate">{displayLabel}</span>
            {isColumnBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-description" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-description" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-40 p-1">
          <DropdownMenuRadioGroup
            value={currentType}
            onValueChange={(v) => {
              if (!isColumnBusy && isColumnCastType(v)) onTypeChange(v);
            }}
          >
            {availableTypes.map((t) => (
              <DropdownMenuRadioItem key={t.value} value={t.value} className="text-label-secondary">
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
          className="h-7 w-7 shrink-0 text-description hover:text-link"
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
                'h-7 w-7 shrink-0 text-description hover:text-link',
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
                className="text-label-secondary"
              >
                Rename
              </DropdownMenuItem>
            )}
            {canDelete && (
              <DropdownMenuItem
                disabled={isColumnBusy}
                onSelect={onRequestDelete}
                className="text-label-secondary text-error focus:text-error"
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
