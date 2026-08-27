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
    const viteConfig = read('frontend/vite.config.ts');

    expect(tauri.build.beforeDevCommand).toBe('pnpm dev:tauri');
    expect(tauri.build.devUrl).toBe('http://127.0.0.1:3001');
    expect(packageJson.scripts['dev:tauri']).toBe('vite --mode tauri');
    expect(viteConfig).toContain("port: mode === 'tauri' ? 3001");
    expect(viteConfig).toContain("host: mode === 'tauri' ? '127.0.0.1' : '0.0.0.0'");
    expect(viteConfig).toContain("strictPort: mode === 'tauri'");
    expect(viteConfig).toContain("ignored: ['**/src-tauri/**']");
    expect(viteConfig).not.toContain('TAURI_DEV_HOST');
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
    expect(workflow).toContain('pnpm tauri:build');
    expect(workflow).not.toContain('pnpm tauri build');
    expect(workflow).toContain(
      'pnpm exec vitest run scripts/desktop-contract.test.mjs src/lib/download.test.ts',
    );
    expect(packageJson.scripts['tauri:build']).toBe(
      'tauri build --config src-tauri/tauri.bundle.conf.json',
    );
    expect(packageJson.scripts['desktop:dev']).toContain('tauri dev --features dev-runtime');
    expect(packageJson.scripts['desktop:build:mac']).toContain('pnpm clean:desktop:mac-bundles');
    expect(packageJson.scripts['desktop:build:mac']).toContain('--target aarch64-apple-darwin');
  });

  it('builds signed updater artifacts and delegates publication to the manual desktop workflow', () => {
    const buildWorkflow = read('.github/workflows/desktop-build.yml');
    const releaseWorkflow = read('.github/workflows/desktop-release.yml');

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
    expect(buildWorkflow).toContain('DMG notarization failed after $attempt attempts');
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
    const nativeUpdater = read('frontend/src-tauri/src/desktop_updater.rs');

    expect(tauri.bundle.createUpdaterArtifacts).toBe(true);
    expect(tauri.plugins.updater.endpoints).toEqual([
      'https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/releases/latest/download/latest.json',
    ]);
    expect(capability.permissions).not.toContain('updater:default');
    expect(capability.permissions).not.toContain('process:allow-restart');
    expect(cargo).toContain('tauri-plugin-updater = "2"');
    expect(cargo).not.toContain('tauri-plugin-process = "2"');
    expect(packageJson.dependencies).not.toHaveProperty('@tauri-apps/plugin-updater');
    expect(packageJson.dependencies).not.toHaveProperty('@tauri-apps/plugin-process');
    expect(capability.windows).toEqual(['main']);
    expect(desktopShell).toContain('Check for Updates…');
    expect(desktopShell).toContain('desktop_updater::check(app_handle.clone())');
    expect(desktopShell).not.toContain('desktop_update_check_requested');
    expect(desktopShell).not.toContain('desktop-updater=1');
    expect(nativeUpdater).toContain('.timeout(CHECK_TIMEOUT)');
    expect(nativeUpdater).toContain('.download_and_install(');
    expect(nativeUpdater).toContain('app.restart()');
    expect(nativeUpdater).toContain('MessageDialogButtons::OkCancelCustom');
    expect(
      existsSync(
        resolve(repoRoot, 'frontend/src/features/desktop-updater/DesktopUpdaterWindow.tsx'),
      ),
    ).toBe(false);
    expect(
      existsSync(
        resolve(repoRoot, 'frontend/src/features/desktop-updater/desktopUpdaterRuntime.ts'),
      ),
    ).toBe(false);
    expect(
      existsSync(
        resolve(repoRoot, 'frontend/src/features/desktop-updater/DesktopUpdaterProvider.tsx'),
      ),
    ).toBe(false);
    expect(existsSync(resolve(repoRoot, '.github/workflows/check-context-docs.yml'))).toBe(false);
    expect(existsSync(resolve(repoRoot, '.github/workflows/check-docs-drift.yml'))).toBe(false);
  });

  it('uses Tauri-native page zoom at the platform default scale', () => {
    const tauri = JSON.parse(read('frontend/src-tauri/tauri.conf.json'));
    const capability = JSON.parse(read('frontend/src-tauri/capabilities/default.json'));
    const desktopShell = read('frontend/src-tauri/src/lib.rs');
    const [mainWindow] = tauri.app.windows;
    const explicitWindowPermissions = capability.permissions.filter(
      (permission) =>
        permission.startsWith('core:window:') || permission.startsWith('core:webview:'),
    );

    expect(tauri.app.windows).toHaveLength(1);
    expect(mainWindow.zoomHotkeysEnabled).toBe(true);
    expect(capability.windows).toEqual(['main']);
    expect(explicitWindowPermissions).toEqual(['core:webview:allow-set-webview-zoom']);
    expect(desktopShell).not.toMatch(/\.set_zoom\s*\(/);
  });

  it('discovers the desktop backend through IPC without page-load injection', () => {
    const desktopShell = read('frontend/src-tauri/src/lib.rs');
    const backendEnvironment = read('frontend/src/lib/backend/env.ts');

    expect(desktopShell).toContain('get_backend_url');
    expect(desktopShell).not.toContain('window.__BACKEND_URL__');
    expect(desktopShell).not.toMatch(/\.eval\s*\(/);
    expect(desktopShell).not.toContain('on_page_load');
    expect(backendEnvironment).not.toContain('http://127.0.0.1:${backendPort}/api');
  });

  it('keeps desktop downloads and filesystem ownership behind Rust commands', () => {
    const capability = JSON.parse(read('frontend/src-tauri/capabilities/default.json'));
    const cargo = read('frontend/src-tauri/Cargo.toml');
    const packageJson = JSON.parse(read('frontend/package.json'));
    const desktopShell = read('frontend/src-tauri/src/lib.rs');
    const nativeDownloads = read('frontend/src-tauri/src/download.rs');
    const webDownloads = read('frontend/src/lib/download.ts');

    expect(desktopShell).toContain('download::download_backend_to_downloads');
    expect(desktopShell).toContain('download::export_data_blocks_to_downloads');
    expect(desktopShell).toContain('download::save_bytes_to_downloads');
    expect(nativeDownloads).not.toContain('method: String');
    expect(webDownloads).not.toContain("@tauri-apps/plugin-fs");
    expect(packageJson.dependencies).not.toHaveProperty('@tauri-apps/plugin-fs');
    expect(cargo).not.toMatch(/^tauri-plugin-fs\s*=/m);
    expect(desktopShell).not.toContain('tauri_plugin_fs::init');
    expect(capability.permissions.some((permission) => permission.startsWith('fs:'))).toBe(false);
  });

  it('uses least-privilege desktop capabilities and a production-only strict CSP', () => {
    const tauri = JSON.parse(read('frontend/src-tauri/tauri.conf.json'));
    const capability = JSON.parse(read('frontend/src-tauri/capabilities/default.json'));

    expect(capability.permissions).toEqual([
      'core:default',
      'core:webview:allow-set-webview-zoom',
      'opener:allow-reveal-item-in-dir',
      'dialog:allow-open',
    ]);
    expect(tauri.app.security.csp).not.toContain("'unsafe-eval'");
    expect(tauri.app.security.csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(tauri.app.security.devCsp).toContain("'unsafe-eval'");
    expect(tauri.app.security.devCsp).toContain('ws://127.0.0.1:3001');
  });

  it('keeps backend startup off the Tauri setup and main threads', () => {
    const desktopShell = read('frontend/src-tauri/src/lib.rs');
    const supervisor = read('frontend/src-tauri/src/supervisor.rs');

    expect(desktopShell).toContain('supervisor::start(app.handle().clone())');
    expect(desktopShell).not.toContain('BackendProcess::spawn');
    expect(desktopShell).not.toContain('wait_until_live');
    expect(supervisor).toContain('tauri::async_runtime::spawn_blocking');
    expect(supervisor).toContain('run_on_main_thread');
    expect(supervisor).toContain('startup_cancelled');
  });

  it('keeps retired JavaScript permissions, plugins, and globals absent', () => {
    const capability = JSON.parse(read('frontend/src-tauri/capabilities/default.json'));
    const cargo = read('frontend/src-tauri/Cargo.toml');
    const main = read('frontend/src-tauri/src/main.rs');

    expect(capability.permissions).not.toContain('http:default');
    expect(cargo).not.toMatch(/tauri-plugin-http|dotenvy/);
    expect(main).not.toMatch(/tauri_plugin_http|__BACKEND_PORT__|load_runtime_env/);
  });

  it('uses one explicit runtime for development and one bundled runtime for packaging', () => {
    const tauri = JSON.parse(read('frontend/src-tauri/tauri.conf.json'));
    const bundleConfig = JSON.parse(read('frontend/src-tauri/tauri.bundle.conf.json'));
    const buildScript = read('frontend/src-tauri/build.rs');
    const cargo = read('frontend/src-tauri/Cargo.toml');
    const runtime = read('frontend/src-tauri/src/runtime.rs');
    const backendProcess = read('frontend/src-tauri/src/backend_process.rs');

    expect(tauri.build.beforeBuildCommand).toContain('stage-backend-runtime.mjs --validate-only');
    expect(tauri.bundle).not.toHaveProperty('resources');
    expect(bundleConfig).toEqual({ bundle: { resources: ['backend-runtime'] } });
    expect(cargo).toContain('dev-runtime = []');
    expect(buildScript).toContain('cargo:rustc-env=LDACA_UV_LOCK_SHA256=');
    expect(buildScript).not.toContain('TAURI_CONFIG');
    expect(runtime).toContain('cfg!(feature = "dev-runtime")');
    expect(runtime).toContain('/backend-runtime');
    expect(runtime).not.toContain('current_exe');
    expect(runtime).not.toContain('LDACA_BACKEND_RUNTIME');
    expect(backendProcess).not.toContain('LDACA_BACKEND_RUNTIME');
  });
});
