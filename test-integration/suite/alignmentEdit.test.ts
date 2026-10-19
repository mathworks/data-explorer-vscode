// Copyright 2026 The MathWorks, Inc.
// A Simulink.Parameter's or Simulink.Signal's Alignment (CoderInfo.Alignment) is edited in its
// table cell, by MATLAB's rule, and the text editor saves it the way MATLAB saves it.
//
// The ruling (2026-10-16, group E, theme 2: follow MATLAB; C-086) turned the read-only label
// into an editable text cell wherever MATLAB takes an edit, which is any StorageClass but
// 'Auto'. The rule and the stored form are data-explorer-core's (its test/alignmentEdit.test.ts
// pins them on the node). vscode adds no code for it: the generic schema cell renders the
// editor and both providers hand the column to `node.setProperty`. So this suite is the lock on
// the part only the host can show, through the real SlddTextEditorProvider: the row it paints,
// the bytes its edit writes, and the refusal it relays.
//
// The fixture is core's MATLAB-written test/fixtures/classes_r2027a_text.sldd (R2027a, made by
// make_classes_r2027a.m there), kept beside the workspace folder so findFiles never returns it.
// Its entries were set up in MATLAB: pSC is ExportedGlobal with the default Alignment, pAl8 is
// ExportedGlobal with 8, pAlM1 is ExportedGlobal set to 8 and back to -1, pNo is Auto, and
// sAl16 is a Simulink.Signal, ExportedGlobal, with 16. So what MATLAB saves is in the file
// itself: pSC set to 8 has to save pAl8's CoderInfo, and pAl8 set back to -1 has to save pSC's.
//
// Each test edits its own copy, made in a temporary directory, so no test sees another's edit.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SlddTextEditorProvider } from '../../src/host/SlddTextEditorProvider';
import { chunkOf, ctx, fakePanel, rowNamed, token, waitFor, ws } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

const AUTO = "Cannot set Alignment when StorageClass is 'Auto'.";
const invalid = (n: number) =>
  `${n} is not a valid alignment boundary. The alignment boundary must be either -1 or a power of two.`;

const FIXTURE = 'classes_r2027a_text.sldd';

/** An entry's `value`, as the text spells it. */
function valueOf(text: string, name: string): any {
  const entry = ((chunkOf(text).entries ?? []) as any[]).find((e) => e.name === name);
  assert.ok(entry, `the text holds the entry "${name}"`);
  return entry.value;
}

/** The CoderInfo object of a Parameter's or Signal's single element. */
const coderInfoOf = (text: string, name: string): any => valueOf(text, name)._elements[0]._properties.CoderInfo;

/** Every entry but the ones named, as the text spells it, for "nothing else changed". */
const othersOf = (text: string, names: string[]): any[] =>
  ((chunkOf(text).entries ?? []) as any[]).filter((e) => !names.includes(e.name));

interface Opened {
  doc: vscode.TextDocument;
  view: ReturnType<typeof fakePanel>;
  rows: any[];
}

