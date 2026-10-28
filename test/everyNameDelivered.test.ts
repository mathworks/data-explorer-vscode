// Copyright 2026 The MathWorks, Inc.
//
// Every name gets a row, however many names there are (host: lazyRows.ts).
//
// The rule is the maintainer's: "try to list all entries in the table. The entry name
// completeness is more important than presenting entry value details. This rule should be
// applied to all data source, all entry types." The row budget already met it in depth: a
// level that does not fit is deferred whole, so every delivered row can still be opened.
// It did not meet it in breadth. A top level wider than the budget (100,000 rows) was CUT:
// the names past the budget had no row and no twisty, and only a banner said they existed.
// The 138 MB bench dictionary (`BENCH_BIG_SLDD_MB=138 node bench/genCorpus.mjs`, 291,564
// entries) showed 100,000 rows and left 191,568 names out. A cell with more elements than
// the budget lost its tail the same way when it was opened.
//
// Now the top level is exempt from the budget: every name is delivered and everything below
// it is deferred. Measured on that dictionary before choosing this over a pager row: 291,568
// rows, 140.8 MiB of JSON, 231 ms to serialize and 253 ms for the table's first paint, against
// 48.1 MiB, 82 ms and 99 ms for today's 100,000. The cost is about three times higher, and
// still well under V8's string limit. A payload too large to post anyway is the provider's
// fallback, `postOrFallback`, pinned in postOrFallback.test.ts.
//
// These go through the real planner, the real sectioned builder and the real fetch, and the
// dictionaries are parsed by core from JSON text, so what is counted is real rows of real nodes.
import { afterEach, describe, expect, it } from 'vitest';
import { LAZY_ROW_BUDGET, planRows } from '../src/view/model/rows/lazyRows.js';
import { rowPlannerFor } from '../src/view/model/rows/rowPlanner.js';
import { answerChildRequest, childRowsMessage } from '../src/view/model/rows/childRequest.js';
import { getModel, releaseIfUnviewed } from '../src/view/model/workspace/SlddModel.js';
import { buildSectionRowId } from '../src/view/model/ids/sectionRowId.js';

/** A JSON .sldd holding `entries`, in the `__MW_TEXT_PARTS__` shape MATLAB writes. */
function dictionaryText(entries: Array<{ name: string; value: unknown }>): string {
  return JSON.stringify({
    __MW_TEXT_COREPROPERTIES__: { release: 'R2026b' },
    __MW_TEXT_PARTS__: {
      '__MW_TEXT_PART__/data/chunk0': {
        __MW_TEXT_content: {
          entries: entries.map((e, i) => ({
            name: e.name,
            metadata: { uuid: `wide-uuid-${i}`, isderived: '0' },
            value: e.value,
          })),
          'Dictionary References': [],
          AllowAccessBWS: '0',
        },
      },
    },
  });
}

const opened: string[] = [];
let seq = 0;

/** Parse `entries` through core, as a tab of a JSON .sldd does, and return the tree. */
function openDictionary(entries: Array<{ name: string; value: unknown }>): { uri: string; node: any } {
  const uri = `wide://${seq++}/wide.sldd`;
  opened.push(uri);
  return { uri, node: getModel(uri, 'wide.sldd', dictionaryText(entries)) };
}

afterEach(() => {
  for (const uri of opened.splice(0)) releaseIfUnviewed(uri);
});

const SLDD = rowPlannerFor('wide.sldd');
const isHeader = (row: any) => String(row.ID).startsWith('section:');
const labelOf = (row: any) => row?.Name?.label ?? String(row?.ID ?? '');

