// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// Search / filtering. The box accepts a small DSL — bare terms, `name:`/`type:`/
// `class:`/`kind:`/`status:`/`value:` prefixes, quoted phrases, and numeric
// comparisons on `value:`. A search that silently matches nothing is worse than
// an error here: the user concludes the entry is absent from the file. These
// tests also pin the tree behaviour of a filtered view, since a matching child
// is useless if its parent rows vanish.
import { describe, it, expect, beforeEach } from 'vitest';
import { DexTreeTable, type TreeTableRow } from '../src/webview/components/dex-tree-table.js';
import { nextStickyIds } from '../src/webview/rowUpdates.js';

const HOST_COLUMNS = ['Name', 'Value', 'DataType', 'UsedBy', 'Status', 'Kind', 'Class'];

beforeEach(() => localStorage.clear());

function makeRow(id: string, parent: string | null, name: string, extra: Partial<TreeTableRow> = {}): TreeTableRow {
  return { ID: id, parent, Name: { label: name }, Value: '', DataType: '', Description: '', Status: '', ...extra };
}

async function mount(rows: TreeTableRow[], expanded: string[] = []): Promise<DexTreeTable> {
  const table = new DexTreeTable();
  table.columns = HOST_COLUMNS;
  document.body.appendChild(table);
  // Kind and Class ship hidden; reveal everything so the prefix searches that
  // read those columns, and the all-visible-column bare search, are exercised.
  (table as any)._hiddenColumns = new Set<string>();
  table.rows = rows;
  (table as any)._expandedIds = new Set(expanded);
  (table as any)._visibleRowsCache = null;
  table.requestUpdate();
  await table.updateComplete;
  return table;
}

// Type into the real search box, so the input binding and cache invalidation run.
async function search(table: DexTreeTable, text: string): Promise<string[]> {
  const input = table.shadowRoot!.querySelector('.filter-input') as HTMLInputElement;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await table.updateComplete;
  return (table as any)._getVisibleRows().map((r: TreeTableRow) => r.ID);
}

const CATALOG = [
  makeRow('p1', null, 'gainValue', { Value: '5', DataType: 'double', Status: 'Modified', Kind: 'Parameter' as any, Class: 'Simulink.Parameter' as any }),
  makeRow('p2', null, 'offset', { Value: '12', DataType: 'single', Status: '', Kind: 'Parameter' as any, Class: 'Simulink.Parameter' as any }),
  makeRow('s1', null, 'busSignal', { Value: '', DataType: 'Bus: myBus', Status: 'New', Kind: 'Signal' as any, Class: 'Simulink.Signal' as any }),
  makeRow('sp', null, 'my param', { Value: '100', DataType: 'double', Kind: 'Parameter' as any }),
];

describe('bare search terms', () => {
  it('matches a substring of a name, case-insensitively', async () => {
    const table = await mount(CATALOG);
    expect(await search(table, 'gain')).toEqual(['p1']);
    expect(await search(table, 'GAIN')).toEqual(['p1']);
    table.remove();
  });

  it('searches across every visible column, not just the name', async () => {
    // The user sees Value/DataType/Status side by side, so typing what they read
    // in any of those columns has to find the row.
    const table = await mount(CATALOG);
    expect(await search(table, 'single')).toEqual(['p2']);
    expect(await search(table, 'Modified')).toEqual(['p1']);
    expect(await search(table, 'Simulink.Signal')).toEqual(['s1']);
    table.remove();
  });

  it('two terms both have to match — they narrow, not widen', async () => {
    // AND, not OR: adding a word must never bring back rows the first word
    // excluded, or refining a search would grow the result list.
    const table = await mount(CATALOG);
    expect(await search(table, 'double')).toEqual(['p1', 'sp']);
    expect(await search(table, 'double gain')).toEqual(['p1']);
    expect(await search(table, 'double busSignal')).toEqual([]);
    table.remove();
  });

  it('an empty box shows everything again', async () => {
    const table = await mount(CATALOG);
    await search(table, 'gain');
    expect(await search(table, '')).toEqual(['p1', 'p2', 's1', 'sp']);
    table.remove();
  });

  it('whitespace-only input is not treated as a term', async () => {
    // Otherwise a stray space would appear to empty the whole document.
    const table = await mount(CATALOG);
    expect(await search(table, '   ')).toEqual(['p1', 'p2', 's1', 'sp']);
    table.remove();
  });

  it('a term matching nothing yields an empty view', async () => {
    const table = await mount(CATALOG);
    expect(await search(table, 'zzzznotpresent')).toEqual([]);
    table.remove();
  });
});

