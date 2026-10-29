// Copyright 2026 The MathWorks, Inc.
//
// The icons the extension ships, into dist/webview/icons (src/host/iconAssets.ts's ICON_DIR):
// where the webviews load them from (table-main and pi-main set dex-icon's base to `./icons/`,
// under a <base href> of dist/webview), and where the host's sidebar tree reads its own.
//
// One source: data-explorer-view ships every icon its widgets and its hierarchy draw, which is
// every one the tree draws too (the two only the tree drew, the folder group and the generic
// fallback, came with the hierarchy, out of the media/icons this extension used to keep). A
// second source would be one icon kept twice, and whichever copy landed last would win, so a
// name in two fails the build rather than picking one.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'dist/webview/icons';
const SOURCES = ['node_modules/data-explorer-view/icons'];

const from = new Map();
for (const dir of SOURCES) {
  if (!existsSync(dir)) throw new Error(`${dir} is missing: the icons cannot be copied without it`);
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.svg'))) {
    if (from.has(name)) throw new Error(`${name} is in both ${from.get(name)} and ${dir}: keep one`);
    from.set(name, dir);
  }
}
mkdirSync(OUT, { recursive: true });
for (const [name, dir] of from) copyFileSync(join(dir, name), join(OUT, name));
console.log(`${from.size} icons → ${OUT}`);
