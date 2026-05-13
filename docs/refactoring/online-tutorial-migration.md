# Online Tutorial Migration Plan

Companion to `docs/refactoring/plan.md` §3.10. Tracks the design and
execution plan for moving tutorial / info / reference content from the
bundled frontend into an externally-hosted, version-pinned docs site so
that documentation can be updated without bumping app releases.

## Status (2026-05-14)

- **3.10A — Loader infrastructure**: ✅ landed on the `docs-migration`
  branch (commits `63f37e3`, `38959fe`). bundledRegistry + registryStore
  + remoteRegistry + getDocTarget in place; existing registry files
  thinned to re-exports; App.tsx hydrates on mount; DocumentView resolves
  remote-prefixed paths; 10 new unit tests.
- **3.10B — Content migration**: 🟡 partial. Sibling docs repo
  `ldaca-analytics-docs/` scaffolded with content, registry.json,
  build-registry validator, Pages publish workflow, and wiki-mirror
  workflow. Git-init'd but **not committed** — left for the user to
  review and `git remote add origin` + `git push`. The webapp's bundled
  `frontend/public/{tutorials,information,references,warnings}/` copies
  are NOT yet trimmed; that happens once the docs site is live.
- **3.10C — Versioned deployment**: scaffolded (publish.yml +
  mirror-to-wiki.yml in the docs repo). Awaits a real GitHub remote and
  the `WIKI_PAT` secret for the wiki-mirror cross-repo push.
- **3.10D — Drift CI**: ✅ landed (commit `b602683`).
  `frontend/scripts/check-docs-drift.mjs` + `.github/workflows/check-docs-drift.yml`;
  caught two pre-existing drifts when first run, both fixed.
- **EOL banner**: ✅ landed (commit `3dbf231`). Reads `meta.eolDate`
  from the merged registry; per-version dismissable.

## Decisions taken vs. original plan

| Topic | Plan said | What landed |
|---|---|---|
| Docs repo name | `ldaca-docs` | `ldaca-analytics-docs` (scoped to the analytics arm) |
| Docs repo placement | unstated | **sibling** of `ldaca_web_app` under the master repo (`LDaCA_Text_Analytics_Tools`), not a sub-submodule of the app |
| Wiki | n/a | The master repo's wiki is mirrored from `ldaca-analytics-docs/main` on push (Option C from the discussion — wiki for human browsing, not the app's load path) |
| Registry unification | unify on wire, keep 3 accessors | done — `bundledRegistry.ts` is unified `{tutorial,info,reference}`; trimmed registry files re-export typed accessors |
| Bundled-fallback scope | trim to ~50 essentials | **kept full ~100 entries for 3.10A** to avoid temporarily-broken anchors before the docs site is live. Trim happens in 3.10B-final |
| LooseAutoComplete | plan referenced it | not needed — `keyof typeof BUNDLED_REGISTRY[kind]` already covers every literal call site because the bundle stays fat |
| Cache TTL | refresh on every start, no time-based TTL | as designed |
| Dev base URL | `.env.local` overrides `VITE_DOCS_BASE_URL` | as designed |
| Drift CI source-of-truth | fetch deployed registry.json | check against BUNDLED_REGISTRY for now; extend to fetch remote once the docs site is live |

This work was originally **out of scope** for the `refactoring` branch.
It now lives on its own `docs-migration` branch (webapp side) plus the
yet-to-be-pushed `ldaca-analytics-docs` sibling.

---

## Goal

Replace the three inline registries —
- `frontend/src/tutorials/tutorialRegistry.ts` (466 LoC, ~88 entries)
- `frontend/src/tutorials/infoRegistry.ts` (69 LoC)
- `frontend/src/tutorials/referenceRegistry.ts` (24 LoC)

— and the bundled markdown content in `frontend/public/tutorials/` (~2070
LoC across 10 files) with a runtime-loaded registry + remotely-hosted
markdown, while:

1. **Preserving offline behaviour** for the essentials.
2. **Decoupling doc updates from app releases.**
3. **Isolating doc versions** so old apps don't see new-feature anchors
   they can't navigate to, and don't lose access to anchors that were
   removed in the latest docs.

