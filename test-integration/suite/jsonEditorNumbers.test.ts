// Copyright 2026 The MathWorks, Inc.
//
// The JSON dictionary editor writes a number typed into a cell as MATLAB writes it in a text
// dictionary, in real VS Code: a double of 2^64 - 1 or of -2^63, typed at an entry and at an
// element inside one, goes into the document text with a fraction of zero, and an exponent with
// no plus sign. JSON.stringify, which the editor wrote an entry's text with, spelled them as
// integer literals past what a 64-bit integer holds, and MATLAB R2027a could not open the saved
// dictionary. The editor writes through core's writer now (structuralEdit.recordText), which
// core's own save uses, so the two cannot part again (dictionaryEditorSaves.test.ts holds a sweep
// of edits to that).
//
// With DEX_GATE_OUT set, the saved dictionary is copied there with the values MATLAB must read
// back, for the live gate.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { quiet, waitFor } from './tools/hostHarness';
import { closeAll, entryOf, entryRow, openJson, readSldd, type Opened } from './tools/tables';

/* eslint-disable @typescript-eslint/no-explicit-any */

// What is typed where (`at`: the row's place under the entry, each step counted from 0; [] the
// entry itself), how the document must spell it, and how JSON.stringify spelled it. All three are
// numbers of the dictionary's JSON (a Parameter's Value, a struct's field, an element of a field);
// a matrix is held as one Matrix(...) text, which core spells itself.
const EDITS = [
  { entry: 'gravity', at: [], typed: '18446744073709551615', written: /"Value": 18446744073709552000\.0\b/, not: /18446744073709552000(?!\.0)/ },
  { entry: 'myStruct', at: [0], typed: '-9223372036854775808', written: /"a": -9223372036854776000\.0\b/, not: /-9223372036854776000(?!\.0)/ },
  { entry: 'myStruct', at: [1, 0], typed: '1e300', written: /\b1e300\b/, not: /1e\+300/ },
];

suite('The JSON dictionary editor writes numbers as MATLAB writes them', () => {
  let dir = '';
  const opened: Opened = [];

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  setup(() => {
    dir = mkdtempSync(join(tmpdir(), 'dex-jsonnum-'));
  });

  teardown(async () => {
    closeAll(opened);
    await quiet(200, 'the disposed watchers to stop watching before their directory goes');
    rmSync(dir, { recursive: true, force: true });
  });

  test('a huge double typed at an entry and at an element is written with a fraction of zero, and saved so', async () => {
    const j = await openJson(opened, dir, 'numbers.sldd');
    const rows = (j.view.posts.filter((m) => m.type === 'setRows').pop()?.rows ?? []) as any[];
    for (const e of EDITS) {
      let row = entryRow(j.view.posts, e.entry);
      for (const step of e.at) row = rows.filter((r) => r.parent === row.ID)[step];
      assert.ok(row, `the table has a row ${e.at.join('/')} under ${e.entry}`);
      const version = j.doc.version;
      const cell = row.Value;
      j.view.send({ type: 'edit', rowId: row.ID, columnId: 'Value', oldValue: typeof cell === 'object' ? cell.text : String(cell), newValue: e.typed });
      await waitFor(`the edit of ${e.entry} to reach the document`, () => j.doc.version !== version);
      assert.ok(!j.view.posts.some((m) => m.type === 'validationError' || m.type === 'error'), `${e.typed} was taken`);
      assert.match(j.doc.getText(), e.written, `the document spells ${e.typed} as MATLAB does`);
      assert.doesNotMatch(j.doc.getText(), e.not, `and not as JSON.stringify did`);
    }

    assert.ok(await j.doc.save(), 'the dictionary saved');
    const saved = new Uint8Array(readFileSync(j.path));
    // A fresh read of the saved file holds the doubles typed.
    const read = readSldd(saved, (dict) => {
      const struct = entryOf(dict, 'myStruct');
      return [entryOf(dict, 'gravity').serialize().value, struct.children[0], struct.children[1].children[0]].map((n: any, i) =>
        i === 0 ? n._elements[0]._properties.Value : Number(n.toRow().Value),
      );
    });
    assert.deepStrictEqual(read, [18446744073709551615, -9223372036854775808, 1e300]);

    // For the live gate: MATLAB opens the saved file and reads the same three doubles.
    const GATE_OUT = process.env.DEX_GATE_OUT;
    if (GATE_OUT) {
      mkdirSync(GATE_OUT, { recursive: true });
      copyFileSync(j.path, join(GATE_OUT, 'numbers.sldd'));
      writeFileSync(join(GATE_OUT, 'numbers.json'), JSON.stringify({ file: join(GATE_OUT, 'numbers.sldd'), typed: EDITS.map((e) => e.typed) }, null, 1));
    }
  });
});
