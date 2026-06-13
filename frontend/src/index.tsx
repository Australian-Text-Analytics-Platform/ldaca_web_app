import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './router';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { initSentry } from './lib/sentry';

initSentry();

// Silence the harmless "ResizeObserver loop completed with undelivered
// notifications" message before any module-level code (and Vite's HMR
// overlay) gets a chance to surface it. The browser raises this when a RO
// callback's work doesn't finish in one animation frame — the spec marks
// it benign and the next frame redelivers — but it still trips Vite's
// unhandled-error overlay during dev. Recharts + our own RO consumers in
// chart/sidebar/hint code legitimately hit it on rapid re-layout.
if (typeof window !== 'undefined') {
  /** Filters only the ResizeObserver loop warning that Vite should ignore. */
  /** Called by: the global error listener before React renders the router because the interaction needs a single handler that validates state, runs the action, and updates feedback. */
  const isResizeObserverLoopMessage = (msg: unknown): boolean =>
    typeof msg === 'string' && msg.includes('ResizeObserver loop');
  window.addEventListener('error', (event) => {
    if (isResizeObserverLoopMessage(event.message)) {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  });
}

// Resolve Google Client ID in priority order:
//   1. window.__GOOGLE_CLIENT_ID__ (injected by backend at runtime)
//   2. VITE_GOOGLE_CLIENT_ID (build-time env)
//   3. Development fallback (LDaCA shared dev client)
const INJECTED_GOOGLE_CLIENT_ID =
  typeof window !== 'undefined' ? window.__GOOGLE_CLIENT_ID__ : undefined;
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- empty/whitespace client IDs should fall through to the next fallback, not only null/undefined */
const GOOGLE_CLIENT_ID =
  (INJECTED_GOOGLE_CLIENT_ID?.trim()) ||
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  '460163662698-lof601jcnsk9ugjjr3dpjqn31bv6krem.apps.googleusercontent.com';
/* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root not found');
}
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <RouterProvider router={router} />
    </GoogleOAuthProvider>
  </React.StrictMode>,
);
