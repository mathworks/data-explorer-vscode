import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const web = process.argv.includes('--web');
// For the integration coverage run (`npm run test:integration:coverage`). Coverage counts the
// statements and branches of the code that ran, and minifying rewrites them (statements joined
// into comma expressions, an `if` into `&&` or a ternary), so the counts would not be the
// source's. The shipped bundle stays minified.
const minify = !process.argv.includes('--no-minify');

// Shared config for the extension-host bundle. The desktop build targets Node;
// the `--web` build targets the browser web-extension host (a Web Worker on
// vscode.dev / github.dev / @vscode/test-web). Both keep `vscode` external and
// prefer packages' ESM entry — jsonc-parser's UMD main leaves unresolved runtime
// require('./impl/*') calls after bundling, which breaks host activation.
const common = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  minify,
  mainFields: ['module', 'main'],
  external: ['vscode'],
  sourcemap: true,
};

const config = web
  ? {
      ...common,
      // A save's replace-by-rename (src/host/safeWrite.ts) imports Node's fs lazily, on the
      // save path only, and writes through `workspace.fs` when that import fails, which is what
      // it does in the web host. Left external so the browser bundle builds; never loaded there.
      external: [...common.external, 'node:fs/promises'],
      outfile: 'dist/web/extension.js',
      platform: 'browser',
      format: 'cjs',
      target: 'es2020',
    }
  : {
      ...common,
      outfile: 'dist/extension.js',
      platform: 'node',
      format: 'cjs',
      target: 'node18',
    };

const ctx = await esbuild.context(config);

if (watch) {
  await ctx.watch();
  console.log(`esbuild: watching ${web ? 'web' : 'host'} bundle...`);
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log(`esbuild: ${web ? 'web' : 'host'} bundle written to ${config.outfile}`);
}
