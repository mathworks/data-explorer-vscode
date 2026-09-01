// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// Tree expansion. Expansion state is keyed to the row ID, not to a position,
// because the host re-sends the whole `rows` array on every document change: if
// state were positional, saving a file would collapse or scramble the user's
// open subtrees. These tests also cover the malformed-hierarchy cases (parent
// cycles, orphan rows) that come out of a corrupt .sldd — the component has to
// stay responsive rather than hang the webview.
import { describe, it, expect } from 'vitest';
import { DexTreeTable, type TreeTableRow } from '../src/webview/components/dex-tree-table.js';

function makeRow(id: string, parent: string | null, name = id): TreeTableRow {
  return { ID: id, parent, Name: { label: name }, Value: '', DataType: '', Description: '', Status: '' };
}

async function mount(rows: TreeTableRow[], expanded: string[] = []): Promise<DexTreeTable> {
  const table = new DexTreeTable();
  table.columns = ['Name', 'Value', 'DataType', 'Status'];
  document.body.appendChild(table);
  table.rows = rows;
  (table as any)._expandedIds = new Set(expanded);
  (table as any)._visibleRowsCache = null;
  table.requestUpdate();
  await table.updateComplete;
  return table;
}

const ids = (table: DexTreeTable): string[] => (table as any)._getVisibleRows().map((r: TreeTableRow) => r.ID);

// The clickable ▶/▼ glyph in a row's Name cell.
const toggle = (table: DexTreeTable, rowId: string): HTMLElement =>
  table.shadowRoot!.querySelector(`tr[data-row-id="${rowId}"] .toggle`) as HTMLElement;

// A three-level tree: bus -> element -> sub-element, plus a flat sibling.
const TREE = [
  makeRow('bus', null),
  makeRow('bus/e1', 'bus'),
  makeRow('bus/e1/x', 'bus/e1'),
  makeRow('bus/e2', 'bus'),
  makeRow('flat', null),
];

describe('what the collapsed and expanded views contain', () => {
  it('collapsed by default: only top-level rows are visible', async () => {
    // A dictionary can hold thousands of nested entries; auto-expanding would
    // bury the top-level structure the user opened the file to see.
    const table = await mount(TREE);
    expect(ids(table)).toEqual(['bus', 'flat']);
    table.remove();
  });

  it('expanding one level reveals its direct children only', async () => {
    const table = await mount(TREE, ['bus']);
    expect(ids(table)).toEqual(['bus', 'bus/e1', 'bus/e2', 'flat']);
    table.remove();
  });

  it('a grandchild stays hidden until its own parent is expanded', async () => {
    // Expanding the root must not dump the whole subtree at once.
    const table = await mount(TREE, ['bus']);
    expect(ids(table)).not.toContain('bus/e1/x');
    (table as any)._toggleExpand('bus/e1');
    expect(ids(table)).toEqual(['bus', 'bus/e1', 'bus/e1/x', 'bus/e2', 'flat']);
    table.remove();
  });

  it('children appear directly beneath their parent, not at the end', async () => {
    // Depth is drawn with indentation, so a child rendered away from its parent
    // reads as belonging to a different branch.
    const table = await mount(TREE, ['bus', 'bus/e1']);
    const order = ids(table);
    expect(order.indexOf('bus/e1')).toBe(order.indexOf('bus') + 1);
    expect(order.indexOf('bus/e1/x')).toBe(order.indexOf('bus/e1') + 1);
    expect(order[order.length - 1]).toBe('flat');
    table.remove();
  });

  it('collapsing a parent hides its entire subtree, grandchildren included', async () => {
    const table = await mount(TREE, ['bus', 'bus/e1']);
    (table as any)._toggleExpand('bus');
    expect(ids(table)).toEqual(['bus', 'flat']);
    table.remove();
  });

  it('a collapsed parent remembers that its child was open', async () => {
    // Otherwise re-opening a branch loses the position the user had drilled to.
    const table = await mount(TREE, ['bus', 'bus/e1']);
    (table as any)._toggleExpand('bus'); // collapse
    (table as any)._toggleExpand('bus'); // re-open
    expect(ids(table)).toContain('bus/e1/x');
    table.remove();
  });
});

