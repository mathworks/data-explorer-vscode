import { defineConfig } from 'vite';
import { resolve } from 'path';
import { SHARED_STYLESHEET } from './src/common/webviewAssets.js';

// Every webview links exactly one stylesheet, under a name the host hardcodes.
// Left to vite, that name follows whichever chunk the CSS is hoisted into, so it
// changes whenever the module graph does — see webviewAssets.ts. Pin it, and fail
// the build loudly if a second, different CSS source ever appears, because with a
// fixed name the second one would silently overwrite the first.
let cssSource: string | undefined;

function assetName(info: { names?: string[]; name?: string }): string {
  const name = info.names?.[0] ?? info.name ?? '';
  if (!name.endsWith('.css')) {
    return 'assets/[name][extname]';
  }
  if (cssSource !== undefined && cssSource !== name) {
    throw new Error(
      `The webview build now emits two stylesheets (${cssSource}, ${name}), but the host links ` +
        `exactly one (${SHARED_STYLESHEET}). Give them distinct names and teach webviewHtml.ts ` +
        `about the second, rather than letting one overwrite the other.`,
    );
  }
  cssSource = name;
  return `assets/${SHARED_STYLESHEET}`;
}

export default defineConfig({
  base: './',
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
        assetFileNames: assetName,
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify('0.0.1'),
    __BUILD_DATE__: JSON.stringify('2026-07-02'),
  },
});