suite('a Parameter or Signal Alignment is edited in its table cell, as MATLAB edits it', () => {
  let dir: string | undefined;
  let view: ReturnType<typeof fakePanel> | undefined;
  let copies = 0;

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  teardown(() => {
    view?.close();
    view = undefined;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  /** A fresh copy of the fixture in the text editor, painted the way the webview asks for it. */
  async function open(): Promise<Opened> {
    dir = mkdtempSync(join(tmpdir(), 'dex-alignment-'));
    // A name of its own per test: VS Code keeps a TextDocument by URI, and a copy at a path an
    // earlier test edited could come back as that test's dirty document.
    const uri = vscode.Uri.file(join(dir, `alignment_${++copies}.sldd`));
    await vscode.workspace.fs.copy(vscode.Uri.joinPath(ws(), '..', 'classes', FIXTURE), uri);
    const doc = await vscode.workspace.openTextDocument(uri);
    view = fakePanel();
    await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, view.panel, token());
    view.send({ type: 'ready' });
    await waitFor('the table paint', () => view!.posts.some((p) => p.type === 'setRows' || p.type === 'error'));
    const failed = view.posts.find((p) => p.type === 'error');
    assert.ok(!failed, `the tab posted an error: ${failed?.message}`);
    return { doc, view, rows: view.posts.find((p) => p.type === 'setRows').rows };
  }

  /**
   * One cell edit, exactly as the table sends it, and what came of it: the text after it, and
   * the refusal if there was one. Waits for the edit to land in the document or be refused,
   * and then for the repaint of its entry, which the host posts beside either.
   */
  async function edit(
    opened: Opened,
    entry: string,
    columnId: string,
    oldValue: string,
    newValue: string,
  ): Promise<{ before: string; after: string; refusal: any; repaint: any }> {
    const before = opened.doc.getText();
    const from = opened.view.posts.length;
    const rowId = rowNamed(opened.rows, entry).ID;
    opened.view.send({ type: 'edit', rowId, columnId, oldValue, newValue });
    const since = () => opened.view.posts.slice(from);
    const errored = () => since().some((p) => p.type === 'error');
    await waitFor(
      'the edit to reach the document or be refused',
      () => opened.doc.getText() !== before || since().some((p) => p.type === 'validationError') || errored(),
    );
    // A write paints the entry before it is made, and a refusal paints it back after.
    await waitFor(
      'the repaint of the edited entry',
      () => errored() || since().some((p) => p.type === 'updateEntryRows' && p.entryRowId === rowId),
    );
    const failed = since().find((p) => p.type === 'error');
    assert.ok(!failed, `the edit posted an error: ${failed?.message}`);
    const repaints = since().filter((p) => p.type === 'updateEntryRows' && p.entryRowId === rowId);
    const repaint = repaints.length ? repaints[repaints.length - 1].rows.find((r: any) => r.ID === rowId) : undefined;
    return {
      before,
      after: opened.doc.getText(),
      refusal: since().find((p) => p.type === 'validationError'),
      repaint,
    };
  }

  test('the cell is a text editor under any StorageClass but Auto, and plain text under Auto', async () => {
    const { rows } = await open();
    for (const [name, text] of [['pSC', '-1'], ['pAl8', '8'], ['pAlM1', '-1'], ['sAl16', '16']]) {
      const cell = rowNamed(rows, name).alignment;
      assert.strictEqual(typeof cell, 'object', `${name}'s Alignment is an editable cell (${JSON.stringify(cell)})`);
      assert.strictEqual(cell.editable, true, `${name}'s Alignment cell is editable`);
      assert.strictEqual(cell.editor, 'text', `${name}'s Alignment is typed into, not chosen from a list`);
      assert.strictEqual(cell.options, undefined, `${name}'s Alignment offers no list`);
      assert.strictEqual(cell.text, text, `${name}'s Alignment shows the value MATLAB saved`);
    }
    // StorageClass Auto: MATLAB refuses every Alignment but -1, so the table offers no editor.
    assert.strictEqual(rowNamed(rows, 'pNo').alignment, '-1', 'a Parameter under Auto shows -1, read-only');
    assert.strictEqual(rowNamed(rows, 'sigA').alignment, '-1', 'a Signal under Auto shows -1, read-only');
  });

  test('8 on pSC saves the CoderInfo MATLAB saved for pAl8, and changes nothing else', async () => {
    const opened = await open();
    const { before, after, refusal, repaint } = await edit(opened, 'pSC', 'alignment', '-1', '8');
    assert.strictEqual(refusal, undefined, `the edit was accepted (refused: ${refusal?.reason})`);
    assert.notStrictEqual(after, before, 'the edit reached the document');

    const info = coderInfoOf(after, 'pSC');
    assert.deepStrictEqual(info._properties.Alignment, { _type: 'int32', _value: '8' }, 'a typed int32, never a string');
    assert.strictEqual(Object.keys(info._properties)[0], 'Alignment', 'first in CoderInfo, where MATLAB puts it');
    assert.deepStrictEqual(info, coderInfoOf(before, 'pAl8'), "pAl8's CoderInfo, as MATLAB saved it");

    // The rest of pSC's value, and every other entry, exactly as read.
    const expected = valueOf(before, 'pSC');
    expected._elements[0]._properties.CoderInfo = coderInfoOf(before, 'pAl8');
    assert.deepStrictEqual(valueOf(after, 'pSC'), expected, 'nothing else in pSC changed');
    assert.deepStrictEqual(othersOf(after, ['pSC']), othersOf(before, ['pSC']), 'no other entry changed');

    assert.ok(repaint, 'the entry was repainted');
    assert.strictEqual(repaint.alignment?.text, '8', 'and its cell shows the new Alignment');
    assert.strictEqual(repaint.alignment?.editable, true, 'still editable');
  });

  test('-1 takes the key back out, which is how MATLAB saves the default', async () => {
    const opened = await open();
    const original = opened.doc.getText();
    const set = await edit(opened, 'pSC', 'alignment', '-1', '8');
    assert.strictEqual(set.refusal, undefined, `8 was accepted (refused: ${set.refusal?.reason})`);
    assert.deepStrictEqual(
      coderInfoOf(set.after, 'pSC')._properties.Alignment,
      { _type: 'int32', _value: '8' },
      '8 reached the document',
    );

    const back = await edit(opened, 'pSC', 'alignment', '8', '-1');
    assert.strictEqual(back.refusal, undefined, `-1 was accepted (refused: ${back.refusal?.reason})`);
    assert.ok(!('Alignment' in coderInfoOf(back.after, 'pSC')._properties), 'no Alignment key at -1');
    assert.deepStrictEqual(valueOf(back.after, 'pSC'), valueOf(original, 'pSC'), 'pSC is back to what MATLAB wrote');
    assert.deepStrictEqual(othersOf(back.after, ['pSC']), othersOf(original, ['pSC']), 'no other entry changed');
    assert.strictEqual(back.repaint?.alignment?.text, '-1', 'and its cell shows -1');

    // The same on an entry MATLAB itself saved at 8: pAl8 set to -1 saves pAlM1's CoderInfo.
    const pAl8 = await edit(opened, 'pAl8', 'alignment', '8', '-1');
    assert.strictEqual(pAl8.refusal, undefined, `-1 on pAl8 was accepted (refused: ${pAl8.refusal?.reason})`);
    assert.deepStrictEqual(coderInfoOf(pAl8.after, 'pAl8'), coderInfoOf(original, 'pAlM1'), "pAlM1's CoderInfo");
  });

  test('a value MATLAB refuses is refused in its words, and the document is unchanged', async () => {
    const opened = await open();
    const { before, after, refusal, repaint } = await edit(opened, 'pSC', 'alignment', '-1', '3');
    assert.ok(refusal, 'the edit was refused');
    assert.strictEqual(refusal.reason, invalid(3), "MATLAB's reason, without its inaccurate 128 bound");
    assert.strictEqual(refusal.invalidValue, '3', 'naming what was typed');
    assert.strictEqual(after, before, 'the document is unchanged');
    assert.strictEqual(repaint?.alignment?.text, '-1', 'and the cell is repainted back to -1');
  });

  test('under StorageClass Auto an Alignment is refused, as MATLAB refuses it', async () => {
    const opened = await open();
    const { before, after, refusal } = await edit(opened, 'pNo', 'alignment', '-1', '8');
    assert.ok(refusal, 'the edit was refused');
    assert.strictEqual(refusal.reason, AUTO, "MATLAB's reason");
    assert.strictEqual(after, before, 'the document is unchanged');
  });

  test('StorageClass set to Auto resets Alignment, saving the CoderInfo MATLAB saved for pNo', async () => {
    const opened = await open();
    const { before, after, refusal, repaint } = await edit(opened, 'pAl8', 'storageClass', 'ExportedGlobal', 'Auto');
    assert.strictEqual(refusal, undefined, `the edit was accepted (refused: ${refusal?.reason})`);
    assert.notStrictEqual(after, before, 'the edit reached the document');
    assert.deepStrictEqual(coderInfoOf(after, 'pAl8'), coderInfoOf(before, 'pNo'), "pNo's CoderInfo: Auto, and no Alignment");
    assert.strictEqual(repaint?.alignment, '-1', 'and the cell is -1 and read-only again');
  });
});
