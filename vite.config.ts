import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/dex/core'),
      '@datamodel': resolve(__dirname, 'src/dex/datamodel'),
      '@components': resolve(__dirname, 'src/dex/components'),
      '@graph': resolve(__dirname, 'src/dex/graph'),
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist/webview',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        table: resolve(__dirname, 'src/webview/table.html'),
        pi: resolve(__dirname, 'src/webview/pi.html'),
      },
      output: {
        entryFileNames: '[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify('0.0.1'),
    __BUILD_DATE__: JSON.stringify('2026-07-02'),
  },
});
