// Copyright 2026 The MathWorks, Inc.
// Contract tests over package.json `contributes`. The editor-toggle feature and
// the single-editor decision live entirely in the manifest (commands + menu
// `when` clauses + customEditors), which imports no code and so is invisible to
// the rest of the suite. A typo'd command id or a `when` clause pointing at the
// wrong viewType silently disables a button with no build error — these tests
// are the guard against that.
//
// One of those `when` clauses is now load-bearing in a way the others are not. R2026b's
// `matlab.toml` is a file a user also HAND-EDITS, so clicking it in the Explorer must keep
// opening the plain text editor — and the entire mechanism for that is a priority in this
// manifest. A one-word edit here ("option" → "default", or a `matlab.toml` pattern joining the
// binary view's selector) takes a text file away from the text editor with nothing in the
// TypeScript to show it, which is why the tests below pin the priority and the selector's
// SHAPE rather than only its presence.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_EXTS, SUPPORTED_NAMES } from '../src/common/fileTypes.js';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
);
const contributes = pkg.contributes;
const commandIds: string[] = contributes.commands.map((c: { command: string }) => c.command);

const BINARY_VIEW = 'dataExplorer.binaryView';
const TABLE_VIEW = 'dataExplorer.tableView';
const BINARY_SLDD_VIEW = 'dataExplorer.binarySlddView';
const PROJECT_VIEW = 'dataExplorer.projectView';

