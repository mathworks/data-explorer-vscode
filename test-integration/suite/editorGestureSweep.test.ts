// Copyright 2026 The MathWorks, Inc.
//
// A listed sweep of gestures through the editors, in real VS Code, each file an editor saves written out
// for a comparison outside the test: in the dictionary editors, gallery adds, pastes (from the file
// itself, another dictionary, a MAT-file), moves within a file and across files, and renames, each
// followed, where this host can, by an undo and a save, then a redo and a save; in the MAT-file editor,
// gallery adds and pastes into the whole file. editorSaveSweep.test.ts and p4MatEditorSweep.test.ts beside
// this are the ones for single edits.
//
// Runs only when EB_P4_GESTURE_OUT is set. EB_P4_GESTURE names the dictionary gestures, one JSON object a line:
//   { id, i, format: 'json' | 'bin', orig, edit, undoRedo }
//   edit: { op: 'gallery', section, className } | { op: 'rename', path, text }
//       | { op: 'paste' | 'move' | 'xmove', from: { format, orig, section, name }, to: { section } }
// Each gesture is made on fresh copies of its files, by the messages the table sends (addEntry; edit of
// the Name; copy or cut, then paste on the section's row), then the editor's own save. A move across
// files saves its source too. A binary edit is undone and redone through the edit VS Code was handed;
// a JSON one through VS Code's own undo and redo, when this host's undo reaches an editor at all (see
// cutPasteUndo.test.ts's canary). One line a gesture goes to <out>/<format>-gesture.jsonl, and each
// saved file to <out>/<format>-gesture/<i>[-source|-undo|-redo].sldd.
//
// EB_P4_MAT_GESTURE names the MAT-file gestures, each on a fresh copy of `case.orig`:
//   { id, i, edit: { path: '', op: 'gallery', className } | { path: '', op: 'paste', from: { format, orig,
//     section, name } }, case: { orig } }
// A gallery add is the tile's addEntry; a paste copies the entry `name` (of section `section` of a
// dictionary, or a variable of a MAT-file) in its own editor, a variable of the file itself in the file's
// own editor, then pastes into the whole file (rowId ''). One line a gesture, with the names it added,
// goes to <out>/mat-gesture.jsonl, and each saved file to <out>/mat-gesture/<i>.mat.
import * as vscode from 'vscode';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { buildSectionRowId } from 'data-explorer-view/model';
import { waitFor } from './tools/hostHarness';
import { closeAll, type Opened } from './tools/tables';
import { nodeAt } from './tools/editorSaves';
import { EXT, answered, openTab, take, type Tab } from './tools/gestures';
import { clearClipboard } from '../../src/host/clipboard';
import { clearDrag } from '../../src/host/dragState';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Listed {
  id: string;
  i: number;
  format: 'json' | 'bin';
  orig: string;
  edit: any;
  undoRedo?: boolean;
}

const OUT = process.env.EB_P4_GESTURE_OUT;

/** Whether this host's `undo` reaches an editor: false until a JSON undo has landed, null untried. */
let jsonUndoWorks: boolean | null = null;

/** A JSON document's last edit undone by VS Code, saved, then redone, saved. */
async function undoRedoJson(doc: vscode.TextDocument, stem: string, path: string, line: Record<string, unknown>): Promise<void> {
  if (jsonUndoWorks === false) {
    line.undoNote = 'not run: this host\'s undo did not reach an editor';
    return;
  }
  await vscode.window.showTextDocument(doc, { preview: false });
  try {
    for (const [command, key] of [['undo', 'undo'], ['redo', 'redo']] as const) {
      const v = doc.version;
      await vscode.commands.executeCommand(command);
      try {
        await waitFor(`the ${command} to land`, () => doc.version !== v, 1500);
      } catch {
        if (jsonUndoWorks === null) jsonUndoWorks = false;
        line.undoNote = `not run: this host's ${command} did not reach the editor`;
        return;
      }
      jsonUndoWorks = true;
      await doc.save();
      copyFileSync(path, `${stem}-${key}.sldd`);
      line[key] = `${stem}-${key}.sldd`;
    }
  } finally {
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  }
}

