import { useSyncExternalStore } from 'react';

/**
 * Module-level singleton tracking which node currently owns the visible hover
 * toolbar.
 *
 * Used by: CustomNode instances because each node owns local hover state, but
 * the graph interaction model requires only one popped-out toolbar/menu to be
 * visible at a time.
 */
let activeToolbarNodeId: string | null = null;
const toolbarOwnerListeners = new Set<() => void>();

/** Sets the active toolbar owner and notifies subscribed nodes. */
export function setActiveToolbarOwner(nodeId: string | null): void {
  if (activeToolbarNodeId === nodeId) return;
  activeToolbarNodeId = nodeId;
  for (const listener of toolbarOwnerListeners) listener();
}

/** Clears toolbar ownership only when the requesting node still owns it. */
export function releaseToolbarOwner(nodeId: string): void {
  if (activeToolbarNodeId === nodeId) {
    setActiveToolbarOwner(null);
  }
}

const subscribeToolbarOwner = (listener: () => void): (() => void) => {
  toolbarOwnerListeners.add(listener);
  return () => {
    toolbarOwnerListeners.delete(listener);
  };
};

const getToolbarOwnerSnapshot = (): string | null => activeToolbarNodeId;

/**
 * Subscribes a node renderer to singleton toolbar-owner changes.
 * Used by: CustomNode because when one node claims ownership, all other nodes
 * must re-render and hide their hover toolbar immediately.
 */
export function useCustomNodeToolbarOwner(): string | null {
  return useSyncExternalStore(
    subscribeToolbarOwner,
    getToolbarOwnerSnapshot,
    getToolbarOwnerSnapshot,
  );
}
