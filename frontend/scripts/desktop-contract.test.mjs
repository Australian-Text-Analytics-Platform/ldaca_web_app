import { existsSync, readFileSync } from 'node:fs';
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
    const packageJson = JSON.parse(read('frontend/package.json'));

    expect(workflow).toContain("inputs.platform == 'windows'");
    expect(workflow).toContain("inputs.platform == 'macos'");
    expect(workflow).toContain('pnpm prepare:backend-runtime');
    expect(workflow).not.toContain('package_backend_runtime.py');
    expect(workflow).not.toContain('pnpm stage:backend-runtime');
    expect(workflow).not.toContain('build-notes');
    expect(workflow).not.toContain('UV_NO_SOURCES');
    expect(packageJson.scripts['desktop:build:mac']).toContain(
      'pnpm clean:desktop:mac-bundles',
    );
    expect(packageJson.scripts['desktop:build:mac']).toContain(
      '--target aarch64-apple-darwin',
    );
  });

  it('builds signed updater artifacts and delegates publication to the release workflow', () => {
    const buildWorkflow = read('.github/workflows/desktop-build.yml');
    const releaseWorkflow = read('.github/workflows/release.yml');

    for (const action of [
      'actions/checkout@v7.0.1',
      'actions/setup-node@v7.0.0',
      'actions/upload-artifact@v7.0.1',
      'astral-sh/setup-uv@v9.0.0',
    ]) {
      expect(buildWorkflow).toContain(action);
    }
    expect(buildWorkflow).toContain('Apple-Actions/import-codesign-certs@v7.0.0');
    expect(releaseWorkflow).toContain('actions/download-artifact@v8.0.1');
    expect(buildWorkflow).toContain('aarch64-apple-darwin');
    expect(buildWorkflow).toContain('xcrun notarytool submit');
    expect(buildWorkflow).toContain('TAURI_SIGNING_PRIVATE_KEY');
    expect(buildWorkflow).toContain('.app.tar.gz.sig');
    expect(releaseWorkflow).toContain('secrets: inherit');
    expect(releaseWorkflow).toContain('release-assets/latest.json');
    expect(releaseWorkflow).not.toContain('pnpm tauri build');
  });

  it('uses the official Tauri updater contract without legacy update checks', () => {
    const tauri = JSON.parse(read('frontend/src-tauri/tauri.conf.json'));
    const capability = JSON.parse(read('frontend/src-tauri/capabilities/default.json'));
    const cargo = read('frontend/src-tauri/Cargo.toml');
    const packageJson = JSON.parse(read('frontend/package.json'));
    const desktopShell = read('frontend/src-tauri/src/lib.rs');
    const updaterRuntime = read(
      'frontend/src/features/desktop-updater/desktopUpdaterRuntime.ts',
    );

    expect(tauri.bundle.createUpdaterArtifacts).toBe(true);
    expect(tauri.plugins.updater.endpoints).toEqual([
      'https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/releases/latest/download/latest.json',
    ]);
    expect(capability.permissions).toContain('updater:default');
    expect(capability.permissions).toContain('process:allow-restart');
    expect(cargo).toContain('tauri-plugin-updater = "2"');
    expect(cargo).toContain('tauri-plugin-process = "2"');
    expect(packageJson.dependencies).toHaveProperty('@tauri-apps/plugin-updater');
    expect(packageJson.dependencies).toHaveProperty('@tauri-apps/plugin-process');
    expect(capability.windows).toContain('desktop-updater');
    expect(desktopShell).toContain('Check for Updates…');
    expect(desktopShell).toContain('desktop-update-check-requested');
    expect(desktopShell).toContain('WebviewUrl::App("index.html?desktop-updater=1".into())');
    expect(desktopShell).toContain('window.label() == DESKTOP_UPDATER_WINDOW_LABEL');
    expect(updaterRuntime).toContain('check({ timeout: UPDATE_CHECK_TIMEOUT_MS })');
    expect(
      existsSync(
        resolve(repoRoot, 'frontend/src/features/desktop-updater/DesktopUpdaterProvider.tsx'),
      ),
    ).toBe(false);
    expect(existsSync(resolve(repoRoot, '.github/workflows/check-context-docs.yml'))).toBe(false);
    expect(existsSync(resolve(repoRoot, '.github/workflows/check-docs-drift.yml'))).toBe(false);
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

    expect(tauri.build.beforeBuildCommand).toContain('stage-backend-runtime.mjs --validate-only');
    expect(buildScript).toContain('"bundle":{"resources":[]}');
  });
});
