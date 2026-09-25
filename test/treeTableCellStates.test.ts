// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The three cell states of issue #26: editable, read-only, and read-only where the column
// does not apply to the row at all. The table marks each on its <td> and the stylesheet
// does the rest — dimmed ink for read-only, a washed surface for not-applicable, and
// nothing at all for editable, which is what the user is hunting for and so is the one
// left plain.
//
// Three earlier versions were rejected in use, and all three rejections are pinned below
// rather than merely no longer tested, because each is the obvious thing to reach for again:
//   - the cues were first revealed on the row under the cursor. A cue that appears under
//     the pointer is motion in the corner of your eye on every mouse move, and it answers
//     the question for one row while the user is scanning a column.
//   - the not-applicable cue was first applied to EVERY empty read-only cell. Measured
//     over five real dictionaries that is 81-100% of every optional column — Usage and
//     Status are blank on every row of every fixture — so it shaded whole columns instead of
//     marking anything. Emptiness is not the state; see NOT_APPLICABLE_WHEN_BLANK.
//   - the wash was then drawn as a 45deg hatch, and rejected as too eye-catching at 22% and
//     again at 10%. The hatch carried LESS ink than the wash it replaced, so the lesson is
//     that edges are what the eye picks up in a grid, not quantity of ink — which is why
//     the rule below may set no background-image and nothing with a border.
//
// The test that matters here is not "the class is present". It is that the class and the
// double-click handler cannot disagree: `cell-editable` is a PROMISE that an editor
// opens, and a boundary drawn over a cell that stays shut would teach the user to
// distrust the one signal this design rests on. Both now read `_cellEditTarget`, and the
// cross-check below is what keeps them reading it.
//
// What happy-dom cannot do is evaluate any of the CSS — no color-mix, no :hover, no
// layout — so the rules themselves are asserted as text, and the rendered colours are
// qualified separately by the browser harness against the shipped bundle.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DexTreeTable, type TreeTableRow } from '../src/webview/components/dex-tree-table.js';

const COLUMNS = ['Name', 'Value', 'DataType', 'Class', 'Kind', 'Description', 'Status'];

beforeEach(() => localStorage.clear());

function makeRow(id: string, name: string, extra: Partial<TreeTableRow> = {}): TreeTableRow {
  return {
    ID: id,
    parent: null,
    Name: { label: name },
    Value: '',
    DataType: '',
    Description: '',
    Status: '',
    ...extra,
  };
}

async function mount(rows: TreeTableRow[]): Promise<DexTreeTable> {
  const table = new DexTreeTable();
  table.columns = COLUMNS;
  document.body.appendChild(table);
  (table as any)._hiddenColumns = new Set<string>();
  table.rows = rows;
  table.requestUpdate();
  await table.updateComplete;
  return table;
}

const cell = (table: DexTreeTable, rowId: string, col: string): HTMLElement =>
  table.shadowRoot!.querySelector(`tr[data-row-id="${rowId}"] td.col-${col}`) as HTMLElement;

const sheet = (): string =>
  (DexTreeTable.styles as unknown as { cssText: string }[]).map((s) => s.cssText).join('\n');

// Every state the five cases of the design produce, on one row each.
const ROWS: TreeTableRow[] = [
  // 1. editable with text, and 3. read-only with text (DataType)
  makeRow('r1', 'Kp', {
    Name: { label: 'Kp', editable: true },
    Value: { text: '0.5', editable: true },
    DataType: 'double',
    Class: 'Simulink.Parameter',
  }),
  // 2. editable with EMPTY text — still just a cell you can type in, never a state
  makeRow('r2', 'Ki', {
    Name: { label: 'Ki', editable: true },
    Value: { text: '', editable: true },
    DataType: 'double',
  }),
  // 4. read-only with text (Value), and 5. NOT APPLICABLE — a bus has no data type, which
  // is why DataType is one of the two columns where an empty read-only cell is a state.
  makeRow('r3', 'busA', {
    Name: { label: 'busA' },
    Value: { text: '<1x1 Simulink.Bus>' },
    DataType: '',
    _descriptionEditable: false,
  }),
];