The end state is: doc edits ship by pushing to the docs repo; the app
picks up changes on next start (or sooner if a refresh window arrives).

---

## Why externalize (recap of motivation)

- **Ship-without-release**: typo fixes, new examples, screenshots,
  short GIFs no longer need an app release.
- **Bundle size**: currently small (≪10 MB) but will balloon if/when
  GIFs or short videos go inline.
- **Editorial workflow**: doc-only PRs review independently of code PRs.

---

## Architecture decisions (already landed in design discussion)

### Hosting

- **Docs repo + GitHub Pages**, branch-per-version.
- URL shape: `https://<docs-host>/<vX.Y>/registry.json` and
  `https://<docs-host>/<vX.Y>/tutorials/<file>.md`.
- Each docs-repo branch maps to an app minor version (`v0.3`, `v0.4`,
  etc).
- App build embeds `VITE_DOCS_BASE_URL` derived from `package.json`
  `version` at build time. Example: app `0.3.5` → docs base
  `https://chao-sun.github.io/ldaca-docs/v0.3`.

### Cache + offline

Stale-while-revalidate model:

1. **Bundle a minimal fallback registry** (~30–40 essentials only;
   `bundledRegistry.ts` replaces the 466-LoC inline registry).
2. **On app start**: kick off background `fetch(${DOCS_BASE_URL}/registry.json)`.
3. **On startup with cached registry**: read from `localStorage` (`ldaca.docs.registry.v1`),
   merge over bundled fallback, paint instantly. Then refresh in
   background.
4. **On help click**: lookup uses the active in-memory registry
   (cache-merged-with-bundle).
5. **On markdown fetch**: `DocumentView` fetches from the resolved
   absolute URL (`DOCS_BASE_URL` + `file`). If fetch fails AND the file
   is in the bundled list, fall back to `public/tutorials/<file>`
   (which contains the minimal fallback markdown set).

### Version compatibility

- **Branch-per-version + accretive within version.** Docs branches
  evolve forward only — new anchors added, old anchors never removed
  within a branch. Removed-anchor markdown stubs link to the new
  anchor.
- **EOL flag**: optional `eolDate` field on the registry root so the
  app can show a banner like "this version is unsupported, please
  upgrade" once a branch is retired.

### Anchor-drift detection

- **CI job in the app repo**: on every PR, fetch the deployed registry
  and assert that every `<HelpIcon targetKey="...">` /
  `<InfoIcon targetKey="...">` / `<ReferenceIcon targetKey="...">`
  literal in the source resolves against it. Fails the PR if a
  literal is missing or a literal exists but has no anchor.
- This replaces the build-time-scan idea from the original §3.10 plan.

---

## Open decisions (please choose before starting)

These can't be inferred from the codebase — flag them in the PR
description and either decide upfront or split into a follow-up:

1. **Docs repo name and host.** Suggested: `ldaca-docs` under the same
   owner as the app, GitHub Pages enabled. Alternatives: Cloudflare
   Pages (faster CDN), jsdelivr (just serves the raw repo, no build).
2. **Unify the three registries into one, or keep three?** Currently
   `tutorial` / `info` / `reference` are separate registries. They
   share the shape `{ file, anchor, label? }` but have separate consumer
   types and separate modal hosts in `DocumentModalHost`. The dynamic
   registry can be a single `{ tutorial: { … }, info: { … }, reference: { … } }`
   shape. Recommended: **unify on the wire** (one fetch, one JSON), but
   keep three accessor functions (`getTutorialTarget` /
   `getInfoTarget` / `getReferenceTarget`) so consumers don't change.
3. **What's in the bundled fallback?** Suggested minimum:
   - `tutorial`: the `tutorialIndexTarget` and the 9 per-feature
     anchors used by Sidebar's top-of-section help icons.
   - `info`: the 5 most-frequently-clicked entries.
   - `reference`: keep all (it's only 24 LoC; the marginal bundle cost
     is trivial).
4. **Cache TTL / refresh policy.** Recommended: refresh on every app
   start in the background, no time-based TTL. The cached version is
   shown immediately; the refresh quietly updates state for the next
   modal open.
