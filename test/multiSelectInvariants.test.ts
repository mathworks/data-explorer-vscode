// Copyright 2026 The MathWorks, Inc.
//
// The seams between the paths a multi-row action travels, where they run through this extension's
// own sources: the providers hand a paste and a drop to the same transfer, and the webview
// (table-main.ts) describes the menu once, so the keyboard cannot disagree with it.
//
// The rest of this suite asserted the menu's and the host's resolutions of one selection against
// each other over a real model (operands, anchors, subsumption, paste-offered, the drag
// predictor and the no-op move). Both halves are view's and core's now, and those cases are in
// view, by the same names (its multiSelectInvariants.test.ts, and the JSON engine's clipboard
// tests).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { blankCommentsAndKeepLines } from './tools/moduleGraph.js';

describe('a drag is a no-op exactly where the same cut and paste is (V-002)', () => {
  // The host's rule — a move into the section EVERY item came from does nothing — is the rule for
  // a paste AND a drop, because both gestures go through one runTransfer. The providers host view's
  // engines, which hand both to the engine's table, whose runTransfer and its no-op rule are view's
  // (isNoopTransfer, pinned against the drop predictor in view's multiSelectInvariants and
  // noopMoveAgreement). So the providers are read here only to check that they still hand both
  // gestures to the table, and keep no copy of the rule of their own.
  for (const provider of ['SlddTextEditorProvider', 'BinarySlddEditorProvider']) {
    it(`${provider} pastes and drops through runTransfer`, () => {
      const text = blankCommentsAndKeepLines(
        readFileSync(fileURLToPath(new URL(`../src/host/${provider}.ts`, import.meta.url)), 'utf8'),
      );
      if (/\.engine\.view\(\)|\bopenJsonTable\(/.test(text)) {
        expect(text).toMatch(/msg\?\.type === 'paste'\) table\.paste\?\.\(/);
        expect(text).toMatch(/msg\?\.type === 'drop'\) table\.drop\?\.\(/);
      } else {
        // Each register reaches runTransfer — directly, or (for a queued drop, which captures its
        // register as the message arrives) through the one statement that queues it.
        expect(text).toMatch(/runTransfer\([^;]*clipboardRegister\(/);
        expect(text).toMatch(/runTransfer\([^;]*dragRegister\(|dragRegister\([^;]*\);\s*return queueStructural\(\(\) => runTransfer\(/);
      }
      expect(text, 'and no copy of the no-op rule of its own').not.toMatch(/\.every\(\(it\) => it\.sourceSection ===/);
    });
  }
});

describe('the keyboard cannot disagree with the menu', () => {
  // table-main.ts runs top-level side effects against a live table element, so it is not
  // importable here; what is checkable is that it describes the menu ONCE. The old code
  // computed enablement twice — buildContextMenuItems for the menu, a ternary over
  // _canCopy/_canDelete for the chord — with a comment promising they matched.
  const src = blankCommentsAndKeepLines(
    readFileSync(fileURLToPath(new URL('../src/webview/table-main.ts', import.meta.url)), 'utf8'),
  );

  it('builds the menu in exactly one place', () => {
    expect(src.match(/buildContextMenuItems\(/g) ?? []).toHaveLength(1);
  });

  it('gates every chord on the item that chord would click', () => {
    expect(src).toContain("find((i) => i.id === action)");
    expect(src).toContain("find((i) => i.id === 'locateInText')");
  });

  it('re-derives no capability of its own', () => {
    for (const flag of ['_canCopy', '_canDelete', '_canAddChild']) {
      expect(src, `table-main reads ${flag} again`).not.toContain(flag);
    }
  });

  it('resolves a paste target through operands.ts, never a parent lookup of its own', () => {
    // The other half of "one answer to which rows this acts on": the DESTINATION. A row's
    // section is a whole-chain walk (sectionRowIdOf), mirroring the host's
    // findOwningEntry(node).parent. Reading the row's immediate `parent` instead answered
    // null for a nested bus element, and null reads as "no destination" — so Paste greyed
    // out on a child while the host would have accepted it, with no reason shown.
    expect(src, 'the walk comes from operands.ts').toContain('sectionRowIdOf(');
    expect(src, 'table-main walks to a section itself').not.toMatch(/sectionNameFromRowId\([^)]*parent/);
  });
});