describe('a cell carries its state on the td', () => {
  it('marks editable, read-only, and not-applicable cells apart', async () => {
    const t = await mount(ROWS);

    expect(cell(t, 'r1', 'Name').className).toContain('cell-editable');
    expect(cell(t, 'r1', 'Value').className).toContain('cell-editable');
    // DataType has text and no editor: dimmed, but not a blank.
    expect(cell(t, 'r1', 'DataType').className).toContain('cell-readonly');
    expect(cell(t, 'r1', 'DataType').className).not.toContain('cell-blank');
    // r3's DataType is empty and read-only, in a column where that is structural.
    expect(cell(t, 'r3', 'DataType').className).toContain('cell-blank');
    expect(cell(t, 'r3', 'DataType').className).toContain('cell-readonly');
  });

  it('leaves an empty cell alone in a column whose blanks are just unset values', async () => {
    // The correction that produced NOT_APPLICABLE_WHEN_BLANK. Usage and Status are empty
    // on every row of every fixture we have — no usage recorded, nothing modified yet —
    // so washing them marked nothing and shaded two entire columns. Kind, Class and
    // the optional property columns are the same kind of empty.
    const t = await mount(ROWS);
    for (const col of ['Kind', 'Class', 'UsedBy', 'Status', 'Description']) {
      const td = cell(t, 'r1', col);
      if (!td) continue;
      expect(td.className, col).not.toContain('cell-blank');
    }
    // …and they are still read-only, so they still get the dimmed ink.
    expect(cell(t, 'r1', 'Kind').className).toContain('cell-readonly');
  });

  it('never marks an EMPTY editable cell not-applicable', async () => {
    // Value IS in NOT_APPLICABLE_WHEN_BLANK, so this is the case the editable check has to
    // win: r2's Value is empty and typeable. Washing it would say "nothing goes here"
    // about the one cell the user most needs to find.
    const t = await mount(ROWS);
    expect(cell(t, 'r2', 'Value').className).toContain('cell-editable');
    expect(cell(t, 'r2', 'Value').className).not.toContain('cell-blank');
  });

  it('gives a column it has never heard of no cue at all', async () => {
    // Pins the ALLOW-list direction. A schema column added by a future core release, or
    // one of the Code Generation columns, is empty on most rows for the ordinary reason
    // that nobody set it — so the default has to be "no cue", and turning one on has to
    // be a deliberate edit to NOT_APPLICABLE_WHEN_BLANK.
    const t = await mount([makeRow('r9', 'Kp', { Name: { label: 'Kp', editable: true } })]);
    (t as any)._hiddenColumns = new Set<string>();
    t.columns = [...COLUMNS, 'someFutureProperty'];
    t.requestUpdate();
    await t.updateComplete;
    const td = cell(t, 'r9', 'someFutureProperty');
    expect(td).not.toBeNull();
    expect(td.className).toContain('cell-readonly');
    expect(td.className).not.toContain('cell-blank');
  });

  it('never marks a read-only cell editable', async () => {
    const t = await mount(ROWS);
    for (const col of ['Value', 'DataType', 'Class', 'Kind', 'Description', 'Status']) {
      expect(cell(t, 'r3', col).className, col).not.toContain('cell-editable');
    }
    // Name is not editable on this row either — no `editable: true` on it.
    expect(cell(t, 'r3', 'Name').className).not.toContain('cell-editable');
  });

  it('leaves a section row unmarked — its blanks are not unanswered questions', async () => {
    const t = await mount([
      makeRow('section:Design Data', 'Design Data'),
      makeRow('r1', 'Kp', { Name: { label: 'Kp', editable: true } }),
    ]);
    const row = t.shadowRoot!.querySelector('tr[data-row-id="section:Design Data"]')!;
    for (const td of row.querySelectorAll('td')) {
      expect(td.className).not.toContain('cell-editable');
      expect(td.className).not.toContain('cell-readonly');
      expect(td.className).not.toContain('cell-blank');
    }
  });
});

