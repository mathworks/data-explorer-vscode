// Copyright 2026 The MathWorks, Inc.
//
// A Description of several lines, through each table editor in real VS Code: the edit the table
// posts is written with every line break, saved, and a fresh open of the saved file shows it
// exactly; and an edit that repeats the Description as it is writes nothing.
//
// The files are MATLAB's own (test-integration/fixtures/multiline): the same three
// Simulink.Parameter objects in a MAT-file, a text dictionary and a binary one, whose
// Descriptions MATLAB wrote with an LF, with a CR LF (which MATLAB's text dictionary writes as
// LF), and on one line. The webview's half, that the table posts exactly the text the user sees
// and nothing for an editor only opened, is test/multiLineDescriptionRows.test.ts.
//
// With DEX_GATE_OUT set, every file a save here writes is copied there with a manifest of the
// Description each of its entries must hold, as character codes, so that MATLAB itself can judge
// what this extension writes: a live gate outside this repo opens each and compares.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { quiet, waitFor } from './tools/hostHarness';
import { closeAll, fixturePath, type Opened } from './tools/tables';
import { BINARY_EDITOR, MAT_EDITOR, TEXT_EDITOR, type EditorKind, type EditorTab } from './tools/editorTabs';

/* eslint-disable @typescript-eslint/no-explicit-any */

const LF = "two\nlines, it's";

/** An editor, and the MATLAB-written file of the multiline fixtures it opens. */
interface Format extends EditorKind {
  file: string;
}

const FORMATS: Format[] = [
  { ...MAT_EDITOR, file: 'multiline_r2027a.mat' },
  { ...TEXT_EDITOR, file: 'multiline_r2027a_text.sldd' },
  { ...BINARY_EDITOR, file: 'multiline_r2027a_binary.sldd' },
];

/** The Description core reads of a node. */
const description = (node: any): string => node.toRow().Description;

/** The Description's character codes, so a failure shows which line break went where. */
const codes = (text: string): string => [...text].map((c) => c.charCodeAt(0)).join(' ');

// ---- What the live gate is handed, with DEX_GATE_OUT set ----------------------------------------

const GATE_OUT = process.env.DEX_GATE_OUT;
const gateFiles: { file: string; descriptions: Record<string, number[]> }[] = [];

/** A saved file, copied for the gate, with the Description of each entry MATLAB should find. */
function forGate(saved: Uint8Array, file: string, descriptions: Record<string, string>): void {
  if (!GATE_OUT) return;
  mkdirSync(GATE_OUT, { recursive: true });
  const path = join(GATE_OUT, `${String(gateFiles.length + 1).padStart(2, '0')}_${file}`);
  writeFileSync(path, saved);
  const asCodes = Object.fromEntries(Object.entries(descriptions).map(([name, text]) => [name, [...text].map((c) => c.charCodeAt(0))]));
  gateFiles.push({ file: path, descriptions: asCodes });
}

suite('A multi-line Description is written exactly as typed, in every table editor', () => {
  let dir = '';
  const opened: Opened = [];

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  setup(() => {
    dir = mkdtempSync(join(tmpdir(), 'dex-multiline-'));
  });

  teardown(async () => {
    closeAll(opened);
    await quiet(200, 'the disposed watchers to stop watching before their directory goes');
    rmSync(dir, { recursive: true, force: true });
  });

  const editDescription = (tab: EditorTab, row: any, newValue: string) =>
    tab.view.send({ type: 'edit', rowId: row.ID, columnId: 'Description', oldValue: String(row.Description), newValue });

  const refusalsIn = (posts: any[]) => posts.filter((p) => p.type === 'validationError' || p.type === 'error');

  suiteTeardown(() => {
    if (GATE_OUT && gateFiles.length > 0) writeFileSync(join(GATE_OUT, 'manifest.json'), JSON.stringify({ files: gateFiles }, null, 1));
  });

  for (const format of FORMATS) {
    // pCRLF as MATLAB wrote it: its text dictionary writes the CR LF as LF, the other two keep it.
    const crlfHeld = format.file.endsWith('_text.sldd') ? 'first line\nsecond line' : 'first line\r\nsecond line';

    test(`in ${format.name}: a line added to a two-line Description is saved, and reopens, exactly`, async () => {
      const tab = await format.open(opened, dir, `edit-${format.file}`, fixturePath('multiline', format.file));
      const row = tab.row('pLF');
      assert.strictEqual(row.Description, LF, 'the Description MATLAB wrote');
      const typed = `${LF}\nand a third`;
      editDescription(tab, row, typed);
      await waitFor('the edit to reach the document', () => tab.edited());
      assert.deepStrictEqual(refusalsIn(tab.view.posts), [], 'the edit was taken');

      const saved = await tab.save();
      forGate(saved, format.file, { pLF: typed, pCRLF: crlfHeld, pOne: 'one line' });
      assert.strictEqual(codes(format.readBack(saved, 'pLF', description)), codes(typed), 'a fresh read of the saved file');
      const reopened = await format.open(opened, dir, `reopen-${format.file}`, join(dir, `edit-${format.file}`));
      assert.strictEqual(codes(reopened.row('pLF').Description), codes(typed), 'the saved file reopened in a new editor');
      assert.strictEqual(reopened.row('pOne').Description, 'one line', 'the other entries as MATLAB wrote them');
    });

    test(`in ${format.name}: an edit of a CR LF Description keeps the line break the file held`, async () => {
      const tab = await format.open(opened, dir, `crlf-${format.file}`, fixturePath('multiline', format.file));
      const row = tab.row('pCRLF');
      assert.strictEqual(codes(row.Description), codes(crlfHeld), 'the Description MATLAB wrote');
      const typed = crlfHeld.replace('second line', 'second line, edited');
      editDescription(tab, row, typed);
      await waitFor('the edit to reach the document', () => tab.edited());
      const saved = await tab.save();
      forGate(saved, format.file, { pLF: LF, pCRLF: typed, pOne: 'one line' });
      assert.strictEqual(codes(format.readBack(saved, 'pCRLF', description)), codes(typed), 'a fresh read of the saved file');
      const reopened = await format.open(opened, dir, `crlf-reopen-${format.file}`, join(dir, `crlf-${format.file}`));
      assert.strictEqual(codes(reopened.row('pCRLF').Description), codes(typed), 'the saved file reopened in a new editor');
    });

    test(`in ${format.name}: an edit that repeats a multi-line Description writes nothing`, async () => {
      const tab = await format.open(opened, dir, `same-${format.file}`, fixturePath('multiline', format.file));
      for (const name of ['pLF', 'pCRLF']) {
        const row = tab.row(name);
        editDescription(tab, row, String(row.Description));
        await quiet(300, `a write the repeated text of ${name} must not make`);
      }
      assert.deepStrictEqual(refusalsIn(tab.view.posts), [], 'nothing was refused either');
      assert.strictEqual(tab.edited(), false, 'no edit reached the document');
      assert.strictEqual(tab.dirty(), false, 'the document is clean');
    });
  }
});
