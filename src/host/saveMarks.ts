// Copyright 2026 The MathWorks, Inc.
//
// Which variables of an open MAT-file differ from the file as last saved, for the Status column.
//
// Core marks a variable `Modified` at its first edit (`New` when it was added) and never clears
// the mark: the mark is what tells a save to write the variable fresh instead of as the bytes it
// was read from, so it has to outlive the save, and the MAT-file editor keeps its tree across
// saves (see MatEditorProvider). The column asks something else, "is this what the file on disk
// holds", which a mark kept since the file was opened answers wrongly from the first save on.
//
// So the answer is kept here, beside VS Code's edit stack. Each edit says which variables it
// touched, whether it is applied now, and whether it was applied when the file was last saved. A
// variable differs from the saved file when an edit that touched it has moved since: applied now
// and not then (an edit made since the save, or the redo of one undone before it), or the other
// way round (an undo past the save, or an edit undone and then dropped from the stack by a newer
// one). Two edits that cancel each other out still mark it. Only a comparison of values could
// tell, and a mark too many is the safe side.
//
// vscode-free, so that the rule is unit-tested (test/saveMarks.test.ts).

/** One edit, as the closures VS Code calls for it see it. */
export interface MarkedEdit {
  undone(): void;
  redone(): void;
}

/** Which edits were applied when a save serialized the document. */
export interface SaveSnapshot {
  readonly applied: ReadonlyMap<object, boolean>;
}

interface Entry<T> {
  readonly touched: ReadonlySet<T>;
  readonly added: ReadonlySet<T>;
  applied: boolean;
  atSave: boolean;
}

export type SaveMark = 'Modified' | 'New';

export class SaveMarks<T> {
  private entries: Entry<T>[] = [];

  /**
   * An edit was made, touching `touched`, of which `added` it added (a variable that joined the
   * file, which the column calls New until the file is saved with it). An edit is never applied
   * at the save before it, so it starts moved.
   */
  push(touched: Iterable<T>, added: Iterable<T> = []): MarkedEdit {
    const entry: Entry<T> = { touched: new Set(touched), added: new Set(added), applied: true, atSave: false };
    this.entries.push(entry);
    return {
      undone: () => {
        entry.applied = false;
      },
      redone: () => {
        entry.applied = true;
      },
    };
  }

  /**
   * What a save is about to write: taken when the document is serialized, and committed only once
   * the bytes are on disk. An edit that lands while the write is in flight is not in those bytes,
   * and an undo that lands then does not take its edit out of them.
   */
  snapshot(): SaveSnapshot {
    return { applied: new Map(this.entries.map((e) => [e, e.applied])) };
  }

  /** The save of `snapshot` is on disk: what it held is what every later edit is measured from. */
  commit(snapshot: SaveSnapshot): void {
    for (const entry of this.entries) {
      const applied = snapshot.applied.get(entry);
      if (applied !== undefined) entry.atSave = applied;
    }
  }

  /**
   * The document was replaced by what the disk holds (a revert, or a reload of an outside
   * change): nothing in it differs from the file any more, and no edit made before belongs to
   * the tree it now holds.
   */
  clear(): void {
    this.entries = [];
  }

  /** Every variable that differs from the saved file, and how. */
  marks(): Map<T, SaveMark> {
    const marks = new Map<T, SaveMark>();
    for (const entry of this.entries) {
      if (entry.applied === entry.atSave) continue;
      for (const node of entry.touched) {
        // New only while the edit that added it is applied and was not at the save: anything
        // else that touches it, before or after, is an edit of a variable the file holds.
        const added = entry.applied && entry.added.has(node);
        if (added) marks.set(node, 'New');
        else if (!marks.has(node)) marks.set(node, 'Modified');
      }
    }
    return marks;
  }
}
