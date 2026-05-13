#!/usr/bin/env node
// Drift-detection for <HelpIcon/InfoIcon/ReferenceIcon targetKey="…">
// literals across the source. Fails the build if any literal has no
// matching registry entry.
//
// Today we check against the in-bundle registry only — the bundled set
// still mirrors the full registry. Once VITE_DOCS_BASE_URL is wired in
// CI, fetch the deployed registry.json and check there too.
//
// Usage:  node frontend/scripts/check-docs-drift.mjs

import { readFile } from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUNDLED_REGISTRY } from '../src/tutorials/bundledRegistry.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(__dirname, '..', 'src');

const COMPONENT_TO_KIND = {
  HelpIcon: 'tutorial',
  InfoIcon: 'info',
  ReferenceIcon: 'reference',
};

const LITERAL_RE = new RegExp(
  `<(${Object.keys(COMPONENT_TO_KIND).join('|')})\\s+[^>]*targetKey=["']([^"']+)["']`,
  'g',
);

const walk = (dir, acc = []) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) acc.push(full);
  }
  return acc;
};

const files = walk(SRC_DIR);
const literals = [];

for (const file of files) {
  const text = await readFile(file, 'utf8');
  for (const m of text.matchAll(LITERAL_RE)) {
    literals.push({ file, component: m[1], key: m[2] });
  }
}

const missing = [];
const seen = new Set();
for (const lit of literals) {
  const kind = COMPONENT_TO_KIND[lit.component];
  if (!BUNDLED_REGISTRY[kind][lit.key]) {
    missing.push(lit);
  }
  seen.add(`${kind}:${lit.key}`);
}

if (missing.length) {
  console.error('Found <Icon targetKey="…"> literals with no registry entry:\n');
  for (const m of missing) {
    const relPath = m.file.replace(`${resolve(__dirname, '..')}/`, '');
    console.error(`  ${relPath}: ${m.component} targetKey="${m.key}"`);
  }
  process.exit(1);
}

// Soft warning: registry keys that no literal call site uses. These are
// fine if accessed dynamically (e.g. HintsController), but worth knowing.
const unusedBundled = [];
for (const [kind, section] of Object.entries(BUNDLED_REGISTRY)) {
  for (const key of Object.keys(section)) {
    if (!seen.has(`${kind}:${key}`)) unusedBundled.push(`${kind}:${key}`);
  }
}
if (unusedBundled.length) {
  console.log(
    `\nNote: ${unusedBundled.length} registry entries have no literal call site ` +
      `(may be referenced dynamically, e.g. via HintsController).`,
  );
}

console.log(`Drift check OK — ${literals.length} icon literals all resolve.`);