describe('the expand/collapse toggle glyph', () => {
  it('shows ▶ collapsed and ▼ expanded, and clicking flips it', async () => {
    const table = await mount(TREE);
    expect(toggle(table, 'bus').textContent!.trim()).toBe('▶');

    toggle(table, 'bus').click();
    await table.updateComplete;
    expect(toggle(table, 'bus').textContent!.trim()).toBe('▼');
    expect(ids(table)).toContain('bus/e1');

    toggle(table, 'bus').click();
    await table.updateComplete;
    expect(toggle(table, 'bus').textContent!.trim()).toBe('▶');
    table.remove();
  });

  it('a childless row renders an empty toggle that does nothing', async () => {
    // A glyph on a leaf implies hidden content that does not exist.
    const table = await mount(TREE);
    const leaf = toggle(table, 'flat');
    expect(leaf.textContent!.trim()).toBe('');
    expect(leaf.className).toContain('empty');
    leaf.click();
    await table.updateComplete;
    expect([...(table as any)._expandedIds]).toEqual([]);
    table.remove();
  });

  it('clicking the toggle does not also select the row', async () => {
    // stopPropagation matters: opening a branch to look inside it should not
    // replace the selection the user built up, nor retarget the inspector.
    const table = await mount(TREE);
    table.selectedRowIds = ['flat'];
    await table.updateComplete;
    const selections: string[][] = [];
    table.addEventListener('dex-row-selected', (e) => selections.push((e as CustomEvent).detail.rowIds));

    toggle(table, 'bus').click();
    await table.updateComplete;
    expect(table.selectedRowIds).toEqual(['flat']);
    expect(selections).toEqual([]);
    table.remove();
  });

  it('indentation grows one step per level', async () => {
    const table = await mount(TREE, ['bus', 'bus/e1']);
    const indent = (id: string) =>
      (table.shadowRoot!.querySelector(`tr[data-row-id="${id}"] .indent`) as HTMLElement).style.width;
    expect(indent('bus')).toBe('0px');
    expect(indent('bus/e1')).toBe('16px');
    expect(indent('bus/e1/x')).toBe('32px');
    table.remove();
  });
});

describe('expansion survives the host resending rows', () => {
  it('a new rows array with the same IDs keeps the open subtrees open', async () => {
    // Every save/undo/external change re-sends `rows`. Losing expansion there
    // would snap the tree shut mid-edit and lose the user's place.
    const table = await mount(TREE, ['bus', 'bus/e1']);
    expect(ids(table)).toContain('bus/e1/x');

    table.rows = TREE.map((r) => ({ ...r }));
    (table as any)._visibleRowsCache = null;
    await table.updateComplete;
    expect(ids(table)).toContain('bus/e1/x');
    table.remove();
  });

  it('reordering the rows array does not move expansion to a different entry', async () => {
    // State keyed by index would follow the slot, silently opening whichever
    // entry now sits there.
    const table = await mount(TREE, ['bus']);
    table.rows = [...TREE].reverse();
    (table as any)._visibleRowsCache = null;
    await table.updateComplete;
    expect([...(table as any)._expandedIds]).toEqual(['bus']);
    expect(ids(table)).toEqual(['flat', 'bus', 'bus/e2', 'bus/e1']);
    table.remove();
  });

  it('an expanded ID that disappears from the document is simply ignored', async () => {
    // Deleting an entry must not leave a dangling expansion that throws or that
    // re-opens if an unrelated entry later reuses the ID's position.
    const table = await mount(TREE, ['bus', 'bus/e1']);
    table.rows = [makeRow('flat', null)];
    (table as any)._visibleRowsCache = null;
    await table.updateComplete;
    expect(ids(table)).toEqual(['flat']);
    table.remove();
  });

  it('depth is recomputed when a row is re-parented', async () => {
    // A drag-and-drop move changes nesting; a stale depth cache would keep
    // drawing the row at its old indentation.
    const table = await mount(TREE, ['bus', 'bus/e1', 'bus/e2']);
    expect((table as any)._depthCache.get('bus/e1/x')).toBe(2);

    table.rows = [
      makeRow('bus', null),
      makeRow('bus/e1', 'bus'),
      { ...makeRow('bus/e1/x', 'bus/e2') },
      makeRow('bus/e2', 'bus'),
      makeRow('flat', null),
    ];
    (table as any)._visibleRowsCache = null;
    await table.updateComplete;
    expect((table as any)._depthCache.get('bus/e1/x')).toBe(2);
    expect(ids(table)).toEqual(['bus', 'bus/e1', 'bus/e2', 'bus/e1/x', 'flat']);
    table.remove();
  });
});

