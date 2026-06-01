#!/usr/bin/env node
/**
 * Refresh the bundled docs in `frontend/public/` from the remote docs site.
 *
 * Why
 * ---
 * The desktop (Tauri) build ships the docs that live in `public/` as its
 * offline floor (vite copies them into the build → deploy-frontend-to-backend
 * archives them into the backend's `resources/frontend/build` → packaged into
 * the wheel). Without this step that floor only changes when someone manually
 * re-syncs `public/` and commits it, so a fresh desktop install can show docs
 * frozen at whenever `public/` was last touched. Run as part of the desktop
 * bundle build, this pulls the latest version-pinned docs so the bundle's
 * offline floor is current as of build time. (At runtime the backend's
 * docs_sync still keeps online users fresher; this is the offline/first-paint
 * floor.)
 *
 * Behaviour
 * ---------
 * - Mirrors markdown (registry entries + index pages) + their referenced image
 *   assets into `public/`, matching the backend `core/docs_sync.py` logic.
 * - Version-checked: skips when the remote `meta.version` matches the marker
 *   `public/.docs-bundle-version` (pass `--force` to override).
 * - Resilient: if the remote is unreachable it logs and exits 0, leaving the
 *   committed docs in place — offline builds still work. Individual file
 *   failures keep that file's existing committed copy.
 * - `--dry-run`: fetch + report what would change, write nothing.
 *
 * Config: docs base URL from $VITE_DOCS_BASE_URL, else `frontend/.env`, else the
 * v0.5 default. Must match the minor-version path the app ships against.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendDir = resolve(scriptDir, '..');
const publicDir = resolve(frontendDir, 'public');
const VERSION_MARKER = resolve(publicDir, '.docs-bundle-version');

const DEFAULT_BASE =
  'https://australian-text-analytics-platform.github.io/ldaca-wordflow-docs/v0.5';

const INDEX_FILES = [
  'tutorials/index.md',
  'information/index.md',
  'references/index.md',
];
// Forward-compat placeholder (see core/docs_sync.py): may not be published yet,
// so a 404 here is expected and silent.
const OPTIONAL_FILES = ['warnings/index.md'];

const MD_IMG_RE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+[^)]*)?\)/g;
const HTML_IMG_RE = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const force = args.has('--force');

function log(msg) {
  console.log(`[sync-bundled-docs] ${msg}`);
}

async function resolveBaseUrl() {
  if (process.env.VITE_DOCS_BASE_URL?.trim()) {
    return process.env.VITE_DOCS_BASE_URL.trim();
  }
  const envPath = resolve(frontendDir, '.env');
  if (existsSync(envPath)) {
    const text = await readFile(envPath, 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*VITE_DOCS_BASE_URL\s*=\s*(.+)\s*$/);
      if (m) {
        const val = m[1].trim().replace(/^["']|["']$/g, '');
        if (val) return val;
      }
    }
  }
  return DEFAULT_BASE;
}

function normalizeRel(rel) {
  const stack = [];
  for (const seg of rel.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      stack.pop();
      continue;
    }
    stack.push(seg);
  }
  return stack.join('/');
}

function collectImageRefs(markdown) {
  const refs = new Set();
  for (const m of markdown.matchAll(MD_IMG_RE)) refs.add(m[1]);
  for (const m of markdown.matchAll(HTML_IMG_RE)) refs.add(m[1]);
  const out = new Set();
  for (let ref of refs) {
    ref = ref.trim();
    if (
      !ref ||
      /^(https?:)?\/\//i.test(ref) ||
      ref.startsWith('data:') ||
      ref.startsWith('blob:') ||
      ref.startsWith('mailto:') ||
      ref.startsWith('#')
    ) {
      continue;
    }
    const norm = normalizeRel(ref.replace(/^\/+/, ''));
    if (norm) out.add(norm);
  }
  return out;
}

function collectMarkdownFiles(registry) {
  const files = new Set(INDEX_FILES);
  for (const section of ['tutorial', 'warning', 'info', 'reference']) {
    const entries = registry?.[section];
    if (!entries || typeof entries !== 'object') continue;
    for (const entry of Object.values(entries)) {
      const file = entry?.file;
      if (typeof file === 'string' && file.endsWith('.md')) {
        files.add(normalizeRel(file));
      }
    }
  }
  return files;
}

async function fetchBytes(url, { optional = false } = {}) {
  try {
    const resp = await fetch(url, { cache: 'no-store' });
    if (resp.status === 404 && optional) return null;
    if (!resp.ok) {
      if (!optional) log(`WARN could not download ${url} (HTTP ${resp.status})`);
      return null;
    }
    return Buffer.from(await resp.arrayBuffer());
  } catch (err) {
    if (!optional) log(`WARN could not download ${url} (${err.message})`);
    return null;
  }
}

async function writeInto(rel, bytes) {
  const dest = resolve(publicDir, rel);
  if (!dest.startsWith(publicDir)) return; // traversal guard
  if (dryRun) return;
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, bytes);
}

async function main() {
  const base = (await resolveBaseUrl()).replace(/\/+$/, '');
  log(`docs base: ${base}${dryRun ? ' (dry-run)' : ''}`);

  // 1. Registry → version check.
  const registryBytes = await fetchBytes(`${base}/registry.json`);
  if (!registryBytes) {
    log('remote docs unreachable; keeping committed bundled docs');
    return; // exit 0 — never fail the build over this
  }
  let registry;
  try {
    registry = JSON.parse(registryBytes.toString('utf8'));
  } catch {
    log('registry.json was not valid JSON; keeping committed bundled docs');
    return;
  }
  const remoteVersion = registry?.meta?.version?.trim?.() || `len:${registryBytes.length}`;
  const cachedVersion = existsSync(VERSION_MARKER)
    ? (await readFile(VERSION_MARKER, 'utf8')).trim()
    : null;
  if (!force && cachedVersion === remoteVersion) {
    log(`bundled docs already at version ${remoteVersion}; nothing to do`);
    return;
  }

  // 2. Mirror markdown + referenced assets.
  log(`refreshing bundled docs to version ${remoteVersion}`);
  const mdFiles = [...collectMarkdownFiles(registry)].sort();
  const assets = new Set();
  let mdCount = 0;
  for (const rel of mdFiles) {
    const data = await fetchBytes(`${base}/${rel}`);
    if (!data) continue;
    await writeInto(rel, data);
    mdCount += 1;
    for (const a of collectImageRefs(data.toString('utf8'))) assets.add(a);
  }
  for (const rel of OPTIONAL_FILES) {
    const data = await fetchBytes(`${base}/${rel}`, { optional: true });
    if (!data) continue;
    await writeInto(rel, data);
    mdCount += 1;
    for (const a of collectImageRefs(data.toString('utf8'))) assets.add(a);
  }
  let assetCount = 0;
  for (const rel of [...assets].sort()) {
    const data = await fetchBytes(`${base}/${rel}`);
    if (!data) continue;
    await writeInto(rel, data);
    assetCount += 1;
  }

  if (!dryRun) await writeFile(VERSION_MARKER, remoteVersion, 'utf8');
  log(
    `${dryRun ? 'would refresh' : 'refreshed'} ${mdCount} markdown + ${assetCount} asset file(s) ` +
      `(version ${remoteVersion})`,
  );
}

main().catch((err) => {
  // Build resilience: a sync failure must never break the bundle build.
  log(`unexpected error, keeping committed bundled docs: ${err.message}`);
  process.exit(0);
});