5. **What is the docs base URL for development?** Probably the same
   GitHub Pages host pointed at the `main` branch, OR a local
   `vite preview` of the docs repo on `localhost:5174`. Recommended:
   `.env.local` overrides `VITE_DOCS_BASE_URL`.

---

## Current state inventory

What this migration must replace:

### Registries (`frontend/src/tutorials/`)

| File | LoC | Entries | Exports |
|---|---|---|---|
| `tutorialRegistry.ts` | 466 | ~88 | `TutorialTargetKey`, `getTutorialTarget`, `tutorialIndexTarget`, `registry` |
| `infoRegistry.ts` | 69 | ~10 | `InfoTargetKey`, `getInfoTarget`, `registry` |
| `referenceRegistry.ts` | 24 | ~3 | `ReferenceTargetKey`, `getReferenceTarget`, `registry` |

Each entry shape: `{ file: string; anchor: string; label?: string }`.

Each `XTargetKey` is `LooseAutoComplete<keyof typeof registry>` (per
commit `0b48657`) — gives IDE autocomplete on direct uses while
allowing dynamic targetKey strings to compile.

### Markdown content (`frontend/public/tutorials/`)

| File | LoC |
|---|---|
| `concordance.md` | 227 |
| `data-loader.md` | 156 |
| `export.md` | 64 |
| `index.md` | 80 |
| `preprocessing.md` | 254 |
| `quotation.md` | 99 |
| `sequential-analysis.md` | 174 |
| `token-frequency.md` | 155 |
| `topic-modeling.md` | 190 |
| `ui.md` | 113 |
| **Total** | **2071** |

Plus `frontend/public/tutorials/assets/` for images.

### Consumers

- `frontend/src/components/help/DocLinkIcon.tsx` — the implementation.
  Imports `getTutorialTarget` / `getInfoTarget` / `getReferenceTarget`
  via a `CONFIG: Record<DocLinkKind, ...>` map. **This is the central
  point that changes** — swap the three direct imports for a single
  `getDocTarget(kind, key)` helper backed by the dynamic loader.
- `frontend/src/components/help/HelpIcon.tsx`,
  `InfoIcon.tsx`, `ReferenceIcon.tsx` — type-only imports of
  `XTargetKey`. Wrappers over `DocLinkIcon`. **No change needed** as
  long as the literal-union types continue to exist.
- `frontend/src/features/hints/HintsController.tsx` — imports
  `getTutorialTarget`. Single call site; trivial swap.
- `frontend/src/components/layout/Sidebar.tsx` — imports
  `tutorialIndexTarget` (the index-page target). Either re-export from
  bundled fallback (always present) or inline as
  `{ file: 'tutorials/index.md', anchor: '' }`.
- `frontend/src/components/DocumentView.tsx` — fetches markdown via
  `resolveDocUrl(requestedFile)` (lines 45–65). Currently resolves
  relative to the base href. **Needs change**: when the file path is
  not a known-bundled fallback, prefix `VITE_DOCS_BASE_URL`.

### Modal host (`frontend/src/components/dialogs/DocumentModalHost.tsx`)

Four `ModalSlot`s — tutorial / info / reference / warning. Each is
gated by a `useUIStore.modals.<X>Modal` boolean and reads a corresponding
`<X>Target`. **No change needed**.

---

## Phase 3.10A — Loader infrastructure

The core work. Do this on its own branch. Around half a day plus
testing. The output is "registry is loaded at runtime" with NO content
moved yet — markdown still lives in `public/tutorials/`. Doc updates
still require a release. The structural foundation is what's being
built here.

### File layout (proposed)

