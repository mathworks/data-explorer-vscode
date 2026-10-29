// Copyright 2026 The MathWorks, Inc.
//
// What a dictionary editor saves after an edit is what core saves after the same edit, in real
// VS Code, for edits at every depth: a field, an element of a struct array, a cell inside cells,
// a member of a Parameter's struct Value, a Bus element; values, a property, renames, an Add and a
// Delete.
//
// Neither editor saves through core's serializeSource, which is what an edit sweep of core judges
// against MATLAB. The JSON editor writes the edited entry's text itself, re-serialized into its
// TextDocument (structuralEdit.ts reserializeEntry), and saves the document; the binary editor
// splices the entry into the chunk it read and zips it with its own save. So each is held here to
// core's save of the same model edit: the JSON file to its text (but for each entry's lastmod,
// the clock of the save), the binary file to what a fresh read of it shows, row for row.
//
// The two numbers past 2^63 are there for the JSON writer: a double JSON.stringify spells as an
// integer literal is a dictionary MATLAB cannot open, so a change to how core writes a text
// dictionary's numbers has to reach the editor's own writer too, or the two saves part here.
//
// The last edit types a cell over cLeaves{9}, a complex [1+2i 3-4i] the file holds as a MAT
// stream. The JSON editor repaints the table before it writes the entry, and the repaint asks every
// row whether it can take an Add or a Delete. Through core v1.52.0 that question, for an element
// of a cell edited under a stream, changed the value it was asked about, so the editor saved
// {[1 0], true} for {[1 2], true}, and a Delete right after the edit took the wrong elements. Two
// tests below hold the JSON editor to the value as typed, without core's save to compare with.
//
// The fixtures are the R2027a text and binary dictionaries of core's edit-bash parity set.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createSession, ingest } from 'data-explorer-core';
import { quiet, ws } from './tools/hostHarness';
import { shownCells } from './tools/tables';
import { binaryEditorSave, coreSave, jsonEditorSave, nodeAt, type Edit } from './tools/editorSaves';

/* eslint-disable @typescript-eslint/no-explicit-any */

const EDITS: Edit[] = [
  { path: 'dRow(1)', op: 'value', key: 'Value', text: '7' },
  { path: 'strRow(1)', op: 'value', key: 'Value', text: '"abc"' },
  { path: 'sLeaves.dScalar', op: 'value', key: 'Value', text: '[1;2;3]' },
  { path: 'sArr(1).a', op: 'value', key: 'Value', text: '+5' },
  { path: 'cLeaves{1}', op: 'value', key: 'Value', text: '[1 2 3]' },
  { path: 'sNest.c{2}.s.f', op: 'value', key: 'Value', text: '0' },
  { path: 'cNest{1}{2}{1}', op: 'value', key: 'Value', text: '[1 2; 3 4]' },
  { path: 'pStruct.Value.a', op: 'value', key: 'Value', text: '-3.25' },
  { path: 'pStruct.Value.inner.x', op: 'value', key: 'Value', text: '.5' },
  { path: 'pStructArr.Value(1).a', op: 'value', key: 'Value', text: '-0' },
  { path: 'pInt8.Value(1)', op: 'value', key: 'Value', text: 'NaN' },
  { path: 'sHoldsParam.p', op: 'prop', key: 'Min', text: '0' },
  { path: 'bus.e1', op: 'prop', key: 'complexity', text: 'complex' },
  { path: 'sNest.c{2}.s', op: 'name', text: 'zz_new' },
  { path: 'pStruct.Value.inner.x', op: 'name', text: 'zz_new' },
  { path: 'sLeaves.dRow', op: 'add' },
  { path: 'saCell(2).c{1}', op: 'add' },
  { path: 'pStruct.Value.inner.y', op: 'add' },
  { path: 'cNest{1}{2}{1}', op: 'delete' },
  { path: 'pStruct.Value.b(1)', op: 'delete' },
  { path: 'sArr(2).b', op: 'value', key: 'Value', text: '18446744073709551615' },
  { path: 'cNest{1}{2}{2}', op: 'value', key: 'Value', text: '-9223372036854775808' },
  { path: 'cLeaves{9}', op: 'value', key: 'Value', text: '{[1 2], true}' },
];
const CELL_OVER_STREAM = EDITS[EDITS.length - 1];

