// Copyright 2026 The MathWorks, Inc.
// The dirty-flag copy the binary .sldd and MAT-file documents keep (src/host/settledSave.ts,
// EditStackCopy), held to VS Code's own custom-editor model, which decides the tab's dot, the close
// prompt and hot exit. VS Code's save point is an index into its edit list: save, undo past the save,
// make a different edit, and the new edit sits at the saved index, so VS Code alone would read the tab
// clean over a file that lacks it. A document restored from a hot-exit backup is the second such case:
// VS Code counts the backup only while its edit list is empty, so one edit and its undo read clean.
// The copy tells VS Code of the push (`lost`), and the document sends a content change, which keeps
// VS Code dirty until the next save or revert. customEditorSavePoint.test.ts (integration) shows the
// first case on real tabs; the second needs a window reload, which ends a test host, so this model of
// VS Code 1.144's source is its proof.
import { describe, it, expect } from 'vitest';
import { EditStackCopy } from '../src/host/settledSave.js';

/**
 * VS Code 1.144's custom-editor model, as far as its dirty flag goes (workbench.desktop.main.js:
 * `isDirty`, `pushEdit`/`spliceEdits`, `undo`, `redo`, `saveCustomEditor`, `revert`, `changeContent`).
 */
class VsCodeModel {
  length = 0;
  current = -1;
  savePoint = -1;
  fromContentChange = false;

  /** `fromBackup`: `!!backupId` where the workbench makes the model. */
  constructor(public fromBackup = false) {}

  get dirty(): boolean {
    return this.fromContentChange ? true : this.length > 0 ? this.savePoint !== this.current : this.fromBackup;
  }
  push(): void {
    this.length = this.current + 2;
    this.current = this.length - 1;
  }
  undo(): boolean {
    if (this.current < 0) return false;
    this.current--;
    return true;
  }
  redo(): boolean {
    if (this.current >= this.length - 1) return false;
    this.current++;
    return true;
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
    this.length = Math.min(this.length, this.current + 1);
    return true;
  }
  changeContent(): void {
    this.fromContentChange = true;
  }
}

type Op = 'push' | 'undo' | 'redo' | 'save' | 'revert';
const OPS: Op[] = ['push', 'undo', 'redo', 'save', 'revert'];

/** VS Code's model and a document's copy, driven as VS Code and the engines drive them. */
function pair(wired = true, fromBackup = false) {
  const vscode = new VsCodeModel(fromBackup);
  let lost = 0;
  const copy = new EditStackCopy(fromBackup, () => {
    lost++;
    if (wired) vscode.changeContent();
  });
  const run = (op: Op): void => {
    switch (op) {
      case 'push': // the engine moves the copy, then puts the edit on VS Code's stack
        copy.pushed();
        vscode.push();
        break;
      case 'undo': // VS Code's command; the document hears of it only when VS Code undoes
        if (vscode.undo()) copy.undone();
        break;
      case 'redo':
        if (vscode.redo()) copy.redone();
        break;
      case 'save': // saveSettled, once the write lands
        vscode.save();
        copy.saved(copy.here());
        break;
      case 'revert': // VS Code reverts only a dirty document, and then the provider reverts the copy
        if (vscode.revert()) copy.reverted();
        break;
    }
  };
  return { vscode, copy, run, lost: () => lost };
}

/** Every sequence of `n` ops. */
function* sequences(n: number): Generator<Op[]> {
  if (n === 0) return yield [];
  for (const head of sequences(n - 1)) for (const op of OPS) yield [...head, op];
}

