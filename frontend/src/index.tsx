import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './router';
import { GoogleOAuthProvider } from '@react-oauth/google';

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

if (localStorage.getItem('debugApp') === '1') {
  console.debug('[LDaCA] Google Client ID:', GOOGLE_CLIENT_ID);
  console.debug('[LDaCA] Origin:', window.location.origin);
  console.debug('[LDaCA] Multi-user mode:', window.__MULTI_USER__);
}

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
