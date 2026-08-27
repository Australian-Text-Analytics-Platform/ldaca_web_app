import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { installExternalFileDropGuard } from './lib/externalFileDropGuard';
import { startThemeStorageSync } from './features/theme/themeRuntime';

// Silence the harmless "ResizeObserver loop completed with undelivered
// notifications" message before any module-level code (and Vite's HMR
// overlay) gets a chance to surface it. The browser raises this when a RO
// callback's work doesn't finish in one animation frame — the spec marks
// it benign and the next frame redelivers — but it still trips Vite's
// unhandled-error overlay during dev. ECharts + our own RO consumers in
// chart/sidebar/hint code legitimately hit it on rapid re-layout.
if (typeof window !== 'undefined') {
  startThemeStorageSync();
  installExternalFileDropGuard(window);

  /** Filters only the ResizeObserver loop warning that Vite should ignore. */
  /** Called by: the global error listener before React renders the router. */
  const isResizeObserverLoopMessage = (msg: unknown): boolean =>
    typeof msg === 'string' && msg.includes('ResizeObserver loop');
  window.addEventListener('error', (event) => {
    if (isResizeObserverLoopMessage(event.message)) {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  });
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root not found');
}

async function renderApplication(rootContainer: HTMLElement) {
  const [{ RouterProvider }, { router }, { initSentry }] = await Promise.all([
    import('@tanstack/react-router'),
    import('./router'),
    import('./lib/sentry'),
  ]);
  void initSentry();
  createRoot(rootContainer).render(
    <React.StrictMode>
      <RouterProvider router={router} />
    </React.StrictMode>,
  );
}

void renderApplication(container);