/** One gesture: made, the target saved (and a cross-file move's source), then undone and redone. */
async function runCase(c: Listed): Promise<Record<string, unknown>> {
  const line: Record<string, unknown> = { id: c.id, format: c.format };
  const stem = join(OUT!, `${c.format}-gesture`, String(c.i).padStart(4, '0'));
  const dir = mkdtempSync(join(OUT!, 'work', `${String(c.i).padStart(4, '0')}-`));
  const opened: Opened = [];
  clearClipboard();
  clearDrag();
  try {
    const target = await openTab(c.format, opened, dir, `target.${EXT[c.format]}`, c.orig);
    const g = c.edit;
    let source: Tab | null = null;
    let r: { answer: string; reason?: string; edited: boolean };
    if (g.op === 'gallery') {
      r = await answered(target, { type: 'addEntry', section: g.section, className: g.className, rename: false });
    } else if (g.op === 'rename') {
      const node = nodeAt(target.model(), g.path);
      if (!node) return { ...line, answer: 'absent' };
      r = await answered(target, { type: 'edit', rowId: node.id, columnId: 'Name', oldValue: String(node.toRow()?.Name?.label ?? node.name), newValue: g.text });
    } else {
      const same = g.op === 'move' || (g.op === 'paste' && g.from.format === c.format && g.from.orig === c.orig);
      source = same ? target : await openTab(g.from.format, opened, dir, `source.${EXT[g.from.format]}`, g.from.orig);
      const taken = await take(source, g.from.section, g.from.name, g.op === 'paste' ? 'copy' : 'cut');
      if (taken) return { ...line, ...taken };
      const sourceEdits = source.edits();
      r = await answered(target, { type: 'paste', rowId: buildSectionRowId(g.to.section) });
      if (g.op === 'xmove' && r.edited) {
        try {
          await waitFor('the source to delete what moved', () => source!.edits() > sourceEdits, 5000);
        } catch {
          line.sourceNote = 'the source took nothing out';
        }
      }
    }
    line.answer = r.answer;
    line.reason = r.reason ?? null;
    if (!r.edited) return line;
    await target.save();
    line.saved = `${stem}.sldd`;
    copyFileSync(target.path, `${stem}.sldd`);
    if (g.op === 'xmove' && source && source !== target) {
      await source.save();
      line.source = `${stem}-source.sldd`;
      copyFileSync(source.path, `${stem}-source.sldd`);
    }
    if (c.format === 'bin' && target.events?.length) {
      const last = target.events[target.events.length - 1];
      for (const key of ['undo', 'redo'] as const) {
        await last[key]();
        await target.save();
        line[key] = `${stem}-${key}.sldd`;
        copyFileSync(target.path, `${stem}-${key}.sldd`);
      }
    } else if (c.format === 'json' && target.doc) {
      await undoRedoJson(target.doc, stem, target.path, line);
    }
    return line;
  } catch (err) {
    return { ...line, answer: 'crash', reason: err instanceof Error ? (err.stack ?? err.message) : String(err) };
  } finally {
    closeAll(opened);
    clearClipboard();
  }
}

/** The names of a MAT-file editor's variables. */
const variablesOf = (tab: Tab): string[] => ((tab.model()?.children ?? []) as any[]).map((v) => v.name);

/** One MAT-file gesture: a gallery add or a whole-file paste, then the editor's own save. */
async function runMatCase(c: any): Promise<Record<string, unknown>> {
  const line: Record<string, unknown> = { id: c.id, format: 'mat' };
  const file = join(OUT!, 'mat-gesture', `${String(c.i).padStart(4, '0')}.mat`);
  const dir = mkdtempSync(join(OUT!, 'work', `mat-${String(c.i).padStart(4, '0')}-`));
  const opened: Opened = [];
  clearClipboard();
  clearDrag();
  try {
    // Under its own name, so that the words a refusal says name the file as the user has it.
    const target = await openTab('mat27', opened, dir, basename(c.case.orig), c.case.orig);
    const before = variablesOf(target);
    const g = c.edit;
    let r: { answer: string; reason?: string; edited: boolean };
    if (g.op === 'gallery') {
      r = await answered(target, { type: 'addEntry', section: '', className: g.className, rename: false });
    } else {
      const source = g.from.format === 'mat27' ? target : await openTab(g.from.format, opened, dir, `source.${EXT[g.from.format]}`, g.from.orig);
      const taken = await take(source, g.from.section, g.from.name, 'copy');
      if (taken) return { ...line, ...taken };
      r = await answered(target, { type: 'paste', rowId: '' });
    }
    line.answer = r.answer;
    line.reason = r.reason ?? null;
    if (!r.edited) return line;
    line.added = variablesOf(target).filter((n) => !before.includes(n));
    await target.save();
    copyFileSync(target.path, file);
    line.saved = file;
    return line;
  } catch (err) {
    return { ...line, answer: 'crash', reason: err instanceof Error ? (err.stack ?? err.message) : String(err) };
  } finally {
    closeAll(opened);
    clearClipboard();
  }
}

const listOf = (file: string | undefined): any[] =>
  file
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l))
    : [];

(OUT ? suite : suite.skip)('A listed sweep of gestures, saved by the editors', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
    mkdirSync(join(OUT!, 'work'), { recursive: true });
  });

  test('MAT-file: each gallery add and whole-file paste, its own save', async function () {
    if (!process.env.EB_P4_MAT_GESTURE) this.skip();
    this.timeout(0);
    mkdirSync(join(OUT!, 'mat-gesture'), { recursive: true });
    const log = join(OUT!, 'mat-gesture.jsonl');
    writeFileSync(log, '');
    for (const c of listOf(process.env.EB_P4_MAT_GESTURE)) {
      const t0 = Date.now();
      const line = await runMatCase(c);
      line.ms = Date.now() - t0;
      appendFileSync(log, JSON.stringify(line) + '\n');
    }
  });

  test('each gesture through its editor, saved, then undone and redone', async function () {
    if (!process.env.EB_P4_GESTURE) this.skip();
    this.timeout(0);
    const cases: Listed[] = listOf(process.env.EB_P4_GESTURE);
    for (const f of ['json', 'bin']) {
      mkdirSync(join(OUT!, `${f}-gesture`), { recursive: true });
      writeFileSync(join(OUT!, `${f}-gesture.jsonl`), '');
    }
    mkdirSync(join(OUT!, 'work'), { recursive: true });
    for (const c of cases) {
      const t0 = Date.now();
      const line = await runCase(c);
      line.ms = Date.now() - t0;
      appendFileSync(join(OUT!, `${c.format}-gesture.jsonl`), JSON.stringify(line) + '\n');
    }
  });
});