describe('quoted phrases', () => {
  // Regression: the tokenizer deliberately keeps "my param" together as ONE
  // token so its space does not split it into two terms — but the quotes were
  // never stripped before comparing, so every quoted search matched literally
  // nothing. The user quotes a phrase precisely because it contains a space, and
  // got an empty table telling them the entry did not exist.
  it('a quoted phrase matches the phrase, not the quote characters', async () => {
    const table = await mount(CATALOG);
    expect(await search(table, '"my param"')).toEqual(['sp']);
    table.remove();
  });

  it('quoting keeps the phrase intact instead of AND-ing two terms', async () => {
    // Unquoted, `my param` is two terms and would also match anything containing
    // both words separately.
    const table = await mount([...CATALOG, makeRow('x', null, 'param of my own')]);
    expect(await search(table, 'my param')).toEqual(['sp', 'x']);
    expect(await search(table, '"my param"')).toEqual(['sp']);
    table.remove();
  });

  it('a prefixed search accepts a quoted phrase too', async () => {
    const table = await mount(CATALOG);
    expect(await search(table, 'name:"my param"')).toEqual(['sp']);
    table.remove();
  });

  it('type: accepts a quoted value containing a colon', async () => {
    // "Bus: myBus" has both a space and a colon, so it can only be searched quoted.
    const table = await mount(CATALOG);
    expect(await search(table, 'type:"Bus: myBus"')).toEqual(['s1']);
    table.remove();
  });

  it('an unclosed quote searches the rest of the text rather than throwing', async () => {
    // A half-typed query arrives on every keystroke of a quoted phrase. Dropping
    // the lone quote and matching `my` keeps the list live as the user types;
    // treating the quote as literal text would blank the table instead.
    const table = await mount(CATALOG);
    expect(await search(table, '"my')).toEqual(['s1', 'sp']);
    table.remove();
  });
});

describe('field-prefixed searches', () => {
  it('name: restricts the match to the Name column', async () => {
    // `double` appears in DataType for two rows; name:double must find neither.
    const table = await mount(CATALOG);
    expect(await search(table, 'name:gain')).toEqual(['p1']);
    expect(await search(table, 'name:double')).toEqual([]);
    table.remove();
  });

  it('type: restricts to DataType', async () => {
    const table = await mount(CATALOG);
    expect(await search(table, 'type:double')).toEqual(['p1', 'sp']);
    expect(await search(table, 'type:gain')).toEqual([]);
    table.remove();
  });

  it('class: and kind: restrict to their own columns', async () => {
    const table = await mount(CATALOG);
    expect(await search(table, 'kind:Signal')).toEqual(['s1']);
    expect(await search(table, 'class:Simulink.Parameter')).toEqual(['p1', 'p2']);
    table.remove();
  });

  it('status: finds the rows the host has marked changed', async () => {
    // This is how a user reviews what they have edited before saving.
    const table = await mount(CATALOG);
    expect(await search(table, 'status:Modified')).toEqual(['p1']);
    expect(await search(table, 'status:New')).toEqual(['s1']);
    table.remove();
  });

  it('an unknown prefix is searched as ordinary text, colon included', async () => {
    // Otherwise a value that genuinely contains a colon becomes unsearchable and
    // the user gets a silently empty table.
    const table = await mount([makeRow('c', null, 'ns:thing'), makeRow('d', null, 'other')]);
    expect(await search(table, 'ns:thing')).toEqual(['c']);
    table.remove();
  });

  it('a prefix that names an Object.prototype member is still ordinary text', async () => {
    // The known prefixes are looked up in a table keyed by prefix name. A plain
    // object literal there inherits from Object.prototype, so `constructor:` /
    // `toString:` would resolve to an inherited function, be mistaken for a real
    // column prefix, and match against a column named after a function — matching
    // nothing at all. These are searchable words in a .sldd (a struct field, a
    // MATLAB class member), so they have to behave like any unknown prefix.
    const rows = [
      makeRow('c', null, 'constructor:init'),
      makeRow('t', null, 'toString:helper'),
      makeRow('d', null, 'other'),
    ];
    const table = await mount(rows);
    expect(await search(table, 'constructor:init')).toEqual(['c']);
    expect(await search(table, 'toString:helper')).toEqual(['t']);
    table.remove();
  });

  it('a leading colon is not read as an empty prefix', async () => {
    const table = await mount([makeRow('c', null, ':leading'), makeRow('d', null, 'other')]);
    expect(await search(table, ':leading')).toEqual(['c']);
    table.remove();
  });

  it('a prefix with no value matches every row rather than none', async () => {
    // `name:` on its own is an incomplete query the user is still typing; blanking
    // the table mid-keystroke reads as "nothing here".
    const table = await mount(CATALOG);
    expect(await search(table, 'name:')).toEqual(['p1', 'p2', 's1', 'sp']);
    table.remove();
  });

  it('prefixes are recognised case-insensitively', async () => {
    const table = await mount(CATALOG);
    expect(await search(table, 'NAME:gain')).toEqual(['p1']);
    table.remove();
  });

  it('a prefixed and a bare term combine', async () => {
    const table = await mount(CATALOG);
    expect(await search(table, 'kind:Parameter single')).toEqual(['p2']);
    table.remove();
  });
});

