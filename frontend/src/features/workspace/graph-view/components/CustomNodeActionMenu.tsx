import { Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  computeMenuPlacement,
  type NodeMenuPlacement,
} from './customNodeMenuPlacement';

export const CUSTOM_NODE_TOOLBAR_BUTTON_CLASS =
  'relative flex h-8 w-8 items-center justify-center rounded-md border border-border bg-white text-gray-600 shadow-sm transition-colors hover:bg-muted hover:text-gray-900';

interface CustomNodeActionMenuProps {
  menuRef: React.RefObject<HTMLDivElement | null>;
  showMenu: boolean;
  menuOpensUp: boolean;
  menuOpensRight: boolean;
  canUndo?: boolean | null;
  canRedo?: boolean | null;
  onMenuChange: (showMenu: boolean, placement: NodeMenuPlacement | null) => void;
  onRenameClick: (event: React.MouseEvent) => void;
  onCopyNode: (event: React.MouseEvent) => void;
  onUndoNode: (event: React.MouseEvent) => void;
  onRedoNode: (event: React.MouseEvent) => void;
  onDeleteClick: (event: React.MouseEvent) => void;
  stopGraphControlEvent: (event: React.SyntheticEvent) => void;
}

/**
 * Renders the fixed-size settings button and dropdown menu for a graph node.
 * Used by: CustomNode's React Flow toolbar because menu placement, disabled
 * history actions, and event isolation are one coherent interaction boundary.
 */
export function CustomNodeActionMenu({
  menuRef,
  showMenu,
  menuOpensUp,
  menuOpensRight,
  canUndo,
  canRedo,
  onMenuChange,
  onRenameClick,
  onCopyNode,
  onUndoNode,
  onRedoNode,
  onDeleteClick,
  stopGraphControlEvent,
}: CustomNodeActionMenuProps) {
  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onPointerDown={stopGraphControlEvent}
        onMouseDown={stopGraphControlEvent}
        onClick={(event) => {
          event.stopPropagation();
          const willOpen = !showMenu;
          const placement = willOpen ? computeMenuPlacement(event.currentTarget) : null;
          onMenuChange(willOpen, placement);
        }}
        className={CUSTOM_NODE_TOOLBAR_BUTTON_CLASS}
        title="More options"
        aria-label="Node settings"
      >
        <Settings2 className="h-4 w-4" />
      </button>

      {showMenu && (
        <div
          className={cn(
            'absolute z-30 min-w-36 rounded-md border border-border bg-white shadow-lg',
            menuOpensUp ? 'bottom-9' : 'top-9',
            menuOpensRight ? 'left-0' : 'right-0',
          )}
        >
          <button
            onClick={onRenameClick}
            className="w-full rounded-md px-3 py-2 text-left text-xs hover:bg-muted/60"
          >
            Rename
          </button>

          <button
            onClick={onCopyNode}
            className="w-full border-t border-border/60 px-3 py-2 text-left text-xs hover:bg-muted/60"
          >
            Clone
          </button>

          <button
            onClick={onUndoNode}
            disabled={!canUndo}
            className="w-full border-t border-border/60 px-3 py-2 text-left text-xs disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent hover:bg-muted/60"
          >
            Undo
          </button>

          <button
            onClick={onRedoNode}
            disabled={!canRedo}
            className="w-full border-t border-border/60 px-3 py-2 text-left text-xs disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent hover:bg-muted/60"
          >
            Redo
          </button>

          <button
            onClick={onDeleteClick}
            className="w-full border-t border-border/60 px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
