// Copyright 2026 The MathWorks, Inc.
//
// What the Property Inspector shows: the node of the first row selected in a table, resolved
// from the session when the selection arrives, and resolved again whenever that document's tree
// changes under it.
//
// The inspector is handed a NODE, and builds its rows from it once. Every editor that changes its
// document in place rebuilds nodes under ids that stay the same: an edit mutates the entry, an
// undo or a redo rebuilds it from the record it restores (entryOps), and a save, a revert or a
// reload re-registers the whole tree. The table repaints from the new nodes; an inspector that
// kept the one it was handed went on showing the value from before the edit, the undo or the
// revert, until the user clicked another row. So each editor says when its tree changed (the two
// .sldd editors' and the MAT-file editor's `onChanged`), and every one of them is
// answered by `refresh`, one rule (wired once in extension.ts).
//
// vscode-free, so that the rule is unit-tested (test/inspectorSelection.test.ts): the inspector
// and the session's lookup are handed in.
import { isSectionRowId } from '../ids/sectionRowId.js';

/** The two things the inspector is asked to do: PropertiesViewProvider's. */
export interface Inspector {
  showNode(node: unknown, fromUri?: string): void;
  clear(): void;
}

/** A node by its row id in a document's tree, or null: SlddModel's `findNode`. */
export type FindNode = (uriString: string, nodeId: string) => unknown;

export class InspectorSelection {
  /** The selection the inspector was last asked to show. */
  private last: { uriString: string; rowIds: readonly string[] } | undefined;

  constructor(
    private readonly inspector: Inspector,
    private readonly find: FindNode,
  ) {}

  /**
   * A table's selection changed: show its first row's node. A section row has no properties,
   * and neither does a row that resolves to nothing, so the inspector is cleared for either.
   */
  show(uriString: string, rowIds: readonly string[]): void {
    this.last = { uriString, rowIds };
    const node = this.resolve();
    if (node) this.inspector.showNode(node, uriString);
    else this.inspector.clear();
  }

  /**
   * `uriString`'s tree changed: show the selected node again from the tree as it is now, if the
   * selection is that document's.
   *
   * A node that no longer resolves is left alone, for the table to settle. Its selection names
   * the same row, and the table reports what it does about that row going: a rename selects the
   * row under its new id, a delete selects the next row, and a selection left naming nothing is
   * cleared (table-main's `scheduleVanishedClear`), each through `show`. Clearing here too would
   * blank the inspector between the edit and that report, the flicker the table defers its own
   * clear to avoid.
   *
   * Never throws. A refresh runs inside the editor's repaint, and the binary .sldd editor's undo
   * and redo repaint inside VS Code's own call, after they have changed the document: a node
   * whose rows cannot be built would otherwise fail that undo half-way. The inspector is cleared
   * instead, since it cannot show the node the table now does.
   */
  refresh(uriString: string): void {
    if (this.last?.uriString !== uriString) return;
    try {
      const node = this.resolve();
      if (node) this.inspector.showNode(node, uriString);
    } catch {
      try {
        this.inspector.clear();
      } catch {
        /* nothing left to tell it */
      }
    }
  }

  /** The node of the first row of the last selection, or null for none, a section, or one gone. */
  private resolve(): unknown {
    if (!this.last) return null;
    const first = this.last.rowIds[0];
    if (!first || isSectionRowId(first)) return null;
    return this.find(this.last.uriString, first) ?? null;
  }
}
