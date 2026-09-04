// Copyright 2026 The MathWorks, Inc.
//
// Who creates the webview's overlay elements.
//
// The table webview's HTML is assembled as a string by THREE host providers, and
// a fourth shell (src/webview/table.html) exists for vite dev. table-main.ts is
// shared by all of them, so every element it looks up in markup is one rule
// spread over four paths. Two real bugs came from that split:
//
//   * BinaryEditorProvider never had <dex-error-dialog>, so `errorDialog?.show()`
//     silently did nothing and invalid-value errors were invisible in that view.
//   * <dex-variable-editor> was added to table.html only — vite's dev entry, not
//     a shipped shell — so the element was null at runtime and a close() call in
//     the setRows handler threw, blanking the table for every file.
//
// The rule now is: markup owns the CONTENT element, table-main.ts owns every
// OVERLAY. Neither fault is reachable from a DOM test, because the providers
// import vscode and the markup is a template literal — so this reads the sources.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

// Self-positioning, initially hidden popovers. None has a place in the shell's
// layout, so none belongs in the shell's markup.
const OVERLAYS = ['dex-context-menu', 'dex-error-dialog', 'dex-variable-editor'];

// Every shell that table-main.ts runs inside.
const TABLE_SHELLS = [
  'src/host/SlddTextEditorProvider.ts',
  'src/host/BinarySlddEditorProvider.ts',
  'src/host/BinaryEditorProvider.ts',
  'src/webview/table.html',
];

describe('table webview overlays are created in code, not declared in markup', () => {
  it.each(TABLE_SHELLS)('%s declares no overlay element', (shell) => {
    const src = read(shell);
    for (const tag of OVERLAYS) {
      expect(src).not.toContain(`<${tag}>`);
    }
  });

  it.each(OVERLAYS)('table-main.ts creates %s itself', (tag) => {
    expect(read('src/webview/table-main.ts')).toContain(`overlay('${tag}')`);
  });

  it('still takes the content element from markup, since only the shell places it', () => {
    // The inverse of the rule: dex-tree-table is positioned by each shell
    // (position:absolute;inset:0), so the shell must be the one to create it.
    expect(read('src/webview/table-main.ts')).toContain("document.querySelector('dex-tree-table')");
    for (const shell of TABLE_SHELLS) {
      expect(read(shell)).toContain('<dex-tree-table');
    }
  });

  it('uses the overlays unguarded, because they can no longer be missing', () => {
    // `errorDialog?.show(...)` was load-bearing while a provider could omit the
    // tag. Now that this module creates it, the optional call would only hide a
    // typo — and the guard's absence is what keeps the invariant honest.
    expect(read('src/webview/table-main.ts')).not.toContain('errorDialog?.');
  });
});
