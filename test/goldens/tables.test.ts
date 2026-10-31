// Copyright 2026 The MathWorks, Inc.
//
// What every fixture's table view is sent, pinned as golden payloads.
//
// The view-model layer — the row builders, the inspector's groups, the matrix cells — is about to
// move out of this extension into a package of its own, a step at a time. The extension is
// published, so the one property every step has to keep is that no user sees a different table.
// These snapshots are that property, written down: for each fixture, exactly what the host posts
// to the webview, byte for byte as JSON. A move that changes nothing leaves every file here as it
// is; a move that changes something shows up as a diff a reviewer can read, row by row — or, for
// the few payloads too large to keep whole, as a changed digest naming the row (fixtures.ts).
//
// Per fixture, beside this file in __snapshots__/<fixture>/ (fixtures.ts spells the layout):
//   table.json         the first paint, every message in post order, at the real row budget;
//   table-lazy.json    the same paint at a budget of SMALL_BUDGET rows, so rows are deferred
//                      (`_lazy`) — which no fixture is large enough to reach at 100,000;
//   children-lazy.json the `childRows` answer for every row that paint deferred, by row id;
//   inspector.json     the Property Inspector's `showProps` for every row that selects a node;
//   matrix.json        the Variable Editor's `matrixCells` for every row carrying `_matrix`.
// Beside them, from the other suites here: project.json, a project's page (project.test.ts);
// usage.json, the Usage column as its folder fills it (usage.test.ts); and, per fixture FOLDER,
// hierarchy.json, the sidebar's relationship tree (hierarchy.test.ts).
//
// A snapshot that is supposed to change is rewritten with `npx vitest run test/goldens -u`, and
// the diff is the review. `GOLDENS_FULL_DIR=<dir>` also writes every payload whole, never
// digested, in the same layout under <dir> (fixtures.ts expectGolden).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataModel, isProjectFile } from 'data-explorer-core';
import { LAZY_ROW_BUDGET, isSectionRowId } from 'data-explorer-view/model';
import { bytesOf, expectGolden, fixtureFiles, nameOf } from './fixtures.js';
import { openTable, registers, routeOf, type TableView } from './views.js';

/**
 * Small enough that any fixture of more than a handful of rows, with anything below its names,
 * defers something: the top level is always delivered whole (lazyRows.ts), so this decides how
 * far below the names a first paint goes.
 */
const SMALL_BUDGET = 5;

// Every fixture but the projects, which open on a page (project.test.ts).
const TABLES = fixtureFiles().filter((rel) => !isProjectFile(nameOf(rel)));

/** The rows of a view keyed by id, refusing two rows under one id rather than keeping either. */
function keyed<T>(view: TableView, rows: any[], answer: (row: any) => T | undefined): Record<string, T> {
  const out: Record<string, T> = {};
  for (const row of rows) {
    const id = String(row.ID);
    const value = answer(row);
    if (value === undefined) continue;
    if (Object.hasOwn(out, id)) throw new Error(`${view.uriString}: two rows answer for ${id}`);
    out[id] = value;
  }
  return out;
}

/** Paint `rel`, hand the open view to `use`, and close it whatever `use` did. */
async function withTable(rel: string, budget: number, use: (view: TableView) => Promise<void>): Promise<void> {
  const view = await openTable(rel, budget);
  try {
    await use(view);
  } finally {
    view.close();
  }
  // Each fixture opens into an empty session, as a window with one tab does. A view that left a
  // source registered would hand the next fixture's rows a Usage answer from this one (core's own
  // `UsedBy` counts every registered model), and the snapshots would depend on the order.
  expect(DataModel.getDataSourceIds(), `${rel} left a source registered`).toEqual([]);
}

beforeAll(() => {
  // What `clipboardState` and every clip mark read: the empty clipboard of a fresh window.
  registers.clearClipboard();
  DataModel.removeAll();
});

afterAll(() => {
  DataModel.removeAll();
});

// Generous: a loaded CI worker is many times slower than an idle laptop, where the slowest fixture
// here takes a few hundred milliseconds.
describe('golden table payloads', { timeout: 60_000 }, () => {
  it('finds a corpus worth pinning', () => {
    // A walker that found nothing would pass every test below by having none. A floor, not a
    // count, so adding a fixture does not need this touched.
    expect(TABLES.length).toBeGreaterThan(60);
    for (const ext of ['.sldd', '.slx', '.mdl', '.mat']) {
      expect(TABLES.some((rel) => rel.endsWith(ext)), ext).toBe(true);
    }
    // And every route views.ts replays is taken by some fixture, so none of the copies there is
    // pinned by nothing.
    const routes = new Set(TABLES.map((rel) => routeOf(nameOf(rel), new Uint8Array(bytesOf(rel))).kind));
    expect([...routes].sort()).toEqual(['mat', 'readonly', 'text', 'zip']);
  });

  for (const rel of TABLES) {
    it(rel, async () => {
      await withTable(rel, LAZY_ROW_BUDGET, async (view) => {
        await expectGolden(view.messages, rel, 'table');
        // Every row the user can click, as the table reports a click: one row id. A section
        // header shows nothing (InspectorSelection), so it is not asked.
        const inspector = keyed(view, view.rows, (row) => (isSectionRowId(String(row.ID)) ? undefined : view.select(row.ID)));
        await expectGolden(inspector, rel, 'inspector');
        // The id the panel asks with is the descriptor's (view's connectTable), not the row's.
        const matrix = keyed(view, view.rows, (row) => (row._matrix ? view.matrix(row._matrix.nodeId) : undefined));
        await expectGolden(matrix, rel, 'matrix');
      });

      await withTable(rel, SMALL_BUDGET, async (view) => {
        await expectGolden(view.messages, rel, 'table-lazy');
        const children: Record<string, unknown> = {};
        for (const row of view.rows.filter((r) => r._lazy)) {
          const id = String(row.ID);
          if (Object.hasOwn(children, id)) throw new Error(`${view.uriString}: two deferred rows named ${id}`);
          // One at a time and in row order, as a user opening each twisty in turn would ask.
          children[id] = await view.children(id);
        }
        await expectGolden(children, rel, 'children-lazy');
      });
    });
  }
});
