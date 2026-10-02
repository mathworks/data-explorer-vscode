// Copyright 2026 The MathWorks, Inc.
//
// Breadth over depth on a SECTIONED tree — a dictionary, a model, a project.
//
// The rule, in the maintainer's words: "if the file or entry is too large to parse and
// create full node tree, try to do breadth over depth, you can stop expanding large
// entries, but try to list all entries in the table. The entry name completeness is more
// important than presenting entry value details. This rule should be applied to all data
// source, all entry types."
//
// lazyRows.test.ts pins the planner. This pins what a sectioned tree does with it, and
// the thing most able to go wrong is specific: planning each SECTION separately would
// also deliver whole levels, defer honestly, and pass every test in that file — while
// spending the whole budget on the depth of section 1 and leaving section 9's entries
// unnamed. One plan over every entry of every section is what makes the first level
// "every name in the file", so that is what is asserted here, in the one shape that can
// tell the difference: a fat early section and a thin late one.
import { describe, it, expect } from 'vitest';
import { buildRows, buildRowsPlanned, buildChildRows, buildEntryRows } from '../src/host/rowBuilder.js';
import { rowPlannerFor } from '../src/host/rowPlanner.js';
import { buildSectionRowId } from '../src/common/sectionRowId.js';

/**
 * A duck-typed entry subtree: `kids` children, each with `grandkids` of its own.
 *
 * The shape that matters is depth under a name, so the nodes carry nothing else. `toRow`
 * answers what core's does — an id, a null parent for the entry, the parent id for a
 * nested node — because the reparent and the contiguity rules both read those.
 */
function entry(name: string, kids = 0, grandkids = 0): any {
  const node = (id: string, parent: string | null, children: any[]): any => ({
    id,
    name: id,
    children,
    toRow: () => ({ ID: id, parent, Name: { label: id }, Value: '' }),
  });
  const children = Array.from({ length: kids }, (_, i) =>
    node(
      `${name}.k${i}`,
      name,
      Array.from({ length: grandkids }, (_, j) => node(`${name}.k${i}.g${j}`, `${name}.k${i}`, [])),
    ),
  );
  return node(name, null, children);
}

const section = (name: string, entries: any[]) => ({ name, displayName: name, icon: '', children: entries });

/** Section names in order, as the payload emitted them. */
const headers = (rows: any[]) => rows.filter((r) => r.parent === null).map((r) => r.ID);
/** Every row id, in payload order. */
const ids = (rows: any[]) => rows.map((r) => r.ID);

// A fat FIRST section and a thin last one: the arrangement a per-section plan gets wrong,
// because section `design`'s depth is enough to spend a small budget on its own.
//   design:     3 entries x 4 children x 5 grandchildren  (3 + 12 + 60 = 75 rows whole)
//   references: 2 entries, no children                    (2 rows whole)
const TWO_SECTIONS = {
  children: [
    section('design', [entry('A', 4, 5), entry('B', 4, 5), entry('C', 4, 5)]),
    section('references', [entry('R1'), entry('R2')]),
  ],
};
const ALL_NAMES = ['A', 'B', 'C', 'R1', 'R2'];

