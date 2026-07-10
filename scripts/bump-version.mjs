#!/usr/bin/env node
/** Updates every version target from the shared release registry. */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SEMVER, VERSION_TARGETS } from './version-targets.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requestedVersion = process.argv[2];

if (!requestedVersion || !SEMVER.test(requestedVersion)) {
    console.error('Usage: node scripts/bump-version.mjs <semver>');
    process.exit(1);
}

const widest = Math.max(...VERSION_TARGETS.map(({ label }) => label.length));
let missing = false;

for (const target of VERSION_TARGETS) {
    const fullPath = resolve(repoRoot, target.path);
    const source = await readFile(fullPath, 'utf8');
    const previous = target.extract(source);
    const next = target.replace(source, requestedVersion);
    if (!previous || (next === source && previous !== requestedVersion)) {
        console.error(`x ${target.label.padEnd(widest)}  no version field matched`);
        missing = true;
        continue;
    }
    if (next === source) {
        console.log(`= ${target.label.padEnd(widest)}  already ${requestedVersion}`);
        continue;
    }
    await writeFile(fullPath, next);
    console.log(`+ ${target.label.padEnd(widest)}  ${previous} -> ${requestedVersion}`);
}

if (missing) process.exit(2);

console.log('\nNext: run `pnpm deploy_frontend_to_backend`, then `pnpm check-versions`.');
