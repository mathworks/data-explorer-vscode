// Copyright 2026 The MathWorks, Inc.
//
// The project page's stylesheet, as a string injected at runtime by project-main.ts.
//
// WHY A STRING AND NOT A .css FILE. Two reasons, both structural:
//
//  1. The build emits exactly ONE stylesheet, under a name the host hardcodes
//     (`SHARED_STYLESHEET`), and `vite.config.ts` throws if a second distinct CSS
//     source ever appears — see the comment there. A `import './projectPage.css'`
//     would be that second source.
//  2. The vite dev shell (`project.html`) is a static file that cannot interpolate
//     anything the host builds, so page styles written into the host's markup would
//     need a hand copy there — the drift that `test/webviewOverlays.test.ts` exists
//     to catch for the banner strip.
//
// Injected rather than inlined in the host shell so there is exactly one copy for
// both shells. No flash of unstyled content: the page's markup is created by the
// same script, after this.
//
// Colours are VS Code theme variables ONLY — no literals, so the page follows the
// user's theme, including ones that do not exist yet. `color-mix` against
// `--vscode-foreground` rather than `descriptionForeground`/`disabledForeground` for
// the reason recorded in vscode-theme.css: those tokens composite to under WCAG AA
// on the stock themes, and mixing the theme's own foreground toward transparency
// holds in any theme and over any surface the text actually sits on.
export const PROJECT_PAGE_CSS = `
/* The shared stylesheet locks the viewport (html,body{height:100%;overflow:hidden})
   because the table views are one absolutely-positioned element filling the panel.
   This view is a DOCUMENT: it is as tall as the project is and it scrolls. */
html, body { height: auto; overflow: visible; }
body {
  margin: 0;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  -webkit-font-smoothing: antialiased;
}
.dex-page * { box-sizing: border-box; }

/* A measure, not the full panel width: these are lines of prose-length text, and a
   path folder stretched across an ultrawide editor is unreadable. */
.dex-page {
  max-width: 860px; margin: 0 auto; padding: 26px 28px 80px;
  /* ONE muted tone for the whole page, at the one mix measured to clear WCAG AA in BOTH
     stock themes: 4.82:1 on light, 5.97:1 on dark. The tones that varied per surface did
     not survive measurement -- a 60% mix reads as comfortably muted on the dark theme at
     4.58:1 and lands at 3.48:1 on the light one, which is the same trap vscode-theme.css
     records about descriptionForeground. Anything fainter than this needs a measurement,
     not a preference. */
  --dex-muted: color-mix(in srgb, var(--vscode-foreground) 72%, transparent);
}

.dex-page .identity { padding-bottom: 4px; }
.dex-page .identity h1 { margin: 0; font-size: 21px; font-weight: 600; letter-spacing: -0.01em; }
.dex-page .identity .root {
  margin-top: 5px; font-family: var(--vscode-editor-font-family); font-size: 12px;
  color: var(--dex-muted);
  word-break: break-all;
}
.dex-page .identity .meta {
  margin-top: 8px; font-size: 12px;
  color: var(--dex-muted);
}
.dex-page .identity .meta .dot { opacity: .5; margin: 0 6px; }

.dex-page .section { margin-top: 30px; }
.dex-page .section > header {
  display: flex; align-items: baseline; gap: 10px;
  border-bottom: 1px solid var(--vscode-panel-border);
  padding-bottom: 5px; margin-bottom: 7px;
}
.dex-page .section h2 {
  margin: 0; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .09em;
  color: var(--dex-muted);
}
.dex-page .section .count {
  font-size: 11px; font-variant-numeric: tabular-nums;
  color: var(--dex-muted);
}
.dex-page .section .spacer { flex: 1 1 auto; }

.dex-page input.filter {
  font: inherit; font-size: 11px; width: 190px; padding: 2px 6px;
  color: var(--vscode-input-foreground, var(--vscode-foreground));
  background: var(--vscode-input-background, var(--vscode-editor-background));
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: 2px;
}
.dex-page input.filter::placeholder { color: var(--vscode-input-placeholderForeground, inherit); opacity: .7; }
.dex-page input.filter:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }

.dex-page .row {
  display: flex; gap: 14px; align-items: baseline;
  padding: 3px 7px; border-radius: 3px;
}
.dex-page .row:hover { background: var(--vscode-list-hoverBackground); }
.dex-page .row .name { flex: 0 0 auto; min-width: 190px; }
.dex-page .row .target {
  font-family: var(--vscode-editor-font-family); font-size: 12px;
  color: var(--dex-muted);
  word-break: break-all;
}
.dex-page .row.single .name { min-width: 0; font-family: var(--vscode-editor-font-family); font-size: 12px; }
/* a.link is NESTED inside .target, so this (one class + one element) must not be
   outspecified by ".row .target" (two classes) -- which is what happened when one
   element carried both classes: every link rendered in the muted body colour, i.e.
   the clickable rows did not look clickable. */
.dex-page a.link { color: var(--vscode-textLink-foreground); text-decoration: none; cursor: pointer; }
.dex-page a.link:hover, .dex-page a.link:focus-visible { text-decoration: underline; }
.dex-page a.link:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
.dex-page .muted { color: var(--dex-muted); }
.dex-page .empty {
  padding: 3px 7px; font-size: 12px; font-style: italic;
  color: var(--dex-muted);
}
.dex-page mark {
  background: var(--vscode-editor-findMatchHighlightBackground, rgba(234,92,0,.33));
  color: inherit; border-radius: 2px;
}
.dex-page .group-label {
  margin: 8px 0 3px 7px; font-size: 11px; font-weight: 600;
  color: var(--dex-muted);
}
.dex-page .group-label:first-child { margin-top: 0; }

/* The same palette as the table views' warning banner (BANNERS_HTML), so "this file
   did not read whole" looks the same wherever it is said. */
.dex-page .warning {
  padding: 6px 10px; border-radius: 3px; font-size: 12px;
  color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
  background: var(--vscode-inputValidation-warningBackground, rgba(255,190,60,0.12));
  border: 1px solid var(--vscode-inputValidation-warningBorder, #b89500);
  margin-bottom: 18px;
}
.dex-page .warning .headline { font-weight: 600; }
.dex-page .warning ul { margin: 4px 0 0; padding-inline-start: 18px; }

.dex-page .runs {
  padding: 8px 10px; border-radius: 4px;
  background: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
}
.dex-page .runs .row { padding: 2px 0; }
.dex-page .runs .row .name { min-width: 92px; font-weight: 500; }
.dex-page .runs .ord {
  display: inline-block; min-width: 14px; margin-right: 4px; text-align: right;
  opacity: .55; font-variant-numeric: tabular-nums;
}

.dex-page .chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 3px 7px; }
.dex-page .chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 1px 9px; border-radius: 11px; font-size: 12px;
  border: 1px solid var(--vscode-panel-border);
}
.dex-page .chip .n { font-variant-numeric: tabular-nums; color: var(--dex-muted); }
.dex-page .chip.unused { opacity: .5; }
.dex-page .chip.custom { border-style: dashed; }

.dex-page button.more {
  margin: 5px 0 0 7px; font: inherit; font-size: 11px; cursor: pointer;
  color: var(--vscode-textLink-foreground); background: none; border: 0; padding: 2px 0;
}
.dex-page button.more:hover { text-decoration: underline; }

/* A dashed border and an opacity are both invisible in a forced-colours theme, where
   the OS replaces every colour we asked for. Say the same two things with properties
   it keeps. */
@media (forced-colors: active) {
  .dex-page .chip { border-color: CanvasText; }
  .dex-page .chip.unused { opacity: 1; color: GrayText; }
  .dex-page .chip.custom { border-style: dashed; }
  .dex-page a.link { color: LinkText; }
  .dex-page mark { background: Highlight; color: HighlightText; }
}
`;
