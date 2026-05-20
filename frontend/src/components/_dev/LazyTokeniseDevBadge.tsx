// TEMPORARY (Phase 2/2.5 local-testing aid) — fixed-position dev
// indicator that confirms the backend's LDACA_LAZY_TOKENISE env flag
// is on. Visible only when the flag is on; renders nothing otherwise,
// so it's safe to leave mounted while the flag remains opt-in.
//
// REMOVE BEFORE PUBLISH (Phase 3+ once the flag becomes default):
// 1. Delete this file and its enclosing `_dev/` folder (if empty).
// 2. Remove the <LazyTokeniseDevBadge /> mount from `App.tsx`.
// 3. Remove `lazy_tokenise_enabled` from `api/config.ts`
//    ConfigResponse + the matching field in backend's `api/config.py`.
// 4. Remove the temporary startup-banner log block in
//    `backend/src/ldaca_wordflow/main.py` (also tagged TEMPORARY).
// The lazy-tokenisation feature itself stays — only the dev-visible
// indicator is removed.

import { useAuthStore } from '@/stores/authStore';

export function LazyTokeniseDevBadge() {
  const enabled = useAuthStore((s) => s.config?.lazy_tokenise_enabled);
  if (!enabled) {
    return null;
  }
  return (
    <div
      title="Backend started with LDACA_LAZY_TOKENISE=1. Tokenise clicks defer cache writes; first analysis materialises tokens. Remove this badge before publishing."
      className="fixed bottom-2 right-2 z-50 select-none rounded border border-amber-600/70 bg-amber-100/95 px-2 py-1 text-xs font-mono text-amber-900 shadow-md backdrop-blur"
      role="status"
      aria-label="Lazy tokenisation is enabled"
    >
      <span className="font-semibold">DEV</span> · lazy tokenise <span className="font-semibold">ON</span>
    </div>
  );
}

export default LazyTokeniseDevBadge;
