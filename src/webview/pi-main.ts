// Copyright 2026 The MathWorks, Inc.
import 'data-explorer-view/theme.css';
import './webview-page.css';
import './vscode-theme.css';
import { connectInspector, definePropertyInspector } from 'data-explorer-view/property-inspector';
import { defineVariableEditor } from 'data-explorer-view/variable-editor';
import { setIconBase } from 'data-explorer-view/icon';
import { inspectorFeed } from 'data-explorer-view/model';
import { vscodePort } from './vscodePort.js';

// Importing a widget no longer registers it, so this comes first: before the shell's inspector
// is looked up and before the Variable Editor is created. The icon base too, before the Variable
// Editor's open button draws one: as table-main's, the icons in dist/webview/icons.
setIconBase('./icons/');
definePropertyInspector();
defineVariableEditor();

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

const pi = document.querySelector('dex-property-inspector') as any;
const empty = document.getElementById('dex-empty');

// The Variable Editor: the same overlay, opened by the same glyph, as the table's
// Value cell. Created here rather than declared in markup for the reason
// test/webviewOverlays.test.ts records — the shipped shell is a string built by
// PropertiesViewProvider, so a tag required in pi.html would only reach vite's dev
// entry. The inspector is the event source because the glyph is in its shadow tree.
const variableEditor = document.createElement('dex-variable-editor');
document.body.appendChild(variableEditor);

function setEmpty(show: boolean): void {
  if (empty) empty.style.display = show ? 'block' : 'none';
  if (pi) (pi as HTMLElement).style.display = show ? 'none' : 'block';
}

// The inspector, fed by the host through view's connectInspector: each `showProps` and `empty`
// is a page, and each replaces every row an open grid was anchored to, so it closes the grid;
// the glyph's cells are asked for with `requestMatrix`. Its first page listener says `ready`,
// after the empty state is up, as this page always has.
const inspector = connectInspector(pi, inspectorFeed(vscodePort(vscode)), { variableEditor, empty: setEmpty });

// A cross-reference in the inspector was clicked. This webview has no rows to select in —
// the target is a row in a TABLE, which is a different webview — so the host resolves it,
// exactly as it does for a cross-tab Usage link (host/navigate.ts).
inspector.on('navigate', (target) => vscode.postMessage({ type: 'navigate', target }));
