// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// Cell rendering. Every cell value originates in the user's file, so two things
// have to hold: text must be rendered as text (an entry named `<img onerror=…>`
// must not become live markup inside the webview), and the several cell shapes
// the host emits — plain string, {text}, {links}, {paramLinks}, {blockLinks} —
// must each render and, where applicable, produce a working navigation link.
// `_getCellText` is the same text sorting and searching read, so a shape that
// returns undefined there breaks both.
import { describe, it, expect, beforeEach } from 'vitest';
import { DexTreeTable, type TreeTableRow } from '../src/webview/components/dex-tree-table.js';

const HOST_COLUMNS = ['Name', 'Value', 'DataType', 'UsedBy', 'Status', 'Kind', 'Class', 'storageClass', 'Description'];

beforeEach(() => localStorage.clear());

function makeRow(id: string, name: string, extra: Partial<TreeTableRow> = {}): TreeTableRow {
  return { ID: id, parent: null, Name: { label: name }, Value: '', DataType: '', Description: '', Status: '', ...extra };
}

async function mount(rows: TreeTableRow[]): Promise<DexTreeTable> {
  const table = new DexTreeTable();
  table.columns = HOST_COLUMNS;
  document.body.appendChild(table);
  (table as any)._hiddenColumns = new Set<string>();
  table.rows = rows;
  table.requestUpdate();
  await table.updateComplete;
  return table;
}

const cell = (table: DexTreeTable, rowId: string, col: string): HTMLElement =>
  table.shadowRoot!.querySelector(`tr[data-row-id="${rowId}"] td.col-${col}`) as HTMLElement;

const text = (table: DexTreeTable, rowId: string, col: string): string =>
  (cell(table, rowId, col).textContent || '').trim();

describe('user-supplied text is rendered as text, never as markup', () => {
  it('an entry named like an HTML tag shows the literal characters', async () => {
    // A .sldd is just a file; an entry named `<img src=x onerror="...">` must not
    // become a live element that runs script inside the webview.
    const evil = '<img src=x onerror="boom">';
    const table = await mount([makeRow('x', evil)]);
    expect(table.shadowRoot!.querySelectorAll('img').length).toBe(0);
    expect(text(table, 'x', 'Name')).toBe(evil);
    table.remove();
  });

  it('a value containing markup is escaped too', async () => {
    const table = await mount([makeRow('x', 'plain', { Value: '<script>alert(1)</script>' })]);
    expect(table.shadowRoot!.querySelectorAll('script').length).toBe(0);
    expect(text(table, 'x', 'Value')).toBe('<script>alert(1)</script>');
    table.remove();
  });

  it('search highlighting does not open a hole in the escaping', async () => {
    // _highlight splits the string and re-interpolates it around a <mark>; the
    // pieces have to stay escaped or a crafted name becomes markup as soon as the
    // user searches for part of it.
    const table = await mount([makeRow('x', '<img src=x onerror="boom">')]);
    const input = table.shadowRoot!.querySelector('.filter-input') as HTMLInputElement;
    input.value = 'img';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await table.updateComplete;

    expect(table.shadowRoot!.querySelectorAll('img').length).toBe(0);
    expect(cell(table, 'x', 'Name').querySelector('mark')!.textContent).toBe('img');
    table.remove();
  });

  it('a MATLAB object value keeps its <Class> display form as text', async () => {
    // The host writes an unexpandable object as `<Simulink.Parameter>`; those
    // angle brackets are the intended display, and get their own style class.
    const table = await mount([makeRow('o', 'obj', { Value: '<Simulink.Parameter>' })]);
    expect(text(table, 'o', 'Value')).toBe('<Simulink.Parameter>');
    expect(cell(table, 'o', 'Value').querySelector('.value-object')).not.toBeNull();
    table.remove();
  });
});

