// Copyright 2026 The MathWorks, Inc.
//
// The icon files the extension ships, as the folders scripts/copy-icons.mjs copies into
// dist/webview/icons: data-explorer-view's icons/ (every icon its widgets draw, and so every one
// the sidebar tree shares with them) and media/icons (the few only the tree draws). Read from the
// sources rather than from dist/, which exists only after a build.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Off the cwd, as the other tests reading the installed view: vitest runs from the repo root, and
// under happy-dom import.meta.url is not a file URL.
export const ICON_SOURCES = ['node_modules/data-explorer-view/icons', 'media/icons'] as const;

/** The source file that ships as `<id>.svg`, or undefined when no source has it. */
export function shippedIcon(id: string): string | undefined {
  return ICON_SOURCES.map((dir) => join(process.cwd(), dir, `${id}.svg`)).find((file) => existsSync(file));
}

/** Every `.svg` name in one source folder. */
export function iconsIn(dir: (typeof ICON_SOURCES)[number]): string[] {
  return readdirSync(join(process.cwd(), dir))
    .filter((f) => f.endsWith('.svg'))
    .sort();
}
