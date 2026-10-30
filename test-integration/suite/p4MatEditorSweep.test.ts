// Copyright 2026 The MathWorks, Inc.
//
// A listed sweep of edits through the MAT-file editor, in real VS Code, each file the editor saves
// written out for a comparison outside the test: the MAT-file twin of editorSaveSweep.test.ts, which
// covers the two dictionary editors.
//
// Runs only when EB_P4_MAT_OUT is set. EB_P4_MAT names the edits, one JSON object a line:
//   { id, i, second, edit: { path, op, key?, text? }, case: { orig } }
// op: value | prop | name (a cell edit, `key` its column), add (an Add on the row), delete. Each edit
// is made on a fresh copy of `case.orig` in a fresh MAT-file editor, by the message the table sends,
// then the editor's own save. One line an edit goes to <EB_P4_MAT_OUT>/editor-mat.jsonl, and each
// saved file to <EB_P4_MAT_OUT>/mat/<i>.mat.
import * as vscode from 'vscode';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { DataModel } from 'data-explorer-core';
import { MatEditorProvider } from '../../src/host/MatEditorProvider';
import { ctx, fakePanel, quiet, token, waitFor } from './tools/hostHarness';
import { nodeAt, type Answer, type Edit } from './tools/editorSaves';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Listed {
  id: string;
  i: number;
  second: boolean;
  edit: Edit;
  case: { orig: string };
}

const OUT = process.env.EB_P4_MAT_OUT;

const listed = (file: string | undefined): Listed[] =>
  file && existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l))
    : [];

// The message the table sends for an edit, as tools/editorSaves.ts sends it to the dictionary editors.
function shownText(row: any, key: string): string {
  if (key === 'Name') return String(row?.Name?.label ?? '');
  const cell = row?.[key];
  if (cell && typeof cell === 'object') return String(cell.text ?? '');
  return String(cell ?? '');
}
const columnOf = (edit: Edit): string => (edit.op === 'name' ? 'Name' : (edit.key ?? 'Value'));
function messageFor(node: any, edit: Edit): any {
  if (edit.op === 'add') return { type: 'addChild', rowId: node.id };
  if (edit.op === 'delete') return { type: 'delete', rowIds: [node.id] };
  const key = columnOf(edit);
  return { type: 'edit', rowId: node.id, columnId: key, oldValue: shownText(node.toRow(), key), newValue: edit.text ?? '' };
}
function refusalIn(posts: any[]): Answer | null {
  const v = posts.find((p) => p.type === 'validationError');
  if (v) return { answer: 'refused', reason: String(v.reason) };
  const e = posts.find((p) => p.type === 'error');
  if (e) return { answer: 'error', reason: String(e.message) };
  return null;
}

/** `edit` of the MAT-file at `file`, in a fresh MAT-file editor, then its own save. */
async function matEditorSave(file: string, edit: Edit): Promise<Answer> {
  const uri = vscode.Uri.file(file);
  const provider = new MatEditorProvider(ctx());
  const events: unknown[] = [];
  const sub = provider.onDidChangeCustomDocument((e) => events.push(e));
  const doc: any = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
  const view = fakePanel();
  try {
    await provider.resolveCustomEditor(doc, view.panel, token());
    view.send({ type: 'ready' });
    await waitFor('the first rows', () => view.posts.some((m) => m.type === 'setRows' || m.type === 'error'));
    const node = nodeAt(DataModel.getDataSource(doc.srcId), edit.path);
    if (!node) return { answer: 'absent' };
    const mark = view.posts.length;
    view.send(messageFor(node, edit));
    const after = () => view.posts.slice(mark);
    try {
      await waitFor('the edit answered', () => events.length > 0 || refusalIn(after()) !== null, 5000);
    } catch {
      return { answer: 'none' };
    }
    await quiet(30, 'an error the edit may post after it was recorded');
    const refused = refusalIn(after());
    if (events.length === 0) return refused ?? { answer: 'none' };
    try {
      await provider.saveCustomDocument(doc, token());
    } catch (err) {
      return { answer: 'saveRefused', reason: err instanceof Error ? err.message : String(err) };
    }
    const bytes = new Uint8Array(readFileSync(file));
    return refused ? { ...refused, bytes } : { answer: 'written', bytes };
  } finally {
    view.close();
    sub.dispose();
    doc.dispose();
  }
}

(OUT ? suite : suite.skip)('A listed sweep of edits, saved by the MAT-file editor', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  test('MAT-file: each edit through the MAT-file editor, its own save', async function () {
    this.timeout(0);
    const dir = join(OUT!, 'mat');
    mkdirSync(dir, { recursive: true });
    const log = join(OUT!, 'editor-mat.jsonl');
    writeFileSync(log, '');
    for (const s of listed(process.env.EB_P4_MAT)) {
      const t0 = Date.now();
      const line: Record<string, unknown> = { id: s.id, format: 'mat' };
      try {
        const file = join(dir, `${String(s.i).padStart(4, '0')}.mat`);
        writeFileSync(file, new Uint8Array(readFileSync(s.case.orig)));
        const answer = await matEditorSave(file, s.edit);
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
  });
});
