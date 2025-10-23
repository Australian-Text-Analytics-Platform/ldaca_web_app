#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const buildPath = join(projectRoot, 'build');

// Read environment variables with defaults
const frontendPort = process.env.FRONTEND_PORT || '3000';
const backendPort = process.env.VITE_BACKEND_PORT || '8001';

console.log('Starting LDaCA Web App Frontend (Production)');
console.log(`Frontend server: http://localhost:${frontendPort}`);
console.log(`Backend API: http://localhost:${backendPort}`);
console.log();

// Check if build folder exists
if (!existsSync(buildPath)) {
  console.error('Build directory not found. This package may be corrupted.');
  console.error('Try reinstalling: npx ldaca_web_app_frontend@latest');
  process.exit(1);
}

console.log('Tip: Customize ports with environment variables:');
console.log(`  FRONTEND_PORT=${frontendPort} VITE_BACKEND_PORT=${backendPort} npx ldaca_web_app_frontend`);
console.log();
console.log('Running optimized production build');
console.log();

// Run vite preview to serve the production build from the 'build' directory
const previewArgs = ['vite', 'preview', '--outDir', 'build', '--host', '0.0.0.0', '--port', frontendPort];

const preview = spawn('npx', previewArgs, {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env } // Pass through all env vars
});

preview.on('error', (err) => {
  console.error('Failed to start frontend:', err);
  process.exit(1);
});

preview.on('close', (code) => {
  process.exit(code || 0);
});
