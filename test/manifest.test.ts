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

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
);
const contributes = pkg.contributes;
const commandIds: string[] = contributes.commands.map((c: { command: string }) => c.command);

const BINARY_VIEW = 'dataExplorer.binaryView';
const TABLE_VIEW = 'dataExplorer.tableView';

describe('customEditors: text-backed table for JSON .sldd + byte-backed binary editor', () => {
  const editors = contributes.customEditors as Array<{
    viewType: string;
    selector: Array<{ filenamePattern: string }>;
    priority: string;
  }>;

  it('registers exactly two custom editors: the table view and the binary view', () => {
    const viewTypes = editors.map((e) => e.viewType).sort();
    expect(viewTypes).toEqual([BINARY_VIEW, TABLE_VIEW].sort());
  });

  it('the byte-backed binary editor is DEFAULT for all four formats incl *.sldd', () => {
    // binaryView must be the default for *.sldd because it can open ANY bytes —
    // a CustomTextEditorProvider (tableView) cannot open binary/zip .sldd (it
    // fails to load as a TextDocument: "cannot open as text"). binaryView opens
    // editable JSON .sldd too, then redirects it to the tableView.
    const binary = editors.find((e) => e.viewType === BINARY_VIEW)!;
    expect(binary, 'the binaryView editor must be declared').toBeTruthy();
    const patterns = binary.selector.map((s) => s.filenamePattern);
    expect(patterns).toEqual(expect.arrayContaining(['*.sldd', '*.slx', '*.mat', '*.prj']));
    expect(binary.priority).toBe('default');
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
