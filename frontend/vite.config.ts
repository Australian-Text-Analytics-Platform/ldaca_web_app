/// <reference types="vitest/config" />

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type ServerOptions } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/postcss';

const frontendRootDir = path.dirname(fileURLToPath(import.meta.url));

const serverConfig = {
  port: Number(process.env.FRONTEND_PORT ?? 3000),
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
    port: Number(process.env.FRONTEND_PORT ?? 3000),
  },
  envPrefix: 'VITE_', // Vite standard environment variable prefix
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    reporters: ['default'],
  },
});
