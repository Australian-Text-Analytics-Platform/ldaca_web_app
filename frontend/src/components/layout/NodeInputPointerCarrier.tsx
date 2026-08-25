import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Layers3, MousePointer2 } from 'lucide-react';

import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useUIStore } from '@/stores';
import {
  type NodeInputPointerPosition,
  useNodeInputRequestsStore,
} from '@/stores/nodeInputRequestsStore';

const POINTER_OFFSET = 16;

/** Follows the pointer while one Data Block is waiting for a selector target. */
function PointerFollower({
  requests,
  topRequestId,
  initialPosition,
}: {
  requests: { id: number; name: string }[];
  topRequestId: number;
  initialPosition?: NodeInputPointerPosition;
}) {
  const [position, setPosition] = useState<NodeInputPointerPosition | null>(
    initialPosition ?? null,
  );

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      setPosition({ x: event.clientX, y: event.clientY });
    };
    const discardTopRequest = () => {
      useNodeInputRequestsStore.getState().consume(topRequestId);
    };
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      discardTopRequest();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      useNodeInputRequestsStore.getState().clear();
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [topRequestId]);

  if (!position) return null;

  return createPortal(
    <div
      role="status"
      aria-label={`Carrying ${String(requests.length)} Data Block${requests.length === 1 ? '' : 's'}`}
      className="pointer-events-none fixed z-[100] w-64 overflow-hidden rounded-lg border border-button/35 bg-editor/95 text-body"
      style={{ left: position.x + POINTER_OFFSET, top: position.y + POINTER_OFFSET }}
    >
      <div className="flex items-center gap-2 border-b border-surface-border/70 px-3 py-2">
        <MousePointer2 className="size-4 shrink-0 text-link" aria-hidden="true" />
        <span className="font-medium text-foreground">
          Carrying {requests.length} Data Block{requests.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="flex max-h-56 flex-col-reverse overflow-hidden p-2">
        {requests.map((request, index) => {
          const isTop = index === requests.length - 1;
          return (
            <div
              key={request.id}
              className={`flex min-w-0 items-center gap-2 rounded-md border border-surface-border bg-surface px-2.5 py-1.5 ${index > 0 ? '-mt-1' : ''}`}
            >
              <Layers3
                className={isTop ? 'size-3.5 text-link' : 'size-3.5 text-description'}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                {request.name}
              </span>
              {isTop ? <span className="text-badge font-medium text-link">Next</span> : null}
            </div>
          );
        })}
      </div>
      <div className="border-t border-surface-border/70 px-3 py-1.5 text-badge text-description">
        Click a selector to place next · Right-click discards next · Esc clears all
      </div>
    </div>,
    document.body,
  );
}

/** Renders the active carried stack as a pointer-following placement preview. */
export function NodeInputPointerCarrier() {
  const { currentWorkspaceId, nodes } = useWorkspaceData();
  const currentView = useUIStore((state) => state.currentView);
  const pendingRequests = useNodeInputRequestsStore((state) => state.pendingRequests);
  const activeRequests = pendingRequests.flatMap((request) => {
    if (request.workspaceId !== currentWorkspaceId || request.view !== currentView) return [];
    const node = nodes.find((candidate) => candidate.id === request.nodeId);
    return node ? [{ id: request.id, name: node.name, pointer: request.pointer }] : [];
  });
  const topRequest = activeRequests.at(-1);
  if (!topRequest) return null;

  return (
    <PointerFollower
      requests={activeRequests.map(({ id, name }) => ({ id, name }))}
      topRequestId={topRequest.id}
      initialPosition={topRequest.pointer}
    />
  );
}
