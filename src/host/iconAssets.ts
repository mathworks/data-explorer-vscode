// Copyright 2026 The MathWorks, Inc.

// Where the icon SVGs live INSIDE THE INSTALLED EXTENSION, as path segments
// relative to `extensionUri`.
//
// This is deliberately not `media/icons`, which holds the few icons only this tree
// draws, nor data-explorer-view's `icons/`, which holds every icon its widgets draw:
// `npm run copy:icons` (scripts/copy-icons.mjs) copies both here for the webview to
// load, and `.vscodeignore` excludes `media/icons/**` so they are not shipped twice.
// The host's tree resolved `media/icons/<id>.svg` once — a path that existed in a dev
// checkout and in every integration run, and in no published VSIX, so the Simulink
// Data tree had no icons at all for users while looking correct to us.
//
// Host and webview now read the ONE copy that ships. It is a separate, vscode-free
// module so the unit suite can assert against it; iconMap.ts imports `vscode` and
// vitest cannot load it.
export const ICON_DIR = ['dist', 'webview', 'icons'] as const;
