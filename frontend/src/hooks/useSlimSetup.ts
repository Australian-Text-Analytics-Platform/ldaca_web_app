import { useEffect, useState } from 'react';

/**
 * Listens for `slim-setup` events emitted by the desktop shell while it
 * provisions the Python runtime on first launch — the slim variant installs via
 * uv, the bundle variant extracts a shipped tarball (see `src-tauri/src/main.rs`
 * `ensure_slim_runtime` / `ensure_bundle_runtime`).
 *
 * Returns the latest `{ phase, message }`, or `null` outside the Tauri desktop
 * context / before setup starts. In the web build and the legacy bundled build
 * no events are emitted, so this stays `null` and the normal health-poll loading
 * screen is shown unchanged.
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
        // Attach the listener first so no update is missed between seeding and
        // subscribing.
        const un = await listen<{ phase: string; message: string }>(
          'slim-setup',
          (event) => setState(event.payload),
        );
        if (cancelled) {
          un();
          return;
        }
        unlisten = un;

        // Seed the current phase: the setup thread emits its first event(s)
        // before this hook mounts, so without this the screen sits on the bare
        // health spinner for the whole (slow, on Windows) extraction. Only fill
        // if no live event has already arrived.
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const initial =
            await invoke<NonNullable<SlimSetupState>>('current_setup');
          if (!cancelled && initial) {
            setState((prev) => prev ?? initial);
          }
        } catch {
          // `current_setup` is unavailable in the web build; ignore.
        }
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
