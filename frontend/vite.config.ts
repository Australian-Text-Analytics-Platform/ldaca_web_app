/// <reference types="vitest/config" />

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/postcss';

const frontendRootDir = path.dirname(fileURLToPath(import.meta.url));

const packageVersion = (() => {
  try {
    const packageJson: unknown = JSON.parse(
      readFileSync(path.join(frontendRootDir, 'package.json'), 'utf-8'),
    ) as unknown;
    return packageJson &&
      typeof packageJson === 'object' &&
      'version' in packageJson &&
      typeof packageJson.version === 'string'
      ? packageJson.version
      : '';
  } catch {
    return '';
  }
})();

const gitShortSha = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: frontendRootDir, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
})();

process.env.VITE_APP_VERSION ??= packageVersion;
process.env.VITE_APP_BUILD ??= gitShortSha;
// Build date in DD/MMM/YYYY form — matches the human-readable footer in
// the references panel and lets the markdown there reference
// `{{BUILD_DATE}}` instead of carrying a hand-edited date.
process.env.VITE_APP_BUILD_DATE ??= (() => {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[now.getMonth()] ?? 'Jan';
  return `${day}/${month}/${String(now.getFullYear())}`;
})();

export default defineConfig(({ mode }) => ({
  clearScreen: false,
  base: './',
  plugins: [
    react(),
    babel({
      include: /\.[tj]sx?$/,
      presets: [reactCompilerPreset()],
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(frontendRootDir, './src'),
    },
  },
  css: {
    postcss: {
      plugins: [tailwindcss()],
    },
  },
  build: {
    target: 'esnext',
    outDir: 'build',
    rolldownOptions: {
      input: {
        main: path.resolve(frontendRootDir, 'index.html'),
        updater: path.resolve(frontendRootDir, 'updater.html'),
      },
    },
  },
  server: {
    port: mode === 'tauri' ? 3001 : Number(process.env.FRONTEND_PORT ?? 3000),
    host: mode === 'tauri' ? '127.0.0.1' : '0.0.0.0',
    strictPort: mode === 'tauri',
    watch: {
      ignored: ['**/src-tauri/**'],
    },
    forwardConsole: {
      unhandledErrors: true,
      logLevels: ['warn', 'error'],
    },
  },
  preview: {
    port: Number(process.env.FRONTEND_PORT ?? 3002),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
}));