describe('value: searches', () => {
  it('a bare value: term is a substring match', async () => {
    const table = await mount(CATALOG);
    expect(await search(table, 'value:12')).toEqual(['p2']);
    table.remove();
  });

  it('value:"..." is exact, so it does not match a longer value', async () => {
    // Distinguishing 5 from 15 and 100 is the whole point of the quoted form.
    const table = await mount([
      makeRow('a', null, 'a', { Value: '5' }),
      makeRow('b', null, 'b', { Value: '15' }),
      makeRow('c', null, 'c', { Value: '5.0' }),
    ]);
    expect(await search(table, 'value:"5"')).toEqual(['a']);
    table.remove();
  });

  it('numeric comparisons compare as numbers, not as text', async () => {
    // Lexical comparison would put "100" below "5" and give the wrong rows.
    const table = await mount([
      makeRow('a', null, 'a', { Value: '5' }),
      makeRow('b', null, 'b', { Value: '100' }),
      makeRow('c', null, 'c', { Value: '50' }),
    ]);
    expect(await search(table, 'value:>50')).toEqual(['b']);
    expect(await search(table, 'value:>=50')).toEqual(['b', 'c']);
    expect(await search(table, 'value:<50')).toEqual(['a']);
    expect(await search(table, 'value:<=50')).toEqual(['a', 'c']);
    expect(await search(table, 'value:=50')).toEqual(['c']);
    table.remove();
  });

  it('a non-numeric cell is excluded from a numeric comparison, not treated as zero', async () => {
    // Treating '' or 'auto' as 0 would sweep unrelated rows into `value:<10`.
    const table = await mount([
      makeRow('n', null, 'n', { Value: '5' }),
      makeRow('t', null, 't', { Value: 'auto' }),
      makeRow('e', null, 'e', { Value: '' }),
    ]);
    expect(await search(table, 'value:<10')).toEqual(['n']);
    table.remove();
  });

  it('a comparison with a non-numeric bound is ignored rather than emptying the table', async () => {
    const table = await mount(CATALOG);
    expect(await search(table, 'value:>abc')).toEqual(['p1', 'p2', 's1', 'sp']);
    table.remove();
  });

  it('value: reads through an object-shaped cell', async () => {
    // Editable cells arrive as {text, editable}; searching must see the text.
    const table = await mount([
      makeRow('a', null, 'a', { Value: { text: '7', editable: true } }),
      makeRow('b', null, 'b', { Value: { text: '9', editable: true } }),
    ]);
    expect(await search(table, 'value:7')).toEqual(['a']);
    expect(await search(table, 'value:>8')).toEqual(['b']);
    table.remove();
  });
});

