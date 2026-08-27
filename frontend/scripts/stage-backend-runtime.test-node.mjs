import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  expectedBackendVersion,
  expectedUvLockSha256,
  resolveRuntimeLayout,
  stageBackendRuntime,
} from './stage-backend-runtime.mjs';

function createRuntime(root) {
  const paths = {
    python_executable: 'managed-python/cpython-test/bin/python3',
    python_home: 'managed-python/cpython-test',
    site_packages: 'python/lib/python3.14/site-packages',
  };
  for (const relativePath of Object.values(paths)) {
    const absolutePath = path.join(root, relativePath);
    if (path.extname(absolutePath) || absolutePath.endsWith('python3')) {
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, 'fixture');
    } else {
      fs.mkdirSync(absolutePath, { recursive: true });
    }
  }
  fs.writeFileSync(
    path.join(root, 'runtime-manifest.json'),
    JSON.stringify({
      schema_version: 3,
      backend_version: expectedBackendVersion,
      target_os: { darwin: 'macos', win32: 'windows', linux: 'linux' }[process.platform],
      target_arch: { arm64: 'aarch64', x64: 'x86_64' }[process.arch],
      python_selector: '3.14',
      python_version: '3.14.0',
      python_free_threaded: false,
      uv_lock_sha256: expectedUvLockSha256,
      ...paths,
    }),
  );
}

test('relative runtime layout remains valid after relocation', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-layout-'));
  const source = path.join(temp, 'source', 'backend-runtime');
  const target = path.join(temp, 'relocated', 'backend-runtime');
  createRuntime(source);

  stageBackendRuntime({ sourceRuntime: source, targetRuntime: target, platform: 'darwin' });

  const layout = resolveRuntimeLayout(target);
  assert.equal(layout.python_executable, path.join(target, 'managed-python/cpython-test/bin/python3'));
  assert.equal(
    fs.readFileSync(path.join(source, 'runtime-manifest.json'), 'utf8'),
    fs.readFileSync(path.join(target, 'runtime-manifest.json'), 'utf8'),
  );
});

test('runtime layout rejects corrupt, absolute, escaping, and missing paths', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-invalid-'));
  const root = path.join(temp, 'runtime');
  createRuntime(root);

  fs.writeFileSync(path.join(root, 'runtime-manifest.json'), '{');
  assert.throws(() => resolveRuntimeLayout(root), /Cannot read runtime manifest/);

  createRuntime(root);
  const manifestPath = path.join(root, 'runtime-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.python_home = path.join(temp, 'absolute');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => resolveRuntimeLayout(root), /portable relative path/);

  manifest.python_home = '../outside';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => resolveRuntimeLayout(root), /portable relative path/);

  manifest.python_home = 'managed-python/missing';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => resolveRuntimeLayout(root), /does not exist/);
});

test('runtime layout rejects free-threaded Python', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-abi-'));
  const root = path.join(temp, 'runtime');
  createRuntime(root);

  const manifestPath = path.join(root, 'runtime-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.python_free_threaded = true;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));

  assert.throws(() => resolveRuntimeLayout(root), /provenance is invalid/);
});

test('runtime layout rejects a stale backend version or lockfile', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-provenance-'));
  const root = path.join(temp, 'runtime');
  createRuntime(root);

  const manifestPath = path.join(root, 'runtime-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.backend_version = '0.0.0-stale';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => resolveRuntimeLayout(root), /provenance is invalid/);

  createRuntime(root);
  const currentManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  currentManifest.uv_lock_sha256 = 'a'.repeat(64);
  fs.writeFileSync(manifestPath, JSON.stringify(currentManifest));
  assert.throws(() => resolveRuntimeLayout(root), /provenance is invalid/);
});

test('staging a replacement removes files retained from the previous runtime', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-replacement-'));
  const source = path.join(temp, 'source', 'backend-runtime');
  const target = path.join(temp, 'staged', 'backend-runtime');
  createRuntime(source);

  stageBackendRuntime({ sourceRuntime: source, targetRuntime: target, platform: 'darwin' });
  const staleDistribution = path.join(
    target,
    'python/lib/python3.14/site-packages/ldaca_wordflow-previous.dist-info',
  );
  fs.mkdirSync(staleDistribution, { recursive: true });
  fs.writeFileSync(path.join(staleDistribution, 'METADATA'), 'stale');

  stageBackendRuntime({ sourceRuntime: source, targetRuntime: target, platform: 'darwin' });

  assert.equal(fs.existsSync(staleDistribution), false);
  assert.doesNotThrow(() => resolveRuntimeLayout(target));
});
