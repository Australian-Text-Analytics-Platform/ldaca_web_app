import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    sourcemap: true,
    outDir: 'build', // keep previous CRA output folder name if backend expects it
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // Group vendor libraries
          'vendor-react': ['react', 'react-dom'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-ui': ['@xyflow/react', 'dagre'],
          'vendor-charts': ['recharts'],
          'vendor-markdown': ['react-markdown', 'rehype-raw'],
          'vendor-auth': ['@react-oauth/google'],
          'vendor-utils': ['zustand']
        }
      }
    }
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  preview: {
    port: 3000,
  },
  envPrefix: 'VITE_', // Vite standard environment variable prefix
});
