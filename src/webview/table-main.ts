// Copyright 2026 The MathWorks, Inc.
import 'data-explorer-view/theme.css';
import './webview-page.css';
import './vscode-theme.css';
import { connectTable, defineTreeTable } from 'data-explorer-view/tree-table';
import { defineContextMenu } from 'data-explorer-view/context-menu';
import { defineErrorDialog } from 'data-explorer-view/error-dialog';
import { defineVariableEditor } from 'data-explorer-view/variable-editor';
import { setIconBase } from 'data-explorer-view/icon';
import { messageSource } from 'data-explorer-view/model';
import type { HostToTableMessage } from '../common/protocol.js';
import { renderBanners, renderError } from './banners.js';
import { vscodePort } from './vscodePort.js';

// Importing a widget no longer registers it, so this comes first: before the shell's table is
// looked up and before any overlay is created, each finds its element already defined. The icon
// base too, before the first row draws one: the icons copy:icons puts in dist/webview/icons,
// relative to the shell's <base href> (dist/webview).
setIconBase('./icons/');
defineTreeTable();
defineContextMenu();
defineErrorDialog();
defineVariableEditor();

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

// Markup owns the CONTENT element, because only the shell knows where the table
// sits on screen. This module owns every OVERLAY, because none of them has a
// place in the shell's layout — each is a self-positioning, initially hidden
// popover appended to <body>.
//
// This split is not a style preference. The webview HTML is assembled as a string
// by three separate host providers (SlddTextEditorProvider,
// BinarySlddEditorProvider, BinaryEditorProvider), so any tag required in markup
// is one rule spread over three paths — and a provider that misses it produces a
// null here, i.e. a crash or a silently dead feature in that view only.
// BinaryEditorProvider had exactly that: no <dex-error-dialog>, so save errors
// never surfaced there. Creating them here makes the shells interchangeable.
//
// All three are handed to connectTable below, which would otherwise make its own: the dialog when
// it connects and the menu at the first right-click. These are made at load, in this order, as
// they always were.
const table = document.querySelector('dex-tree-table') as any;

function overlay(tag: string): any {
  const el = document.createElement(tag);
  document.body.appendChild(el);
  return el as any;
}

const contextMenu = overlay('dex-context-menu');
const errorDialog = overlay('dex-error-dialog');
// The Variable Editor: a glyph in a matrix Value cell asks for a grid. connectTable opens and
// fills it.
const variableEditor = overlay('dex-variable-editor');

// Whether the document has a plain-text view "Location in Text" can reveal a row in (JSON .sldd
// yes, compressed-binary .sldd no). Every setRows says, but a table's paint does not carry it, so
// this shell reads it off the message itself, registered BEFORE the table's source so it is set
// before the rows it came with are installed.
let hasTextView = false;
window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as HostToTableMessage | null;
  if (typeof msg === 'object' && msg !== null && msg.type === 'setRows') hasTextView = !!msg.hasTextView;
});

// The table, fed by the host through view's connectTable, which holds both halves: the display
// (installRows, the vanished-selection clear, pending selections, lazy rows, the matrix glyph,
// local links, Ctrl+F) and, with `editing`, the editing one (the editing state a setRows carries,
// the clipboard, the drag in flight and the drop rules the host tells every table, the editing
// menu and its chords, the drop predictor, the dialogs, and every gesture posted as the message
// the host takes). What is left here is this extension's: the two host requests that are not the
// table's wire (selectByName, from cross-tab navigation; openAddGallery, the Add accelerator), the
// text view, the banner strip, and the selection and links relayed to the host.
const port = vscodePort(vscode);
const source = messageSource(port, {
  extra: (msg: HostToTableMessage) => {
    // Cross-tab navigation: select the row whose name matches (block or variable). Applied now if
    // present, else held until the next setRows.
    if (msg.type === 'selectByName' && typeof msg.name === 'string') handle.selectByName(msg.name);
    // The Add-gallery accelerator (dataExplorer.addEntry), handed to the same method the button
    // calls, so the keyboard and the pointer share one path — including the toggle, and the
    // no-op on a view that cannot add.
    else if (msg.type === 'openAddGallery') handle.toggleAddGallery();
  },
});
const handle = connectTable(table, source, {
  contextMenu,
  errorDialog,
  variableEditor,
  editing: true,
  // Location in Text, and Cmd/Ctrl+L, reveal a row in the plain-text view, which the host opens.
  textView: {
    available: () => hasTextView,
    locate: (rowId) => vscode.postMessage({ type: 'locateInText', rowId }),
  },
  // The banners are drawn in this shell's strip (banners.ts), whose height the full-bleed table is
  // offset by.
  banners: (banners) => {
    renderError(table, banners.error);
    renderBanners(table, { notice: banners.notice, warnings: banners.warnings });
  },
});

// Relay row selection to the host, for the Property Inspector, which is another webview: the
// user's, and the ones the table applies for the host and for a link.
handle.on('select', (rowIds) => vscode.postMessage({ type: 'select', rowIds }));

// A link the table does not answer itself goes to the host, which opens the referenced file and
// selects the row there (see navigate.ts): each table is its own webview, with no page around
// it to navigate within.
handle.on('navigate', ({ target }) => vscode.postMessage({ type: 'navigate', target }));