describe('EditStackCopy and VS Code agree on a byte-backed document being dirty', () => {
  it('a different edit after undoing past the save: VS Code alone reads clean, told, it reads dirty', () => {
    for (const wired of [false, true]) {
      const p = pair(wired);
      for (const op of ['push', 'save', 'undo', 'push'] as Op[]) p.run(op);
      expect(p.copy.dirty, 'the copy: the file lacks the new edit').toBe(true);
      expect(p.lost(), 'the copy saw the push discard the save point').toBe(1);
      expect(p.vscode.dirty, wired ? 'VS Code, told of it' : "VS Code's own flag: the save point index is the new edit's").toBe(wired);
    }
  });

  it('it stays dirty through any undo or redo until a save, and a revert clears it', () => {
    const p = pair();
    for (const op of ['push', 'save', 'undo'] as Op[]) p.run(op);
    for (const op of ['push', 'undo', 'redo', 'undo', 'undo', 'redo'] as Op[]) {
      p.run(op);
      expect(p.vscode.dirty).toBe(true);
      expect(p.copy.dirty).toBe(true);
    }
    p.run('save');
    expect([p.vscode.dirty, p.copy.dirty]).toEqual([false, false]);
    for (const op of ['undo', 'push', 'revert'] as Op[]) p.run(op);
    expect([p.vscode.dirty, p.copy.dirty]).toEqual([false, false]);
  });

  it('tells VS Code only when a push discards the save point, once each time', () => {
    const p = pair();
    // Edits, saves, undos and redos that never push over the save point.
    for (const op of ['push', 'push', 'save', 'undo', 'redo', 'push', 'undo', 'undo', 'redo', 'redo', 'save'] as Op[]) p.run(op);
    expect(p.lost()).toBe(0);
    // Two undos past the save, then two edits: the first push discards it, the second has nothing to.
    for (const op of ['undo', 'undo', 'push', 'push'] as Op[]) p.run(op);
    expect(p.lost()).toBe(1);
    expect(p.vscode.dirty, "VS Code's index is back at the saved one, and still dirty").toBe(true);
    // Saved again, the same thing tells it again.
    for (const op of ['save', 'undo', 'push'] as Op[]) p.run(op);
    expect(p.lost()).toBe(2);
  });

  it('agree after every step of every sequence of seven pushes, undos, redos, saves and reverts', () => {
    let steps = 0;
    for (const fromBackup of [false, true]) {
      for (const ops of sequences(7)) {
        const p = pair(true, fromBackup);
        for (const [i, op] of ops.entries()) {
          p.run(op);
          steps++;
          // A revert past a discarded save point leaves VS Code's index beyond its own list (its
          // `revert` sets the index to the save point and splices nothing): VS Code's own state, which
          // the extension cannot repair, so the sequence ends there.
          if (p.vscode.current > p.vscode.length - 1) break;
          if (p.vscode.dirty !== p.copy.dirty) {
            expect.fail(`${fromBackup ? 'restored, then ' : ''}after ${ops.slice(0, i + 1).join(', ')}: VS Code ${p.vscode.dirty}, the copy ${p.copy.dirty}`);
          }
        }
      }
    }
    expect(steps).toBeGreaterThan(1_000_000);
  });

  it('without telling VS Code, the same sequences find it reading clean while the copy is dirty', () => {
    const disagreements = (fromBackup: boolean) =>
      [...sequences(4)]
        .filter((ops) => {
          const p = pair(false, fromBackup);
          return ops.some((op) => (p.run(op), p.vscode.current <= p.vscode.length - 1 && !p.vscode.dirty && p.copy.dirty));
        })
        .map((ops) => ops.join(','));
    expect(disagreements(false)).toContain('push,save,undo,push');
    expect(disagreements(true)).toContain('push,undo,redo,redo');
  });

  it('a document restored from a backup: VS Code alone reads one edit and its undo clean, told, dirty', () => {
    for (const wired of [false, true]) {
      const p = pair(wired, true);
      expect([p.vscode.dirty, p.copy.dirty], 'restored: dirty with no edits').toEqual([true, true]);
      p.run('push');
      p.run('undo');
      expect(p.copy.dirty, 'the copy: the file never held the restored document').toBe(true);
      expect(p.vscode.dirty, wired ? 'VS Code, told of it' : "VS Code's own flag: back at the save point").toBe(wired);
    }
    // Told once, on the first push; a save or a revert ends it, as it ends VS Code's.
    const p = pair(true, true);
    for (const op of ['push', 'push', 'undo', 'undo', 'redo'] as Op[]) p.run(op);
    expect(p.lost()).toBe(1);
    p.run('save');
    for (const op of ['undo', 'redo', 'push'] as Op[]) p.run(op);
    expect([p.lost(), p.vscode.dirty, p.copy.dirty]).toEqual([1, true, true]);
    const r = pair(true, true);
    r.run('revert');
    expect([r.vscode.dirty, r.copy.dirty]).toEqual([false, false]);
    r.run('push');
    expect(r.lost(), 'after a revert, an edit is an ordinary one').toBe(0);
  });
});
