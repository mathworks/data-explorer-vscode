// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// WHICH row a by-name navigation selects, when the name is spelled at two depths.
//
// The navigation channel is name-only end to end: `requestSelect` carries a string, and
// `parseNavTarget` has already thrown the grammar away by then, so the WEBVIEW picks the
// row. `arch_binary.sldd` holds the case where that choice is not free — two rows answer to
// `ValueType`:
//
//   arch/DataInterface/ValueType   a bus ELEMENT named after the value type it references,
//                                  whose Data Type cell reads `ValueType: ValueType`
//   arch/ValueType                 the `Simulink.ValueType` entry that link means
//
// and the element comes FIRST, because its interface is entered before the value type. So
// first-in-document-order selected the element — the row the click came from — and the link
// looked dead: it was already selected, nothing moved, nothing else happened.
//
// The rule is that every by-name target on this channel means a top-level ENTRY. A Data Type
// link resolves through core's typeLinkIndex, which is `isEntry`-gated (so the element could
// never have been the answer), and the Usage grammars name a dictionary/MAT variable or a
// model-workspace param. Nested rows stay reachable as the fallback, which is what a pre-SID
// block target needs — its row is deep in the block tree, never an entry.
//
// Driven against the SHIPPED table-main, with the REAL rows the host builds from the real
// fixture, for the reason linkRoute.test.ts is: rows rewritten here would keep the
// collision only as long as someone remembered to, and the collision is the whole test.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
// join(import.meta.dirname, …), not fileURLToPath(import.meta.url): under happy-dom
// import.meta.url is an http URL, which fileURLToPath rejects. Same reason as
// linkRoute.test.ts and blockSidIdentity.test.ts.
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { DataModel } from 'data-explorer-core';
import { readSlddParts } from '../src/host/slddContent.js';
import { buildRows, COLUMNS, COLUMN_LABELS } from '../src/host/rowBuilder.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A plain uriString srcId, the spelling two of the three providers register — so the link
// target core builds is `ValueType@<HERE>` and routes locally. The prefixed
// (`binedit:`) spelling of the same document is covered in srcId.test.ts and
// linkRoute.test.ts; what this file is about is depth, not srcId.
const HERE = 'file:///w/arch_binary.sldd';
const ENTRY_ROW = `${HERE}/arch/ValueType`;
const ELEMENT_ROW = `${HERE}/arch/DataInterface/ValueType`;

/** The rows the host would post for the fixture, built by the host's own row builder. */
function fixtureRows(): any[] {
  const zip = unzipSync(
    new Uint8Array(readFileSync(join(import.meta.dirname, 'fixtures', 'arch_binary.sldd'))),
  );
  const zipMeta: Record<string, Uint8Array> = {};
  for (const [member, data] of Object.entries(zip)) {
    if (member !== 'data/chunk0.xml') zipMeta[member] = data;
  }
  DataModel.removeDataSource(HERE);
  const node = DataModel.addDataSource(
    HERE,
    readSlddParts(new TextDecoder().decode(zip['data/chunk0.xml']), zipMeta),
    { path: 'arch_binary.sldd' },
  );
  return buildRows(node as any) as any[];
}

describe('a by-name navigation selects the definition, not a same-named child', () => {
  const posted: { type: string; [k: string]: unknown }[] = [];
  let table: any;
  let rows: any[];

  beforeAll(async () => {
    rows = fixtureRows();
    (globalThis as any).acquireVsCodeApi = () => ({
      postMessage: (m: unknown) => posted.push(m as { type: string }),
    });
    document.body.innerHTML = '<dex-tree-table></dex-tree-table>';
    await import('../src/webview/table-main.js');
    table = document.querySelector('dex-tree-table');
  });

  beforeEach(async () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'setRows',
          docUri: HERE,
          rows,
          columns: COLUMNS,
          columnLabels: COLUMN_LABELS,
          editable: false,
        },
      }),
    );
    await table.updateComplete;
    table.selectedRowIds = [];
    posted.length = 0;
  });

  const selected = () =>
    posted.filter((m) => m.type === 'select').map((m) => (m.rowIds as string[]).join());

  it('is a fixture where the name really is spelled twice', () => {
    // If this ever stops holding, the two tests below pass for the wrong reason — they would
    // be asserting the only row there is. The Data Type cell is read from the row too, so
    // this also names where the click comes from: the ELEMENT's cell, pointing at the ENTRY.
    const ids = rows.filter((r) => r.Name?.label === 'ValueType').map((r) => r.ID);
    expect(ids).toEqual([ELEMENT_ROW, ENTRY_ROW]);
    expect(rows.find((r) => r.ID === ELEMENT_ROW).DataType).toEqual({
      prefix: 'ValueType: ',
      text: 'ValueType',
      linkTarget: `ValueType@${HERE}`,
    });
  });

  it('selects the entry for a local Data Type click', () => {
    // The reported bug, with the target taken from the cell rather than written out here.
    const target = rows.find((r) => r.ID === ELEMENT_ROW).DataType.linkTarget as string;
    table.dispatchEvent(new CustomEvent('dex-link-clicked', { detail: { target } }));
    expect(selected()).toEqual([ENTRY_ROW]);
  });

  it('answers a host selectByName the same way', () => {
    // The other path to the same matcher: a cross-file link, a Property Inspector click, and
    // the global entry search all arrive as this message instead. They must agree — one rule
    // reached by two paths is where this class of bug lives, and a fix on the local path
    // alone would leave every Data Type link clicked in the Properties pane still dead.
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'selectByName', name: 'ValueType' } }),
    );
    expect(selected()).toEqual([ENTRY_ROW]);
  });

  it('still selects a nested row when no entry has the name', () => {
    // The fallback, and the reason the entry pass is a PREFERENCE rather than a filter: a
    // pre-SID block target names a row deep in the block tree, and gating on entries alone
    // would turn those clicks into silent no-ops.
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'selectByName', name: 'Element' } }),
    );
    expect(selected()).toEqual([`${HERE}/arch/StructType/Element`]);
  });
});
