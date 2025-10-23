import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    include: [
      '@radix-ui/react-tabs',
      '@radix-ui/react-toggle',
      '@radix-ui/react-toggle-group',
    ],
  },
  build: {
    sourcemap: true,
    outDir: 'build',
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
    port: Number(process.env.FRONTEND_PORT ?? 3000),
    host: '0.0.0.0',
  },
  preview: {
    port: Number(process.env.FRONTEND_PORT ?? 3000),
  },
  envPrefix: 'VITE_', // Vite standard environment variable prefix
});
