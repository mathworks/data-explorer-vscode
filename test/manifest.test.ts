// Copyright 2026 The MathWorks, Inc.
// Contract tests over package.json `contributes`. The editor-toggle feature and
// the single-editor decision live entirely in the manifest (commands + menu
// `when` clauses + customEditors), which imports no code and so is invisible to
// the rest of the suite. A typo'd command id or a `when` clause pointing at the
// wrong viewType silently disables a button with no build error — these tests
// are the guard against that.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_EXTS } from '../src/common/fileTypes.js';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
);
const contributes = pkg.contributes;
const commandIds: string[] = contributes.commands.map((c: { command: string }) => c.command);

const BINARY_VIEW = 'dataExplorer.binaryView';
const TABLE_VIEW = 'dataExplorer.tableView';
const BINARY_SLDD_VIEW = 'dataExplorer.binarySlddView';

describe('customEditors: text-backed table for JSON .sldd + byte-backed binary editor', () => {
  const editors = contributes.customEditors as Array<{
    viewType: string;
    selector: Array<{ filenamePattern: string }>;
    priority: string;
  }>;

  it('registers exactly three custom editors: table view, binary view, binary sldd view', () => {
    const viewTypes = editors.map((e) => e.viewType).sort();
    expect(viewTypes).toEqual([BINARY_VIEW, TABLE_VIEW, BINARY_SLDD_VIEW].sort());
  });

  it('the writable binary-sldd table view owns *.sldd at priority option (reached via redirect)', () => {
    const view = editors.find((e) => e.viewType === BINARY_SLDD_VIEW)!;
    expect(view, 'the binarySlddView editor must be declared').toBeTruthy();
    expect(view.selector.map((s) => s.filenamePattern)).toEqual(['*.sldd']);
    // 'option' (not 'default') so it never auto-opens; the binary editor is the
    // default and redirects compressed-binary .sldd here.
    expect(view.priority).toBe('option');
  });

  it('the byte-backed binary editor is DEFAULT for every supported format incl *.sldd', () => {
    // binaryView must be the default for *.sldd because it can open ANY bytes —
    // a CustomTextEditorProvider (tableView) cannot open binary/zip .sldd (it
    // fails to load as a TextDocument: "cannot open as text"). binaryView opens
    // editable JSON .sldd too, then redirects it to the tableView.
    const binary = editors.find((e) => e.viewType === BINARY_VIEW)!;
    expect(binary, 'the binaryView editor must be declared').toBeTruthy();
    const patterns = binary.selector.map((s) => s.filenamePattern);
    expect(patterns).toEqual(expect.arrayContaining(SUPPORTED_EXTS.map((e) => `*.${e}`)));
    expect(binary.priority).toBe('default');
  });

  // Derived from SUPPORTED_EXTS rather than a second hand-written list, because
  // the manifest is the one consumer of that list which no import can reach: the
  // host code can be updated for a new format and typecheck clean while the
  // selector here still omits it — the file then opens in VS Code's default
  // (hex/text) editor and the extension appears simply not to support it.
  it('declares no supported format the host does not know about, and omits none', () => {
    const binary = editors.find((e) => e.viewType === BINARY_VIEW)!;
    const declared = binary.selector.map((s) => s.filenamePattern.replace(/^\*\./, '')).sort();
    expect(declared).toEqual([...SUPPORTED_EXTS].sort());
  });

  it('the editable table view owns *.sldd at priority option (reached via redirect / Reopen With)', () => {
    const table = editors.find((e) => e.viewType === TABLE_VIEW)!;
    expect(table, 'the tableView editor must be declared').toBeTruthy();
    expect(table.selector.map((s) => s.filenamePattern)).toEqual(['*.sldd']);
    // 'option' (not 'default') so it never auto-opens binary .sldd; the binary
    // editor is the default and redirects editable JSON here.
    expect(table.priority).toBe('option');
  });
});