describe('selecting a row opens the branches needed to see it', () => {
  it('selecting a deeply nested row expands every ancestor', async () => {
    // The host selects a row when the user clicks a link or a search result in
    // another panel; leaving it collapsed would appear to do nothing at all.
    const table = await mount(TREE);
    table.selectedRowIds = ['bus/e1/x'];
    await table.updateComplete;
    expect([...(table as any)._expandedIds].sort()).toEqual(['bus', 'bus/e1']);
    expect(ids(table)).toContain('bus/e1/x');
    table.remove();
  });

  it('it does not collapse branches the user had already opened', async () => {
    const table = await mount(TREE, ['flat-unrelated', 'bus']);
    table.selectedRowIds = ['bus/e1/x'];
    await table.updateComplete;
    expect((table as any)._expandedIds.has('flat-unrelated')).toBe(true);
    table.remove();
  });

  it('selecting a top-level row expands nothing', async () => {
    const table = await mount(TREE);
    table.selectedRowIds = ['flat'];
    await table.updateComplete;
    expect([...(table as any)._expandedIds]).toEqual([]);
    table.remove();
  });

  it('selecting an ID that is not in the document is a no-op', async () => {
    const table = await mount(TREE);
    table.selectedRowIds = ['does/not/exist'];
    await table.updateComplete;
    expect([...(table as any)._expandedIds]).toEqual([]);
    expect(ids(table)).toEqual(['bus', 'flat']);
    table.remove();
  });
});

describe('malformed hierarchies must not hang the webview', () => {
  it('a parent cycle still renders instead of freezing the editor tab', async () => {
    // Regression: the depth walk followed `parent` links with no visited set, so
    // a cycle (x -> y -> x) from a corrupt document spun forever. The webview
    // froze with no error and the whole editor tab became unresponsive — the
    // user could not even close the file.
    const cyclic = [makeRow('x', 'y'), makeRow('y', 'x'), makeRow('ok', null)];
    const table = await mount(cyclic);
    expect(ids(table)).toEqual(['ok']); // neither cycle member is reachable from a root
    expect((table as any)._depthCache.get('x')).toBeGreaterThanOrEqual(0);
    table.remove();
  });

  it('a row that is its own parent does not hang either', async () => {
    const table = await mount([makeRow('self', 'self'), makeRow('ok', null)]);
    expect(ids(table)).toEqual(['ok']);
    table.remove();
  });

  it('a cycle does not hang the ancestor-expansion walk on selection', async () => {
    const table = await mount([makeRow('x', 'y'), makeRow('y', 'x'), makeRow('ok', null)]);
    table.selectedRowIds = ['x'];
    await table.updateComplete;
    expect(table.selectedRowIds).toEqual(['x']);
    table.remove();
  });

  it('a cycle does not hang the filter ancestor walks', async () => {
    // Search walks parents to keep a matching row's ancestors visible; the same
    // cycle would freeze the webview as soon as the user typed in the box.
    const table = await mount([makeRow('x', 'y', 'alpha'), makeRow('y', 'x', 'beta'), makeRow('ok', null, 'alpha')]);
    const matched = (table as any)._filterRows(table.rows, 'alpha').map((r: TreeTableRow) => r.ID);
    expect(matched).toContain('ok');
    table.remove();
  });

  it('a row whose parent is missing is dropped rather than rendered at the root', async () => {
    // An orphan drawn at top level looks like a real top-level entry, which
    // misrepresents the file's structure.
    const table = await mount([makeRow('root', null), makeRow('orphan', 'gone')]);
    expect(ids(table)).toEqual(['root']);
    table.remove();
  });

  it('an empty document renders no rows and no toggles', async () => {
    const table = await mount([]);
    expect(ids(table)).toEqual([]);
    expect(table.shadowRoot!.querySelectorAll('tr.data-row').length).toBe(0);
    table.remove();
  });
});
