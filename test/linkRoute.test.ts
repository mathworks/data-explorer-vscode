// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// Where a link click in this webview goes: the table answers a link into its own document
// itself (view's localLinkName, which connectTable applies to every click, and view proves:
// test/messageSource.test.ts › link targets, test/connectTable.test.ts › links), and table-main
// hands every other one to the host. What stays here is that half: table-main's.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
// `join(import.meta.dirname, …)` and not `fileURLToPath(import.meta.url)`: this file runs
// under happy-dom, where import.meta.url is an http URL and fileURLToPath rejects it.
// nameSelectTarget.test.ts reads its fixture the same way for the same reason.
import { join } from 'node:path';
import { blankCommentsAndKeepLines } from './tools/moduleGraph.js';

const HERE = 'file:///w/Controller.sldd';

describe('table-main routes every link through that one function', () => {
  // Read as source, the way multiSelectInvariants.test.ts reads it: these are about the SHAPE of
  // table-main.ts rather than its behaviour, which the describe below drives for real. The click,
  // the link rule and the document's uri are connectTable's and messageSource's, and view proves
  // them (test/connectTable.test.ts › links, test/connectTableRepaints.test.ts).
  const src = blankCommentsAndKeepLines(
    readFileSync(join(import.meta.dirname, '..', 'src/webview/table-main.ts'), 'utf8'),
  );

  it('decides in exactly one place', () => {
    // table-main has no link rule of its own: it hands what connectTable does not answer to the host.
    expect(src).not.toMatch(/dex-link-clicked|linkRoute\(|localLinkName\(/);
    expect(src.match(/handle\.on\('navigate'/g) ?? []).toHaveLength(1);
  });

  it('keeps no document uri of its own', () => {
    // The uri is view's: messageSource reads it off every setRows and every sectionRules, and
    // connectTable takes each paint's. table-main keeps no uri of its own to drift from them.
    expect(src).not.toMatch(/docUri = /);
  });
});

// ── the routing, driven for real ──────────────────────────────────────────────────
// Everything above reads table-main as text. This imports it and clicks a link in it, so the
// assertion is about the listener that actually ships rather than about a copy of it.
//
// It is importable after all, with two stubs: `acquireVsCodeApi` as a global (the module
// calls it at top level) and a `<dex-tree-table>` in the body for it to bind to, both in
// place before the dynamic import runs. Importing it once, in beforeAll, is not a choice —
// a module body runs once per test FILE, and this one wires window and body listeners.
describe('a local click that finds no row still reaches the host', () => {
  const posted: { type: string; [k: string]: unknown }[] = [];
  let table: any;

  // Its own timeout: a cold import of the whole table-main webview is what a loaded machine stretches.
  beforeAll(async () => {
    (globalThis as any).acquireVsCodeApi = () => ({
      postMessage: (m: unknown) => posted.push(m as { type: string }),
    });
    document.body.innerHTML = '<dex-tree-table></dex-tree-table>';
    await import('../src/webview/table-main.js');
    table = document.querySelector('dex-tree-table');
  }, 60_000);

  // A repaint carrying one row, from THIS document.
  async function paint(names: string[]): Promise<void> {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'setRows',
          docUri: HERE,
          rows: names.map((name, i) => ({ ID: `r${i}`, parent: null, Name: { label: name } })),
          columns: ['Name'],
          columnLabels: { Name: 'Name' },
          editable: false,
        },
      }),
    );
    await table.updateComplete;
  }

  function click(target: string): void {
    table.dispatchEvent(new CustomEvent('dex-link-clicked', { detail: { target } }));
  }

  const types = () => posted.map((m) => m.type);

  beforeEach(async () => {
    await paint(['artFsAimCmd']);
    posted.length = 0;
  });

  it('still hands a cross-document target straight to the host', () => {
    // What connectTable does not answer itself, table-main hands to the host, which opens the
    // other document and selects the row there.
    click('Kp@file:///w/Other.sldd');
    expect(types()).toEqual(['navigate']);
  });
});
