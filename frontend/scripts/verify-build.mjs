#!/usr/bin/env node
/** Verifies that distributable frontend assets contain no fixed local API URL. */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BUILD_DIR = resolve(SCRIPT_DIR, '..', 'build');
const TEXT_ASSET_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.map',
  '.mjs',
  '.svg',
  '.txt',
  '.webmanifest',
]);
const FORBIDDEN_LOCAL_API_BASE = /https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/api\b/g;

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await walk(path)));
    else paths.push(path);
  }
  return paths;
}

/** Returns emitted text assets containing a complete local backend API URL. */
export async function findForbiddenLocalApiBases(buildDirectory) {
  const offenders = [];
  for (const path of await walk(buildDirectory)) {
    if (!TEXT_ASSET_EXTENSIONS.has(extname(path).toLowerCase())) continue;
    const contents = await readFile(path, 'utf8');
    FORBIDDEN_LOCAL_API_BASE.lastIndex = 0;
    if (FORBIDDEN_LOCAL_API_BASE.test(contents)) {
      offenders.push(relative(buildDirectory, path));
    }
  }
  return offenders;
}

export async function verifyFrontendBuild(buildDirectory = DEFAULT_BUILD_DIR) {
  const offenders = await findForbiddenLocalApiBases(buildDirectory);
  if (offenders.length > 0) {
    throw new Error(
      `Frontend build contains a fixed local backend API URL: ${offenders.join(', ')}`,
    );
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  await verifyFrontendBuild();
  console.log('Frontend build backend-location contract passed.');
}
