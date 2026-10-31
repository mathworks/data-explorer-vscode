// Copyright 2026 The MathWorks, Inc.
//
// A listed sweep of gestures through the editors, in real VS Code, each file an editor saves written out
// for a comparison outside the test: in the dictionary editors, gallery adds, pastes (from the file
// itself, another dictionary, a MAT-file), moves within a file and across files and formats, drags that
// move or copy, and renames, each followed, where this host can, by an undo and a save, then a redo and a
// save; in the MAT-file editor, gallery adds, and pastes, moves and drops into the whole file.
// editorSaveSweep.test.ts and p4MatEditorSweep.test.ts beside this are the ones for single edits.
//
// Runs only when EB_P4_GESTURE_OUT is set. EB_P4_GESTURE names the dictionary gestures, one JSON object a line:
//   { id, i, format: 'json' | 'bin', orig, edit, undoRedo }
//   edit: { op: 'gallery', section, className } | { op: 'rename', path, text }
//       | { op: 'paste' | 'move' | 'xmove', from: { format, orig, section, name }, to: { section } }
//       | { op: 'drag', mode: 'move' | 'copy', within?: true, from: { format, orig, section, name }, to: { section } }
// `from.format` may be another format than the target's, a MAT-file (`mat27`, section '') included.
// Each gesture is made on fresh copies of its files, by the messages the table sends (addEntry; edit of
// the Name; copy or cut, then paste on the section's row; dragStart in the source's table, then drop on
// the section's row and the source's dragEnd), then the editor's own save. A drag is within the target's
// own table when `within` is set, and from a second file otherwise. A move across files (xmove, or a
// drag move from a second file) saves its source too, as <i>-source.<sldd|mat>. A binary edit is undone
// and redone through the edit VS Code was handed; a JSON one through VS Code's own undo and redo, when
// this host's undo reaches an editor at all (see cutPasteUndo.test.ts's canary). One line a gesture goes
// to <out>/<format>-gesture.jsonl, and each saved file to <out>/<format>-gesture/<i>[-source|-undo|-redo]
// (.sldd, or .mat for a MAT-file source).
//
// EB_P4_MAT_GESTURE names the MAT-file gestures, each on a fresh copy of `case.orig`:
//   { id, i, edit: { path: '', op: 'gallery', className } | { path: '', op: 'paste' | 'xmove', from: { format,
//     orig, section, name } } | { path: '', op: 'drag', mode: 'move' | 'copy', within?: true, from: … },
//     case: { orig } }
// A gallery add is the tile's addEntry; a paste copies the entry `name` (of section `section` of a
// dictionary, or a variable of a MAT-file) in its own editor, a variable of the file itself in the file's
// own editor, then pastes into the whole file (rowId ''); an xmove cuts it instead, from a second file;
// a drag starts in the source's table and is let go over the whole file. One line a gesture, with the
// names it added, goes to <out>/mat-gesture.jsonl, and each saved file to <out>/mat-gesture/<i>.mat (and
// a move's source, saved too, to <i>-source.<sldd|mat>).
import * as vscode from 'vscode';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { buildSectionRowId } from 'data-explorer-view/model';
import { quiet, waitFor } from './tools/hostHarness';
import { closeAll, type Opened } from './tools/tables';
import { nodeAt } from './tools/editorSaves';
import { EXT, answered, dragFrom, dropOn, openTab, take, type Tab } from './tools/gestures';
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

/**
 * JSON undos or redos in a row that did not land. One that misses is tried once more, the document
 * shown again first; past MISSES_IN_A_ROW in a row, this host's `undo` is taken not to reach an editor
 * at all, and the rest are not tried. (Until this, the first case's miss stood for every case after
 * it, and one slow first undo cost a run all of them.)
 */
let jsonUndoMisses = 0;
const MISSES_IN_A_ROW = 10;

/**
 * Run `command` on the document shown, and say whether its text moved within a second and a half, and
 * whether that took a second try. The version is read again right before the retry, so a first try
 * that landed meanwhile is not sent again; one that lands later still, after the retry was sent, is
 * caught by undoRedoJson's check of the text.
 */
async function lands(doc: vscode.TextDocument, command: 'undo' | 'redo'): Promise<'once' | 'retried' | false> {
  const v = doc.version;
  for (let attempt = 0; attempt < 2; attempt++) {
    await vscode.window.showTextDocument(doc, { preview: false });
    if (doc.version !== v) return attempt === 0 ? 'once' : 'retried';
    await vscode.commands.executeCommand(command);
    try {
      await waitFor(`the ${command} to land`, () => doc.version !== v, 1500);
      return attempt === 0 ? 'once' : 'retried';
    } catch {
      /* tried again below, the document shown first */
    }
  }
  return doc.version !== v ? 'retried' : false;
}

