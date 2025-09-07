import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { GoogleOAuthProvider } from '@react-oauth/google';

// Get Google Client ID from environment
const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  '460163662698-lof601jcnsk9ugjjr3dpjqn31bv6krem.apps.googleusercontent.com';

if (localStorage.getItem('debugApp') === '1') {
  console.debug('[LDaCA] Google Client ID:', GOOGLE_CLIENT_ID);
  console.debug('[LDaCA] Origin:', window.location.origin);
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root not found');
}
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <App />
    </GoogleOAuthProvider>
  </React.StrictMode>
);
