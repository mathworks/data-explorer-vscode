// Copyright 2026 The MathWorks, Inc.
//
// The filename of the one stylesheet every webview links.
//
// It is a constant because two independent things have to agree on it: vite emits
// it (vite.config.ts) and the host writes the <link> that loads it
// (webviewHtml.ts). It used to be neither — vite auto-named the shared CSS after
// whatever chunk it landed in, which happened to be `property`, and the host
// hardcoded that name. Adding a module that both webview entries import renamed
// the chunk to `matrixOpen`, so the <link> 404'd in every view and the shared
// styles silently vanished. A build-output name the host hardcodes must not be
// derived from the shape of the module graph.
export const SHARED_STYLESHEET = 'property.css';
