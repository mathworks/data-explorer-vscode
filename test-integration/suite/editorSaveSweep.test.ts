// Copyright 2026 The MathWorks, Inc.
//
// A list of edits through the dictionary editors, in real VS Code, each file the editor saves
// written out for a comparison outside the test (and for MATLAB): the runner an edit sweep of
// core uses to check that what the editors save is what core saves (see dictionaryEditorSaves
// for the cases this suite holds itself).
//
// Runs only when EB_P4_OUT is set. EB_P4_JSON / EB_P4_BIN name the edits, one JSON object a line:
//   { id, i, second, first: Edit, edit: Edit, case: { orig } }       (Edit: tools/editorSaves.ts)
// Each edit is made on a fresh copy of `case.orig`; a second edit is made after the first is
// saved and the saved file opened in a fresh editor. One line an edit goes to
// <EB_P4_OUT>/editor-<format>.jsonl, and each saved file to <EB_P4_OUT>/<format>/.
import * as vscode from 'vscode';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { binaryEditorSave, jsonEditorSave, type Answer, type Edit } from './tools/editorSaves';

interface Listed {
  id: string;
  i: number;
  second: boolean;
  first: Edit;
  edit: Edit;
  case: { orig: string };
}

const OUT = process.env.EB_P4_OUT;

const listed = (file: string | undefined): Listed[] =>
  file && existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l))
    : [];

async function runAll(format: 'json' | 'bin', edits: Listed[], save: (file: string, e: Edit) => Promise<Answer>) {
  const dir = join(OUT!, format);
  mkdirSync(dir, { recursive: true });
  const log = join(OUT!, `editor-${format}.jsonl`);
  writeFileSync(log, '');
  const stem = (s: Listed) => String(s.i).padStart(4, '0') + (s.second ? '-2' : '');
  for (const s of edits) {
    const t0 = Date.now();
    const line: Record<string, unknown> = { id: s.id, format };
    try {
      let from = new Uint8Array(readFileSync(s.case.orig));
      if (s.second) {
        const firstFile = join(dir, `${stem(s)}-first.sldd`);
        writeFileSync(firstFile, from);
        const first = await save(firstFile, s.first);
        line.first = { answer: first.answer, reason: first.reason };
        if (!first.bytes) throw new Error(`the first edit was not saved (${first.answer}: ${first.reason ?? ''})`);
        from = first.bytes;
      }
      const file = join(dir, `${stem(s)}.sldd`);
      writeFileSync(file, from);
      const answer = await save(file, s.edit);
      line.answer = answer.answer;
      line.reason = answer.reason ?? null;
      line.saved = answer.bytes ? file : null;
    } catch (err) {
      line.answer = 'crash';
      line.reason = err instanceof Error ? (err.stack ?? err.message) : String(err);
    }
    line.ms = Date.now() - t0;
    appendFileSync(log, JSON.stringify(line) + '\n');
  }
}

(OUT ? suite : suite.skip)('A listed sweep of edits, saved by the dictionary editors', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  test('JSON .sldd: each edit through the text-table editor, its TextDocument saved', async function () {
    this.timeout(0);
    await runAll('json', listed(process.env.EB_P4_JSON), jsonEditorSave);
  });

  test('binary .sldd: each edit through the binary-table editor, its own save', async function () {
    this.timeout(0);
    await runAll('bin', listed(process.env.EB_P4_BIN), binaryEditorSave);
  });
});