```
frontend/src/tutorials/
├── bundledRegistry.ts         # NEW. Trimmed essentials (~30–40 tutorial
│                              #      entries + index target + ~5 info +
│                              #      all ~3 reference). Single JSON-able
│                              #      object exported as a constant.
├── remoteRegistry.ts          # NEW. fetch() + localStorage cache + SWR.
│                              #      Exports `loadRemoteRegistry()` and
│                              #      `getCachedRegistry()`.
├── registryStore.ts           # NEW. Zustand store that holds the
│                              #      active (bundled-merged-with-remote)
│                              #      registry. Subscribes are how the
│                              #      modal hosts see live updates.
├── getDocTarget.ts            # NEW. `getDocTarget(kind, key)` →
│                              #      `{file, anchor, label} | null`.
│                              #      Reads from registryStore.
├── tutorialRegistry.ts        # SHRINKS. Keeps `TutorialTargetKey`
│                              #      literal-union (derived from
│                              #      bundledRegistry) + thin
│                              #      `getTutorialTarget` that calls
│                              #      `getDocTarget('tutorial', key)`.
├── infoRegistry.ts            # SHRINKS. Same pattern.
└── referenceRegistry.ts       # SHRINKS. Same pattern.
```

The three existing files stay (their `XTargetKey` exports are
consumed by typed call sites) but their bodies become re-exports —
the runtime data lives in the new modules.

### API surface

```ts
// frontend/src/tutorials/getDocTarget.ts
export type DocLinkKind = 'tutorial' | 'info' | 'reference' | 'warning';
export type DocTarget = { file: string; anchor: string; label?: string };

export function getDocTarget(kind: DocLinkKind, key: string): DocTarget | null;
```

```ts
// frontend/src/tutorials/registryStore.ts
type RegistryShape = {
  tutorial: Record<string, DocTarget>;
  info: Record<string, DocTarget>;
  reference: Record<string, DocTarget>;
  meta?: { version: string; eolDate?: string };
};

export const useRegistryStore = create<{
  registry: RegistryShape;     // always merged-with-bundled
  isLoading: boolean;
  lastFetchedAt: number | null;
}>(...);
```

```ts
// frontend/src/tutorials/remoteRegistry.ts
/** Fires on app start. Resolves when localStorage cache (if any) has
 *  been read into the store; the network refresh runs in the background
 *  and updates the store when it arrives. */
export async function loadRemoteRegistry(): Promise<void>;
```

### Bundled fallback shape

```ts
// frontend/src/tutorials/bundledRegistry.ts
import type { RegistryShape } from './registryStore';

export const BUNDLED_REGISTRY: RegistryShape = {
  tutorial: {
    'index': { file: 'tutorials/index.md', anchor: '' },
    'ui.tool-choice': { file: 'tutorials/ui.md', anchor: 'help-ui-tool-choice', label: 'Tool Choice' },
    // … only the ~30–40 essentials (decided in open-decision #3)
  },
  info: { /* … */ },
  reference: { /* keep all (only ~3) */ },
};
```

### Implementation steps (in order)

1. **Add `VITE_DOCS_BASE_URL` env var.**
   - Default in `.env`: `VITE_DOCS_BASE_URL=` (empty → no remote fetch).
   - Once docs repo is live: `VITE_DOCS_BASE_URL=https://<host>/v0.3`.
   - Wire into Vite config so it's typed via `vite-env.d.ts`.

2. **Create `bundledRegistry.ts` with the essentials.** Cherry-pick
   from current `tutorialRegistry.ts` / `infoRegistry.ts` /
   `referenceRegistry.ts`. Aim for ~50 total entries across the three
   kinds. The rest of the current entries get DROPPED from the bundle
   and live only in the remote registry once 3.10B lands.

3. **Create `registryStore.ts`** with the merge logic
   (`{ ...BUNDLED_REGISTRY[kind], ...remote[kind] }` per kind). Initialize
   to bundled-only; later actions merge remote on top.

4. **Create `remoteRegistry.ts`** with:
   - `readCache()`: `JSON.parse(localStorage.getItem('ldaca.docs.registry.v1'))`,
     returns null on error.
   - `writeCache(registry, version)`: serialise + setItem; silent on
     storage errors.
   - `loadRemoteRegistry()`: read cache → store; in background
     `fetch(VITE_DOCS_BASE_URL + '/registry.json')` → on success,
     update store + cache; on failure, log to debug and move on.
   - Skip the fetch entirely if `VITE_DOCS_BASE_URL` is empty.