describe('configurationDefaults: redirect-only editors stay out of the editor-type picker', () => {
  // VS Code >= 1.129 shows an editor-type picker in the breadcrumbs, listing every
  // editor whose selector matches the file. Our selectors are filename globs only
  // (VS Code offers no content-based selector), so all three Data Explorer editors
  // match *.sldd and the picker offered three entries for one file — two of them
  // internal redirect targets that FAIL when a user picks them by hand (issue #24:
  // tableView on a compressed-binary .sldd cannot be resolved as text at all).
  //
  // `workbench.editor.hiddenEditorTypes` (VS Code >= 1.134) drops an editor from
  // that picker while leaving "Reopen Editor With…", `workbench.editorAssociations`
  // and our own `vscode.openWith` redirects working — and VS Code keeps the ACTIVE
  // type visible, so the picker still names the editor you are in. It is
  // WINDOW-scoped, which is what makes it legal for an extension to default; on
  // VS Code < 1.134 the key is simply unregistered and the default goes unread.
  const hidden = contributes.configurationDefaults?.['workbench.editor.hiddenEditorTypes'];
  const editors = contributes.customEditors as Array<{ viewType: string; priority: string }>;

  it('hides exactly the two editors reached only by redirect', () => {
    expect(Array.isArray(hidden), 'hiddenEditorTypes must be declared as an array').toBe(true);
    expect([...hidden].sort()).toEqual([TABLE_VIEW, BINARY_SLDD_VIEW].sort());
  });

  it('hides only `option`-priority editors, never the default one users pick', () => {
    // The rule that keeps this honest as editors are added: an editor a user is
    // meant to choose (priority `default`) must stay in the picker; one that only
    // ever arrives via a content-based redirect must not be offered by hand.
    for (const id of hidden) {
      const editor = editors.find((e) => e.viewType === id);
      expect(editor, `hidden editor ${id} must be a declared custom editor`).toBeTruthy();
      expect(editor!.priority, `hidden editor ${id} must be option-priority`).toBe('option');
    }
    expect(hidden, 'the default editor must remain pickable').not.toContain(BINARY_VIEW);
  });
});

describe('editor-toggle commands', () => {
  it('declares viewAsText and viewAsTable with icons', () => {
    for (const id of ['dataExplorer.viewAsText', 'dataExplorer.viewAsTable']) {
      const cmd = contributes.commands.find((c: { command: string }) => c.command === id);
      expect(cmd, `command ${id} must be declared`).toBeTruthy();
      expect(cmd.icon, `command ${id} needs an icon for the tab toolbar`).toMatch(/^\$\(/);
    }
  });
});

describe('menu wiring', () => {
  const titleMenus = contributes.menus['editor/title'] as Array<{
    command: string;
    when: string;
    group: string;
  }>;

  it('every menu command refers to a declared command', () => {
    const referenced = [
      ...titleMenus,
      ...contributes.menus.commandPalette,
    ].map((m: { command: string }) => m.command);
    for (const ref of referenced) {
      expect(commandIds, `menu references undeclared command ${ref}`).toContain(ref);
    }
  });

  it('shows View-as-Text only when the table view is the active editor', () => {
    const entry = titleMenus.find((m) => m.command === 'dataExplorer.viewAsText');
    expect(entry).toBeTruthy();
    expect(entry!.when).toContain(`activeCustomEditorId == ${TABLE_VIEW}`);
  });

  it('shows View-as-Table only when a non-custom editor is active on a .sldd', () => {
    const entry = titleMenus.find((m) => m.command === 'dataExplorer.viewAsTable');
    expect(entry).toBeTruthy();
    // `!activeCustomEditorId` means the plain text editor is the active view.
    expect(entry!.when).toContain('!activeCustomEditorId');
    expect(entry!.when).toContain('resourceExtname == .sldd');
  });

  it('the two toggle buttons are mutually exclusive (never both visible)', () => {
    const text = titleMenus.find((m) => m.command === 'dataExplorer.viewAsText')!;
    const table = titleMenus.find((m) => m.command === 'dataExplorer.viewAsTable')!;
    // One requires the table custom editor active; the other requires no custom
    // editor active (the plain text view).
    const textNeedsCustom = text.when.includes(`activeCustomEditorId == ${TABLE_VIEW}`);
    const tableNeedsNoCustom = table.when.includes('!activeCustomEditorId');
    expect(textNeedsCustom && tableNeedsNoCustom).toBe(true);
  });

  it('restricts the palette entries to .sldd files', () => {
    for (const entry of contributes.menus.commandPalette) {
      expect(entry.when).toContain('resourceExtname == .sldd');
    }
  });
});
