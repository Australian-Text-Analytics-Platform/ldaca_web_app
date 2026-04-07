import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';

import type { WorkspaceDataTableHeaderInfo } from '../hooks/useWorkspaceDataTable';

interface WorkspaceDataHeaderProps {
  info: WorkspaceDataTableHeaderInfo;
  onUndo?: () => void;
  onRedo?: () => void;
  onRename?: (newName: string) => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export const WorkspaceDataHeader = ({
  info,
  onUndo,
  onRedo,
  onRename,
  canUndo = false,
  canRedo = false,
}: WorkspaceDataHeaderProps) => {
  const [isRenaming, setIsRenaming] = useState(false);
  const [nameInput, setNameInput] = useState(info.nodeLabel);
  const inputRef = useRef<HTMLInputElement>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- Syncing input with prop when node changes */
  useEffect(() => {
    setNameInput(info.nodeLabel);
  }, [info.nodeLabel]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleRenameCommit = () => {
    const trimmed = nameInput.trim();
    if (trimmed && trimmed !== info.nodeLabel && onRename) {
      onRename(trimmed);
    }
    setIsRenaming(false);
  };

  const startRename = () => {
    setNameInput(info.nodeLabel);
    setIsRenaming(true);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 10);
  };

  return (
    <div className="flex-shrink-0 border-b border-border bg-muted p-2">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          <h3 className="text-sm font-medium text-gray-700">Data View</h3>
          <span className="text-gray-300">|</span>
          {isRenaming ? (
            <input
              ref={inputRef}
              className="px-2 py-0.5 border rounded text-sm font-semibold text-gray-800"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={handleRenameCommit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameCommit();
                if (e.key === 'Escape') setIsRenaming(false);
              }}
              aria-label="Node name"
            />
          ) : (
            <span className="text-sm font-semibold text-gray-800">{info.nodeLabel}</span>
          )}
          {onRename && !isRenaming && (
            <button
              className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-800 px-1.5 py-0.5 border rounded"
              onClick={startRename}
              title="Rename"
              aria-label="Rename node"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
                <path d="M16.862 3.487a1.5 1.5 0 0 1 2.121 0l1.53 1.53a1.5 1.5 0 0 1 0 2.122l-9.9 9.9a1.5 1.5 0 0 1-.53.352l-4.18 1.393a.75.75 0 0 1-.948-.948l1.392-4.18a1.5 1.5 0 0 1 .352-.53l9.9-9.9Z" />
                <path d="M18.26 2.08a3 3 0 0 1 4.243 0l.53.53a3 3 0 0 1 0 4.243l-1.06 1.06-4.773-4.773 1.06-1.06Z" />
              </svg>
              Rename
            </button>
          )}
          {info.isEmptyTable && (
            <span className="text-xs italic text-gray-500" aria-live="polite">
              (empty table)
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onUndo} disabled={!canUndo}>
            Undo
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onRedo} disabled={!canRedo}>
            Redo
          </Button>
        </div>
      </div>
    </div>
  );
};
