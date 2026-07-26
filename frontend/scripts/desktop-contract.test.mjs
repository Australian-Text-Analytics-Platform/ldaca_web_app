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

  it('makes both shared desktop build branches use runtime preparation', () => {
    const workflow = read('.github/workflows/desktop-build.yml');

    expect(workflow).toContain("inputs.platform == 'windows'");
    expect(workflow).toContain("inputs.platform == 'macos'");
    expect(workflow).toContain('pnpm prepare:backend-runtime');
    expect(workflow).not.toContain('package_backend_runtime.py');
    expect(workflow).not.toContain('pnpm stage:backend-runtime');
    expect(workflow).not.toContain('build-notes');
  });

  it('builds the selected workflow branch unless a release ref is overridden', () => {
    const workflow = read('.github/workflows/release.yml');

    expect(workflow).toContain('default: ""');
    expect(workflow).not.toContain('default: "dev"');
    expect(workflow.match(/inputs\.ref \|\| github\.ref }}/g)).toHaveLength(2);
  });

  it('keeps retired JavaScript permissions, plugins, and globals absent', () => {
    const capability = read('frontend/src-tauri/capabilities/default.json');
    const cargo = read('frontend/src-tauri/Cargo.toml');
    const main = read('frontend/src-tauri/src/main.rs');

    expect(capability).not.toMatch(/core:(?:window|webview):|http:default/);
    expect(cargo).not.toMatch(/tauri-plugin-http|dotenvy/);
    expect(main).not.toMatch(/tauri_plugin_http|__BACKEND_PORT__|load_runtime_env/);
  });

  it('gates packaging on a valid staged runtime without coupling source checks', () => {
    const tauri = JSON.parse(read('frontend/src-tauri/tauri.conf.json'));
    const buildScript = read('frontend/src-tauri/build.rs');

    expect(tauri.build.beforeBuildCommand).toContain(
      'stage-backend-runtime.mjs --validate-only',
    );
    expect(buildScript).toContain('"bundle":{"resources":[]}');
  });
});