describe('the cell shapes the host emits', () => {
  it('a plain string renders directly', async () => {
    const table = await mount([makeRow('a', 'A', { Value: 'five', DataType: 'double', Status: 'Modified' })]);
    expect(text(table, 'a', 'Value')).toBe('five');
    expect(text(table, 'a', 'DataType')).toBe('double');
    expect(text(table, 'a', 'Status')).toBe('Modified');
    table.remove();
  });

  it('an object cell renders its text', async () => {
    const table = await mount([
      makeRow('a', 'A', {
        Value: { text: 'five', editable: true },
        DataType: { text: 'single' },
        Status: { text: 'New' },
        Kind: { text: 'Signal' } as any,
        Class: { text: 'Simulink.Signal' } as any,
        Description: { text: 'notes' },
      }),
    ]);
    expect(text(table, 'a', 'Value')).toBe('five');
    expect(text(table, 'a', 'DataType')).toBe('single');
    expect(text(table, 'a', 'Status')).toBe('New');
    expect(text(table, 'a', 'Kind')).toBe('Signal');
    expect(text(table, 'a', 'Class')).toBe('Simulink.Signal');
    expect(text(table, 'a', 'Description')).toBe('notes');
    table.remove();
  });

  it('an empty cell renders blank rather than "undefined" or "null"', async () => {
    // Stringifying a missing field would put the word undefined in the user's
    // table and, worse, make it searchable.
    const table = await mount([{ ID: 'a', parent: null, Name: { label: 'A' } } as any]);
    for (const col of ['Value', 'DataType', 'Status', 'Description', 'UsedBy', 'Kind', 'Class']) {
      expect(text(table, 'a', col)).toBe('');
    }
    table.remove();
  });

  it('a value of zero is shown, not swallowed as falsy', async () => {
    // 0 is a perfectly ordinary parameter value; a truthiness check would render
    // an empty cell and make the entry look unset.
    const table = await mount([
      makeRow('z', 'zero', { Value: '0' }),
      makeRow('o', 'objZero', { Value: { text: '0', editable: true } }),
      makeRow('f', 'falseish', { Value: { text: 'false' } }),
    ]);
    expect(text(table, 'z', 'Value')).toBe('0');
    expect(text(table, 'o', 'Value')).toBe('0');
    expect(text(table, 'f', 'Value')).toBe('false');
    table.remove();
  });

  it('a generic schema column renders read-only strings dimmed and editable ones plain', async () => {
    // The dimming is how the user tells at a glance which Code Generation fields
    // they can actually change.
    const table = await mount([
      makeRow('ro', 'ReadOnly', { storageClass: 'Auto' as any }),
      makeRow('rw', 'Writable', { storageClass: { text: 'Auto', editable: true } as any }),
    ]);
    expect(cell(table, 'ro', 'storageClass').querySelector('.readonly-cell')).not.toBeNull();
    expect(cell(table, 'rw', 'storageClass').querySelector('.readonly-cell')).toBeNull();
    expect(text(table, 'rw', 'storageClass')).toBe('Auto');
    table.remove();
  });

  it('a Status value gets the modified style only when non-empty', async () => {
    const table = await mount([makeRow('m', 'M', { Status: 'Modified' }), makeRow('u', 'U', { Status: '' })]);
    expect(cell(table, 'm', 'Status').querySelector('.status-modified')).not.toBeNull();
    expect(cell(table, 'u', 'Status').querySelector('.status-modified')).toBeNull();
    table.remove();
  });

  it('positional array elements are dimmed, since their names are synthetic', async () => {
    // `(1)` and `(2)` are index labels the viewer invents, not names in the file,
    // so they read as structure rather than as data the user typed.
    const table = await mount([
      { ...makeRow('e', 'x'), Name: { label: '(1)', element: true } } as any,
      makeRow('n', 'realName'),
    ]);
    expect(cell(table, 'e', 'Name').querySelector('.label')!.className).toContain('readonly');
    expect(cell(table, 'n', 'Name').querySelector('.label')!.className).not.toContain('readonly');
    table.remove();
  });

  it('an icon is rendered when the host supplies one, and omitted otherwise', async () => {
    const table = await mount([
      { ...makeRow('i', 'WithIcon'), Name: { label: 'WithIcon', iconId: 'param' } } as any,
      makeRow('p', 'Plain'),
    ]);
    expect(cell(table, 'i', 'Name').querySelector('dex-icon')).not.toBeNull();
    expect(cell(table, 'p', 'Name').querySelector('dex-icon')).toBeNull();
    table.remove();
  });
});

