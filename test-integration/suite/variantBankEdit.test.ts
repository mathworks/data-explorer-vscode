// Copyright 2026 The MathWorks, Inc.
// A Simulink.VariantBank's own fields and a Simulink.VariantBankCoderInfo's are columns of the
// table, edited in their cells, and saved, in a JSON dictionary and in a binary one.
//
// The ruling (2026-10-18, group F: C-168B and C-169B) has two halves. data-explorer-core 1.41.0
// reads, checks and writes the fields (its test/variantBankFields.test.ts pins the node), and
// sends each as an editable cell: Bank Name, Variant Conditions, All Choices Coder Info and
// Active Choice Coder Info for a bank, and Header File, Definition File, Pre Statement, Post
// Statement and Qualifier for a coder info. This extension's half is to offer those cells as
// columns, under a label and a picker group. Before it, core sent the cells and the table had no
// column to show them in, so none of them could be seen or edited. Both providers hand any
// column to `node.setProperty`, so what only a host can show is checked here, through the real
// SlddTextEditorProvider and BinarySlddEditorProvider: the columns the first paint offers, the
// cells the rows carry, what an edit of each kind writes and saves, and the refusal relayed.
//
// The fixtures are core's MATLAB-written test/fixtures/variantbank_r2027a_{text,binary}.sldd
// (R2027a, made by make_variantbank_r2027a.m there), kept beside the workspace folder so
// findFiles never returns them. vbN is a bank with every field set; ciA and ciB are coder infos,
// ciA set and ciB at MATLAB's defaults.
//
// Each test works on its own copies in a temporary directory, so no test sees another's edit.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SlddTextEditorProvider } from '../../src/host/SlddTextEditorProvider';
import { BinarySlddEditorProvider } from '../../src/host/BinarySlddEditorProvider';
import { chunkOf, ctx, fakePanel, rowNamed, token, waitFor, ws } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The columns a bank's and a coder info's fields are shown in: the id, the label its header
 * reads, and the picker group it is under. Header File was already a column (a Parameter's and
 * a Signal's); the other eight are new.
 */
const OFFERED: Array<[string, string, string]> = [
  ['headerFile', 'Header File', 'Code Generation'],
  ['bankName', 'Bank Name', 'Variant Bank'],
  ['variantConditions', 'Variant Conditions', 'Variant Bank'],
  ['allChoicesCoderInfo', 'All Choices Coder Info', 'Variant Bank'],
  ['activeChoiceCoderInfo', 'Active Choice Coder Info', 'Variant Bank'],
  ['definitionFile', 'Definition File', 'Code Generation'],
  ['preStatement', 'Pre Statement', 'Code Generation'],
  ['postStatement', 'Post Statement', 'Code Generation'],
  ['qualifier', 'Qualifier', 'Code Generation'],
];

/**
 * One edit of each kind, as the table sends it: the entry, the column, the cell's text before
 * it, what was typed or chosen, and what the cell shows after it, which is how MATLAB spells it.
 * `field` is the saveobj field the edit writes, and `saved` is that field as a JSON dictionary
 * then holds it.
 */
interface Edit {
  entry: string;
  column: string;
  from: string;
  typed: string;
  shown: string;
  field: string;
  saved: unknown;
}

const cellOf = (conditions: string[]) => ({
  _array_type: 'Cell',
  _dimensions: [1, conditions.length],
  _elements: conditions,
});

const EDITS: Edit[] = [
  // Text cells.
  { entry: 'vbN', column: 'bankName', from: 'bankA', typed: 'bankB', shown: 'bankB', field: 'Name', saved: 'bankB' },
  {
    entry: 'vbN',
    column: 'allChoicesCoderInfo',
    from: 'ciA',
    typed: 'ciB',
    shown: 'ciB',
    field: 'AllChoicesCoderInfo',
    saved: 'ciB',
  },
  {
    entry: 'vbN',
    column: 'activeChoiceCoderInfo',
    from: 'ciB',
    typed: 'ciA',
    shown: 'ciA',
    field: 'ActiveChoiceCoderInfo',
    saved: 'ciA',
  },
  { entry: 'ciB', column: 'headerFile', from: '', typed: 'h.h', shown: 'h.h', field: 'HeaderFile', saved: 'h.h' },
  { entry: 'ciB', column: 'definitionFile', from: '', typed: 'd.c', shown: 'd.c', field: 'DefinitionFile', saved: 'd.c' },
  // A cell literal, saved as a cell of the conditions in MATLAB's spelling.
  {
    entry: 'vbN',
    column: 'variantConditions',
    from: "{'V == 1','V == 2'}",
    typed: "{'V==1','V == 3'}",
    shown: "{'V == 1','V == 3'}",
    field: 'VariantConditions',
    saved: cellOf(['V == 1', 'V == 3']),
  },
  // The two textArea cells, one with a line break.
  {
    entry: 'ciB',
    column: 'preStatement',
    from: '',
    typed: 'pre\nline two',
    shown: 'pre\nline two',
    field: 'PreStatement',
    saved: 'pre\nline two',
  },
  { entry: 'ciB', column: 'postStatement', from: '', typed: 'post', shown: 'post', field: 'PostStatement', saved: 'post' },
  // The select cell, saved in MATLAB's spelling of the choice.
  { entry: 'ciB', column: 'qualifier', from: 'None', typed: 'Volatile', shown: 'Volatile', field: 'Qualifier', saved: 'Volatile' },
];

/** Edits MATLAB refuses, and its words for each (core's, relayed as they are). */
const REFUSED: Array<{ entry: string; column: string; from: string; typed: string; reason: string }> = [
  {
    entry: 'vbN',
    column: 'bankName',
    from: 'bankA',
    typed: '1bad',
    reason: `'Name' property for Simulink.VariantBank must be a valid C identifier that does not start with "rt".`,
  },
  {
    entry: 'vbN',
    column: 'variantConditions',
    from: "{'V == 1','V == 2'}",
    typed: 'V == 1',
    reason: "'VariantConditions' property for Simulink.VariantBank must be a cell array.",
  },
  {
    entry: 'vbN',
    column: 'allChoicesCoderInfo',
    from: 'ciA',
    typed: '_a',
    reason:
      "'AllChoicesCoderInfo' value '_a' must be a valid variable name corresponding to Simulink.VariantBankCoderInfo object.",
  },
  {
    entry: 'ciB',
    column: 'headerFile',
    from: '',
    typed: 'a.c',
    reason: "Change file extension 'c' to header file extension '.h' or '.hpp'.",
  },
  {
    entry: 'ciB',
    column: 'qualifier',
    from: 'None',
    typed: 'Restrict',
    reason: "Error setting property 'Qualifier' of class 'VariantBankCoderInfo': There is no enumerated value named 'Restrict'.",
  },
];

/** A dictionary open in one of the two editors, painted the way the webview asks for it. */
interface Opened {
  view: ReturnType<typeof fakePanel>;
  setRows: any;
  rows: any[];
  /** What the editor holds now: the JSON text, or the binary chunk's XML. */
  held: () => string;
  /** Whether the editor reports an unsaved change. */
  dirty: () => boolean;
  save: () => Promise<void>;
  close: () => void;
}

type Format = 'JSON' | 'binary';
const FIXTURE: Record<Format, string> = {
  JSON: 'variantbank_r2027a_text.sldd',
  binary: 'variantbank_r2027a_binary.sldd',
};

/** A cell's text, editability, editor and options, without the keys a pooled cell carries as undefined. */
const cell = (c: any) => ({
  text: c?.text,
  editable: c?.editable,
  editor: c?.editor,
  ...(c?.options !== undefined ? { options: c.options } : {}),
});

/** The bank's or coder info's saveobj fields, as a JSON dictionary's text holds them. */
function fieldsOf(text: string, name: string): any {
  const entry = ((chunkOf(text).entries ?? []) as any[]).find((e) => e.name === name);
  assert.ok(entry, `the text holds the entry "${name}"`);
  return entry.value._elements[0]._custom_save._elements[0];
}

suite('A VariantBank and a VariantBankCoderInfo are edited in their own columns, and saved', () => {
  let dir: string | undefined;
  const open: Opened[] = [];
  let copies = 0;

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  teardown(async () => {
    for (const o of open.splice(0)) o.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  /** A fresh copy of a file in the temporary directory. A name of its own, so no cached model or document is reused. */
  async function copyOf(from: vscode.Uri): Promise<vscode.Uri> {
    dir ??= mkdtempSync(join(tmpdir(), 'dex-variantbank-'));
    const uri = vscode.Uri.file(join(dir, `variantbank_${++copies}.sldd`));
    await vscode.workspace.fs.copy(from, uri);
    return uri;
  }

  const fixture = (format: Format) => vscode.Uri.joinPath(ws(), '..', 'classes', FIXTURE[format]);

  /** Open `uri` in the editor for its format, and wait for the first paint. */
  async function openIn(format: Format, uri: vscode.Uri): Promise<Opened> {
    const view = fakePanel();
    let opened: Opened;
    if (format === 'JSON') {
      const doc = await vscode.workspace.openTextDocument(uri);
      await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, view.panel, token());
      opened = {
        view,
        setRows: undefined,
        rows: [],
        held: () => doc.getText(),
        dirty: () => doc.isDirty,
        save: async () => {
          assert.ok(await doc.save(), 'the JSON dictionary saved');
        },
        close: () => view.close(),
      };
    } else {
      const provider = new BinarySlddEditorProvider(ctx());
      let edits = 0;
      const sub = provider.onDidChangeCustomDocument(() => {
        edits += 1;
      });
      const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
      await provider.resolveCustomEditor(doc, view.panel, token());
      opened = {
        view,
        setRows: undefined,
        rows: [],
        held: () => (doc as any).chunkXml as string,
        dirty: () => edits > 0,
        save: () => provider.saveCustomDocument(doc, token()),
        close: () => {
          view.close();
          sub.dispose();
          doc.dispose();
        },
      };
    }
    open.push(opened);
    view.send({ type: 'ready' });
    await waitFor('the table paint', () => view.posts.some((p) => p.type === 'setRows' || p.type === 'error'));
    const failed = view.posts.find((p) => p.type === 'error');
    assert.ok(!failed, `the tab posted an error: ${failed?.message}`);
    opened.setRows = view.posts.find((p) => p.type === 'setRows');
    opened.rows = opened.setRows.rows;
    return opened;
  }

  /**
   * The table offers `column`: the host lists it among the columns, under its label and picker
   * group. This is what the change adds; without it the cell core sends has nowhere to be shown,
   * so it can be neither seen nor edited.
   */
  function assertOffered(opened: Opened, column: string): void {
    const offered = OFFERED.find(([c]) => c === column);
    assert.ok(offered, `${column} is one of this suite's columns`);
    const [, label, group] = offered;
    const { columns, columnLabels, columnGroups } = opened.setRows;
    assert.ok(columns.includes(column), `the table offers a ${column} column (columns: ${columns.join(', ')})`);
    assert.strictEqual(columnLabels[column], label, `headed "${label}"`);
    assert.strictEqual(columnGroups[column], group, `in the picker's ${group} group`);
  }

  /**
   * One cell edit, exactly as the table sends it, and what came of it: what the editor held
   * before and after it, the refusal if there was one, and the entry's repainted row. Waits for
   * the edit to land or be refused, and gives up quietly after a while, so that an edit that does
   * neither fails on the assertion that says so rather than as a timeout.
   */
  async function edit(
    opened: Opened,
    entry: string,
    column: string,
    oldValue: string,
    newValue: string,
  ): Promise<{ before: string; after: string; refusal: any; repaint: any }> {
    const before = opened.held();
    const from = opened.view.posts.length;
    const rowId = rowNamed(opened.rows, entry).ID;
    opened.view.send({ type: 'edit', rowId, columnId: column, oldValue, newValue });
    const since = () => opened.view.posts.slice(from);
    const repainted = () => since().some((p) => p.type === 'updateEntryRows' && p.entryRowId === rowId);
    await waitFor(
      'the edit to land or be refused, and its entry to be repainted',
      () =>
        ((opened.held() !== before || since().some((p) => p.type === 'validationError')) && repainted()) ||
        since().some((p) => p.type === 'error'),
    );
    const failed = since().find((p) => p.type === 'error');
    assert.ok(!failed, `the edit posted an error: ${failed?.message}`);
    const repaints = since().filter((p) => p.type === 'updateEntryRows' && p.entryRowId === rowId);
    const repaint = repaints.length ? repaints[repaints.length - 1].rows.find((r: any) => r.ID === rowId) : undefined;
    return { before, after: opened.held(), refusal: since().find((p) => p.type === 'validationError'), repaint };
  }

  for (const format of ['JSON', 'binary'] as Format[]) {
    test(`${format}: the first paint offers the bank's and the coder info's columns, and the rows fill them`, async () => {
      const opened = await openIn(format, await copyOf(fixture(format)));
      for (const [column] of OFFERED) assertOffered(opened, column);

      const vbN = rowNamed(opened.rows, 'vbN');
      for (const [column, text] of [
        ['bankName', 'bankA'],
        ['variantConditions', "{'V == 1','V == 2'}"],
        ['allChoicesCoderInfo', 'ciA'],
        ['activeChoiceCoderInfo', 'ciB'],
      ]) {
        assert.deepStrictEqual(cell(vbN[column]), { text, editable: true, editor: 'text' }, `vbN's ${column} cell`);
      }
      const ciA = rowNamed(opened.rows, 'ciA');
      assert.deepStrictEqual(cell(ciA.headerFile), { text: 'h.h', editable: true, editor: 'text' }, "ciA's Header File");
      assert.deepStrictEqual(cell(ciA.definitionFile), { text: 'd.c', editable: true, editor: 'text' }, "ciA's Definition File");
      assert.deepStrictEqual(cell(ciA.preStatement), { text: 'pre', editable: true, editor: 'textArea' }, "ciA's Pre Statement");
      assert.deepStrictEqual(cell(ciA.postStatement), { text: 'post', editable: true, editor: 'textArea' }, "ciA's Post Statement");
      assert.deepStrictEqual(
        cell(ciA.qualifier),
        { text: 'Const', editable: true, editor: 'select', options: ['None', 'Const', 'Volatile', 'ConstVolatile'] },
        "ciA's Qualifier, a choice of MATLAB's four",
      );
      // A coder info has no Description in MATLAB, and core says so on the row, which is what
      // keeps the table from offering an editor for one.
      assert.strictEqual(ciA._descriptionEditable, false, 'a coder info offers no Description');
      assert.notStrictEqual(vbN._descriptionEditable, false, 'a bank keeps its Description');
    });

    test(`${format}: an edit of each kind commits, is shown as MATLAB spells it, and is saved`, async () => {
      const uri = await copyOf(fixture(format));
      const opened = await openIn(format, uri);
      const original = opened.held();
      for (const e of EDITS) {
        const mark = opened.view.posts.length;
        assertOffered(opened, e.column);
        assert.strictEqual(rowNamed(opened.rows, e.entry)[e.column]?.text, e.from, `${e.entry}'s ${e.column} reads as read`);
        const { before, after, refusal, repaint } = await edit(opened, e.entry, e.column, e.from, e.typed);
        assert.strictEqual(refusal, undefined, `${e.column}: accepted (refused: ${refusal?.reason})`);
        assert.notStrictEqual(after, before, `${e.column}: the edit reached the ${format} dictionary`);
        assert.ok(repaint, `${e.column}: the entry was repainted`);
        assert.strictEqual(repaint[e.column]?.text, e.shown, `${e.column}: its cell shows ${JSON.stringify(e.shown)}`);
        assert.strictEqual(repaint[e.column]?.editable, true, `${e.column}: and is still editable`);
        if (format === 'JSON') {
          assert.deepStrictEqual(fieldsOf(after, e.entry)[e.field], e.saved, `${e.column}: written into ${e.field}`);
        }
        // The write's own change event only confirms the paint above, by painting the entry
        // again; it has to land here, not inside the next edit. A binary write fires none.
        if (format === 'JSON') {
          await waitFor('the write’s own change event to repaint the entry', () =>
            opened.view.posts.slice(mark).filter((p) => p.type === 'updateEntryRows' || p.type === 'setRows').length >= 2,
          );
        }
      }
      assert.ok(opened.dirty(), 'the editor holds unsaved edits');

      if (format === 'JSON') {
        // Nothing but the edited fields changed: every other field of the two edited entries,
        // and every other entry. (An edited entry's metadata takes a new modification stamp.)
        const edited = new Set(EDITS.map((e) => e.entry));
        const expected = chunkOf(original).entries as any[];
        for (const e of EDITS) {
          expected.find((x) => x.name === e.entry).value._elements[0]._custom_save._elements[0][e.field] = e.saved;
        }
        const now = chunkOf(opened.held()).entries as any[];
        assert.deepStrictEqual(now.map((x) => x.name), expected.map((x) => x.name), 'the same entries, in order');
        for (const [i, x] of expected.entries()) {
          if (edited.has(x.name)) assert.deepStrictEqual(now[i].value, x.value, `${x.name}: only the edited fields changed`);
          else assert.deepStrictEqual(now[i], x, `${x.name}: unchanged`);
        }
      }

      await opened.save();
      if (format === 'JSON') {
        const onDisk = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        assert.strictEqual(onDisk, opened.held(), 'the save wrote what the editor holds');
      }

      // Read back through a fresh editor, from a copy of the saved file: every edit is there.
      const reread = await openIn(format, await copyOf(uri));
      for (const e of EDITS) {
        assert.strictEqual(
          rowNamed(reread.rows, e.entry)[e.column]?.text,
          e.shown,
          `${e.entry}'s ${e.column} reads back as saved`,
        );
      }
      // And the fields no edit touched read back as MATLAB wrote them.
      assert.strictEqual(rowNamed(reread.rows, 'ciA').qualifier?.text, 'Const', "ciA's Qualifier is as read");
      assert.strictEqual(rowNamed(reread.rows, 'vbN').Description, 'desc A', "vbN's Description is as read");
    });

    test(`${format}: an edit MATLAB refuses shows core's message and changes nothing`, async () => {
      const opened = await openIn(format, await copyOf(fixture(format)));
      const original = opened.held();
      for (const r of REFUSED) {
        assertOffered(opened, r.column);
        const { after, refusal, repaint } = await edit(opened, r.entry, r.column, r.from, r.typed);
        assert.ok(refusal, `${r.column} ${JSON.stringify(r.typed)}: refused`);
        assert.strictEqual(refusal.reason, r.reason, `${r.column}: in MATLAB's words, as core gives them`);
        assert.strictEqual(refusal.invalidValue, r.typed, `${r.column}: naming what was typed`);
        assert.strictEqual(refusal.previousValue, r.from, `${r.column}: and what the cell held`);
        assert.strictEqual(after, original, `${r.column}: the ${format} dictionary is unchanged`);
        assert.ok(repaint, `${r.column}: the entry was repainted`);
        assert.strictEqual(repaint[r.column]?.text, r.from, `${r.column}: and its cell is back to what it held`);
      }
      assert.strictEqual(opened.dirty(), false, 'the editor holds no unsaved change');
    });
  }
});
