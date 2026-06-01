import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './router';
import { GoogleOAuthProvider } from '@react-oauth/google';

// Silence the harmless "ResizeObserver loop completed with undelivered
// notifications" message before any module-level code (and Vite's HMR
// overlay) gets a chance to surface it. The browser raises this when a RO
// callback's work doesn't finish in one animation frame — the spec marks
// it benign and the next frame redelivers — but it still trips Vite's
// unhandled-error overlay during dev. Recharts + our own RO consumers in
// chart/sidebar/hint code legitimately hit it on rapid re-layout.
if (typeof window !== 'undefined') {
  const isResizeObserverLoopMessage = (msg: unknown): boolean =>
    typeof msg === 'string' &&
    msg.includes('ResizeObserver loop');
  window.addEventListener('error', (event) => {
    if (isResizeObserverLoopMessage(event.message)) {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  });
}

// In the packaged desktop (Tauri) build only, stop the WebView from
// navigating away to display a file dropped onto blank space — which
// otherwise turns the whole window into a plain text reader. Everything the
// app uses on purpose is left untouched: in-app drag-drop (file uploads,
// graph block moves, preprocessing column drags), text selection + copy,
// Cmd +/- zoom, and browser find all keep working. The dev browser is
// unaffected because of the Tauri guard.
if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
  // Stop the WebView from opening a file dropped outside a drop zone. We
  // only cancel the default for *external file* drags ('Files' in types),
  // so internal HTML5 drag-drop (graph blocks, preprocessing columns) is
  // never affected. Real drop zones still receive the event and read the
  // files normally — preventDefault here only kills the navigate-away
  // fallback that fires when nothing else handled the drop.
  const blockExternalFileDrop = (event: DragEvent) => {
    if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) {
      event.preventDefault();
    }
  };
  window.addEventListener('dragover', blockExternalFileDrop);
  window.addEventListener('drop', blockExternalFileDrop);
}

// Resolve Google Client ID in priority order:
//   1. window.__GOOGLE_CLIENT_ID__ (injected by backend at runtime)
//   2. VITE_GOOGLE_CLIENT_ID (build-time env)
//   3. Development fallback (LDaCA shared dev client)
const INJECTED_GOOGLE_CLIENT_ID =
  typeof window !== 'undefined' ? window.__GOOGLE_CLIENT_ID__ : undefined;
const GOOGLE_CLIENT_ID =
  (INJECTED_GOOGLE_CLIENT_ID && INJECTED_GOOGLE_CLIENT_ID.trim()) ||
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  '460163662698-lof601jcnsk9ugjjr3dpjqn31bv6krem.apps.googleusercontent.com';

// CILogon uses server-side OIDC; __CILOGON_CLIENT_ID__ is injected for
// informational use only — the actual auth flow starts at /api/auth/cilogon/login.
const _CILOGON_CLIENT_ID =
  typeof window !== 'undefined' ? window.__CILOGON_CLIENT_ID__ : undefined;

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
  </React.StrictMode>
);