/**
 * A JSON document's last edit undone by VS Code, saved, then redone, saved. `opened` is the text the
 * document opened with, before the gesture: what its undo must give back, as its redo must give back
 * the gesture's. A text that is neither (an undo sent twice, the first one only slow) is not saved: the
 * case says so instead of keeping a wrong file.
 */
async function undoRedoJson(doc: vscode.TextDocument, opened: string, stem: string, path: string, line: Record<string, unknown>): Promise<void> {
  if (jsonUndoMisses >= MISSES_IN_A_ROW) {
    line.undoNote = `not run: this host's undo did not reach an editor ${MISSES_IN_A_ROW} times in a row`;
    return;
  }
  const expected = { undo: opened, redo: doc.getText() };
  try {
    for (const [command, key] of [['undo', 'undo'], ['redo', 'redo']] as const) {
      const landed = await lands(doc, command);
      if (!landed) {
        jsonUndoMisses++;
        line.undoNote = `not run: this host's ${command} did not reach the editor`;
        return;
      }
      jsonUndoMisses = 0;
      // A retried command whose first try was only slow lands twice: let a late one land, then hold
      // the text, retried or not, to the one this step must give back.
      if (landed === 'retried') await quiet(500, `a late ${command} to land before the text is read`);
      if (doc.getText() !== expected[key]) {
        line.undoNote = `not saved: the ${command} left a text other than ${key === 'undo' ? 'the one the document opened with' : "the gesture's"}`;
        return;
      }
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
    const openedText = target.doc?.getText() ?? '';
    const g = c.edit;
    let source: Tab | null = null;
    let r: { answer: string; reason?: string; edited: boolean };
    if (g.op === 'gallery') {
      r = await answered(target, { type: 'addEntry', section: g.section, className: g.className, rename: false });
    } else if (g.op === 'rename') {
      const node = nodeAt(target.model(), g.path);
      if (!node) return { ...line, answer: 'absent' };
      r = await answered(target, { type: 'edit', rowId: node.id, columnId: 'Name', oldValue: String(node.toRow()?.Name?.label ?? node.name), newValue: g.text });
    } else if (g.op === 'drag') {
      source = g.within ? target : await openTab(g.from.format, opened, dir, `source.${EXT[g.from.format]}`, g.from.orig);
      const started = await dragFrom(source, g.from.section, g.from.name);
      if (started) return { ...line, ...started };
      const sourceEdits = source.edits();
      r = await dropOn(target, source, buildSectionRowId(g.to.section), g.mode);
      if (g.mode === 'move' && source !== target && r.edited) {
        try {
          await waitFor('the source to delete what moved', () => source!.edits() > sourceEdits, 5000);
        } catch {
          line.sourceNote = 'the source took nothing out';
        }
      }
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
    if ((g.op === 'xmove' || (g.op === 'drag' && g.mode === 'move')) && source && source !== target) {
      const saved = `${stem}-source.${EXT[g.from.format]}`;
      await source.save();
      line.source = saved;
      copyFileSync(source.path, saved);
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
      await undoRedoJson(target.doc, openedText, stem, target.path, line);
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

/** One MAT-file gesture: a gallery add, or a whole-file paste, move or drop, then the editor's own save. */
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
    let source: Tab | null = null;
    let moved = false;
    if (g.op === 'gallery') {
      r = await answered(target, { type: 'addEntry', section: '', className: g.className, rename: false });
    } else {
      // A paste of the file's own variable is made in the file's own table; an xmove, and a drag that
      // is not `within`, come from a second file, of whatever format.
      const fromItself = g.op === 'paste' ? g.from.format === 'mat27' : g.op === 'drag' && !!g.within;
      source = fromItself ? target : await openTab(g.from.format, opened, dir, `source.${EXT[g.from.format]}`, g.from.orig);
      const sourceEdits = source.edits();
      if (g.op === 'drag') {
        const started = await dragFrom(source, g.from.section, g.from.name);
        if (started) return { ...line, ...started };
        r = await dropOn(target, source, '', g.mode);
      } else {
        const taken = await take(source, g.from.section, g.from.name, g.op === 'xmove' ? 'cut' : 'copy');
        if (taken) return { ...line, ...taken };
        r = await answered(target, { type: 'paste', rowId: '' });
      }
      moved = (g.op === 'xmove' || (g.op === 'drag' && g.mode === 'move')) && source !== target;
      if (moved && r.edited) {
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
    line.added = variablesOf(target).filter((n) => !before.includes(n));
    await target.save();
    copyFileSync(target.path, file);
    line.saved = file;
    if (moved && source) {
      const saved = file.replace(/\.mat$/, `-source.${EXT[g.from.format]}`);
      await source.save();
      line.source = saved;
      copyFileSync(source.path, saved);
    }
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
