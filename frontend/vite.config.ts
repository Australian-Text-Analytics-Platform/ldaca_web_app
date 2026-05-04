/// <reference types="vitest/config" />

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type ServerOptions } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/postcss';

const frontendRootDir = path.dirname(fileURLToPath(import.meta.url));

const packageVersion = (() => {
  try {
    return JSON.parse(readFileSync(path.join(frontendRootDir, 'package.json'), 'utf-8')).version ?? '';
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

const serverConfig = {
  port: Number(process.env.FRONTEND_PORT ?? 3002),
  host: '0.0.0.0',
  forwardConsole: {
    unhandledErrors: true,
    logLevels: ['warn', 'error'],
  },
} as unknown as ServerOptions;

export default defineConfig({
  base: './',
  plugins: [
    react(),
    babel({
      include: /\.[tj]sx?$/,
      presets: [reactCompilerPreset()],
    } as Parameters<typeof babel>[0]),
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
    cssMinify: 'esbuild',
    sourcemap: true,
    outDir: 'build',
    emptyOutDir: true,
  },
  server: serverConfig,
  preview: {
    port: Number(process.env.FRONTEND_PORT ?? 3002),
  },
  envPrefix: 'VITE_', // Vite standard environment variable prefix
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    reporters: ['default'],
  },
});
