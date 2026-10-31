// Copyright 2026 The MathWorks, Inc.
// The dirty-flag copy the binary .sldd and MAT-file documents keep (src/host/settledSave.ts,
// EditStackCopy), held to VS Code's own custom-editor model, which decides the tab's dot, the close
// prompt and hot exit, and to what the document holds against what the file holds.
//
// VS Code's save point is an index into its edit list. Save, undo past the save, make a different edit,
// and the new edit sits at the saved index, so VS Code alone would read the tab clean over a file that
// lacks it. A document restored from a hot-exit backup is a second case: VS Code counts the backup only
// while its edit list is empty, so one edit and its undo read clean. And once a save point has been
// lost, VS Code's revert leaves its index at that stale save point, over edits whose undo and redo no
// longer lead to the file. The copy tells VS Code of each (`lost`), and the document sends a content
// change, which keeps VS Code dirty until the next save or revert.
//
// customEditorSavePoint.test.ts (integration) shows the first case on real tabs. The others need a
// window reload, or more steps than a real-tab test can make one at a time, so this model of VS Code
// 1.144's workbench source is their proof.
import { describe, it, expect } from 'vitest';
import { EditStackCopy } from '../src/host/settledSave.js';

/**
 * VS Code 1.144's custom-editor model, as far as its dirty flag goes (workbench.desktop.main.js:
 * `isDirty`, `pushEdit`/`spliceEdits`, `undo`, `redo`, `saveCustomEditor`, `revert`, `changeContent`),
 * its edit list an array spliced as the bundle splices it.
 */
class VsCodeModel {
  edits: number[] = [];
  current = -1;
  savePoint = -1;
  fromContentChange = false;

  /** `fromBackup`: `!!backupId` where the workbench makes the model. */
  constructor(public fromBackup = false) {}

  get dirty(): boolean {
    return this.fromContentChange ? true : this.edits.length > 0 ? this.savePoint !== this.current : this.fromBackup;
  }
  push(id: number): void {
    this.edits.splice(this.current + 1, this.edits.length - this.current, id);
    this.current = this.edits.length - 1;
  }
  /** The edit VS Code's undo hands the extension host: undefined past its list (the host then finds none). */
  undo(): { id: number | undefined } | null {
    if (this.current < 0) return null;
    const id = this.edits[this.current];
    this.current--;
    return { id };
  }
  redo(): { id: number | undefined } | null {
    if (this.current >= this.edits.length - 1) return null;
    const id = this.edits[this.current + 1];
    this.current++;
    return { id };
  }
  save(): void {
    this.fromContentChange = false;
    this.savePoint = this.current;
    this.fromBackup = false;
  }
  revert(): boolean {
    if (this.current === this.savePoint && !this.fromContentChange && !this.fromBackup) return false;
    this.fromContentChange = false;
    this.fromBackup = false;
    this.current = this.savePoint;
    this.edits.splice(this.current + 1, this.edits.length - this.current);
    return true;
  }
  changeContent(): void {
    this.fromContentChange = true;
  }
}

type Op = 'push' | 'undo' | 'redo' | 'save' | 'revert';
const OPS: Op[] = ['push', 'undo', 'redo', 'save', 'revert'];

/**
 * How an engine undoes and redoes an edit: the binary engine restores the edit's stored snapshots;
 * the MAT engine does nothing to its tree for an edit made before the file was read again (its
 * generation), and moves the stack all the same.
 */
type Engine = 'binary' | 'mat';

/** A document as VS Code, the engines and the copy drive it, with what it holds and what the file holds. */
function document(engine: Engine, fromBackup = false, wired = true) {
  const vscode = new VsCodeModel(fromBackup);
  let told = 0;
  const copy = new EditStackCopy(fromBackup, () => {
    told++;
    if (wired) vscode.changeContent();
  });
  let content = fromBackup ? 'restored' : '';
  let disk = '';
  let generation = 0;
  let next = 1;
  const edits = new Map<number, { before: string; after: string; generation: number }>();
  const run = (op: Op): void => {
    switch (op) {
      case 'push': {
        // The engine moves the copy, then puts the edit on VS Code's stack.
        const id = next++;
        const before = content;
        content = `${content}.${id}`;
        edits.set(id, { before, after: content, generation });
        copy.pushed();
        vscode.push(id);
        break;
      }
      case 'undo':
      case 'redo': {
        // VS Code's command; the document hears of it only when VS Code hands it an edit it holds.
        const moved = op === 'undo' ? vscode.undo() : vscode.redo();
        const edit = moved?.id === undefined ? undefined : edits.get(moved.id);
        if (!edit) break;
        if (op === 'undo') copy.undone();
        else copy.redone();
        if (engine === 'binary' || edit.generation === generation) content = op === 'undo' ? edit.before : edit.after;
        break;
      }
      case 'save': // saveSettled, once the write lands
        vscode.save();
        disk = content;
        copy.saved(copy.here());
        break;
      case 'revert': // VS Code reverts only a dirty document; the provider then reads the file again
        if (vscode.revert()) {
          content = disk;
          generation++;
          copy.reverted();
        }
        break;
    }
  };
  return { vscode, copy, run, told: () => told, unsaved: () => content !== disk };
}

/** Every sequence of `n` ops. */
function* sequences(n: number): Generator<Op[]> {
  if (n === 0) return yield [];
  for (const head of sequences(n - 1)) for (const op of OPS) yield [...head, op];
}

