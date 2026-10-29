// Copyright 2026 The MathWorks, Inc.
//
// What the Property Inspector is asked to show (src/view/model/inspector/inspectorSelection.ts): a table's
// selection, resolved to its first row's node, and that node resolved again whenever the
// document's tree changes under it. The providers that tell it so are exercised in real VS Code
// (test-integration/suite/binarySlddInspectorRefresh.test.ts, matEdit.test.ts).
import { describe, it, expect } from 'vitest';
import { InspectorSelection } from '../src/view/model/inspector/inspectorSelection.js';

const DOC = 'file:///work/params.sldd';
const OTHER = 'file:///work/other.sldd';

/** A recording inspector, and a tree the test can swap: ids to nodes, per document. */
function harness() {
  const shown: { node: unknown; from?: string }[] = [];
  let cleared = 0;
  const trees = new Map<string, Map<string, object>>();
  const selection = new InspectorSelection(
    {
      showNode: (node, from) => void shown.push({ node, from }),
      clear: () => void cleared++,
    },
    (uri, id) => trees.get(uri)?.get(id) ?? null,
  );
  const tree = (uri: string, nodes: Record<string, object>) => trees.set(uri, new Map(Object.entries(nodes)));
  return { selection, shown, cleared: () => cleared, tree };
}

describe('InspectorSelection.show', () => {
  it('shows the node of the first selected row, from the document it was selected in', () => {
    const h = harness();
    const kp = { name: 'Kp' };
    h.tree(DOC, { a: kp, b: { name: 'Ki' } });
    h.selection.show(DOC, ['a', 'b']);
    expect(h.shown).toEqual([{ node: kp, from: DOC }]);
  });

  it('clears for no selection, a section row, or a row that resolves to nothing', () => {
    const h = harness();
    h.tree(DOC, {});
    h.selection.show(DOC, []);
    h.selection.show(DOC, ['section:Design Data']);
    h.selection.show(DOC, ['gone']);
    expect(h.shown).toEqual([]);
    expect(h.cleared()).toBe(3);
  });
});

describe('InspectorSelection.refresh', () => {
  it('shows the selected node again from the tree as it is now', () => {
    // An edit, an undo or a redo, a save, a revert or a reload rebuilds the entry, or the whole
    // tree, under the same id: the node the inspector was handed is not the one the table shows.
    const h = harness();
    const before = { name: 'Kp', value: '1' };
    const after = { name: 'Kp', value: '2' };
    h.tree(DOC, { a: before });
    h.selection.show(DOC, ['a']);
    h.tree(DOC, { a: after });
    h.selection.refresh(DOC);
    expect(h.shown.map((s) => s.node)).toEqual([before, after]);
    expect(h.shown[1].from).toBe(DOC);
  });

  it('does nothing when the change is to another document than the one selected in', () => {
    const h = harness();
    h.tree(DOC, { a: { name: 'Kp' } });
    h.tree(OTHER, { a: { name: 'other' } });
    h.selection.show(DOC, ['a']);
    h.selection.refresh(OTHER);
    expect(h.shown).toHaveLength(1);
    expect(h.cleared()).toBe(0);
  });

  it('leaves a node that no longer resolves to the table, which reports its selection itself', () => {
    // A rename moves the id and then selects the row under its new one; a delete selects the
    // next row; an undo of an add leaves a selection that names nothing, which the table clears
    // and reports. Clearing here as well would blank the inspector between the edit and the
    // table's report of the selection that follows it.
    const h = harness();
    h.tree(DOC, { a: { name: 'Kp' } });
    h.selection.show(DOC, ['a']);
    h.tree(DOC, {});
    h.selection.refresh(DOC);
    expect(h.shown).toHaveLength(1);
    expect(h.cleared()).toBe(0);
  });

  it('does nothing before any selection, or after one the inspector shows nothing for', () => {
    const h = harness();
    h.tree(DOC, { a: { name: 'Kp' } });
    h.selection.refresh(DOC);
    h.selection.show(DOC, []);
    h.selection.refresh(DOC);
    h.selection.show(DOC, ['section:Design Data']);
    h.selection.refresh(DOC);
    expect(h.shown).toEqual([]);
    expect(h.cleared()).toBe(2);
  });

  it('follows the latest selection, not the first', () => {
    const h = harness();
    const kp = { name: 'Kp' };
    const ki = { name: 'Ki' };
    h.tree(DOC, { a: kp });
    h.tree(OTHER, { b: ki });
    h.selection.show(DOC, ['a']);
    h.selection.show(OTHER, ['b']);
    h.selection.refresh(DOC);
    h.selection.refresh(OTHER);
    expect(h.shown.map((s) => s.node)).toEqual([kp, ki, ki]);
  });

  it('never throws into the edit that changed the tree: an inspector that cannot show the node is cleared', () => {
    // A refresh runs inside the editor's repaint, which an undo and a redo run inside VS Code's
    // own call: a throw here would fail that undo after it had changed the document.
    const cleared: string[] = [];
    let failing = false;
    const selection = new InspectorSelection(
      {
        showNode: () => {
          if (failing) throw new Error('toPIObject failed');
        },
        clear: () => void cleared.push('clear'),
      },
      () => ({ name: 'Kp' }),
    );
    selection.show(DOC, ['a']);
    failing = true;
    expect(() => selection.refresh(DOC)).not.toThrow();
    expect(cleared).toEqual(['clear']);
  });

  it('never throws when the lookup or the clear throws either', () => {
    let finding = true;
    const selection = new InspectorSelection(
      {
        showNode: () => undefined,
        clear: () => {
          throw new Error('the view is gone');
        },
      },
      () => {
        if (!finding) throw new Error('the session is gone');
        return { name: 'Kp' };
      },
    );
    selection.show(DOC, ['a']);
    finding = false;
    expect(() => selection.refresh(DOC)).not.toThrow();
  });
});
