#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { cp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { BUNDLED_REGISTRY } from '../src/tutorials/bundledRegistry.ts';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FRONTEND_DIR = resolve(SCRIPT_DIR, '..');
const DEFAULT_TARGET_DIR = resolve(DEFAULT_FRONTEND_DIR, '..', 'ldaca-wordflow-docs');
const CANONICAL_CONTENT_ROOTS = ['tutorials', 'information', 'references'];
const OBSOLETE_CONTENT_ROOTS = ['assets', 'warnings'];

async function assertPublishTarget(targetDir) {
  if (basename(targetDir) !== 'ldaca-wordflow-docs') {
    throw new Error(`Refusing to sync docs to unexpected target: ${targetDir}`);
  }
  for (const requiredPath of ['.git', join('scripts', 'build-registry.mjs')]) {
    try {
      await stat(join(targetDir, requiredPath));
    } catch {
      throw new Error(`Docs publish target is missing ${requiredPath}: ${targetDir}`);
    }
  }
}

/** Mirrors the complete bundled user documentation into its publication repository. */
export async function syncPublishedDocs({
  frontendDir = DEFAULT_FRONTEND_DIR,
  targetDir = DEFAULT_TARGET_DIR,
  generatedDate = new Date().toISOString().slice(0, 10),
  registry = BUNDLED_REGISTRY,
} = {}) {
  await assertPublishTarget(targetDir);
  const packageJson = JSON.parse(await readFile(join(frontendDir, 'package.json'), 'utf8'));
  if (typeof packageJson.version !== 'string' || !packageJson.version) {
    throw new Error('Frontend package version is missing');
  }

  for (const root of [...CANONICAL_CONTENT_ROOTS, ...OBSOLETE_CONTENT_ROOTS]) {
    await rm(join(targetDir, root), { recursive: true, force: true });
  }
  for (const root of CANONICAL_CONTENT_ROOTS) {
    await cp(join(frontendDir, 'public', root), join(targetDir, root), { recursive: true });
  }

  const publishedRegistry = {
    meta: { version: packageJson.version, generated: generatedDate },
    tutorial: registry.tutorial,
    info: registry.info,
    reference: registry.reference,
  };
  await writeFile(join(targetDir, 'registry.json'), `${JSON.stringify(publishedRegistry, null, 2)}\n`);
}

/** Runs the mirror repository's own registry-to-Markdown validator. */
export function validatePublishedDocs(targetDir = DEFAULT_TARGET_DIR) {
  execFileSync(process.execPath, ['scripts/build-registry.mjs'], {
    cwd: targetDir,
    stdio: 'inherit',
  });
}

async function run() {
  await syncPublishedDocs();
  validatePublishedDocs();
  console.log(`Published docs mirror updated at ${DEFAULT_TARGET_DIR}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await run();
}