describe('the cue cannot lie about the behaviour', () => {
  it('a cell marked editable opens an editor, and one not marked stays shut', async () => {
    // One rule, two paths — the invariant is BETWEEN them, so it is asserted between
    // them rather than on each. Driven through the real dblclick listener on the td, so
    // a future refactor that stops routing through _cellEditTarget fails here.
    const rows: TreeTableRow[] = [
      ...ROWS,
      // A generic schema column, the shape the Code Generation columns use.
      makeRow('r4', 'satLimit', {
        Name: { label: 'satLimit', editable: true },
        Value: { text: '100', editable: true },
        storageClass: { text: 'ExportedGlobal', editable: true },
      } as Partial<TreeTableRow>),
    ];
    const t = await mount(rows);
    (t as any)._hiddenColumns = new Set<string>();
    t.columns = [...COLUMNS, 'storageClass'];
    t.requestUpdate();
    await t.updateComplete;

    let checked = 0;
    for (const row of rows) {
      for (const col of t.columns) {
        const td = cell(t, row.ID, col);
        if (!td) continue;
        const marked = td.className.includes('cell-editable');

        (t as any)._editingCell = null;
        td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        await t.updateComplete;
        const opened = (t as any)._editingCell !== null;

        expect(opened, `${row.ID}.${col}: marked=${marked} opened=${opened}`).toBe(marked);
        checked += 1;
      }
    }
    // A loop that measured nothing would pass silently.
    expect(checked).toBeGreaterThan(20);
    (t as any)._editingCell = null;
  });
});