describe('planRows delivers every root, whatever the budget', () => {
  it('plans 250,000 top-level leaves at a 100,000-row budget as 250,000 rows', () => {
    const leaves = Array.from({ length: 250_000 }, (_, i) => ({ id: `v${i}`, children: [] }));
    const plan = planRows(leaves, LAZY_ROW_BUDGET);
    expect(plan.planned).toHaveLength(250_000);
    // The last name is the one a cut loses first.
    expect(plan.planned[plan.planned.length - 1].node.id).toBe('v249999');
    expect(plan.truncated).toBe(0);
    expect(plan.deferred).toBe(0);
  });

  it('defers every root that has children, rather than dropping roots to make room for them', () => {
    const roots = Array.from({ length: 150_000 }, (_, i) => ({
      id: `s${i}`,
      children: [{ id: `s${i}.f`, children: [] }],
    }));
    const plan = planRows(roots, LAZY_ROW_BUDGET);
    expect(plan.planned.map((p) => p.node.id)).toEqual(roots.map((r) => r.id));
    expect(plan.deferred).toBe(150_000);
    expect(plan.planned.every((p) => p.deferred)).toBe(true);
  });
});

describe('a dictionary with more entries than one delivery holds', () => {
  it('names every entry, under the section that holds it', () => {
    const COUNT = LAZY_ROW_BUDGET + 500;
    const { node } = openDictionary(
      Array.from({ length: COUNT }, (_, i) => ({ name: `P_${i}`, value: i })),
    );
    const { rows, plan } = SLDD.payload(node, LAZY_ROW_BUDGET);

    // Where each name lives in the tree, by section, so the check is against core's own
    // grouping rather than against a guess at it.
    const sectionOf = new Map<string, string>();
    for (const section of node.children) {
      for (const e of section.children) sectionOf.set(e.name, buildSectionRowId(section.name));
    }
    expect(sectionOf.size, 'core read every entry').toBe(COUNT);

    const entryRows = rows.filter((r) => !isHeader(r));
    expect(entryRows).toHaveLength(COUNT);
    for (const r of entryRows) expect(r.parent, labelOf(r)).toBe(sectionOf.get(labelOf(r)));
    expect(new Set(entryRows.map(labelOf))).toEqual(new Set(sectionOf.keys()));
    expect(plan.truncated).toBe(0);
    // Every section header still comes.
    expect(rows.filter(isHeader)).toHaveLength(node.children.length);
  });
});

describe('opening a node with more children than one delivery holds', () => {
  // A cell is the shape: core builds a cell's children uncapped (it caps numeric and string
  // expansion at 10,000), so one cell of 150,000 elements is one name with 150,000 children.
  const COUNT = 150_000;
  const bigCell = () =>
    openDictionary([
      { name: 'small', value: 1 },
      {
        name: 'huge',
        value: {
          _array_type: 'Cell',
          _dimensions: [1, COUNT],
          _elements: Array.from({ length: COUNT }, (_, i) => i),
          _mw_element_type: 'MATLABArray',
        },
      },
    ]);

  it('delivers the cell itself as one row whose children load on demand', () => {
    const { node } = bigCell();
    const { rows } = SLDD.payload(node, LAZY_ROW_BUDGET);
    const huge = rows.find((r) => labelOf(r) === 'huge');
    expect(huge?._lazy).toBe(true);
    expect(rows.find((r) => labelOf(r) === 'small')).toBeTruthy();
  });

  it('answers the fetch with every one of its 150,000 elements', () => {
    const { node } = bigCell();
    const cell = node.children.flatMap((s: any) => s.children).find((e: any) => e.name === 'huge');
    expect(cell.children, 'core built every element').toHaveLength(COUNT);
    const answer = childRowsMessage(cell.id, cell, SLDD);
    expect(answer.rows).toHaveLength(COUNT);
    expect(answer.truncated).toBe(0);
    expect(answer.rows.filter((r) => r.parent === cell.id)).toHaveLength(COUNT);
  });

  it('posts all of them through the round trip the table uses', async () => {
    const { uri, node } = bigCell();
    const { rows } = SLDD.payload(node, LAZY_ROW_BUDGET);
    const huge = rows.find((r) => labelOf(r) === 'huge')!;
    const posts: any[] = [];
    const webview = { postMessage: (m: any) => (posts.push(m), Promise.resolve(true)) };
    await answerChildRequest(webview, uri, huge.ID, 'wide.sldd', () => Promise.resolve(false), SLDD);
    expect(posts.map((p) => p.type)).toEqual(['childRows']);
    expect(posts[0].nodeId).toBe(huge.ID);
    expect(posts[0].rows).toHaveLength(COUNT);
    expect(posts[0].truncated).toBe(0);
  });
});