describe('links navigate rather than following an href', () => {
  it('a DataType link reports its target to the host', async () => {
    // This is how the user jumps from a signal to the bus type that defines it;
    // the href="#" must never actually navigate the webview.
    const table = await mount([makeRow('s', 'sig', { DataType: { text: 'myBus', linkTarget: 'bus:myBus' } })]);
    const clicked: string[] = [];
    table.addEventListener('dex-link-clicked', (e) => clicked.push((e as CustomEvent).detail.target));

    const link = cell(table, 's', 'DataType').querySelector('a.value-link') as HTMLElement;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(ev);
    expect(clicked).toEqual(['bus:myBus']);
    expect(ev.defaultPrevented).toBe(true);
    table.remove();
  });

  it('clicking a link does not also change the row selection', async () => {
    // The click is a navigation request; retargeting the inspector at the same
    // time would fight with wherever the host is about to send the user.
    const table = await mount([
      makeRow('s', 'sig', { DataType: { text: 'myBus', linkTarget: 'bus:myBus' } }),
      makeRow('t', 'other'),
    ]);
    table.selectedRowIds = ['t'];
    await table.updateComplete;
    (cell(table, 's', 'DataType').querySelector('a.value-link') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    expect(table.selectedRowIds).toEqual(['t']);
    table.remove();
  });

  it('a Value link works the same way', async () => {
    const table = await mount([makeRow('v', 'v', { Value: { text: 'refEntry', linkTarget: 'entry:refEntry' } })]);
    const clicked: string[] = [];
    table.addEventListener('dex-link-clicked', (e) => clicked.push((e as CustomEvent).detail.target));
    (cell(table, 'v', 'Value').querySelector('a.value-link') as HTMLElement).click();
    expect(clicked).toEqual(['entry:refEntry']);
    table.remove();
  });

  it('a links list renders one link per entry, comma-separated', async () => {
    const table = await mount([
      makeRow('u', 'u', {
        UsedBy: {
          links: [
            { text: 'modelA', linkTarget: 'm:A' },
            { text: 'modelB', linkTarget: 'm:B' },
          ],
        } as any,
      }),
    ]);
    const links = Array.from(cell(table, 'u', 'UsedBy').querySelectorAll('a.value-link'));
    expect(links.map((a) => a.textContent!.trim())).toEqual(['modelA', 'modelB']);
    expect(text(table, 'u', 'UsedBy')).toContain(',');
    table.remove();
  });

  it('paramLinks show which property references the entry', async () => {
    // "Gain=myParam(Block)" tells the user where the value is consumed; dropping
    // the property name would leave an unattributed list of names.
    const table = await mount([
      makeRow('u', 'u', {
        UsedBy: {
          paramLinks: [{ property: 'Gain', paramName: 'myParam', source: 'Block1', linkTarget: 'p:1' }],
        } as any,
      }),
    ]);
    const td = cell(table, 'u', 'UsedBy');
    expect(td.querySelector('.param-property')!.textContent).toBe('Gain=');
    expect(td.querySelector('a.value-link')!.textContent!.trim()).toBe('myParam');
    expect(td.querySelector('.param-source')!.textContent).toBe('(Block1)');
    table.remove();
  });

  it('a paramLink with no source omits the parenthetical rather than showing "()"', async () => {
    const table = await mount([
      makeRow('u', 'u', {
        UsedBy: { paramLinks: [{ property: 'Gain', paramName: 'myParam', source: '', linkTarget: 'p:1' }] } as any,
      }),
    ]);
    expect(cell(table, 'u', 'UsedBy').querySelector('.param-source')).toBeNull();
    table.remove();
  });

  it('blockLinks name the block and its model', async () => {
    // Two models can hold blocks with the same name, so the model qualifier is
    // what makes the reference identifiable.
    const table = await mount([
      makeRow('u', 'u', {
        UsedBy: {
          blockLinks: [{ blockName: 'Gain1', modelName: 'topModel', linkTarget: 'b:1' }],
        } as any,
      }),
    ]);
    const td = cell(table, 'u', 'UsedBy');
    expect(td.querySelector('a.value-link')!.textContent!.trim()).toBe('Gain1');
    expect(td.querySelector('.param-source')!.textContent).toBe('(topModel)');
    table.remove();
  });

  it('DataType paramLinks and links render through the same paths', async () => {
    const table = await mount([
      makeRow('a', 'a', {
        DataType: { paramLinks: [{ property: 'DataType', paramName: 'dt', source: 'S', linkTarget: 'd:1' }] } as any,
      }),
      makeRow('b', 'b', { DataType: { links: [{ text: 'busA', linkTarget: 'b:A' }] } as any }),
    ]);
    expect(cell(table, 'a', 'DataType').querySelector('.param-property')!.textContent).toBe('DataType=');
    expect(cell(table, 'b', 'DataType').querySelector('a.value-link')!.textContent!.trim()).toBe('busA');
    table.remove();
  });

  it('a UsedBy plain string with a linkTarget still renders as a link', async () => {
    const table = await mount([makeRow('u', 'u', { UsedBy: { text: 'modelA', linkTarget: 'm:A' } as any })]);
    const clicked: string[] = [];
    table.addEventListener('dex-link-clicked', (e) => clicked.push((e as CustomEvent).detail.target));
    (cell(table, 'u', 'UsedBy').querySelector('a.value-link') as HTMLElement).click();
    expect(clicked).toEqual(['m:A']);
    table.remove();
  });
});

describe('cell text for sorting and searching', () => {
  it('every shape yields a string, so sorting cannot throw', async () => {
    // _getCellSortText lowercases whatever this returns. A shape that fell through
    // to undefined threw a TypeError mid-render and blanked the ENTIRE table the
    // moment the user clicked the column header.
    const table = await mount([
      makeRow('a', 'A', { UsedBy: {} as any }),
      makeRow('b', 'B', { UsedBy: { text: 'm1' } as any }),
      makeRow('c', 'C', { UsedBy: { links: [{ text: 'm2', linkTarget: 'x' }] } as any }),
      makeRow('d', 'D', { UsedBy: { paramLinks: [{ property: 'P', paramName: 'q', source: '', linkTarget: 'x' }] } as any }),
      makeRow('e', 'E', { UsedBy: { blockLinks: [{ blockName: 'blk', modelName: 'm', linkTarget: 'x' }] } as any }),
      makeRow('f', 'F', { UsedBy: '' as any }),
    ]);
    for (const row of table.rows) {
      expect(typeof (table as any)._getCellText(row, 'UsedBy')).toBe('string');
    }
    table.remove();
  });

  it('sorting by Usage with a shapeless UsedBy value keeps the table rendered', async () => {
    // Regression: usageGraph can leave `UsedBy: {}` on a row with no references.
    // Sorting that column used to throw and the user lost the whole grid.
    const table = await mount([makeRow('a', 'A', { UsedBy: {} as any }), makeRow('b', 'B', { UsedBy: { text: 'm1' } as any })]);
    const usedByTh = Array.from(table.shadowRoot!.querySelectorAll('th')).find((th) =>
      /usage|usedby/i.test(th.textContent || ''),
    ) as HTMLElement;
    usedByTh.click();
    await table.updateComplete;
    expect(table.shadowRoot!.querySelectorAll('tr.data-row').length).toBe(2);
    table.remove();
  });

  it('a links list is flattened to comma-joined text so a search finds any of them', async () => {
    const table = await mount([
      makeRow('u', 'u', {
        UsedBy: { links: [{ text: 'modelA', linkTarget: 'x' }, { text: 'modelB', linkTarget: 'y' }] } as any,
      }),
    ]);
    expect((table as any)._getCellText(table.rows[0], 'UsedBy')).toBe('modelA, modelB');
    table.remove();
  });

  it('an unknown column name yields empty text rather than throwing', async () => {
    const table = await mount([makeRow('a', 'A')]);
    expect((table as any)._getCellText(table.rows[0], 'NoSuchColumn')).toBe('');
    table.remove();
  });
});

// Cell values come out of a parsed file, so a column can arrive null (a property
// present but unset) or as a bare {} (a partial parse, or a usage lookup that
// found nothing). Neither is a shape the viewer chose, and both used to break the
// table rather than the single cell — `typeof null === 'object'` in JavaScript, so
// a null cell took the object branch and dereferencing it threw.
describe('a null or shapeless cell degrades to blank, not to a broken table', () => {
  const COLUMNS = ['Value', 'DataType', 'Class', 'Kind', 'Description', 'Status', 'UsedBy'];

  for (const col of COLUMNS) {
    it(`a null ${col} still renders the row`, async () => {
      // Regression: this threw inside render(), so ONE null cell blanked the
      // ENTIRE grid — every other entry in the file became invisible.
      const table = await mount([makeRow('a', 'A', { [col]: null } as any), makeRow('b', 'B')]);
      expect(table.shadowRoot!.querySelectorAll('tr.data-row').length).toBe(2);
      expect(text(table, 'a', col)).toBe('');
      table.remove();
    });
  }

  for (const col of COLUMNS) {
    it(`sorting by ${col} works when a cell holds a shapeless object`, async () => {
      // Regression: _getCellText returned undefined for {}, and the sort
      // comparator lowercases it — clicking the header threw and the user lost
      // the whole grid.
      const table = await mount([makeRow('a', 'A', { [col]: {} } as any), makeRow('b', 'B', { [col]: 'zz' } as any)]);
      const cols = (table as any)._visibleColumns as string[];
      const th = (Array.from(table.shadowRoot!.querySelectorAll('th')) as HTMLElement[])[cols.indexOf(col)];
      th.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await table.updateComplete;
      expect(table.shadowRoot!.querySelectorAll('tr.data-row').length).toBe(2);
      table.remove();
    });
  }

  it('every column yields a string for null, {} and a text-less object', async () => {
    const table = await mount([makeRow('a', 'A')]);
    for (const col of COLUMNS) {
      for (const bad of [null, {}, { editable: true }]) {
        const value = (table as any)._getCellText({ ...table.rows[0], [col]: bad }, col);
        expect(typeof value, `${col} with ${JSON.stringify(bad)}`).toBe('string');
      }
    }
    table.remove();
  });

  it('a null Value is not treated as an editable cell', async () => {
    // The editability flag lives on the object form; reading it off null threw
    // before the guard, so a double-click on such a cell took the table down.
    const table = await mount([makeRow('a', 'A', { Value: null } as any)]);
    const edits: unknown[] = [];
    table.addEventListener('dex-edit-completed', (e) => edits.push(e));
    cell(table, 'a', 'Value').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await table.updateComplete;
    expect(table.shadowRoot!.querySelector('.edit-input')).toBeNull();
    expect(edits).toEqual([]);
    table.remove();
  });
});

describe('section header rows', () => {
  it('a section row is styled as a header', async () => {
    // Sections group a .mat file's variables; they are labels, not entries, and
    // must not look editable or draggable.
    const table = await mount([makeRow('section:Parameters', 'Parameters'), makeRow('p', 'aParam')]);
    const row = table.shadowRoot!.querySelector('tr[data-row-id="section:Parameters"]') as HTMLElement;
    expect(row.className).toContain('section-row');
    table.remove();
  });

  it('a normal row is not styled as a section', async () => {
    const table = await mount([makeRow('p', 'aParam')]);
    const row = table.shadowRoot!.querySelector('tr[data-row-id="p"]') as HTMLElement;
    expect(row.className).not.toContain('section-row');
    table.remove();
  });
});