describe('the stylesheet spends each channel on one job', () => {
  it('draws the not-applicable state as a surface, at rest and unconditionally', async () => {
    // The hover-scoped version of this was rejected in use, so the absence of a row
    // state in these selectors is the requirement, not an accident. A cue that only
    // appears under the pointer answers the question for one row while the user is
    // scanning a column, and flickers on every mouse move in between.
    const css = sheet();
    const rules = [...css.matchAll(/([^\n{}]*cell-blank[^\n{}]*)\{/g)].map((m) => m[1].trim());
    expect(rules.length).toBeGreaterThan(0);
    for (const selector of rules) {
      expect(selector, selector).not.toMatch(/:hover|\.selected/);
      // The frozen first column is sticky over an opaque background of its own; a
      // translucent wash there would let the scrolled content show through it.
      expect(selector, selector).toContain(':not(:first-child)');
    }
  });

  it('washes the surface rather than marking the cell', async () => {
    const css = sheet();
    const at = css.indexOf('td.cell-blank:not(:first-child) {');
    expect(at).toBeGreaterThan(-1);
    const body = css.slice(at, css.indexOf('}', at)).replace(/\s+/g, ' ');
    expect(body).toContain('background-color: var(--dex-color-bg-na');
    // Flat, with no edge anywhere in it. Every version of this cue that had an edge was
    // rejected in use: an em dash via `content`, then a border, then a 45deg hatch at two
    // different strengths. Edges are what the eye picks up in a grid, so a pattern reads
    // as louder than a tint carrying more ink — which is why `background-image` is barred
    // here and not merely unused.
    expect(body).not.toMatch(/background-image\s*:/);
    expect(body).not.toMatch(/(^|[;{]\s*)(content|border|outline)\s*:/);
    expect(css).not.toContain("content: '—'");
  });

  it('spends italic on a value, never on a whole column', async () => {
    // Data Type used to be italicised for its entire column, and that was one signal too
    // many. Italic already means something specific in this table, and it is the same thing
    // everywhere it appears: `<1x1 struct>` object summaries, the source that qualifies a
    // parameter, the subsystem after a block name, section headers — all of them "this
    // describes the thing rather than being it". A whole column in italics therefore reads
    // as a placeholder on every row, when `double` is simply the answer. Data Type is an
    // ordinary read-only column and now looks like Kind and Class, which carry no rule of
    // their own at all.
    //
    // Asserted over every per-column selector rather than over Data Type, which makes this
    // a guard against the next one rather than a record of this one. It asserts over an
    // empty set today: there is no `td.col-*` rule left in the sheet, because Name's
    // frozen-column styling goes through :first-child.
    const css = sheet();
    for (const m of css.matchAll(/(td\.col-[A-Za-z]+[^\n{}]*)\{([^}]*)\}/g)) {
      expect(m[2], m[1].trim()).not.toMatch(/font-style|font-weight|font-family/);
    }
  });

  it('keeps read-only ink on the themed token, never a bare literal', async () => {
    const css = sheet();
    const at = css.indexOf('td.cell-readonly {');
    expect(at).toBeGreaterThan(-1);
    expect(css.slice(at, css.indexOf('}', at))).toContain('var(--dex-color-text-muted');
  });

  it('takes ink and surface together on a selected row', async () => {
    // VS Code chooses list.activeSelectionBackground and list.activeSelectionForeground as a
    // pair, and this rule used to take only the background. That is safe exactly while the
    // theme's selection colour is muted — both default Modern themes are — but a theme that
    // leaves the background unspecified gets the registry default #0060C0, a saturated blue
    // paired with white text, and the row measured 1.83:1 for editable ink and 1.66:1 for
    // read-only against it. So the pairing is the requirement, not the background alone.
    const css = sheet();
    const at = css.indexOf('tr.data-row.selected {');
    expect(at).toBeGreaterThan(-1);
    const body = css.slice(at, css.indexOf('}', at)).replace(/\s+/g, ' ');
    expect(body).toMatch(/background:/);
    expect(body).toMatch(/(^|[;{]\s*)color\s*:/);
    // Through a fallback, and the fallback is the ink this replaces. The colour is
    // registered {dark:#FFFFFF, light:#FFFFFF, hcDark:NULL, hcLight:NULL}, so on both
    // high-contrast themes an unfallbacked read is the normal path into a broken one.
    expect(body).toContain('var(--vscode-list-activeSelectionForeground, var(--vscode-foreground))');
    // The INK declarations only. The surface keeps a literal fallback on purpose — that is
    // --dex-color-accent-bg's business, and the theme trap behind it is pinned on
    // --dex-selection-bg in vscodeThemeTokens.test.ts.
    const ink = body.match(/(--dex-row-ink|[;{]\s*color)\s*:[^;]*/g) ?? [];
    expect(ink.length).toBe(2);
    for (const decl of ink) {
      expect(decl, 'a selected row must not hard-code its ink').not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });

  it('dims read-only ink against the row ink, at one strength everywhere', async () => {
    // Read-only text has to be dim relative to whatever ink the ROW is using, or a selected
    // row keeps 78% of the editor foreground and the dim cells vanish into a saturated
    // selection. That means the muted token is declared twice — once at :root over
    // --vscode-foreground, once here over the selection foreground — because a var() nested
    // in a custom property is substituted where the property is DECLARED, not where it is
    // used, so one parameterised declaration is not expressible.
    //
    // Two declarations of one number is exactly how the two drift apart, which is the bug
    // shape this file already carries three examples of. So the percentages are compared
    // rather than trusted.
    const sel = sheet().indexOf('tr.data-row.selected {');
    const rowMix = /--dex-color-text-muted:\s*color-mix\(\s*in srgb,\s*var\(--dex-row-ink\)\s*(\d+)%/.exec(
      sheet().slice(sel),
    );
    expect(rowMix, 'the selected row does not redeclare --dex-color-text-muted').not.toBeNull();
    // Read off the cwd, not off import.meta.url: this file runs under happy-dom, where
    // import.meta.url is an http URL and fileURLToPath throws on it.
    const theme = readFileSync(resolve('src/webview/vscode-theme.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    const rootMix = /--dex-color-text-muted:\s*color-mix\(\s*in srgb,\s*var\(--vscode-foreground\)\s*(\d+)%/.exec(
      theme,
    );
    expect(rootMix, 'vscode-theme.css does not declare --dex-color-text-muted as a mix').not.toBeNull();
    expect(rowMix![1], 'the two muted-ink strengths have drifted apart').toBe(rootMix![1]);
  });

  it('leaves editable cells entirely undrawn', async () => {
    // What the user is looking for is the thing with nothing on it: full-strength text
    // on the plain row background. `cell-editable` is still emitted on the td — the
    // dblclick cross-check above is written against it, and it keeps the state legible
    // to tests and to a11y tooling — but no rule may style it, or we are back to
    // marking the majority of a sparse grid.
    const css = sheet();
    for (const m of css.matchAll(/([^\n{}]*cell-editable[^\n{}]*)\{/g)) {
      expect.fail(`cell-editable is styled by \`${m[1].trim()}\` — see the rejected hover design`);
    }
  });
});
