import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { verifyFrontendBuild } from './verify-build.mjs';

async function withBuildFixture(run) {
  const buildDirectory = await mkdtemp(path.join(os.tmpdir(), 'wordflow-frontend-build-'));
  try {
    await mkdir(path.join(buildDirectory, 'assets'));
    await writeFile(path.join(buildDirectory, 'index.html'), '<div id="root"></div>');
    await writeFile(path.join(buildDirectory, 'updater.html'), '<div id="root"></div>');
    await run(buildDirectory);
  } finally {
    await rm(buildDirectory, { force: true, recursive: true });
  }
}

test('accepts runtime and dynamically constructed development backend locations', async () => {
  await withBuildFixture(async (buildDirectory) => {
    await writeFile(
      path.join(buildDirectory, 'assets', 'app.js'),
      'const basePath = window.__WORDFLOW_CONFIG__.basePath; const dev = `http://${host}:${port}/api`;',
    );

    await verifyFrontendBuild(buildDirectory);
  });
});

test('requires both application HTML entry points', async () => {
  await withBuildFixture(async (buildDirectory) => {
    await rm(path.join(buildDirectory, 'updater.html'));

    await assert.rejects(
      verifyFrontendBuild(buildDirectory),
      /missing required entry point: updater\.html/,
    );
  });
});

test('rejects complete localhost and loopback API URLs', async () => {
  await withBuildFixture(async (buildDirectory) => {
    await writeFile(
      path.join(buildDirectory, 'assets', 'app.js'),
      'const first = "http://localhost:8001/api";',
    );
    await writeFile(
      path.join(buildDirectory, 'index.html'),
      '<meta content="https://127.0.0.1:9000/api/v1">',
    );

    await assert.rejects(
      verifyFrontendBuild(buildDirectory),
      /assets\/app\.js, index\.html/,
    );
  });
});
