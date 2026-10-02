// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The customer's end of the row budget: a row whose children the host held back
// (host: lazyRows.ts stamps `_lazy`).
//
// Before this, a twisty existed if and only if some row named this one as its parent,
// which made "has children" and "has children HERE" the same question. A planned
// payload separates them — the 8 MB `.mat` that prompted this has 2,016,325 nodes and
// ships 238 of them — so the table has to offer a gesture for rows it holds nothing
// under, and the gesture has to ask the host rather than reveal.
//
// Two things are easy to get wrong here and neither fails loudly:
//
//  - Only the MOUSE learns the new rule. The glyph, the Space key and `aria-expanded`
//    were three copies of the same test, so a tree a pointer can open stays shut for a
//    keyboard and silent for a screen reader.
//  - The fetch is asked twice, or for ever. Collapsing and re-expanding a row whose
//    answer has not arrived must not re-ask, and a row that came back with children
//    must stop being askable at all.
import { describe, it, expect } from 'vitest';
import { DexTreeTable, type TreeTableRow } from '../src/webview/components/dex-tree-table.js';
import { mergeChildRows } from '../src/webview/rowUpdates.js';

function makeRow(id: string, parent: string | null, extra: Partial<TreeTableRow> = {}): TreeTableRow {
  return { ID: id, parent, Name: { label: id }, Value: '', DataType: '', Description: '', Status: '', ...extra };
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

async function setRows(table: DexTreeTable, rows: TreeTableRow[]): Promise<void> {
  table.rows = rows;
  (table as any)._visibleRowsCache = null;
  table.requestUpdate();
  await table.updateComplete;
}

/** The ▶/▼ glyph in a row's Name cell — the element the user actually clicks. */
const toggle = (table: DexTreeTable, rowId: string): HTMLElement =>
  table.shadowRoot!.querySelector(`tr[data-row-id="${rowId}"] .toggle`) as HTMLElement;

const row = (table: DexTreeTable, rowId: string): HTMLElement =>
  table.shadowRoot!.querySelector(`tr[data-row-id="${rowId}"]`) as HTMLElement;

const ids = (table: DexTreeTable): string[] => (table as any)._getVisibleRows().map((r: TreeTableRow) => r.ID);

/** Record every children request the table makes. */
function asked(table: DexTreeTable): string[] {
  const out: string[] = [];
  table.addEventListener('dex-request-children', (e: Event) => out.push((e as CustomEvent).detail?.nodeId));
  return out;
}

function press(table: DexTreeTable, key: string): void {
  ((table as any)._container as HTMLElement).dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
}

// A payload planned to a budget: one variable delivered, its children deferred, and an
// ordinary leaf beside it.
const DEFERRED = [makeRow('big', null, { _lazy: true }), makeRow('small', null)];

describe('a deferred row offers to open', () => {
  it('shows a twisty although no child row arrived with it', async () => {
    const table = await mount(DEFERRED);
    expect(toggle(table, 'big').classList.contains('empty')).toBe(false);
    expect(toggle(table, 'big').textContent?.trim()).toBe('▶');
    table.remove();
  });

  it('still shows none on a row that genuinely has no children', async () => {
    // The other direction: the mark is what adds the twisty, so a leaf must be
    // unaffected — a table where every row offers to open says nothing about any of them.
    const table = await mount(DEFERRED);
    expect(toggle(table, 'small').classList.contains('empty')).toBe(true);
    table.remove();
  });

  it('tells assistive tech, which cannot see the glyph', async () => {
    const table = await mount(DEFERRED);
    expect(row(table, 'big').getAttribute('aria-expanded')).toBe('false');
    expect(row(table, 'small').hasAttribute('aria-expanded')).toBe(false);
    table.remove();
  });
});

describe('opening one asks the host for its children', () => {
  it('dispatches dex-request-children with the row id, which IS the node id', async () => {
    const table = await mount(DEFERRED);
    const requests = asked(table);
    toggle(table, 'big').click();
    await table.updateComplete;
    expect(requests).toEqual(['big']);
    table.remove();
  });

  it('shows the row as open and waiting, not as a twisty that did nothing', async () => {
    // The click has to land visibly. An unchanged ▶ reads as a dead control and invites
    // the repeated clicking that made the original bug look like a hang.
    const table = await mount(DEFERRED);
    toggle(table, 'big').click();
    await table.updateComplete;
    expect(toggle(table, 'big').textContent?.trim()).toBe('▼');
    expect(toggle(table, 'big').classList.contains('loading')).toBe(true);
    expect(toggle(table, 'big').getAttribute('title')).toBe('Loading…');
    table.remove();
  });

  it('asks once, however many times the row is opened while the answer is in flight', async () => {
    // Collapse and re-expand before the rows arrive. Re-asking would deliver the same
    // rows twice, and mergeChildRows is the only thing standing between that and two
    // rows under one parent.
    const table = await mount(DEFERRED);
    const requests = asked(table);
    toggle(table, 'big').click();
    await table.updateComplete;
    toggle(table, 'big').click();
    await table.updateComplete;
    toggle(table, 'big').click();
    await table.updateComplete;
    expect(requests).toEqual(['big']);
    table.remove();
  });

  it('asks from the keyboard too, by the same rule', async () => {
    // The parity that _canExpand buys: Space used to test the delivered child count, so
    // a keyboard-only user could not open a deferred row at all.
    const table = await mount(DEFERRED);
    const requests = asked(table);
    table.selectedRowIds = ['big'];
    await table.updateComplete;
    press(table, ' ');
    await table.updateComplete;
    expect(requests).toEqual(['big']);
    expect((table as any)._expandedIds.has('big')).toBe(true);
    table.remove();
  });

  it('asks nothing for a row that already holds its children', async () => {
    const table = await mount([makeRow('big', null), makeRow('big.1', 'big')]);
    const requests = asked(table);
    toggle(table, 'big').click();
    await table.updateComplete;
    expect(requests).toEqual([]);
    expect(ids(table)).toEqual(['big', 'big.1']);
    table.remove();
  });
});

describe('when the children arrive', () => {
  it('shows them under the row the user opened, and stops waiting', async () => {
    const table = await mount(DEFERRED);
    toggle(table, 'big').click();
    await table.updateComplete;

    // What table-main does with a `childRows` message.
    const merged = mergeChildRows(table.rows as any[], 'big', [
      makeRow('big.1', 'big'),
      makeRow('big.2', 'big'),
    ]) as TreeTableRow[];
    await setRows(table, merged);

    expect(ids(table)).toEqual(['big', 'big.1', 'big.2', 'small']);
    expect(toggle(table, 'big').classList.contains('loading')).toBe(false);
    table.remove();
  });

  it('does not ask again once they are here', async () => {
    const table = await mount(DEFERRED);
    toggle(table, 'big').click();
    await table.updateComplete;
    await setRows(table, mergeChildRows(table.rows as any[], 'big', [makeRow('big.1', 'big')]) as TreeTableRow[]);

    const requests = asked(table);
    toggle(table, 'big').click(); // collapse
    await table.updateComplete;
    toggle(table, 'big').click(); // expand, from rows it now holds
    await table.updateComplete;
    expect(requests).toEqual([]);
    expect(ids(table)).toEqual(['big', 'big.1', 'small']);
    table.remove();
  });

  it('keeps the row askable when the answer was empty, and asks again only on a new gesture', async () => {
    // An empty answer still clears the mark (see mergeChildRows), so the row settles as
    // a leaf: no twisty, nothing more to ask. The alternative — a row that keeps
    // offering and keeps answering nothing — is a control the user cannot learn from.
    const table = await mount(DEFERRED);
    toggle(table, 'big').click();
    await table.updateComplete;
    await setRows(table, mergeChildRows(table.rows as any[], 'big', []) as TreeTableRow[]);
    expect(toggle(table, 'big').classList.contains('empty')).toBe(true);
    expect(row(table, 'big').hasAttribute('aria-expanded')).toBe(false);
    table.remove();
  });

  it('re-asks after a whole repaint re-marks the row, which is a new payload', async () => {
    // A re-parse (the file changed on disk) sends a fresh planned payload: the row is
    // deferred again and holds nothing. Two things have to be let go of — the pending
    // flag, or the row could never fetch again for the rest of the session, and the
    // expansion, because an open row with nothing under it is the tree refusing to open
    // and takes an extra collapse to recover from. So it paints closed, and one click
    // asks again.
    const table = await mount(DEFERRED);
    toggle(table, 'big').click();
    await table.updateComplete;
    await setRows(table, [makeRow('big', null, { _lazy: true }), makeRow('small', null)]);
    expect(toggle(table, 'big').textContent?.trim()).toBe('▶');

    const requests = asked(table);
    toggle(table, 'big').click();
    await table.updateComplete;
    expect(requests).toEqual(['big']);
    expect(toggle(table, 'big').classList.contains('loading')).toBe(true);
    table.remove();
  });
});