describe('customEditors: text-backed table for JSON .sldd + byte-backed binary editor', () => {
  const editors = contributes.customEditors as Array<{
    viewType: string;
    displayName: string;
    selector: Array<{ filenamePattern: string }>;
    priority: string;
  }>;

  it('registers exactly four custom editors: table, binary, binary sldd, project', () => {
    const viewTypes = editors.map((e) => e.viewType).sort();
    expect(viewTypes).toEqual([BINARY_VIEW, TABLE_VIEW, BINARY_SLDD_VIEW, PROJECT_VIEW].sort());
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

  // The fourth entry, and the reason there is a fourth rather than one more pattern on the
  // binary view's selector: `priority` is a property of the ENTRY, not of the pattern. Adding
  // `matlab.toml` beside `*.prj` on the default-priority entry would make the Data Explorer the
  // default editor for that file, so clicking it in the Explorer would open a project page
  // instead of the TOML text — and that file is meant to be hand-edited. A second entry is the
  // only way VS Code offers to give one glob a different priority from the rest.
  it('the project page owns matlab.toml BY NAME, at priority option', () => {
    const view = editors.find((e) => e.viewType === PROJECT_VIEW)!;
    expect(view, 'the projectView editor must be declared').toBeTruthy();
    // Derived from SUPPORTED_NAMES, exactly like the extension selector below is derived from
    // SUPPORTED_EXTS: the manifest is the one consumer of those lists that no import reaches,
    // so a name added to the host and not to this selector is a project format the host
    // discovers, lists in the tree, and then cannot open.
    expect(view.selector.map((s) => s.filenamePattern)).toEqual([...SUPPORTED_NAMES]);
    expect(view.priority).toBe('option');
    // The same displayName as the binary view, not the "(editable)" one: it draws the identical
    // read-only project page — the same component, chosen in getHtml from the file's name — so
    // two labels for one page would be two names for one thing in the Reopen With list.
    expect(view.displayName).toBe(editors.find((e) => e.viewType === BINARY_VIEW)!.displayName);
  });

  it('leaves every DEFAULT-priority editor blind to the named marker', () => {
    // The regression this file exists to catch, stated as a rule over the whole array rather
    // than about one entry, because the edit that breaks it need not touch projectView at all:
    // a `matlab.toml` (or a `*.toml`) pattern anywhere on a default-priority selector takes the
    // plain text editor away from a file users edit by hand. VS Code auto-selects a default
    // editor whose selector matches; an `option` entry is only ever reached by an explicit
    // `vscode.openWith`, which is how the tree row and the project page get there.
    for (const editor of editors) {
      if (editor.priority !== 'default') continue;
      for (const pattern of editor.selector.map((s) => s.filenamePattern)) {
        for (const name of SUPPORTED_NAMES) {
          expect(pattern, `${editor.viewType} must not claim ${name} by default`).not.toBe(name);
        }
        expect(pattern, `${editor.viewType} must not claim .toml by default`).not.toMatch(/\.toml$/i);
      }
    }
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

  it('keeps the project page pickable, option-priority though it is', () => {
    // The converse does NOT hold, and this is the entry that shows why: `option` here means
    // "not the default for this file", not "a redirect target that breaks when chosen". The two
    // hidden editors are hidden because picking them by hand FAILS — tableView cannot resolve a
    // compressed-binary .sldd as text at all (issue #24). Picking the project page over a
    // `matlab.toml` works perfectly; it is the same view the tree row opens. Hiding it would
    // remove the only discoverable way to get from the text of a definition to the project it
    // describes, for a format whose whole point is that the text is editable by hand.
    expect(hidden, 'the project page must stay in the editor-type picker').not.toContain(PROJECT_VIEW);
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

  // Selected by `when`, not by command: View-as-Text now has TWO entries, one per custom
  // editor that can be left for the text editor. `find` by command alone would have silently
  // tested the first of them twice over and said nothing about the other.
  const textEntryFor = (viewType: string) =>
    titleMenus.find(
      (m) =>
        m.command === 'dataExplorer.viewAsText' &&
        m.when.includes(`activeCustomEditorId == ${viewType}`),
    );

  it('shows View-as-Text only when the table view is the active editor', () => {
    const entry = textEntryFor(TABLE_VIEW);
    expect(entry).toBeTruthy();
    expect(entry!.when).toContain(`activeCustomEditorId == ${TABLE_VIEW}`);
  });

  // Two entries rather than one `||` clause, which is a real choice and the narrower one. A
  // single `when` of `activeCustomEditorId == tableView || activeCustomEditorId == projectView`
  // renders the identical button, but every later edit to either view's condition then has to
  // be made without disturbing the other — and these two are not the same button in spirit: one
  // leaves an editable table for the JSON behind it, the other leaves a read-only page for the
  // TOML it was generated from. The mutual-exclusion test below is what keeps two entries from
  // becoming two buttons at once.
  it('shows View-as-Text on the project page too, which is a round trip', () => {
    const entry = textEntryFor(PROJECT_VIEW);
    expect(entry, 'the project page needs a way back to the TOML text').toBeTruthy();
    // Same group as the table view's, so the button sits in the same place in the tab toolbar
    // whichever custom editor the user is leaving.
    expect(entry!.group).toBe(textEntryFor(TABLE_VIEW)!.group);
    // And no extension condition: this entry is reached only from a view type that one
    // filename can open, so `resourceExtname` would be a second, weaker spelling of the same
    // thing — and the wrong one, since `.toml` is not this file's identity.
    expect(entry!.when).not.toContain('resourceExtname');
  });

  it('shows View-as-Table only when a non-custom editor is active on a .sldd', () => {
    const entry = titleMenus.find((m) => m.command === 'dataExplorer.viewAsTable');
    expect(entry).toBeTruthy();
    // `!activeCustomEditorId` means the plain text editor is the active view.
    expect(entry!.when).toContain('!activeCustomEditorId');
    expect(entry!.when).toContain('resourceExtname == .sldd');
  });

  it('the toggle buttons are mutually exclusive (never two visible at once)', () => {
    const table = titleMenus.find((m) => m.command === 'dataExplorer.viewAsTable')!;
    // The toggles divide on whether a custom editor is active at all: every View-as-Text
    // entry requires a NAMED one, View-as-Table requires none (the plain text view).
    const textEntries = titleMenus.filter((m) => m.command === 'dataExplorer.viewAsText');
    expect(textEntries.length).toBeGreaterThan(1);
    for (const entry of textEntries) {
      expect(entry.when, `${entry.when} must require a custom editor`).toMatch(
        /activeCustomEditorId == dataExplorer\.\w+/,
      );
      expect(entry.when, `${entry.when} must not fire with no custom editor`).not.toContain(
        '!activeCustomEditorId',
      );
    }
    expect(table.when).toContain('!activeCustomEditorId');
    // And the View-as-Text entries exclude each OTHER, which is what makes two entries safe:
    // `activeCustomEditorId` holds one view type, so no two of these clauses are ever true
    // together. Pinned as distinct view types rather than as distinct strings, because two
    // entries naming the same view type would be one button drawn twice.
    const claimed = textEntries.map(
      (m) => /activeCustomEditorId == (dataExplorer\.\w+)/.exec(m.when)![1],
    );
    expect(new Set(claimed).size).toBe(claimed.length);
  });

  // Every palette entry has to be scoped to something it can actually act on, and there are
  // two honest ways to say so. The editor toggles are about the FILE, so they name the
  // extension. "Add an Entry" is about the VIEW: a .sldd open in the plain text editor has no
  // gallery to open, and the two editable table editors are only ever .sldd anyway — so
  // naming them is both narrower and more precise than naming the extension.
  //
  // Which is why the project page gets a tab BUTTON and no palette entry: a palette entry for
  // it would have to be scoped by view type (`.toml` is not that file's identity), and this
  // rule then reads it as a third editable view, which it is not. The button is on screen
  // whenever the page is, so nothing is unreachable — and a palette entry that fires on one
  // filename is a command the palette offers to a workspace that has no project at all.
  it('scopes every palette entry to a .sldd file or to an editable table view', () => {
    const EDITABLE_VIEWS = [TABLE_VIEW, BINARY_SLDD_VIEW];
    for (const entry of contributes.menus.commandPalette) {
      const byFile = entry.when.includes('resourceExtname == .sldd');
      const byView = EDITABLE_VIEWS.some((v: string) => entry.when.includes(`activeCustomEditorId == ${v}`));
      expect(byFile || byView, `palette entry ${entry.command} is offered everywhere`).toBe(true);
    }
  });
});

// The keyboard's way into the Add gallery. The command itself is the whole feature on the
// host side (it posts to the focused table and decides nothing), so what is worth pinning is
// the manifest: a declared command, a palette entry, and an accelerator that can only fire
// where there is a gallery to open.
describe('the Add-gallery accelerator', () => {
  const keybindings = contributes.keybindings as Array<{
    command: string;
    key: string;
    mac?: string;
    when?: string;
  }>;
  const ADD = 'dataExplorer.addEntry';

  it('declares the command, with an icon, in the Data Explorer category', () => {
    const cmd = contributes.commands.find((c: { command: string }) => c.command === ADD);
    expect(cmd).toBeTruthy();
    expect(cmd.category).toBe('Data Explorer');
    expect(cmd.icon).toMatch(/^\$\(/);
  });

  it('binds one accelerator on both platforms', () => {
    const entries = keybindings.filter((k) => k.command === ADD);
    expect(entries.length).toBe(1);
    expect(entries[0].key).toBe('ctrl+alt+a');
    expect(entries[0].mac).toBe('cmd+alt+a');
  });

  // Unscoped, this would steal cmd+alt+a from every other editor in the workbench. Scoped to
  // the two EDITABLE table views — the read-only .slx/.mat view has no Add button, so binding
  // a key there would be a key that does nothing.
  it('fires only where an entry can be added', () => {
    const when = keybindings.find((k) => k.command === ADD)!.when!;
    expect(when).toContain(`activeCustomEditorId == ${TABLE_VIEW}`);
    expect(when).toContain(`activeCustomEditorId == ${BINARY_SLDD_VIEW}`);
    expect(when).not.toContain(BINARY_VIEW);
  });

  it('takes a key no other Data Explorer binding has', () => {
    const keys = keybindings.map((k) => `${k.key} ${k.mac ?? ''}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is offered in the palette, scoped the same way as the key', () => {
    const entry = contributes.menus.commandPalette.find((m: { command: string }) => m.command === ADD);
    expect(entry).toBeTruthy();
    expect(entry.when).toBe(keybindings.find((k) => k.command === ADD)!.when);
  });
});
