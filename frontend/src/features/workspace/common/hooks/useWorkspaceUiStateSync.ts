/**
 * Two-way bridge between the global ``useNodeColorsStore.colors`` map
 * and the per-workspace ``ui_state.json`` sidecar on the backend.
 *
 *   - On ``currentWorkspaceId`` change → GET ``/workspaces/{id}/ui-state``
 *     and hydrate the store via ``hydrateColors``. If the user switches
 *     workspaces, the colours from the new workspace replace the old.
 *
 *   - On ``colors`` change after hydration → debounced PUT back to
 *     ``/ui-state``. Coalesces multiple changes in a 500 ms window so
 *     picking-then-running doesn't fire two writes back-to-back.
 *
 * Skips writes during the hydration window so the GET-then-write loop
 * doesn't echo the GET payload right back at the server.
 *
 * Lives in the workspace feature folder (not in stores/) so it has
 * easy access to the auth headers + ``currentWorkspaceId`` and so the
 * store stays pure / framework-free.
 */
import { useEffect, useRef } from 'react';
import { useNodeColorsStore } from '@/stores/nodeColorsStore';
import { workspaceUiStateApi } from '@/lib/backend/workspaceUiState';

/** Coalesce window for outbound PUTs. Long enough that picker + run
 * fall into the same write, short enough that the user doesn't lose
 * state by closing the tab a second after picking. */
const DEBOUNCE_MS = 500;

export function useWorkspaceUiStateSync(
  currentWorkspaceId: string | null | undefined,
  getAuthHeaders: () => Record<string, string>,
): void {
  const hydrateColors = useNodeColorsStore((s) => s.hydrateColors);
  // Track whether we're currently in the GET → hydrate window so we
  // don't immediately PUT the hydrated state straight back.
  const hydratingRef = useRef(false);
  // The last workspace id we hydrated for. Lets us suppress PUTs that
  // arrive after a workspace switch but before the new workspace's
  // hydration completes (would otherwise scribble the wrong colours
  // into the new workspace's sidecar).
  const hydratedWorkspaceIdRef = useRef<string | null>(null);
  // Debounce timer + the latest colour snapshot pending write.
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingColorsRef = useRef<Record<string, string> | null>(null);

  // --- Hydrate on workspace change -----------------------------------------
  useEffect(() => {
    if (!currentWorkspaceId) {
      hydratedWorkspaceIdRef.current = null;
      hydrateColors({});
      return;
    }
    let cancelled = false;
    hydratingRef.current = true;
    workspaceUiStateApi
      .get(currentWorkspaceId, getAuthHeaders())
      .then((payload) => {
        if (cancelled) return;
        const next = payload?.node_colors ?? {};
        hydrateColors(next);
        hydratedWorkspaceIdRef.current = currentWorkspaceId;
      })
      .catch((err) => {
        if (cancelled) return;
        // Best-effort hydration — if the network/auth call fails we
        // leave the store empty and let the user re-roll colours
        // session-locally. The next successful PUT will populate the
        // file for next time.
        console.warn(
          `Failed to hydrate workspace ui_state for ${currentWorkspaceId}:`,
          err,
        );
        hydrateColors({});
        hydratedWorkspaceIdRef.current = currentWorkspaceId;
      })
      .finally(() => {
        // Release the hydration suppression on the next tick so the
        // synchronous hydrateColors() ``set`` call from the GET handler
        // doesn't trigger a self-echo PUT.
        if (!cancelled) {
          setTimeout(() => {
            hydratingRef.current = false;
          }, 0);
        }
      });
    return () => {
      cancelled = true;
    };
    // ``getAuthHeaders`` is a closure that captures live state — we
    // don't want to re-trigger hydration when it's re-built each
    // render. The workspace id is the only meaningful trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWorkspaceId, hydrateColors]);

  // --- Debounced write on colour changes -----------------------------------
  useEffect(() => {
    const unsubscribe = useNodeColorsStore.subscribe((state, prev) => {
      if (state.colors === prev.colors) return;
      if (hydratingRef.current) return;
      if (!currentWorkspaceId) return;
      if (hydratedWorkspaceIdRef.current !== currentWorkspaceId) return;
      pendingColorsRef.current = state.colors;
      if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
      writeTimerRef.current = setTimeout(() => {
        const colors = pendingColorsRef.current;
        pendingColorsRef.current = null;
        writeTimerRef.current = null;
        if (!currentWorkspaceId || !colors) return;
        workspaceUiStateApi
          .put(currentWorkspaceId, { node_colors: colors }, getAuthHeaders())
          .catch((err) => {
            console.warn(
              `Failed to persist workspace ui_state for ${currentWorkspaceId}:`,
              err,
            );
          });
      }, DEBOUNCE_MS);
    });
    return () => {
      unsubscribe();
      if (writeTimerRef.current) {
        clearTimeout(writeTimerRef.current);
        writeTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWorkspaceId]);
}
