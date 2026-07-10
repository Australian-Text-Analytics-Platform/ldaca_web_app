#!/usr/bin/env node
/** Verifies registered versions, the Tauri lock entry, and optional release tag. */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VERSION_TARGETS, versionFromReleaseTag } from './version-targets.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tagFlagIndex = process.argv.indexOf('--tag');
const releaseTag = tagFlagIndex >= 0 ? process.argv[tagFlagIndex + 1] : null;

if (tagFlagIndex >= 0 && releaseTag === undefined) {
    console.error('Usage: node scripts/check-versions.mjs [--tag v<semver>]');
    process.exit(2);
}

const widest = Math.max(...VERSION_TARGETS.map(({ label }) => label.length));
const seen = [];
let missing = false;

for (const target of VERSION_TARGETS) {
    const source = await readFile(resolve(repoRoot, target.path), 'utf8');
    const version = target.extract(source);
    if (!version) {
        console.error(`x ${target.label.padEnd(widest)}  no version field at ${target.path}`);
        missing = true;
        continue;
    }
    seen.push({ label: target.label, version });
    console.log(`  ${target.label.padEnd(widest)}  ${version}`);
}

if (missing) process.exit(2);

const distinct = [...new Set(seen.map(({ version }) => version))];
if (distinct.length !== 1) {
    console.error(`\nVersion drift: ${distinct.join(' / ')}`);
    console.error('Run `pnpm bump-version <semver>` to realign.');
    process.exit(1);
}

try {
    const taggedVersion = versionFromReleaseTag(releaseTag);
    if (taggedVersion && taggedVersion !== distinct[0]) {
        console.error(`\nRelease tag ${releaseTag} does not match version ${distinct[0]}.`);
        process.exit(1);
    }
} catch (error) {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
}

console.log(`\nAll versions match (${distinct[0]}).${releaseTag ? ` Tag ${releaseTag} matches.` : ''}`);
