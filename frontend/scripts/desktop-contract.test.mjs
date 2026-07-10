import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const frontendRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(frontendRoot, '..');
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8');

describe('desktop configuration contracts', () => {
  it('uses one strict Tauri development port command', () => {
    const tauri = JSON.parse(read('frontend/src-tauri/tauri.conf.json'));
    const packageJson = JSON.parse(read('frontend/package.json'));

    expect(tauri.build.beforeDevCommand).toBe('pnpm dev:tauri');
    expect(tauri.build.devUrl).toBe('http://127.0.0.1:3001');
    expect(packageJson.scripts['dev:tauri']).toBe('vite --host 0.0.0.0 --port 3001 --strictPort');
  });

  it('makes both desktop workflows call the shared runtime preparation command', () => {
    for (const workflowPath of [
      '.github/workflows/desktop-macos.yml',
      '.github/workflows/desktop-windows.yml',
    ]) {
      const workflow = read(workflowPath);
      expect(workflow).toContain('pnpm prepare:backend-runtime');
      expect(workflow).not.toContain('package_backend_runtime.py');
      expect(workflow).not.toContain('pnpm stage:backend-runtime');
      expect(workflow).not.toContain('build-notes');
    }
  });

  it('keeps retired JavaScript permissions, plugins, and globals absent', () => {
    const capability = read('frontend/src-tauri/capabilities/default.json');
    const cargo = read('frontend/src-tauri/Cargo.toml');
    const main = read('frontend/src-tauri/src/main.rs');

    expect(capability).not.toMatch(/core:(?:window|webview):|http:default/);
    expect(cargo).not.toMatch(/tauri-plugin-http|dotenvy|^serde(?:_json)?\s*=/m);
    expect(main).not.toMatch(/tauri_plugin_http|__BACKEND_PORT__|load_runtime_env/);
  });
});
