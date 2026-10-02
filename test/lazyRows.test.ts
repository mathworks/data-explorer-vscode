// Copyright 2026 The MathWorks, Inc.
//
// The row budget that made a two-million-node `.mat` navigable instead of merely
// openable (host: lazyRows.ts).
//
// The cap it sits on top of is lossy by construction: the first 100,000 rows of that
// file in pre-order are the first cell's descendants and nothing else, so ten of its
// eleven top-level variables could not be reached by any gesture. What this file pins
// is the property that fixes that — WHOLE LEVELS, delivered completely or not at all —
// because it is the invariant the webview's twisty depends on and nothing about it is
// visible in a row.
import { describe, it, expect } from 'vitest';
import { DataModel } from 'data-explorer-core';
import { levelsThatFit, planRows, stampLazy, lazyRowsBanner, LAZY_ROW_BUDGET } from '../src/host/lazyRows.js';
import { buildMatRowsPlanned, buildMatRows } from '../src/host/matRowBuilder.js';
import { childRowsMessage, answerChildRequest } from '../src/host/childRequest.js';
import { rowPlannerFor } from '../src/host/rowPlanner.js';

// The REAL planner for the file these tests are about, not a stub: the thing under test
// in the fetch half is that the rows a fetch returns are the rows the payload would have
// built, and a hand-written planner here would be a second implementation of exactly the
// rule that is supposed to exist once (rowPlanner.ts).
const MAT_PLANNER = rowPlannerFor('cfg.mat');

/**
 * A tree of the given per-level widths: `fanOut([2, 3])` is 2 roots with 3 children each.
 *
 * Shaped like the real file (a few roots, each level wider than the last) and small
 * enough to assert about by hand. The budgets below are correspondingly small — the rule
 * does not know what its numbers mean, so 10 exercises it exactly as 100,000 does.
 */
function fanOut(widths: number[], prefix = 'n'): any[] {
  if (widths.length === 0) return [];
  const [count, ...deeper] = widths;
  return Array.from({ length: count }, (_, i) => {
    const id = `${prefix}${i}`;
    return { id, children: fanOut(deeper, `${id}.`), toRow: () => ({ ID: id, parent: null, Name: id }) };
  });
}

const idsOf = (plan: { planned: { node: any }[] }) => plan.planned.map((p) => p.node.id);

describe('levelsThatFit — how much of the tree one delivery can carry', () => {
  it('takes the whole tree when it fits', () => {
    // 2 + 4 + 8 = 14 nodes.
    expect(levelsThatFit(fanOut([2, 2, 2]), 14)).toBe(3);
  });

  it('stops one level short rather than half-delivering the level that does not fit', () => {
    // 13 is enough for 6 of the 8 leaves. It takes none of them: a row whose twisty
    // opens onto some of its children has no way to say which are missing.
    expect(levelsThatFit(fanOut([2, 2, 2]), 13)).toBe(2);
  });

  it('counts a level as a whole, not node by node', () => {
    // 2 roots and 20 grandchildren against a budget of 5: there is room for 3 of the
    // next level, and taking 3 would be the cap's loss again, one level down.
    expect(levelsThatFit(fanOut([2, 10]), 5)).toBe(1);
  });

  it('never returns 0 — the top level is what the file IS', () => {
    // A view of nothing is not a smaller view of the file; it is the spinner this
    // whole area exists to remove.
    expect(levelsThatFit(fanOut([3]), 0)).toBe(1);
    expect(levelsThatFit([], 100)).toBe(1);
  });

  it('survives a node with no children array (rows come from parsed content)', () => {
    expect(levelsThatFit([{}, null as any, { children: null }], 10)).toBe(1);
  });
});