5. **Create `getDocTarget.ts`** that reads from `useRegistryStore`'s
   state directly (`useRegistryStore.getState().registry[kind][key]`).
   Returns null when not found.

6. **Trim `tutorialRegistry.ts` / `infoRegistry.ts` / `referenceRegistry.ts`.**
   Each becomes a tiny file:
   ```ts
   import { BUNDLED_REGISTRY } from './bundledRegistry';
   import { getDocTarget } from './getDocTarget';

   export type TutorialTargetKey = LooseAutoComplete<keyof typeof BUNDLED_REGISTRY.tutorial>;
   export const tutorialIndexTarget = BUNDLED_REGISTRY.tutorial.index;
   export const getTutorialTarget = (key: string) => getDocTarget('tutorial', key);
   ```
   The 466-LoC inline `registry` object is GONE. Its data lived in
   `bundledRegistry.ts` if essential, or is dropped (still resolvable
   via the remote registry — but only once that's deployed).

7. **Update `DocLinkIcon.tsx`'s `CONFIG`.** The three
   `getTutorialTarget` / `getInfoTarget` / `getReferenceTarget`
   imports can stay (their bodies now route through `getDocTarget`), so
   this file is unchanged.

8. **Wire `loadRemoteRegistry()` into app startup.** Call from
   `App.tsx` (before WorkspaceShell renders) inside a `useEffect` so
   the cache is read synchronously into the store before the first
   modal might open.

9. **Update `DocumentView.tsx` `resolveDocUrl`.** When
   `VITE_DOCS_BASE_URL` is set AND the requested file isn't a
   `public/tutorials/*` bundled fallback, prefix the base URL.
   Sketch:
   ```ts
   const BUNDLED_FILES = new Set([
     'tutorials/index.md',
     // … the bundled-fallback file list (deduced from
     //   BUNDLED_REGISTRY's target.file values)
   ]);

   const resolveDocUrl = (requestedFile: string) => {
     if (BUNDLED_FILES.has(requestedFile)) {
       // existing relative-resolution code path
     }
     const base = import.meta.env.VITE_DOCS_BASE_URL;
     if (!base) {
       // no remote configured — fall through to local resolution
     } else {
       return new URL(requestedFile, base + '/').toString();
     }
   };
   ```

10. **Update existing tests.** Two test files import from the
    registries directly via `vi.mock` — keep them working by mocking
    `@/tutorials/getDocTarget` instead, or rely on the trimmed
    re-exports.

### Test plan

- **Unit tests** for `getDocTarget` covering bundled-only, remote-only,
  bundled-shadowed-by-remote, and missing-key cases.
- **Cache test**: write a known value via `localStorage`, mount the
  store, assert the read happens synchronously.
- **Smoke test**: with `VITE_DOCS_BASE_URL=''`, app should boot,
  bundled essentials should resolve, and a non-bundled targetKey
  should toast "documentation unavailable".
- **Manual**: with `VITE_DOCS_BASE_URL` pointing at a local file
  server serving a known-good `registry.json`, app should fetch and
  merge.

### Risk and rollback

- **Risk: remote fetch hangs or errors** — handled by SWR cache + bundled
  fallback. Worst case: user sees bundled-only registry for the
  session.
- **Risk: cache poisoned by old format after schema change** — guard
  with `meta.version` field in the registry JSON. If parsed version
  doesn't match `REGISTRY_SCHEMA_VERSION` constant, ignore the cache.
- **Rollback**: revert this branch. The bundled essentials carry
  fundamental help links; non-essential anchors fail silently with a
  toast as they do today when an anchor is missing.

---

## Phase 3.10B — Content migration

Only do this **after** 3.10A is live in production for at least one
release cycle.

### Steps

1. **Create the `ldaca-docs` repo** (or chosen name) with a `main`
   branch that mirrors the current `frontend/public/tutorials/`
   directory structure. The repo holds:
   - `tutorials/*.md` (current files)
   - `assets/` (current images, plus any new GIF/video)
   - `registry.json` (generated, see below)
2. **Add a `registry.json` build step** in the docs repo. A small
   Node script walks the tutorials/info/reference markdown,
   extracts every `<a id="help-...">` anchor (or a frontmatter block),
   and emits a structured registry. Or: maintain `registry.json`
   manually for now if the markdown structure varies.
3. **Set up GitHub Pages** on the docs repo. Branch-aliased paths:
   - `main` → `/main/`
   - `v0.3` → `/v0.3/`
   - `v0.4` → `/v0.4/`
   - etc.

   GitHub Actions workflow: on push to any branch matching `v[0-9]+\.[0-9]+`
   or `main`, publish under the matching path.
4. **Cut a `v0.3` branch** in the docs repo from `main` matching the
   app's current minor version.
5. **Set `VITE_DOCS_BASE_URL` in the app's `.env`** to
   `https://<docs-host>/v0.3` for the next app release.
6. **Delete `frontend/public/tutorials/*.md`** EXCEPT the bundled
   fallback set decided in open-decision #3. The bundle drops by
   1–2 MB.
7. **Verify the bundle size delta.** `npm run build` before and after.
8. **Verify rendering** for every help icon by spot-checking each
   feature in the app.
9. **Trim `bundledRegistry.ts`** to its final minimum. Anything not
   in the bundled fallback continues to resolve via the remote
   registry.

### Content migration risk

- **Risk: anchors that work today silently break** in production
  because remote fetch hasn't landed before the app opens its first
  help icon. Mitigation: 3.10A's SWR pattern always reads cache
  synchronously; a fresh install with no cache and no network sees
  the bundled essentials only. Non-essential anchors fail silently
  with a toast.
- **Risk: stale-cache pinning to deprecated entries** — handled by
  the `meta.version` cache-bust mechanism in 3.10A.

---

## Phase 3.10C — Docs repo + versioned deployment

One-time setup. Owns the docs lifecycle going forward.

### Repo skeleton

```
ldaca-docs/
├── tutorials/         # markdown files
├── info/              # info-icon markdown
├── reference/         # reference-icon markdown
├── assets/            # images, GIFs
├── registry.json      # generated or hand-maintained
├── scripts/
│   └── build-registry.mjs   # walks markdown, emits registry.json
└── .github/
    └── workflows/
        └── publish.yml      # GitHub Pages per branch
```

### Workflow (`publish.yml`) sketch

```yaml
name: Publish docs
on:
  push:
    branches: [main, 'v*.*']
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions: { pages: write, id-token: write }
    steps:
      - uses: actions/checkout@v4
      - run: node scripts/build-registry.mjs
      - uses: actions/upload-pages-artifact@v3
        with:
          path: .
      - uses: actions/deploy-pages@v4
```

GitHub Pages must be configured to serve from a separate branch (e.g.
`gh-pages`) or via the `pages` action's branch-aware deployment. The
exact setup depends on whether you use the older "deploy from a branch"
mode or the newer "GitHub Actions" mode — the latter is recommended
because it supports per-branch publishing without a separate `gh-pages`
branch dance.

### Versioning convention

- **App `package.json`** version drives `VITE_DOCS_BASE_URL` at build
  time: app `0.3.5` → docs URL `…/v0.3/`.
- **Docs branches**: created when the app's minor version increments.
  `v0.3` → `v0.4` is a fresh branch off the previous (or off `main`).
- **`main` branch**: where ongoing work happens between releases.
  Optionally serve `main` to a `…/main/` URL for staging/preview.
- **EOL**: when v0.3 is retired, set `meta.eolDate` in the v0.3
  registry. Old apps still work but show a deprecation banner.

---

## Phase 3.10D — Drift-detection CI

Independent of 3.10A/B/C but most useful AFTER 3.10A. Lives in the
**app repo**.

### What it does

On every PR:
1. Grep the source for `<HelpIcon targetKey="…">`,
   `<InfoIcon targetKey="…">`, `<ReferenceIcon targetKey="…">`
   literals.
2. Fetch the deployed `registry.json` from `VITE_DOCS_BASE_URL` (the
   one for the PR's target branch's app version).
3. Assert every literal resolves. Fail the CI job if any are missing.
4. Conversely, warn (don't fail) if the registry has entries no source
   reference is using — they may be stale.

### Implementation sketch

```js
// scripts/check-docs-drift.mjs
import { readFileSync } from 'node:fs';
import { globSync } from 'glob';

const SOURCE_FILES = globSync('frontend/src/**/*.{ts,tsx}');
const LITERAL_RE = /<(HelpIcon|InfoIcon|ReferenceIcon)\s+[^>]*targetKey=["']([^"']+)["']/g;

const literals = new Set();
for (const file of SOURCE_FILES) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(LITERAL_RE)) {
    const [, kind, key] = m;
    literals.add(`${kind.replace('Icon', '').toLowerCase()}:${key}`);
  }
}

const docsBase = process.env.VITE_DOCS_BASE_URL ?? readFromPackageJsonOrEnv();
const registry = await fetch(`${docsBase}/registry.json`).then(r => r.json());

const missing = [];
for (const lit of literals) {
  const [kind, key] = lit.split(':');
  if (!registry[kind]?.[key]) missing.push(lit);
}

if (missing.length) {
  console.error('Missing registry entries:', missing);
  process.exit(1);
}
```

Run as a GitHub Action step on every PR.

---

## Migration checklist

Tick as each task lands:

### 3.10A — loader (app repo)

- [ ] Add `VITE_DOCS_BASE_URL` env var + Vite type augmentation.
- [ ] Create `bundledRegistry.ts` with chosen essentials.
- [ ] Create `registryStore.ts` (Zustand).
- [ ] Create `remoteRegistry.ts` (SWR + cache).
- [ ] Create `getDocTarget.ts` accessor.
- [ ] Trim `tutorialRegistry.ts` / `infoRegistry.ts` / `referenceRegistry.ts` to re-exports.
- [ ] Wire `loadRemoteRegistry()` into App startup.
- [ ] Update `DocumentView.resolveDocUrl` for remote-prefixed paths.
- [ ] Unit tests for `getDocTarget` + cache behaviour.
- [ ] Manual smoke against a local mock docs server.
- [ ] Verify existing test suite still green (mock paths updated as needed).

### 3.10B — content move (docs repo + app repo)

- [ ] Set up `ldaca-docs` repo with current tutorial markdown.
- [ ] Add `build-registry.mjs` script (or hand-maintain `registry.json`).
- [ ] Cut `v0.3` branch matching current app minor version.
- [ ] Configure GitHub Pages with per-branch publish.
- [ ] Set `VITE_DOCS_BASE_URL` in app `.env`.
- [ ] Delete non-essential `public/tutorials/*.md` from app.
- [ ] Confirm bundle-size delta.
- [ ] Spot-check every help icon in the app.

### 3.10C — versioned deployment (docs repo)

- [ ] GitHub Actions workflow for per-branch publishing.
- [ ] EOL banner mechanism in app (reads `meta.eolDate` from registry).

### 3.10D — drift CI (app repo)

- [ ] `scripts/check-docs-drift.mjs` (or similar).
- [ ] GitHub Action step on every PR.

---

## Notes for future revisions

- **GIF/video support**: when adding these, host directly in the docs
  repo's `assets/` and reference via absolute URLs in markdown. No
  bundling concerns.
- **i18n**: if/when localised docs are needed, branch path becomes
  `/v0.3/en/registry.json` etc. The base URL gains a locale segment;
  the loader picks it up from a runtime locale setting.
- **Hot-reload in dev**: a Vite plugin could watch the local docs
  checkout and proxy fetches to it. Not on the critical path.
- **Anchor naming**: anchors in markdown use the `<a id="help-...">`
  convention today. The registry's `anchor` field strips the
  `help-` prefix. Keep this contract.

---

## When NOT to start this

- If doc updates are infrequent (less than monthly) and bundle size
  isn't pinching, the current state is fine. The 466-LoC inline
  registry is mildly ugly but not paying significant operational cost.
- If GIF/video support isn't coming in the next quarter, 3.10B can
  wait indefinitely. 3.10A alone gives most of the benefit (the
  structural decoupling) and is a cheap drop-in.

The trigger to start: the first time you want to push a doc fix and
realise you'd have to ship an app release for it.