describe('a filtered view stays a usable tree', () => {
  const NESTED = [
    makeRow('bus', null, 'myBus'),
    makeRow('bus/e1', 'bus', 'speed'),
    makeRow('bus/e1/u', 'bus/e1', 'units'),
    makeRow('bus/e2', 'bus', 'torque'),
    makeRow('other', null, 'unrelated'),
  ];

  it('a matching child keeps its ancestors visible', async () => {
    // Without the parents the match floats free of any context, and the user has
    // no way to tell which bus the element belongs to.
    const table = await mount(NESTED, ['bus', 'bus/e1']);
    expect(await search(table, 'units')).toEqual(['bus', 'bus/e1', 'bus/e1/u']);
    table.remove();
  });

  it('a matching parent keeps its whole subtree, so the branch can be browsed', async () => {
    const table = await mount(NESTED, ['bus', 'bus/e1']);
    expect(await search(table, 'myBus')).toEqual(['bus', 'bus/e1', 'bus/e1/u', 'bus/e2']);
    table.remove();
  });

  it('a non-matching sibling branch is dropped', async () => {
    const table = await mount(NESTED, ['bus', 'bus/e1']);
    expect(await search(table, 'speed')).not.toContain('bus/e2');
    table.remove();
  });

  it('a match inside a collapsed branch is still hidden until expanded', async () => {
    // Filtering narrows the document; it does not override the user's collapse
    // state, so the ancestor rows appear with their toggles ready to open.
    const table = await mount(NESTED, []);
    expect(await search(table, 'units')).toEqual(['bus']);
    table.remove();
  });

  it('clearing the search restores the unfiltered tree', async () => {
    const table = await mount(NESTED, ['bus']);
    await search(table, 'speed');
    expect(await search(table, '')).toEqual(['bus', 'bus/e1', 'bus/e2', 'other']);
    table.remove();
  });
});