describe('one plan over every entry of every section', () => {
  it('names every entry of every section at a budget that fits almost nothing else', () => {
    // THE rule. 9 rows for 2 section headers + 5 entry names, with nothing left over for
    // a single child — and all five names are there.
    const { rows } = buildRowsPlanned(TWO_SECTIONS, undefined, undefined, 9);
    expect(ids(rows)).toEqual([
      buildSectionRowId('design'),
      'A',
      'B',
      'C',
      buildSectionRowId('references'),
      'R1',
      'R2',
    ]);
  });

  it('does not spend the budget on the first section’s depth', () => {
    // The per-section-plan failure, at the budgets that actually expose it — most values
    // do not, which is the whole reason to pick these three deliberately rather than a
    // few round numbers:
    //
    //   17 → 15 rows of headroom. A planner handed section `design` first fits its
    //        levels 1-2 (3 + 12 = 15) exactly, and `references` is left nothing: BOTH
    //        its names are gone. One plan sees level 1 as all five names (5 ≤ 15) and
    //        level 2 as 17, so it stops after the names and every one of them is here.
    //   18 → same, one row looser: R1 arrives, R2 does not.
    //   77 → 75 rows, which is section `design` whole (3 + 12 + 60). Nothing at all is
    //        left for `references`, on a budget that could have held every name in the
    //        file four times over. The symptom is the one a user reports: a file whose
    //        later sections look empty.
    for (const budget of [17, 18, 77]) {
      const { rows } = buildRowsPlanned(TWO_SECTIONS, undefined, undefined, budget);
      const names = rows.map((r) => r.ID);
      for (const n of ALL_NAMES) expect(names, `budget ${budget} drops ${n}`).toContain(n);
    }
  });

  it('delivers whole levels across the sections, not a prefix of one', () => {
    // 2 headers + 5 names + 12 children of A/B/C = 19. At a budget that fits that and not
    // the 60 grandchildren, every child is here and no grandchild is.
    const { rows } = buildRowsPlanned(TWO_SECTIONS, undefined, undefined, 25);
    expect(rows.filter((r) => /\.k\d+$/.test(r.ID))).toHaveLength(12);
    expect(rows.filter((r) => /\.g\d+$/.test(r.ID))).toHaveLength(0);
    // And the frontier is exactly those children — the rows a twisty can still fetch.
    expect(rows.filter((r) => r._lazy).map((r) => r.ID).sort()).toEqual(
      rows.filter((r) => /\.k\d+$/.test(r.ID)).map((r) => r.ID).sort(),
    );
  });

  it('stays within the budget, headers included', () => {
    // The headers are not in the plan (they are structure, and a file whose sections
    // alone overflowed would have nothing worth showing), so the plan is given
    // `budget - sections.length`. Without that subtraction a planned payload could still
    // be over the payload cap and `capRows` would cut exactly the names this protects.
    // 17 and 18 are also the budgets where a per-section planner with a budget EACH
    // (rather than a shared running one) overflows: 2 + 15 + 2 = 19 rows for 18.
    for (const budget of [3, 9, 17, 18, 19, 25, 77, 80]) {
      const { rows } = buildRowsPlanned(TWO_SECTIONS, undefined, undefined, budget);
      expect(rows.length, `budget ${budget}`).toBeLessThanOrEqual(budget);
    }
  });

  it('is the whole tree, with nothing deferred, when no budget is given', () => {
    // What every caller of buildRows had before this existed: 2 headers + 75 + 2.
    const rows = buildRows(TWO_SECTIONS);
    expect(rows).toHaveLength(2 + 75 + 2);
    expect(rows.some((r) => r._lazy)).toBe(false);
    expect(buildRowsPlanned(TWO_SECTIONS).plan.deferred).toBe(0);
  });
});