const FIXTURES = join(ws().fsPath, '..', 'editbash');
const label = (e: Edit) => `${e.op} ${e.path}${e.key && e.op === 'prop' ? '.' + e.key : ''}${e.text !== undefined ? ' = ' + e.text : ''}`;
// When an entry was last modified is the save's clock, not the edit.
const withoutClock = (bytes: Uint8Array) => new TextDecoder().decode(bytes).replace(/("lastmod": ?")[^"]*"/g, '$1<T>"');
/** The Value a fresh read of a dictionary shows at `path`. */
function valueAt(bytes: Uint8Array, filename: string, path: string): string {
  const row = nodeAt(ingest(createSession(), bytes, { filename }), path)?.toRow();
  return String(row?.Value?.text ?? row?.Value ?? '(no row)');
}
/** What a fresh read of a dictionary shows of every entry, row for row. */
function shownBy(bytes: Uint8Array, filename: string): Record<string, unknown> {
  const root: any = ingest(createSession(), bytes, { filename });
  const out: Record<string, unknown> = {};
  for (const section of root.children ?? []) for (const entry of section.children ?? []) out[`${section.name}/${entry.name}`] = shownCells(entry);
  return out;
}

suite('A dictionary editor saves an edit as core saves it', () => {
  let dir = '';

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });
  setup(() => {
    dir = mkdtempSync(join(tmpdir(), 'dex-editorsaves-'));
  });
  teardown(async () => {
    await quiet(200, 'the disposed watchers to stop watching before their directory goes');
    rmSync(dir, { recursive: true, force: true });
  });

  test('JSON .sldd: the saved TextDocument is the text core writes', async () => {
    const original = new Uint8Array(readFileSync(join(FIXTURES, 'values_text.sldd')));
    const wrong: string[] = [];
    for (const [i, edit] of EDITS.entries()) {
      const file = join(dir, `json-${i}.sldd`);
      writeFileSync(file, original);
      const saved = await jsonEditorSave(file, edit);
      if (!saved.bytes || saved.answer !== 'written') {
        wrong.push(`${label(edit)}: the editor ${saved.answer} it (${saved.reason ?? ''})`);
        continue;
      }
      if (withoutClock(saved.bytes) !== withoutClock(coreSave(original, 'values_text.sldd', edit))) {
        wrong.push(`${label(edit)}: the editor's save is not core's`);
      }
      // The comparison can fail: core's save of another value is another text.
      if (i === 0) {
        const other = coreSave(original, 'values_text.sldd', { ...edit, text: '8' });
        assert.notStrictEqual(withoutClock(saved.bytes), withoutClock(other), 'a save of 8 is told from a save of 7');
      }
    }
    assert.deepStrictEqual(wrong, []);
  });

  test('JSON .sldd: a cell typed over an element held as a MAT stream is saved as typed', async () => {
    const file = join(dir, 'json-cell.sldd');
    writeFileSync(file, readFileSync(join(FIXTURES, 'values_text.sldd')));
    const saved = await jsonEditorSave(file, CELL_OVER_STREAM);
    assert.strictEqual(saved.answer, 'written', saved.reason);
    assert.strictEqual(valueAt(saved.bytes!, 'values_text.sldd', 'cLeaves{9}'), '{[1 2], true}');
  });

  test('JSON .sldd: a Delete right after that edit deletes the one element', async () => {
    const file = join(dir, 'json-cell-delete.sldd');
    writeFileSync(file, readFileSync(join(FIXTURES, 'values_text.sldd')));
    const saved = await jsonEditorSave(file, [CELL_OVER_STREAM, { path: 'cLeaves{9}{1}(1)', op: 'delete' }]);
    assert.strictEqual(saved.answer, 'written', saved.reason);
    assert.strictEqual(valueAt(saved.bytes!, 'values_text.sldd', 'cLeaves{9}{1}'), '2');
    assert.strictEqual(valueAt(saved.bytes!, 'values_text.sldd', 'cLeaves{9}{2}'), 'true');
  });

  test('binary .sldd: the saved file reads back as core\'s save does', async () => {
    const original = new Uint8Array(readFileSync(join(FIXTURES, 'values_binary.sldd')));
    const wrong: string[] = [];
    for (const [i, edit] of EDITS.entries()) {
      const file = join(dir, `bin-${i}.sldd`);
      writeFileSync(file, original);
      const saved = await binaryEditorSave(file, edit);
      if (!saved.bytes || saved.answer !== 'written') {
        wrong.push(`${label(edit)}: the editor ${saved.answer} it (${saved.reason ?? ''})`);
        continue;
      }
      const ours = shownBy(saved.bytes, 'values_binary.sldd');
      const cores = shownBy(coreSave(original, 'values_binary.sldd', edit), 'values_binary.sldd');
      try {
        assert.deepStrictEqual(ours, cores);
      } catch {
        wrong.push(`${label(edit)}: the editor's save reads back otherwise than core's`);
      }
      if (i === 0) {
        const other = shownBy(coreSave(original, 'values_binary.sldd', { ...edit, text: '8' }), 'values_binary.sldd');
        assert.notDeepStrictEqual(ours, other, 'a save of 8 is told from a save of 7');
      }
    }
    assert.deepStrictEqual(wrong, []);
  });
});
