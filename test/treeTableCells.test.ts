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

// The declarations of one rule in the component's own stylesheet. For the few cell
// facts that are a matter of LAYOUT: happy-dom computes none of it, so the rule
// itself is the closest thing to an assertion available.
const styleRule = (selector: string): string => {
  const sheet = (DexTreeTable.styles as unknown as { cssText: string }[]).map((s) => s.cssText).join('\n');
  const at = sheet.indexOf(selector + ' {');
  return at < 0 ? '' : sheet.slice(at, sheet.indexOf('}', at));
};

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

// A block NAME is unique only inside its own system, so a model view legitimately lists
// several rows reading `Gain` — separate rows, separate parameters, separate links, and
// nothing to tell them apart by eye. The qualifier is where their difference goes.
describe('a block row says which system it is in, after its name', () => {
  const blockRow = (id: string, name: string, systemPath?: string, blockPath?: string): TreeTableRow =>
    ({ ...makeRow(id, name), _isBlockRow: true, _systemPath: systemPath, _blockPath: blockPath }) as any;

  it('shows the enclosing systems, with the whole path as its tooltip', async () => {
    const table = await mount([blockRow('a', 'Gain', 'Controller', 'Controller/Gain')]);
    const q = cell(table, 'a', 'Name').querySelector('.name-qualifier')!;
    // The systems only, not the path: the label is already right there, and repeating it
    // inside its own qualifier reads as a second name. The path is on hover, where a
    // deeply nested block can afford the characters.
    expect(q.textContent).toBe('(Controller)');
    expect(q.getAttribute('title')).toBe('Controller/Gain');
    expect(text(table, 'a', 'Name')).toBe('Gain(Controller)');
    table.remove();
  });

  it('shows nothing for a root-system block, or for a row that is not a block', async () => {
    // `(...)` around nothing is noise, and a variable row has no system to be in — which
    // is why the qualifier is driven by the field rather than by a row kind.
    const table = await mount([blockRow('root', 'Gain', '', 'Gain'), makeRow('var', 'Kp')]);
    expect(cell(table, 'root', 'Name').querySelector('.name-qualifier')).toBeNull();
    expect(cell(table, 'var', 'Name').querySelector('.name-qualifier')).toBeNull();
    expect(text(table, 'root', 'Name')).toBe('Gain');
    table.remove();
  });

  it('keeps the qualifier out of the text an edit, a copy or a sort reads', async () => {
    // Name is an EDITABLE cell: the rename input is seeded from the label, and a copied
    // Name is pasted back as a name. `Gain(Controller)` is neither, so the qualifier stays
    // presentational — unlike the Usage column's `(model)`, which is part of that cell's
    // payload. A path is searchable in the global entry search instead (searchFilter.ts).
    const table = await mount([blockRow('a', 'Gain', 'Controller', 'Controller/Gain')]);
    expect((table as any)._getCellText(table.rows[0], 'Name')).toBe('Gain');
    table.remove();
  });

  it('puts the name and the qualifier in ONE truncating box, so a narrow column cuts the right', async () => {
    // `Gain3 (Controller)` in a column too narrow for it must read `Gain3 (Con…`, not
    // `… (Controller)`: the ellipsis belongs where reading stops. As two flex items it
    // came out backwards — a flex line shrinks its items side by side, `(Controller)`
    // has no break opportunity after its opening paren so it held its full width, and
    // the label (a scroll container, shrinkable to nothing) gave up all of it. The part
    // that NAMES the row was the first part to disappear.
    //
    // happy-dom has no layout engine, so what can be pinned is the box structure and
    // the rule that truncates it — not the pixel where the ellipsis lands.
    const table = await mount([blockRow('a', 'Gain', 'Controller', 'Controller/Gain')]);
    const box = cell(table, 'a', 'Name').querySelector('.name-text')!;
    expect(box.querySelector('.label')!.textContent).toBe('Gain');
    expect(box.querySelector('.name-qualifier')!.textContent).toBe('(Controller)');

    const truncation = ['overflow: hidden', 'text-overflow: ellipsis', 'white-space: nowrap'];
    for (const decl of truncation) expect(styleRule('.name-cell .name-text')).toContain(decl);
    // And exactly ONE box truncates. A second `overflow` inside it — on the label, as
    // it used to be — is a second ellipsis and the old behaviour back.
    expect(styleRule('.name-cell .label')).not.toContain('overflow');
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
          blockLinks: [{ blockName: 'Gain1', modelName: 'topModel', modelUri: 'file:///w/top.slx', linkTarget: 'b:1' }],
        } as any,
      }),
    ]);
    const td = cell(table, 'u', 'UsedBy');
    expect(td.querySelector('a.value-link')!.textContent!.trim()).toBe('Gain1');
    expect(td.querySelector('.param-source')!.textContent).toBe('(topModel)');
    table.remove();
  });

  // Two links reading the same word are two links a user cannot choose between, and a
  // dictionary entry read by four blocks named `Gain` is the ordinary case rather than a
  // corner of one. The path is what separates them, and it goes on HOVER: spelled inline,
  // four `Controller/Inner/Gain`s would fill a column sized for names.
  describe('a blockLink carries where its block is, as a tooltip', () => {
    it('titles each link with its own path, and adds nothing to the text', async () => {
      const M = 'file:///w/f14.slx';
      const table = await mount([
        makeRow('u', 'u', {
          UsedBy: {
            blockLinks: [
              { blockName: 'Gain', blockPath: 'Controller/Gain', modelName: 'f14', modelUri: M, linkTarget: 'b:15' },
              { blockName: 'Gain', blockPath: 'Sensors/Gain', modelName: 'f14', modelUri: M, linkTarget: 'b:24' },
            ],
          } as any,
        }),
      ]);
      const td = cell(table, 'u', 'UsedBy');
      expect([...td.querySelectorAll('a.value-link')].map((a) => a.getAttribute('title'))).toEqual([
        'Controller/Gain',
        'Sensors/Gain',
      ]);
      // The visible cell is unchanged by the paths — that is the point of a tooltip — so
      // sorting and copying read what they always did.
      expect(td.textContent!.trim()).toBe('Gain, Gain(f14)');
      expect((table as any)._getCellText(table.rows[0], 'UsedBy')).toBe('Gain, Gain(f14)');
      table.remove();
    });

    it('renders no title at all for a link with no path, rather than an empty one', async () => {
      // The cell payload is a host's, and a host built against an earlier core sends no
      // path. An empty `title=""` is a tooltip that flashes nothing on hover.
      const table = await mount([
        makeRow('u', 'u', {
          UsedBy: { blockLinks: [{ blockName: 'Gain', modelName: 'f14', modelUri: 'file:///w/f14.slx', linkTarget: 'b:1' }] } as any,
        }),
      ]);
      const a = cell(table, 'u', 'UsedBy').querySelector('a.value-link')!;
      expect(a.hasAttribute('title')).toBe(false);
      expect(a.textContent!.trim()).toBe('Gain');
      table.remove();
    });
  });

  // A dictionary variable is used by every block that reads it, so the one-qualifier-
  // per-block form spent a narrow column repeating `(EngineCtrl)` and pushed the block
  // names — the part being read — out of sight.
  describe('blockLinks aggregate by model', () => {
    const linksOf = (td: HTMLElement): string[] =>
      [...td.querySelectorAll('a.value-link')].map((a) => a.textContent!.trim());
    const sourcesOf = (td: HTMLElement): string[] =>
      [...td.querySelectorAll('.param-source')].map((s) => s.textContent!);

    it('names each model once, after its last block', async () => {
      const E = 'file:///w/EngineCtrl.slx';
      const F = 'file:///w/FuelInjector.slx';
      const table = await mount([
        makeRow('u', 'u', {
          UsedBy: {
            blockLinks: [
              { blockName: 'AFR', modelName: 'EngineCtrl', modelUri: E, linkTarget: 'b:1' },
              { blockName: 'AFRMonitor', modelName: 'EngineCtrl', modelUri: E, linkTarget: 'b:2' },
              { blockName: 'MixTarget', modelName: 'EngineCtrl', modelUri: E, linkTarget: 'b:3' },
              { blockName: 'AFRConst', modelName: 'FuelInjector', modelUri: F, linkTarget: 'b:4' },
              { blockName: 'AFRCheck', modelName: 'FuelInjector', modelUri: F, linkTarget: 'b:5' },
            ],
          } as any,
        }),
      ]);
      const td = cell(table, 'u', 'UsedBy');
      expect(sourcesOf(td)).toEqual(['(EngineCtrl)', '(FuelInjector)']);
      expect(linksOf(td)).toEqual(['AFR', 'AFRMonitor', 'MixTarget', 'AFRConst', 'AFRCheck']);
      expect(td.textContent!.trim()).toBe('AFR, AFRMonitor, MixTarget(EngineCtrl); AFRConst, AFRCheck(FuelInjector)');
      // Every block keeps its own link — grouping is presentational and must not cost
      // the user a navigable target.
      expect(linksOf(td).length).toBe(5);
      table.remove();
    });

    it('collects a model’s blocks even when the payload interleaves them', async () => {
      // Ordering is the reverse index's, so two models CAN arrive interleaved. Grouping
      // only runs of the same model would then print `(A); (B); (A)` — the very
      // repetition this removes.
      const A = 'file:///w/a.slx';
      const B = 'file:///w/b.slx';
      const table = await mount([
        makeRow('u', 'u', {
          UsedBy: {
            blockLinks: [
              { blockName: 'a1', modelName: 'A', modelUri: A, linkTarget: 'b:1' },
              { blockName: 'b1', modelName: 'B', modelUri: B, linkTarget: 'b:2' },
              { blockName: 'a2', modelName: 'A', modelUri: A, linkTarget: 'b:3' },
            ],
          } as any,
        }),
      ]);
      const td = cell(table, 'u', 'UsedBy');
      expect(sourcesOf(td)).toEqual(['(A)', '(B)']);
      expect(td.textContent!.trim()).toBe('a1, a2(A); b1(B)');
      table.remove();
    });

    it('keeps two same-labelled models apart, because it groups on the uri', async () => {
      // `engine.slx` and `vendor/engine.slx` both label `engine`. Grouping on the label
      // would print one `(engine)` over blocks living in two different files.
      const table = await mount([
        makeRow('u', 'u', {
          UsedBy: {
            blockLinks: [
              { blockName: 'g1', modelName: 'engine', modelUri: 'file:///w/engine.slx', linkTarget: 'b:1' },
              { blockName: 'g2', modelName: 'engine', modelUri: 'file:///w/vendor/engine.slx', linkTarget: 'b:2' },
            ],
          } as any,
        }),
      ]);
      const td = cell(table, 'u', 'UsedBy');
      expect(sourcesOf(td)).toEqual(['(engine)', '(engine)']);
      expect(td.textContent!.trim()).toBe('g1(engine); g2(engine)');
      table.remove();
    });

    it('renders no empty parens for a link with no model name', async () => {
      // Two different things reach the cell as a blank name, and it must print neither: a
      // model the graph could not summarise (this row — no uri either), and a usage the
      // host deliberately unqualified because it is inside the file being viewed
      // (usageCells' `withoutOwnModel`, which keeps the uri). Blanking the name is how the
      // host says "do not print this", so an empty `()` would break both.
      const table = await mount([
        makeRow('u', 'u', {
          UsedBy: { blockLinks: [{ blockName: 'orphan', modelName: '', modelUri: '', linkTarget: 'b:1' }] } as any,
        }),
      ]);
      const td = cell(table, 'u', 'UsedBy');
      expect(td.querySelector('.param-source')).toBeNull();
      expect(td.textContent!.trim()).toBe('orphan');
      table.remove();
    });

    it('gives sorting and copying the same grouped text the cell shows', async () => {
      const E = 'file:///w/EngineCtrl.slx';
      const F = 'file:///w/FuelInjector.slx';
      const table = await mount([
        makeRow('u', 'u', {
          UsedBy: {
            blockLinks: [
              { blockName: 'AFR', modelName: 'EngineCtrl', modelUri: E, linkTarget: 'b:1' },
              { blockName: 'AFRConst', modelName: 'FuelInjector', modelUri: F, linkTarget: 'b:2' },
              { blockName: 'AFRMonitor', modelName: 'EngineCtrl', modelUri: E, linkTarget: 'b:3' },
            ],
          } as any,
        }),
      ]);
      const grouped = 'AFR, AFRMonitor(EngineCtrl); AFRConst(FuelInjector)';
      expect((table as any)._getCellText(table.rows[0], 'UsedBy')).toBe(grouped);
      expect(cell(table, 'u', 'UsedBy').textContent!.trim()).toBe(grouped);
      table.remove();
    });
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

  // Each list shape binds its own click closure over the link it rendered, so an
  // anchor being present is not evidence that clicking it navigates anywhere —
  // one closure that captured the wrong element sends the user to another entry,
  // and the only way to catch that is to click every shape and read the target.
  it('every link shape reports the target of the link actually clicked', async () => {
    const table = await mount([
      makeRow('dp', 'dp', {
        DataType: {
          paramLinks: [
            { property: 'DataType', paramName: 'dtA', source: 'S1', linkTarget: 'dt:A' },
            { property: 'Min', paramName: 'dtB', source: '', linkTarget: 'dt:B' },
          ],
        } as any,
      }),
      makeRow('dl', 'dl', {
        DataType: {
          links: [
            { text: 'busA', linkTarget: 'bus:A' },
            { text: 'busB', linkTarget: 'bus:B' },
          ],
        } as any,
      }),
      makeRow('up', 'up', {
        UsedBy: {
          paramLinks: [
            { property: 'Gain', paramName: 'pA', source: 'Blk', linkTarget: 'p:A' },
            { property: 'Bias', paramName: 'pB', source: '', linkTarget: 'p:B' },
          ],
        } as any,
      }),
      makeRow('ub', 'ub', {
        UsedBy: {
          blockLinks: [
            { blockName: 'Gain1', modelName: 'top', linkTarget: 'b:A' },
            { blockName: 'Gain2', modelName: 'sub', linkTarget: 'b:B' },
          ],
        } as any,
      }),
      makeRow('ul', 'ul', {
        UsedBy: {
          links: [
            { text: 'modelA', linkTarget: 'm:A' },
            { text: 'modelB', linkTarget: 'm:B' },
          ],
        } as any,
      }),
    ]);
    const clicked: string[] = [];
    table.addEventListener('dex-link-clicked', (e) => clicked.push((e as CustomEvent).detail.target));

    // Click the SECOND link of every list: a closure that captured the list
    // rather than the item would report the first target for both.
    for (const [rowId, col] of [
      ['dp', 'DataType'],
      ['dl', 'DataType'],
      ['up', 'UsedBy'],
      ['ub', 'UsedBy'],
      ['ul', 'UsedBy'],
    ] as const) {
      const links = cell(table, rowId, col).querySelectorAll('a.value-link');
      expect(links.length, `${rowId}/${col}`).toBe(2);
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
      links[1].dispatchEvent(ev);
      // href="#" would otherwise navigate the whole webview away from the table.
      expect(ev.defaultPrevented, `${rowId}/${col}`).toBe(true);
    }
    expect(clicked).toEqual(['dt:B', 'bus:B', 'p:B', 'b:B', 'm:B']);
    table.remove();
  });

  it('a link click does not bubble out of the table as a plain click', async () => {
    // The host listens for clicks to move the inspector; a navigation click that
    // kept bubbling would retarget the inspector at the same time as the jump.
    const table = await mount([makeRow('dl', 'dl', { DataType: { links: [{ text: 'busA', linkTarget: 'bus:A' }] } as any })]);
    let bubbled = 0;
    const count = (): void => {
      bubbled++;
    };
    document.body.addEventListener('click', count);
    try {
      (cell(table, 'dl', 'DataType').querySelector('a.value-link') as HTMLElement).click();
      expect(bubbled).toBe(0);
    } finally {
      document.body.removeEventListener('click', count);
      table.remove();
    }
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

  // DataType has its own link shapes (a signal's type resolves to a Bus, or to
  // the parameters that set it), and `type:` search plus header sorting both read
  // this text. Falling through to cellText() on those shapes yields "" or
  // "[object Object]" — the column then sorts arbitrarily and `type:bus` finds
  // nothing, with no error to indicate why.
  it('DataType links flatten to comma-joined text for search and sort', async () => {
    const table = await mount([
      makeRow('a', 'A', {
        DataType: {
          links: [
            { text: 'busA', linkTarget: 'x' },
            { text: 'busB', linkTarget: 'y' },
          ],
        } as any,
      }),
    ]);
    expect((table as any)._getCellText(table.rows[0], 'DataType')).toBe('busA, busB');
    table.remove();
  });

  it('DataType paramLinks flatten to "property=name(source)" text', async () => {
    const table = await mount([
      makeRow('a', 'A', {
        DataType: {
          paramLinks: [
            { property: 'DataType', paramName: 'dt', source: 'Blk', linkTarget: 'x' },
            { property: 'Min', paramName: 'lo', source: '', linkTarget: 'y' },
          ],
        } as any,
      }),
    ]);
    // The second has no source, so it must not gain an empty "()" — the text is
    // what a `type:` search matches against.
    expect((table as any)._getCellText(table.rows[0], 'DataType')).toBe('DataType=dt(Blk), Min=lo');
    table.remove();
  });

  it('a type: search finds an entry through its DataType link text', async () => {
    // The end the flattening exists for: the user searches for the bus name they
    // can see in the column, and the row must match.
    const table = await mount([
      makeRow('a', 'A', { DataType: { links: [{ text: 'myBus', linkTarget: 'x' }] } as any }),
      makeRow('b', 'B', { DataType: 'double' }),
    ]);
    const input = table.shadowRoot!.querySelector('.filter-input') as HTMLInputElement;
    input.value = 'type:myBus';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await table.updateComplete;
    expect(
      Array.from(table.shadowRoot!.querySelectorAll('tr.data-row')).map((r) => r.getAttribute('data-row-id')),
    ).toEqual(['a']);
    table.remove();
  });

  it('sorting by Data Type with a link cell keeps the table rendered', async () => {
    const table = await mount([
      makeRow('a', 'A', { DataType: { links: [{ text: 'zBus', linkTarget: 'x' }] } as any }),
      makeRow('b', 'B', { DataType: { paramLinks: [{ property: 'P', paramName: 'aParam', source: '', linkTarget: 'y' }] } as any }),
    ]);
    const th = Array.from(table.shadowRoot!.querySelectorAll('th')).find((el) =>
      /data ?type/i.test(el.textContent || ''),
    ) as HTMLElement;
    th.click();
    await table.updateComplete;
    expect(
      Array.from(table.shadowRoot!.querySelectorAll('tr.data-row')).map((r) => r.getAttribute('data-row-id')),
    ).toEqual(['b', 'a']); // "P=aParam" sorts before "zBus"
    table.remove();
  });
});

// The invariant BETWEEN the two readings of a cell, rather than another assertion
// of one side. Everything above pins either what `_getCellText` returns or what the
// cell paints — and separate tests of two paths both keep passing as the paths
// drift apart. The GAP is what the user meets: `type:myBus` finding nothing the
// Data Type column plainly shows, a Usage column sorting by text nobody can see, a
// search marking a run the filter never matched. Adding a cell shape in the host
// layer, or an arm in core's toRow, produces exactly that gap and nothing raises.
//
// So: walk every cell shape the host can emit (src/host/rowBuilder.ts,
// usageCells.ts, matrixPayload.ts) and assert the searched text IS the painted
// text. Deliberately no expected strings — pinning the two readings to each other
// is the whole point, so a shape whose flattening rule legitimately changes stays
// covered without this test being touched. The compile-time half of the same
// contract (core's RowData fits TreeTableRow) sits beside TreeTableRow itself.
describe('the text read for search and sort is the text on screen', () => {
  const MATRIX = { name: 'Mat', className: 'double', dims: [2, 2], cells: ['1', '2', '3', '4'] };
  const LINKS = [
    { text: 'busA', linkTarget: 'x' },
    { text: 'busB', linkTarget: 'y' },
  ];
  // The second has no source, so neither reading may invent an empty `()`.
  const PARAM_LINKS = [
    { property: 'DataType', paramName: 'dt', source: 'Blk', linkTarget: 'x' },
    { property: 'Min', paramName: 'lo', source: '', linkTarget: 'y' },
  ];
  // Two blocks in one model plus one with no model name: enough to exercise the
  // grouping, the group separator, and a group that must drop its qualifier.
  const BLOCK_LINKS = [
    { blockName: 'Gain', modelName: 'm1', linkTarget: 'x' },
    { blockName: 'Sum', modelName: 'm1', linkTarget: 'y' },
    { blockName: 'Loose', modelName: '', linkTarget: 'z' },
  ];

  const SHAPES: Array<[string, string, Partial<TreeTableRow>]> = [
    ['a plain label', 'Name', {}],
    ['a block row that names its system', 'Name', { _systemPath: 'Controller/Inner', _blockPath: 'Controller/Inner/entryName' } as any],
    ['a plain string', 'Value', { Value: '3.14' }],
    ['an empty value', 'Value', { Value: '' }],
    ['the {text} shape', 'Value', { Value: { text: '42' } }],
    ['an editable cell', 'Value', { Value: { text: '7', editable: true } }],
    ['a link value', 'Value', { Value: { text: 'busA', linkTarget: 'x' } }],
    ['an object placeholder', 'Value', { Value: '<1x3 struct>' }],
    ['a matrix, whose glyph must add no text', 'Value', { Value: '[1 2; 3 4]', _matrix: MATRIX }],
    ['a plain string', 'DataType', { DataType: 'double' }],
    ['the {text} shape', 'DataType', { DataType: { text: 'single' } }],
    ['a resolved bus link', 'DataType', { DataType: { text: 'myBus', linkTarget: 'x' } }],
    ['a links list', 'DataType', { DataType: { links: LINKS } as any }],
    ['a paramLinks list', 'DataType', { DataType: { paramLinks: PARAM_LINKS } as any }],
    ['a plain string', 'Class', { Class: 'Simulink.Parameter' }],
    ['the {text} shape', 'Class', { Class: { text: 'Simulink.Signal', clipboardMode: 'cell' } }],
    ['a plain string', 'Kind', { Kind: 'Parameter' }],
    ['the {text} shape', 'Kind', { Kind: { text: 'Signal', clipboardMode: 'cell' } }],
    ['a plain string', 'Description', { Description: 'the loop gain' }],
    ['the {text} shape', 'Description', { Description: { text: 'the loop gain', clipboardMode: 'cell' } }],
    ['a plain string', 'Status', { Status: 'Modified' }],
    ['the {text} shape', 'Status', { Status: { text: 'New', clipboardMode: 'cell' } }],
    ['no usage at all', 'UsedBy', {}],
    ['an empty string', 'UsedBy', { UsedBy: '' }],
    ['a shapeless {} from a lookup that found nothing', 'UsedBy', { UsedBy: {} as any }],
    ['a plain string', 'UsedBy', { UsedBy: 'model1' }],
    ['the {text} shape', 'UsedBy', { UsedBy: { text: 'model1' } }],
    ['a link', 'UsedBy', { UsedBy: { text: 'model1', linkTarget: 'x' } }],
    ['a links list', 'UsedBy', { UsedBy: { links: LINKS } as any }],
    ['a paramLinks list', 'UsedBy', { UsedBy: { paramLinks: PARAM_LINKS } as any }],
    ['a grouped blockLinks list', 'UsedBy', { UsedBy: { blockLinks: BLOCK_LINKS } as any }],
    ['a schema column as a plain string', 'storageClass', { storageClass: 'ExportedGlobal' } as any],
    ['a schema column as {text}', 'storageClass', { storageClass: { text: 'Auto' } } as any],
    ['an editable schema column', 'storageClass', { storageClass: { text: 'Model default', editable: true } } as any],
    ['an empty schema column', 'storageClass', { storageClass: '' } as any],
  ];

  const flat = (s: string): string => s.replace(/\s+/g, ' ').trim();

  // The `(Controller/Inner)` a block row appends is a disambiguator the CELL adds
  // when several blocks share a name — not part of the entry's name, which is why
  // _getCellText returns the name alone. It is the one painted run outside this
  // contract, so it is excluded HERE by name rather than being allowed to weaken
  // every other case. `.param-property` and `.param-source` stay in: both readings
  // include them.
  const painted = (table: DexTreeTable, rowId: string, col: string): string => {
    const clone = cell(table, rowId, col).cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.name-qualifier').forEach((q) => q.remove());
    return flat(clone.textContent || '');
  };

  for (const [label, col, extra] of SHAPES) {
    it(`${col}: ${label}`, async () => {
      const table = await mount([makeRow('r', 'entryName', extra)]);
      expect(flat((table as any)._getCellText(table.rows[0], col))).toBe(painted(table, 'r', col));
      table.remove();
    });
  }
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

describe('a matrix Value cell carries the Variable Editor glyph', () => {
  const MAT = { name: 'Mat', className: 'double', dims: [2, 2], cells: ['1', '2', '3', '4'] };

  const glyph = (table: DexTreeTable, rowId: string) =>
    cell(table, rowId, 'Value').querySelector('dex-matrix-open');

  it('renders the glyph only on the row that owns a matrix', async () => {
    const table = await mount([
      makeRow('m', 'Mat', { Value: '[1 2; 3 4]', _matrix: MAT }),
      makeRow('s', 'Scalar', { Value: '7' }),
    ]);
    expect(glyph(table, 'm')).not.toBeNull();
    expect(glyph(table, 's')).toBeNull();
    table.remove();
  });

  it('keeps the value literal beside the glyph, unchanged', async () => {
    // The grid is an addition to the cell, not a replacement for it: the row must
    // still read as the matrix it is when the editor is closed.
    const table = await mount([makeRow('m', 'Mat', { Value: '[1 2; 3 4]', _matrix: MAT })]);
    expect(text(table, 'm', 'Value')).toBe('[1 2; 3 4]');
    table.remove();
  });

  it('hands the glyph the payload and the row id', async () => {
    const table = await mount([makeRow('m', 'Mat', { Value: '[1 2; 3 4]', _matrix: MAT })]);
    const g = glyph(table, 'm') as any;
    expect(g.matrix).toBe(MAT);
    expect(g.rowId).toBe('m');
    table.remove();
  });

  it('adds no text, so sorting and filtering still see the literal only', async () => {
    // _getCellText feeds sort and filter. An icon that contributed text would
    // silently reorder the table.
    const table = await mount([makeRow('m', 'Mat', { Value: '[1 2; 3 4]', _matrix: MAT })]);
    expect((table as any)._getCellText(table.rows[0], 'Value')).toBe('[1 2; 3 4]');
    table.remove();
  });

  it('renders on the object cell shape too, not just the plain string', async () => {
    const table = await mount([
      makeRow('m', 'Mat', { Value: { text: '[1 2; 3 4]', editable: false }, _matrix: MAT }),
    ]);
    expect(glyph(table, 'm')).not.toBeNull();
    expect(text(table, 'm', 'Value')).toBe('[1 2; 3 4]');
    table.remove();
  });

  it('renders beside a link value too, so the rule does not depend on the branch', async () => {
    const table = await mount([
      makeRow('m', 'Mat', { Value: { text: '[1 2; 3 4]', linkTarget: 'x' }, _matrix: MAT }),
    ]);
    expect(cell(table, 'm', 'Value').querySelector('a.value-link')).not.toBeNull();
    expect(glyph(table, 'm')).not.toBeNull();
    table.remove();
  });

  it('is gone while the cell is being edited', async () => {
    // An inline editor replaces the cell contents entirely; a glyph floating over
    // an <input> would open a grid of the pre-edit value.
    const table = await mount([makeRow('m', 'Mat', { Value: { text: '[1 2; 3 4]', editable: true }, _matrix: MAT })]);
    (table as any)._editingCell = { rowId: 'm', columnId: 'Value' };
    table.requestUpdate();
    await table.updateComplete;
    expect(cell(table, 'm', 'Value').querySelector('input')).not.toBeNull();
    expect(glyph(table, 'm')).toBeNull();
    table.remove();
  });
});
