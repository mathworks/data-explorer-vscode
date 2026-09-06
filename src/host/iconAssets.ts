// Copyright 2026 The MathWorks, Inc.

// Where the icon SVGs live INSIDE THE INSTALLED EXTENSION, as path segments
// relative to `extensionUri`.
//
// This is deliberately not `media/icons`, which is where the sources live in the
// repo: `.vscodeignore` excludes `media/icons/**` so the 116 assets are not shipped
// twice, and `npm run copy:icons` copies them here for the webview to load. The
// host's tree resolved `media/icons/<id>.svg` anyway — a path that exists in a dev
// checkout and in every integration run, and in no published VSIX, so the Simulink
// Data tree had no icons at all for users while looking correct to us.
//
// Host and webview now read the ONE copy that ships. It is a separate, vscode-free
// module so the unit suite can assert against it; iconMap.ts imports `vscode` and
// vitest cannot load it.
export const ICON_DIR = ['dist', 'webview', 'icons'] as const;
