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
});