describe('the search box itself', () => {
  it('Escape clears the box and the filter together', async () => {
    // Clearing only one of the two would leave the table filtered by text the
    // user can no longer see.
    const table = await mount(CATALOG);
    await search(table, 'gain');
    const input = table.shadowRoot!.querySelector('.filter-input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await table.updateComplete;
    expect(input.value).toBe('');
    expect((table as any)._filterText).toBe('');
    expect((table as any)._getVisibleRows().length).toBe(4);
    table.remove();
  });

  it('a key other than Escape leaves the filter alone', async () => {
    const table = await mount(CATALOG);
    await search(table, 'gain');
    const input = table.shadowRoot!.querySelector('.filter-input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    await table.updateComplete;
    expect((table as any)._filterText).toBe('gain');
    table.remove();
  });

  it('surrounding whitespace is trimmed so a trailing space still matches', async () => {
    const table = await mount(CATALOG);
    expect(await search(table, '  gain  ')).toEqual(['p1']);
    table.remove();
  });

  it('focusFilter selects the existing text so the next keystroke replaces it', async () => {
    // This backs the Ctrl+F shortcut; without .select() the user types into the
    // middle of their previous query.
    const table = await mount(CATALOG);
    await search(table, 'gain');
    const input = table.shadowRoot!.querySelector('.filter-input') as HTMLInputElement;
    table.focusFilter();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('gain'.length);
    table.remove();
  });

  it('the search box is present even when the document is empty', async () => {
    // The empty-state render is a separate branch; dropping the box there would
    // trap a user who filtered a small file down to nothing.
    const table = await mount([]);
    expect(table.shadowRoot!.querySelector('.filter-input')).not.toBeNull();
    expect(table.shadowRoot!.querySelector('.empty-state')!.textContent).toContain('No data');
    table.remove();
  });
});

describe('feedback when a search matches nothing', () => {
  // Regression: with rows present but no match, the table rendered a bare header
  // over blank space. The user could not tell whether the file was empty, the
  // view had failed to load, or their filter was simply too narrow.
  it('an explanatory message names the term that matched nothing', async () => {
    const table = await mount(CATALOG);
    await search(table, 'zzzznotpresent');
    const msg = table.shadowRoot!.querySelector('.no-match-state') as HTMLElement;
    expect(msg).not.toBeNull();
    expect(msg.textContent).toContain('zzzznotpresent');
    table.remove();
  });

  it('the message is absent whenever rows are showing', async () => {
    const table = await mount(CATALOG);
    expect(table.shadowRoot!.querySelector('.no-match-state')).toBeNull();
    await search(table, 'gain');
    expect(table.shadowRoot!.querySelector('.no-match-state')).toBeNull();
    table.remove();
  });

  it('it disappears again once the search is cleared', async () => {
    const table = await mount(CATALOG);
    await search(table, 'zzzznotpresent');
    await search(table, '');
    expect(table.shadowRoot!.querySelector('.no-match-state')).toBeNull();
    table.remove();
  });

  it('an unfiltered view with nothing to show blames no search term', async () => {
    // Rows can flatten to zero with no filter at all: every row here names a
    // parent that isn't in the set, so none is reachable from a root. Attributing
    // that to a search would print `No entries match ""` and send the user
    // hunting for a filter they never typed.
    const orphans = [makeRow('x', 'missing', 'X'), makeRow('y', 'gone', 'Y')];
    const table = await mount(orphans);
    expect((table as any)._getVisibleRows()).toEqual([]);
    expect(table.shadowRoot!.querySelector('.no-match-state')).toBeNull();
    table.remove();
  });
});

describe('matched text is highlighted', () => {
  const marks = (table: DexTreeTable, rowId: string, col: string): string[] => {
    const cell = table.shadowRoot!.querySelector(`tr[data-row-id="${rowId}"] td.col-${col}`) as HTMLElement;
    return Array.from(cell.querySelectorAll('mark')).map((m) => m.textContent || '');
  };

  it('the matching run is wrapped in a mark so the user can see why a row matched', async () => {
    const table = await mount(CATALOG);
    await search(table, 'gain');
    const mark = table.shadowRoot!.querySelector('tr[data-row-id="p1"] mark') as HTMLElement;
    expect(mark).not.toBeNull();
    expect(mark.textContent).toBe('gain');
    table.remove();
  });

  it('highlighting preserves the original casing of the cell text', async () => {
    // Rewriting the cell to the typed casing would misreport the entry's name.
    const table = await mount([makeRow('a', null, 'GainValue')]);
    await search(table, 'gain');
    const cell = table.shadowRoot!.querySelector('tr[data-row-id="a"] td.col-Name') as HTMLElement;
    expect(cell.textContent).toContain('GainValue');
    expect((cell.querySelector('mark') as HTMLElement).textContent).toBe('Gain');
    table.remove();
  });

  it('a cell that does not contain the term is left unmarked', async () => {
    const table = await mount(CATALOG);
    await search(table, 'gain');
    const typeCell = table.shadowRoot!.querySelector('tr[data-row-id="p1"] td.col-DataType') as HTMLElement;
    expect(typeCell.querySelector('mark')).toBeNull();
    expect(typeCell.textContent).toContain('double');
    table.remove();
  });

  // Regression: highlighting re-derived its search term from the raw filter text
  // instead of from the tokens the row predicates were built from. A multi-word
  // query therefore looked for the literal string `double gain` in every cell,
  // found it nowhere, and marked nothing — the rows narrowed correctly but the
  // user was left to work out by eye which of their words each row matched.
  it('every word of a multi-word search is marked, in whichever column it hit', async () => {
    const table = await mount(CATALOG);
    await search(table, 'double gain');
    expect(marks(table, 'p1', 'Name')).toEqual(['gain']);
    expect(marks(table, 'p1', 'DataType')).toEqual(['double']);
    table.remove();
  });

  it('a quoted phrase is marked as the one run the user searched for', async () => {
    // The phrase is a single token, so its space must not split the mark in two.
    const table = await mount(CATALOG);
    await search(table, '"my param"');
    expect(marks(table, 'sp', 'Name')).toEqual(['my param']);
    table.remove();
  });

  it('a prefixed term is marked only in the column it searched', async () => {
    // `name:double` deliberately ignores the DataType column; marking `double`
    // there would show the user a match the filter did not actually make.
    const table = await mount([makeRow('a', null, 'double', { DataType: 'double' })]);
    await search(table, 'name:double');
    expect(marks(table, 'a', 'Name')).toEqual(['double']);
    expect(marks(table, 'a', 'DataType')).toEqual([]);
    table.remove();
  });

  it('a term repeated inside one cell is marked at every occurrence', async () => {
    const table = await mount([makeRow('a', null, 'gain_of_gain')]);
    await search(table, 'gain');
    expect(marks(table, 'a', 'Name')).toEqual(['gain', 'gain']);
    table.remove();
  });

  it('two terms overlapping the same characters produce one mark, not duplicated text', async () => {
    // `var` and `variable` both hit `myVariable` at the same offset. Marking each
    // independently would emit the overlapping run twice and the cell would read
    // `myVariableiable`.
    const table = await mount([makeRow('a', null, 'myVariable')]);
    await search(table, 'var variable');
    expect(marks(table, 'a', 'Name')).toEqual(['Variable']);
    const cell = table.shadowRoot!.querySelector('tr[data-row-id="a"] td.col-Name') as HTMLElement;
    expect(cell.textContent).toContain('myVariable');
    table.remove();
  });

  it('a numeric comparison marks nothing, having no text to point at', async () => {
    const table = await mount([makeRow('a', null, 'a', { Value: '100' })]);
    await search(table, 'value:>50');
    expect(marks(table, 'a', 'Value')).toEqual([]);
    table.remove();
  });

  it('a Status hit is marked like any other column', async () => {
    const table = await mount(CATALOG);
    await search(table, 'status:Modified');
    expect(marks(table, 'p1', 'Status')).toEqual(['Modified']);
    table.remove();
  });

  it('an incomplete prefix marks nothing rather than every character', async () => {
    // `name:` matches every row while the user is still typing; its empty term
    // must not be treated as a match at every offset in every cell.
    const table = await mount(CATALOG);
    await search(table, 'name:');
    expect(marks(table, 'p1', 'Name')).toEqual([]);
    table.remove();
  });
});

// Editing a row inside a filtered list is how the user makes it stop matching their
// own search. Re-filtering on the spot deletes that row from under the cursor the
// moment the edit commits, so a search resolves to a list ONCE and rows leave it
// only when the user searches again.
describe('a filtered list holds still while its rows are edited', () => {
  // Mirrors installRows() in table-main.ts — the one funnel every repaint (value
  // edit, rename, structural edit, undo, redo) arrives through. Only the sticky-row
  // rule is reproduced here; nextStickyIds itself is pinned in rowUpdates.test.ts.
  async function repaint(
    table: DexTreeTable,
    rows: TreeTableRow[],
    selectIds: string[] = [],
  ): Promise<string[]> {
    const prevVisible = (table as any)._getVisibleRows().map((r: TreeTableRow) => r.ID);
    table.rows = rows;
    (table as any)._stickyRowIds = nextStickyIds((table as any)._filterText, prevVisible, rows, selectIds);
    (table as any)._visibleRowsCache = null;
    table.requestUpdate();
    await table.updateComplete;
    return (table as any)._getVisibleRows().map((r: TreeTableRow) => r.ID);
  }

  const edited = (id: string, extra: Partial<TreeTableRow>): TreeTableRow[] =>
    CATALOG.map((r) => (r.ID === id ? { ...r, ...extra } : r));

  it('a row edited out of the match stays in the list', async () => {
    const table = await mount(CATALOG);
    expect(await search(table, '12')).toEqual(['p2']);
    expect(await repaint(table, edited('p2', { Value: '99' }))).toEqual(['p2']);
    table.remove();
  });

  it('it leaves as soon as the user searches again — even for the same text', async () => {
    // "Until the user triggers another search" means the box, not the text: pressing
    // Enter or retyping the same query is the user asking for a fresh answer.
    const table = await mount(CATALOG);
    await search(table, '12');
    await repaint(table, edited('p2', { Value: '99' }));
    expect(await search(table, '12')).toEqual([]);
    table.remove();
  });

  it('a different search is answered from scratch', async () => {
    const table = await mount(CATALOG);
    await search(table, '12');
    await repaint(table, edited('p2', { Value: '99' }));
    expect(await search(table, 'gain')).toEqual(['p1']);
    table.remove();
  });

  it('a renamed row stays, under the new id the host supplies', async () => {
    // The rename is what changes the Name cell out of the match, and it re-keys the
    // row at the same time, so the sticky id has to come from the host's selectRows.
    const table = await mount(CATALOG);
    expect(await search(table, 'gain')).toEqual(['p1']);
    const renamed = CATALOG.map((r) =>
      r.ID === 'p1' ? { ...r, ID: 'p1b', Name: { label: 'plainValue' } } : r,
    );
    expect(await repaint(table, renamed, ['p1b'])).toEqual(['p1b']);
    table.remove();
  });

  it('a row that never matched still does not appear', async () => {
    // Stickiness suppresses removals from the list the search produced; it is not
    // "show everything once an edit happens".
    const table = await mount(CATALOG);
    await search(table, 'gain');
    expect(await repaint(table, edited('p2', { Value: '99' }))).toEqual(['p1']);
    table.remove();
  });

  it('a row edited INTO the match appears immediately', async () => {
    // Additions are never suppressed: the user renaming a row to what they searched
    // for expects to see it, and nothing on screen is disturbed by it arriving.
    const table = await mount(CATALOG);
    await search(table, 'gain');
    expect(await repaint(table, edited('p2', { Value: 'gain3' }))).toEqual(['p1', 'p2']);
    table.remove();
  });

  it('a deleted row does not linger', async () => {
    const table = await mount(CATALOG);
    await search(table, 'gain');
    expect(await repaint(table, CATALOG.filter((r) => r.ID !== 'p1'))).toEqual([]);
    table.remove();
  });

  it('a kept row keeps its ancestors, so it is still reachable in the tree', async () => {
    // A row whose parent is filtered out is not merely unindented — it is dropped
    // entirely by the flatten, so keeping it without its parents keeps nothing.
    const tree = [
      makeRow('sec', null, 'Parameters'),
      makeRow('bus', 'sec', 'busEntry'),
      makeRow('el', 'bus', 'gainField', { Value: '5' }),
    ];
    const table = await mount(tree, ['sec', 'bus']);
    expect(await search(table, 'gain')).toEqual(['sec', 'bus', 'el']);
    const renamed = tree.map((r) => (r.ID === 'el' ? { ...r, ID: 'el2', Name: { label: 'plainField' } } : r));
    expect(await repaint(table, renamed, ['el2'])).toEqual(['sec', 'bus', 'el2']);
    table.remove();
  });

  it('a pasted row shows even when it does not match the search', async () => {
    // Paste, add, move and the survivor of a delete all arrive on the same channel
    // as a rename: the host names the rows it wants selected. Filtering one out
    // would leave the selection on a row the user cannot see, and make the paste look
    // as though it had not happened.
    const table = await mount(CATALOG);
    await search(table, 'gain');
    const pasted = [...CATALOG, makeRow('new', null, 'copyOfOffset', { Value: '12' })];
    expect(await repaint(table, pasted, ['new'])).toEqual(['p1', 'new']);
    table.remove();
  });

  it('EVERY row of a multi-entry paste shows, not just the last', async () => {
    // A paste of several entries names all of them, and the selection the user is
    // about to act on covers all of them — so a filtered list that admitted only the
    // last would hide rows that are selected, which is worse than hiding none.
    const table = await mount(CATALOG);
    await search(table, 'gain');
    const pasted = [
      ...CATALOG,
      makeRow('new1', null, 'copyOfOffset', { Value: '12' }),
      makeRow('new2', null, 'copyOfOffset1', { Value: '13' }),
    ];
    expect(await repaint(table, pasted, ['new1', 'new2'])).toEqual(['p1', 'new1', 'new2']);
    table.remove();
  });

  it('keeping a row does not re-admit the rest of its section', async () => {
    // A kept row brings its ancestors along, and a MATCHING row brings its whole
    // subtree — so if kept rows counted as matches, the section header kept with the
    // first one would reopen the entire section and the first edit would quietly
    // undo the search.
    const tree = [
      makeRow('sec', null, 'Parameters'),
      makeRow('a', 'sec', 'gainA', { Value: '5' }),
      makeRow('b', 'sec', 'unrelated', { Value: '7' }),
    ];
    const table = await mount(tree, ['sec']);
    expect(await search(table, 'gain')).toEqual(['sec', 'a']);
    const renamed = tree.map((r) => (r.ID === 'a' ? { ...r, ID: 'a2', Name: { label: 'plainA' } } : r));
    expect(await repaint(table, renamed, ['a2'])).toEqual(['sec', 'a2']);
    table.remove();
  });

  it('clearing the search forgets what was kept', async () => {
    // Escape ends the search, so the next one starts from the rows as they are now.
    const table = await mount(CATALOG);
    await search(table, 'gain');
    await repaint(table, edited('p1', { Name: { label: 'plainValue' } }));
    const input = table.shadowRoot!.querySelector('.filter-input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await table.updateComplete;
    expect((table as any)._getVisibleRows().length).toBe(4);
    expect(await search(table, 'gain')).toEqual([]);
    table.remove();
  });
});