const CASES: { engine: Engine; fromBackup: boolean; name: string }[] = [
  { engine: 'binary', fromBackup: false, name: 'a binary dictionary' },
  { engine: 'binary', fromBackup: true, name: 'a restored binary dictionary' },
  { engine: 'mat', fromBackup: false, name: 'a MAT-file' },
  { engine: 'mat', fromBackup: true, name: 'a restored MAT-file' },
];

describe('A byte-backed document never reads clean in VS Code while it differs from the file', () => {
  it('a different edit after undoing past the save: VS Code alone reads clean, told, it reads dirty', () => {
    for (const wired of [false, true]) {
      const d = document('binary', false, wired);
      for (const op of ['push', 'save', 'undo', 'push'] as Op[]) d.run(op);
      expect(d.unsaved(), 'the file lacks the new edit').toBe(true);
      expect(d.copy.dirty).toBe(true);
      expect(d.vscode.dirty, wired ? 'VS Code, told of it' : "VS Code's own flag: the saved index is the new edit's").toBe(wired);
    }
  });

  it('a document restored from a backup: VS Code alone reads one edit and its undo clean, told, dirty', () => {
    for (const wired of [false, true]) {
      const d = document('mat', true, wired);
      expect([d.vscode.dirty, d.copy.dirty], 'restored: dirty with no edits').toEqual([true, true]);
      d.run('push');
      d.run('undo');
      expect(d.unsaved(), 'the file never held the restored document').toBe(true);
      expect(d.copy.dirty).toBe(true);
      expect(d.vscode.dirty, wired ? 'VS Code, told of it' : "VS Code's own flag: back at the save point").toBe(wired);
    }
  });

  // review186 M1: a revert after a lost save point puts VS Code's index at it, over stale edits.
  for (const [engine, ops] of [
    ['binary', 'push,save,undo,push,revert,undo,redo'],
    ['binary', 'push,push,save,undo,undo,push,revert,push'],
    ['mat', 'push,push,save,undo,undo,push,revert,push'],
    ['binary', 'push,save,undo,push,revert,push,undo,save,undo,redo'],
  ] as [Engine, string][]) {
    it(`${engine}: ${ops} reads dirty while it differs from the file, at every step`, () => {
      const d = document(engine);
      for (const op of ops.split(',') as Op[]) {
        d.run(op);
        if (d.unsaved()) expect([op, d.vscode.dirty, d.copy.dirty]).toEqual([op, true, true]);
      }
      expect(d.unsaved(), 'the last step leaves the document unsaved').toBe(true);
    });
  }

  it(
    'over every sequence of eight pushes, undos, redos, saves and reverts, in both engines, fresh and restored',
    () => {
      let steps = 0;
      for (const { engine, fromBackup, name } of CASES) {
        for (const ops of sequences(8)) {
          const d = document(engine, fromBackup);
          for (const [i, op] of ops.entries()) {
            d.run(op);
            steps++;
            if (d.unsaved() && !(d.vscode.dirty && d.copy.dirty)) {
              expect.fail(`${name}, after ${ops.slice(0, i + 1).join(', ')}: unsaved, VS Code ${d.vscode.dirty}, the copy ${d.copy.dirty}`);
            }
          }
        }
      }
      expect(steps).toBe(4 * 8 * 5 ** 8);
    },
    60_000,
  );

  it(
    'until a save point is lost, VS Code and the copy agree at every step, and nothing more is told',
    () => {
      for (const { engine, fromBackup, name } of CASES) {
        for (const ops of sequences(7)) {
          const d = document(engine, fromBackup);
          // Ordinary edits, undos, redos, saves and reverts tell VS Code nothing. A restored document's
          // first push before its first save or revert does, once.
          let expected = 0;
          let settled = false;
          for (const [i, op] of ops.entries()) {
            // VS Code's own test of a lost save point: a push while the saved index is past the current one.
            if (op === 'push' && d.vscode.savePoint > d.vscode.current) break;
            if (op === 'push' && fromBackup && !settled) expected = 1;
            if (op === 'save' || (op === 'revert' && d.vscode.dirty)) settled = true;
            d.run(op);
            if (d.vscode.dirty !== d.copy.dirty || d.told() !== expected) {
              expect.fail(`${name}, after ${ops.slice(0, i + 1).join(', ')}: VS Code ${d.vscode.dirty}, the copy ${d.copy.dirty}, told ${d.told()}`);
            }
          }
        }
      }
    },
    60_000,
  );

  it('without telling VS Code, it reads clean over unsaved content in every case above', () => {
    const found = (engine: Engine, fromBackup: boolean) =>
      [...sequences(4)]
        .filter((ops) => {
          const d = document(engine, fromBackup, false);
          return ops.some((op) => (d.run(op), d.unsaved() && !d.vscode.dirty));
        })
        .map((ops) => ops.join(','));
    expect(found('binary', false)).toContain('push,save,undo,push');
    expect(found('mat', true)).toContain('push,undo,save,undo');
  });

  it('errs dirty once a save point is lost: an undo back to a later save still reads dirty', () => {
    const d = document('binary');
    for (const op of ['push', 'save', 'undo', 'push', 'save', 'push', 'undo'] as Op[]) d.run(op);
    expect(d.unsaved(), 'the document is the file again').toBe(false);
    expect([d.vscode.dirty, d.copy.dirty], 'both read dirty: the safe direction').toEqual([true, true]);
  });
});