describe('the section layer survives the plan', () => {
  it('emits every section header, in order, however little of the tree fit', () => {
    // A header is how a section says it exists. Dropping one because its entries did not
    // fit would make an empty section and an unaffordable section look identical.
    for (const budget of [1, 2, 3, 9, 25]) {
      const { rows } = buildRowsPlanned(TWO_SECTIONS, undefined, undefined, budget);
      expect(headers(rows), `budget ${budget}`).toEqual([
        buildSectionRowId('design'),
        buildSectionRowId('references'),
      ]);
    }
  });

  it('files every entry under its own section, not the first one', () => {
    const { rows } = buildRowsPlanned(TWO_SECTIONS, undefined, undefined, 9);
    const parentOf = (id: string) => rows.find((r) => r.ID === id)!.parent;
    expect(['A', 'B', 'C'].map(parentOf)).toEqual(Array(3).fill(buildSectionRowId('design')));
    expect(['R1', 'R2'].map(parentOf)).toEqual(Array(2).fill(buildSectionRowId('references')));
  });

  it('keeps each entry’s rows in one contiguous run, which is what the splice walks', () => {
    // `spliceEntryRows` replaces an entry's rows by walking forward from its row while
    // the rows still belong to it. A plan that interleaved two entries' descendants would
    // make an edit to one repaint over the other, which is corruption, not a short view.
    const { rows } = buildRowsPlanned(TWO_SECTIONS, undefined, undefined, 25);
    const owner = (id: string) => id.split('.')[0];
    const runs: string[] = [];
    for (const r of rows) {
      if (r.parent === null) continue;
      const o = owner(r.ID);
      if (runs[runs.length - 1] !== o) runs.push(o);
    }
    expect(runs).toEqual(ALL_NAMES);
  });

  it('counts the entries that did not fit at all, so the banner can say so', () => {
    // A budget of 4 leaves room for 2 entry names after the 2 headers. The other three
    // are not deferred — they are ABSENT, with no row to open — and that is the one loss
    // a plan can still inflict, so it is reported rather than left to be noticed.
    const { rows, plan } = buildRowsPlanned(TWO_SECTIONS, undefined, undefined, 4);
    expect(plan.truncated).toBe(3);
    expect(rows.filter((r) => r.parent !== null).map((r) => r.ID)).toEqual(['A', 'B']);
    // The headers still come, both of them, including the one with no entries left.
    expect(headers(rows)).toHaveLength(2);
  });
});

describe('the fetch that completes a sectioned payload', () => {
  it('answers with the children of the row the user opened, under that row', () => {
    const { rows } = buildRowsPlanned(TWO_SECTIONS, undefined, undefined, 9);
    const frontier = rows.find((r) => r.ID === 'A')!;
    expect(frontier._lazy).toBe(true);
    const node = TWO_SECTIONS.children[0].children[0];
    const { rows: fetched, plan } = buildChildRows(node, 100);
    expect(ids(fetched)).toEqual(['A.k0', 'A.k1', 'A.k2', 'A.k3'].flatMap((k) => [
      k,
      ...Array.from({ length: 5 }, (_, j) => `${k}.g${j}`),
    ]));
    for (const r of fetched.filter((x) => /\.k\d+$/.test(x.ID))) expect(r.parent).toBe('A');
    expect(plan.truncated, 'and nothing of this node was lost').toBe(0);
  });

  it('does NOT reparent a fetched row onto a section, because none of them is an entry', () => {
    // The reparent exists to put an entry under its section header. A fetch only ever
    // returns nested nodes, so firing it here would move a struct field up to the
    // section — the row would render at the top level and its own parent would look
    // childless.
    const { rows: fetched } = buildChildRows(TWO_SECTIONS.children[0].children[0], 100);
    expect(fetched.some((r) => r.parent === null)).toBe(false);
    expect(fetched.some((r) => String(r.parent).startsWith('section:'))).toBe(false);
  });

  it('stamps a fetched row the way the payload stamps its siblings', () => {
    // A fetched row that differed from its siblings would differ in exactly the ways
    // nothing notices: an absent capability flag (no context menu), a missing matrix
    // payload (no grid view), an unmarked frontier (a subtree that stops opening).
    const node = TWO_SECTIONS.children[0].children[0];
    const whole = buildRows(TWO_SECTIONS).find((r) => r.ID === 'A.k0')!;
    const fetched = buildChildRows(node, 100).rows.find((r) => r.ID === 'A.k0')!;
    expect(fetched).toEqual(whole);
  });

  it('defers what it cannot carry either, so a huge node’s fetch is bounded too', () => {
    const { rows: fetched, plan } = buildChildRows(TWO_SECTIONS.children[0].children[0], 4);
    expect(ids(fetched)).toEqual(['A.k0', 'A.k1', 'A.k2', 'A.k3']);
    expect(fetched.every((r) => r._lazy)).toBe(true);
    // Four children, four rows: deferred, not lost, so nothing is reported absent.
    expect(plan.truncated).toBe(0);
  });

  it('reports the children that got no row at all, which is the one loss left', () => {
    // A node whose OWN children outnumber a whole delivery — core builds a cell's
    // children uncapped, so one 200,000-element cell is one name. Those names have no
    // row and no twisty, so the count comes back and the table says so; the payload's
    // banner cannot, having been written before the user opened anything.
    const { rows: fetched, plan } = buildChildRows(TWO_SECTIONS.children[0].children[0], 3);
    expect(ids(fetched)).toEqual(['A.k0', 'A.k1', 'A.k2']);
    expect(plan.truncated).toBe(1);
  });
});

