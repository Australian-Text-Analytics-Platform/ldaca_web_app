import { useEffect, useState } from 'react';

/**
 * Listens for `slim-setup` events emitted by the slim desktop shell while it
 * bootstraps the Python runtime via uv on first launch (see
 * `src-tauri/src/main.rs` `ensure_slim_runtime`).
 *
 * Returns the latest `{ phase, message }`, or `null` outside the Tauri desktop
 * context / before any event fires. In the web build and the bundled desktop
 * build no events are emitted, so this stays `null` and the normal health-poll
 * loading screen is shown unchanged.
 */
export type SlimSetupState = { phase: string; message: string } | null;

export const useSlimSetup = (): SlimSetupState => {
  const [state, setState] = useState<SlimSetupState>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
      return;
    }
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const un = await listen<{ phase: string; message: string }>(
          'slim-setup',
          (event) => setState(event.payload),
        );
        if (cancelled) un();
        else unlisten = un;
      } catch (err) {
        console.error('Failed to subscribe to slim-setup events', err);
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return state;
};