describe('planRows — which nodes a delivery carries, and which of them can still grow', () => {
  it('emits pre-order: every parent before its own children', () => {
    const plan = planRows(fanOut([2, 2]), Infinity);
    expect(idsOf(plan)).toEqual(['n0', 'n0.0', 'n0.1', 'n1', 'n1.0', 'n1.1']);
  });

  it('defers nothing when the whole tree fits, so an ordinary file is unaffected', () => {
    const plan = planRows(fanOut([2, 3, 4]), Infinity);
    expect(plan.planned).toHaveLength(2 + 6 + 24);
    expect(plan.deferred).toBe(0);
    expect(plan.planned.every((p) => !p.deferred)).toBe(true);
  });

  it('marks exactly the frontier — the deepest delivered rows that have children', () => {
    // Budget 6 takes levels 1 and 2 (2 + 4) and not level 3 (+8). The four level-2
    // nodes are the frontier; the two roots are not, because their children came.
    const plan = planRows(fanOut([2, 2, 2]), 6);
    expect(idsOf(plan)).toEqual(['n0', 'n0.0', 'n0.1', 'n1', 'n1.0', 'n1.1']);
    expect(plan.deferred).toBe(4);
    expect(plan.planned.filter((p) => p.deferred).map((p) => p.node.id)).toEqual([
      'n0.0',
      'n0.1',
      'n1.0',
      'n1.1',
    ]);
  });

  it('delivers every planned row’s children or none of them — the invariant the twisty reads', () => {
    // The property, stated over the plan rather than over one example of it. A row is
    // either complete (its children are all here) or deferred (none of them is), and
    // nothing in between — which is what makes one fetch per row the whole answer.
    for (const budget of [1, 2, 3, 6, 7, 13, 14, 99]) {
      const plan = planRows(fanOut([2, 2, 2]), budget);
      const delivered = new Set(plan.planned.map((p) => p.node.id));
      for (const { node, deferred } of plan.planned) {
        const kids = node.children as any[];
        const present = kids.filter((c) => delivered.has(c.id)).length;
        if (kids.length === 0) {
          expect(deferred, `${node.id} has nothing to defer`).toBe(false);
        } else if (deferred) {
          expect(present, `deferred ${node.id} at budget ${budget}`).toBe(0);
        } else {
          expect(present, `delivered ${node.id} at budget ${budget}`).toBe(kids.length);
        }
      }
    }
  });

  it('truncates the top level when even that exceeds the budget, and says so', () => {
    // The one lossy corner left, and it is one node's worth: core caps numeric and
    // string element expansion at 10,000 but builds a cell's children uncapped, so a
    // single huge cell can outgrow a whole request. Its first `budget` children arrive
    // and the rest are absent — the cap's old behaviour, confined to one row instead of
    // deciding the whole file.
    const plan = planRows(fanOut([300, 2]), 10);
    expect(plan.planned).toHaveLength(10);
    expect(plan.deferred).toBe(10);
    // Counted, not left to be noticed: these 290 are the only rows a plan can lose, so
    // the banner can say so in the cap's words instead of claiming everything is
    // reachable by expanding something.
    expect(plan.truncated).toBe(290);
  });

  it('reports nothing truncated whenever the top level fits, which is the normal case', () => {
    expect(planRows(fanOut([2, 2, 2]), 6).truncated).toBe(0);
    expect(planRows(fanOut([2, 3, 4]), Infinity).truncated).toBe(0);
    expect(planRows([], 10).truncated).toBe(0);
  });

  it('tags every row with the root it descends from, so a caller can put it back', () => {
    // What the sectioned builder regroups by: it plans EVERY entry of every section in
    // one call — that is what makes "all the names" one level rather than one level per
    // section — and then has to file each row under its own section header again.
    const plan = planRows(fanOut([2, 2]), Infinity);
    expect(plan.planned.map((p) => p.root)).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it('keeps each root’s rows contiguous and in root order, which is what makes one cursor enough', () => {
    for (const budget of [1, 2, 4, 7, 14, 99]) {
      const plan = planRows(fanOut([3, 2, 2]), budget);
      const roots = plan.planned.map((p) => p.root);
      // Non-decreasing: a run per root, never interleaved, never revisited.
      expect([...roots].sort((a, b) => a - b), `budget ${budget}`).toEqual(roots);
      expect(new Set(roots).size + plan.truncated, `budget ${budget}`).toBe(3);
    }
  });

  it('defaults to the payload cap, so both halves of the boundary agree on one number', () => {
    expect(LAZY_ROW_BUDGET).toBe(100000);
    const plan = planRows(fanOut([2, 2]));
    expect(plan.deferred).toBe(0);
  });

  it('does not recurse, so a deeply nested document cannot blank the table', () => {
    // 20,000 levels of one child each. Written as a loop because building it with
    // recursion is the very thing that fails.
    let node: any = { id: 'leaf', children: [] };
    for (let i = 0; i < 20000; i++) node = { id: `d${i}`, children: [node] };
    expect(() => planRows([node], Infinity)).not.toThrow();
    expect(planRows([node], Infinity).planned).toHaveLength(20001);
  });
});

describe('stampLazy — the mark, spelled in one place', () => {
  it('adds `_lazy` only to a deferred row, and copies rather than mutates', () => {
    const row = { ID: 'a' };
    expect(stampLazy(row, true)).toEqual({ ID: 'a', _lazy: true });
    expect(row).toEqual({ ID: 'a' });
    expect(stampLazy(row, false)).toBe(row);
  });
});

describe('lazyRowsBanner — what the user is told about a file that is not all here', () => {
  /** A plan that held `deferred` rows back and lost `truncated` roots. */
  const held = (deferred: number, truncated = 0) => ({ deferred, truncated });

  it('says nothing new when nothing was deferred', () => {
    // A file under the budget shows exactly the banner it showed before this existed.
    expect(lazyRowsBanner(held(0), undefined)).toBeUndefined();
    const parse = { headline: 'Some values could not be read.', details: ['one'] };
    expect(lazyRowsBanner(held(0), parse)).toBe(parse);
  });

  it('names the rows that can still grow, and warns that search only covers the loaded ones', () => {
    const banner = lazyRowsBanner(held(130283), undefined)!;
    expect(banner.headline).toContain('130,283');
    expect(banner.headline).toContain('expand');
    expect(banner.details.join(' ')).toContain('search');
  });

  it('keeps what the parse had to say, below its own headline', () => {
    const banner = lazyRowsBanner(held(5), { headline: 'Parse trouble', details: ['detail'] })!;
    expect(banner.headline).toContain('expand');
    expect(banner.details).toContain('Parse trouble');
    expect(banner.details).toContain('detail');
  });

  it('leads with the rows that are not in this view at all, when the top level was cut', () => {
    // The one loss a plan can still inflict: a level wider than the budget, so some roots
    // have no row and no gesture to reach them. That LEADS, because it is the half the
    // user cannot act on — and the deferred rows are still said, because both are true of
    // one delivery and the expandable ones are worth knowing about.
    const banner = lazyRowsBanner(held(40, 1200), undefined)!;
    expect(banner.headline).toContain('1,200');
    expect(banner.headline).not.toContain('expand');
    expect(banner.details[0]).toContain('40');
    expect(banner.details[0]).toContain('expand');
    expect(banner.details.join(' ')).toContain('search');
  });

  it('says the truncation alone when the cut level deferred nothing', () => {
    const banner = lazyRowsBanner(held(0, 7), undefined)!;
    expect(banner.headline).toContain('7');
    expect(banner.details.some((d) => d.includes('expand'))).toBe(false);
  });

  it('takes a missing plan as a plan that held nothing back', () => {
    // So a caller with no plan at all — a path that never budgeted — composes the same
    // way rather than needing its own branch.
    expect(lazyRowsBanner(undefined, undefined)).toBeUndefined();
  });
});

// ── against a real MatNode, through the core barrel ────────────────────────────────
// The rule above is pure; what follows is the rule wired to the nodes it actually plans
// and the fetch that answers for them. A budget of 2 stands in for 100,000 against a
// tree of 3 nodes: the shape under test is "a level did not fit", not the size of it.
let matSeq = 0;
function structSource(): { uri: string; node: any } {
  const uri = `lazy://${matSeq++}.mat`;
  DataModel.removeDataSource(uri);
  const node = DataModel.addMatSourceParsed(
    uri,
    {
      header: 'MATLAB 5.0',
      variables: [
        {
          name: 'cfg', className: 'struct', dimensions: [1, 1], isComplex: false, isLogical: false, value: null,
          fields: {
            gain: { name: 'gain', className: 'double', dimensions: [1, 1], isComplex: false, isLogical: false, value: 2, fields: null },
            trim: { name: 'trim', className: 'double', dimensions: [1, 1], isComplex: false, isLogical: false, value: 7, fields: null },
          },
        },
      ],
    },
    { path: uri },
  );
  return { uri, node };
}

const structNode = () => structSource().node;

/** A webview that records what the host posted to it. */
function spy() {
  const posts: any[] = [];
  return { posts, postMessage: (m: any) => { posts.push(m); return Promise.resolve(true); } };
}

describe('a planned payload and the fetch that completes it', () => {
  it('stamps the variable and holds its fields back when the field level does not fit', () => {
    const { rows, plan } = buildMatRowsPlanned(structNode(), 1);
    expect(rows).toHaveLength(1);
    expect((rows[0] as any).Name?.label ?? (rows[0] as any).Name).toBe('cfg');
    expect((rows[0] as any)._lazy).toBe(true);
    expect(plan.deferred).toBe(1);
  });

  it('stamps nothing when the whole variable fits, which is every file under the budget', () => {
    const rows = buildMatRows(structNode());
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.some((r: any) => r._lazy)).toBe(false);
  });

  it('answers a fetch with the held-back rows, under the id the table asked about', () => {
    // The round trip: the same builder from a different node. The fields arrive carrying
    // the variable's row id as their parent, which is what lets the webview put them
    // under the row the user opened rather than at the end of the table.
    const node: any = structNode();
    const parentRow: any = buildMatRowsPlanned(node, 1).rows[0];
    const answer = childRowsMessage(parentRow.ID, node.children[0], MAT_PLANNER);
    expect(answer.nodeId).toBe(parentRow.ID);
    expect(answer.rows.map((r: any) => r.Name?.label ?? r.Name).sort()).toEqual(['gain', 'trim']);
    for (const r of answer.rows) expect((r as any).parent).toBe(parentRow.ID);
  });

  it('answers at all when the node is gone, because silence is a twisty that never resolves', () => {
    // `truncated: 0` and not "absent": an answer with no rows lost nothing, and the
    // table must not read a missing node as a file too large to list.
    const answer = childRowsMessage('stale-id', null, MAT_PLANNER);
    expect(answer).toEqual({ type: 'childRows', nodeId: 'stale-id', rows: [], truncated: 0 });
  });

  it('answers at all when the node throws, for the same reason', () => {
    const answer = childRowsMessage(
      'x',
      {
        get children(): any[] {
          throw new Error('boom');
        },
      },
      MAT_PLANNER,
    );
    expect(answer.rows).toEqual([]);
  });
});

describe('answerChildRequest — the whole round trip, on the webview that asked', () => {
  const noUsage = () => Promise.resolve(false);

  it('resolves the row’s node from its id and posts its children', async () => {
    // `row.ID` IS `node.id` (core's BaseNode.toRow), which is what lets the table ask
    // about a row and the host answer about a node without either inventing a mapping.
    const { uri, node } = structSource();
    const parentRow: any = buildMatRowsPlanned(node, 1).rows[0];
    const webview = spy();
    await answerChildRequest(webview, uri, parentRow.ID, 'cfg.mat', noUsage, MAT_PLANNER);
    expect(webview.posts).toHaveLength(1);
    expect(webview.posts[0].type).toBe('childRows');
    expect(webview.posts[0].nodeId).toBe(parentRow.ID);
    expect(webview.posts[0].rows.map((r: any) => r.Name?.label ?? r.Name).sort()).toEqual(['gain', 'trim']);
  });

  it('fills the Usage column for the fetched rows, as the payload does for its own', async () => {
    // Otherwise a row the user expanded shows an empty Usage cell where its siblings,
    // which arrived with the payload, show their users — a column that silently depends
    // on how the row got here.
    const { uri, node } = structSource();
    const parentRow: any = buildMatRowsPlanned(node, 1).rows[0];
    const seen: any[] = [];
    await answerChildRequest(
      spy(),
      uri,
      parentRow.ID,
      'cfg.mat',
      (u, rows) => {
        seen.push({ u, count: rows.length });
        return Promise.resolve(true);
      },
      MAT_PLANNER,
    );
    expect(seen).toEqual([{ u: uri, count: 2 }]);
  });

  it('still posts when the usage graph rejects — the column is worth less than the rows', async () => {
    const { uri, node } = structSource();
    const parentRow: any = buildMatRowsPlanned(node, 1).rows[0];
    const webview = spy();
    await answerChildRequest(webview, uri, parentRow.ID, 'cfg.mat', () => Promise.reject(new Error('no graph')), MAT_PLANNER);
    expect(webview.posts.map((p) => p.type)).toEqual(['childRows']);
  });

  it('still posts for an id no node answers to, so the twisty stops offering', async () => {
    // The failure this guards is specific: the table marks a row as asked-about when it
    // asks, and clears that on the answer. Silence here leaves a twisty that looks live
    // and does nothing for the rest of the session — the hang, scoped to one row.
    const webview = spy();
    await answerChildRequest(webview, 'lazy://gone.mat', 'no-such-node', 'cfg.mat', noUsage, MAT_PLANNER);
    expect(webview.posts).toEqual([
      { type: 'childRows', nodeId: 'no-such-node', rows: [], truncated: 0 },
    ]);
  });

  it('reports instead of hanging when the answer cannot be delivered', async () => {
    // One node with a budget's worth of heavy children is still a message that can
    // exceed V8's string limit, which is the same undeliverable-payload failure the cap
    // exists for (see postPayload.ts) — so the fetch goes through the same reporter.
    const posts: any[] = [];
    const webview = {
      postMessage: (m: any) => {
        posts.push(m);
        return posts.length === 1 ? Promise.reject(new Error('Invalid string length')) : Promise.resolve(true);
      },
    };
    const { uri, node } = structSource();
    const parentRow: any = buildMatRowsPlanned(node, 1).rows[0];
    await answerChildRequest(webview, uri, parentRow.ID, 'cfg.mat', noUsage, MAT_PLANNER);
    expect(posts.map((p) => p.type)).toEqual(['childRows', 'error']);
    expect(posts[1].message).toContain('cfg.mat');
  });
});
