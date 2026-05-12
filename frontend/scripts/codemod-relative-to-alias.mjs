#!/usr/bin/env node
// Convert deep-relative imports (>=3 levels of ../) to the @/ alias.
// Skips imports that resolve outside src/ for safety.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(__dirname, '..');
const SRC = path.join(FRONTEND, 'src');

// Match `from '...'`, `from "..."`, `import('...')`, `import("...")`,
// and `import '...'` / `import "..."` side-effect imports.
const IMPORT_RE = /(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(['"])((?:\.\.\/){3,}[^'"]+)\2/g;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(entry.name)) yield full;
  }
}

let updated = 0;
let conversions = 0;
for (const file of walk(SRC)) {
  const dir = path.dirname(file);
  const original = fs.readFileSync(file, 'utf8');

  const next = original.replace(IMPORT_RE, (match, prefix, quote, importPath) => {
    const abs = path.resolve(dir, importPath);
    if (!abs.startsWith(SRC + path.sep)) {
      return match; // resolves outside src/, leave alone
    }
    const rel = path.relative(SRC, abs).split(path.sep).join('/');
    conversions += 1;
    return `${prefix}${quote}@/${rel}${quote}`;
  });

  if (next !== original) {
    fs.writeFileSync(file, next);
    updated += 1;
  }
}

console.log(`Updated ${updated} files; converted ${conversions} imports.`);