describe('one entry’s repaint is planned by the same rule', () => {
  it('takes a budget, so a 1,000,001-row entry cannot be spliced in whole', () => {
    // The edit write-back repaints ONE entry, and one entry is enough to be the whole
    // problem — a 1000x1000 double is 1,000,001 rows from a single name.
    const rows = buildEntryRows(entry('A', 4, 5), 'design', undefined, undefined, undefined, 5);
    expect(ids(rows)).toEqual(['A', 'A.k0', 'A.k1', 'A.k2', 'A.k3']);
    expect(rows.filter((r) => r._lazy).map((r) => r.ID)).toEqual(['A.k0', 'A.k1', 'A.k2', 'A.k3']);
    expect(rows[0].parent).toBe(buildSectionRowId('design'));
  });

  it('is still the whole subtree when no budget is given', () => {
    const rows = buildEntryRows(entry('A', 4, 5), 'design');
    expect(rows).toHaveLength(1 + 4 + 20);
    expect(rows.some((r) => r._lazy)).toBe(false);
  });
});

describe('rowPlannerFor — the payload and the fetch come from one choice', () => {
  // The pairing is the point: a payload planned by one rule and a fetch answered by
  // another is a deferred row that opens onto the wrong thing, with no error anywhere.
  it('plans a sectioned file through the sectioned builder, both halves', () => {
    const planner = rowPlannerFor('design.sldd');
    const { rows, plan } = planner.payload(TWO_SECTIONS, 9);
    expect(ids(rows)).toEqual(buildRowsPlanned(TWO_SECTIONS, undefined, undefined, 9).rows.map((r) => r.ID));
    expect(plan.truncated).toBe(0);
    expect(ids(planner.children(TWO_SECTIONS.children[0].children[0], 100).rows)).toEqual(
      ids(buildChildRows(TWO_SECTIONS.children[0].children[0], 100).rows),
    );
  });

  it('gives .slx, .mdl and .prj the same planner — they share a tree shape', () => {
    const sectioned = rowPlannerFor('design.sldd');
    for (const name of ['model.slx', 'legacy.mdl', 'work.prj']) {
      expect(rowPlannerFor(name), name).toBe(sectioned);
    }
  });

  it('gives a .mat its own, because its variables are the root’s children', () => {
    expect(rowPlannerFor('data.mat')).not.toBe(rowPlannerFor('design.sldd'));
  });

  it('passes the payload’s stamps through, so Modified and the clipboard mark survive', () => {
    const planner = rowPlannerFor('design.sldd');
    const { rows } = planner.payload(TWO_SECTIONS, 9, {
      modifiedNames: new Set(['A']),
      clipMark: { keys: new Set([`design\u0000B`]), mode: 'cut' },
    });
    expect(rows.find((r) => r.ID === 'A')!.Status).toBe('Modified');
    expect(rows.find((r) => r.ID === 'B')!.Name.clipboardMode).toBe('cut');
    expect(rows.find((r) => r.ID === 'C')!.Name.clipboardMode).toBeUndefined();
  });
});
