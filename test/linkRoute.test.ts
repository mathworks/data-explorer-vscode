// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// Which link clicks this webview can answer itself.
//
// A Data Type link points into the SAME document by construction: core builds the target
// from the source the entry lives in. So the row is already in `table.rows`, and asking the
// host to open a file that is already open, in order to select a row that is already here,
// is a round-trip and a tab-focus for nothing.
//
// The rule is deliberately narrow, and each `host` case below is a real target this must
// NOT swallow: a cross-file usage link, a bare filename (Model Reference), and the
// `blocks:`/`workspace:` grammars, which name things this table cannot select by that
// spelling. Getting the routing wrong in the generous direction is worse than not routing
// at all — a click that quietly selects nothing.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
// `join(import.meta.dirname, …)` and not `fileURLToPath(import.meta.url)`: this file runs
// under happy-dom, where import.meta.url is an http URL and fileURLToPath rejects it.
// blockSidIdentity.test.ts reads the same module the same way for the same reason.
import { join } from 'node:path';
import { linkRoute } from '../src/webview/linkRoute.js';
import { blankCommentsAndKeepLines } from './tools/moduleGraph.js';

const HERE = 'file:///w/Controller.sldd';

describe('a link into this same document is answered here', () => {
  it('routes a type link whose source is this document locally', () => {
    expect(linkRoute(`artFsAimCmd@${HERE}`, HERE)).toEqual({ kind: 'local', name: 'artFsAimCmd' });
  });

  it('splits on the FIRST at-sign, as core does', () => {
    // core's splitLinkTarget (DataModel.ts) takes the FIRST `@`: the producer writes
    // name-then-source, and a srcId is the host's key for a file, which may itself be a uri
    // containing an `@` (credentials, a revision). Reading the last one instead would
    // silently re-point the link at a different document — and, worse, disagree with the
    // host, so the two routes would select different rows for one target.
    //
    // These two cases pin the split from both sides, because each is the answer the OTHER
    // reading gets wrong:
    //
    // `a@b@HERE` is name `a` in source `b@HERE`, which is not this document. Splitting from
    // the right would read it as name `a@b` here and claim it locally.
    expect(linkRoute(`a@b@${HERE}`, HERE)).toEqual({ kind: 'host' });
    // And the case core's comment is about: a document whose own uri holds an `@`.
    // Splitting from the right would cut the uri in half and send this one to the host.
    const AT_URI = 'file:///w/user@host/Controller.sldd';
    expect(linkRoute(`Kp@${AT_URI}`, AT_URI)).toEqual({ kind: 'local', name: 'Kp' });
  });

  it('routes an editable binary dictionary locally too', () => {
    // Its srcId is not its uri: BinarySlddEditorProvider prefixes, so core builds
    // `Kp@binedit:file:///…` while setRows carries the plain uri. Compared raw those never
    // match, and every link in a binary .sldd took the host path — correct, but the fast
    // path silently never firing for one of the three providers is one rule on two paths.
    expect(linkRoute(`Kp@binedit:${HERE}`, HERE)).toEqual({ kind: 'local', name: 'Kp' });
  });

  it('sends a link into another document to the host', () => {
    expect(linkRoute(`Kp@file:///w/Other.sldd`, HERE)).toEqual({ kind: 'host' });
    // Prefixed and still elsewhere: unwrapping the srcId must not widen what counts as
    // "this document".
    expect(linkRoute(`Kp@binedit:file:///w/Other.sldd`, HERE)).toEqual({ kind: 'host' });
  });

  it('sends the block and workspace grammars to the host', () => {
    // These name a block SID and a model-workspace parameter. The host resolves both; this
    // table cannot select either by that spelling, so claiming them locally would turn a
    // working navigation into a click that does nothing.
    expect(linkRoute(`blocks:65@${HERE}`, HERE)).toEqual({ kind: 'host' });
    expect(linkRoute(`workspace:Kp@${HERE}`, HERE)).toEqual({ kind: 'host' });
  });

  it('sends a bare filename to the host', () => {
    // A Model Reference / External Data link: a file to open, with no row to select.
    expect(linkRoute('data.sldd', HERE)).toEqual({ kind: 'host' });
  });

  it('sends everything to the host before this document knows its own uri', () => {
    // The first setRows carries it. A click before that is not possible in practice, but
    // matching '' against '' would route EVERY link locally if it ever were.
    expect(linkRoute(`artFsAimCmd@`, '')).toEqual({ kind: 'host' });
    expect(linkRoute(`artFsAimCmd@${HERE}`, '')).toEqual({ kind: 'host' });
  });

  it('sends a target with an empty name half to the host', () => {
    expect(linkRoute(`@${HERE}`, HERE)).toEqual({ kind: 'host' });
  });
});

describe('table-main routes every link through that one function', () => {
  // Read as source, the way multiSelectInvariants.test.ts reads it: these three are about
  // the SHAPE of the code rather than its behaviour, which the describe below drives for
  // real against an imported table-main.
  const src = blankCommentsAndKeepLines(
    readFileSync(join(import.meta.dirname, '..', 'src/webview/table-main.ts'), 'utf8'),
  );

  it('decides in exactly one place', () => {
    expect(src.match(/linkRoute\(/g) ?? []).toHaveLength(1);
  });

  it('learns the document uri from setRows, not only from sectionRules', () => {
    // Three matches, not two: the module-scope declaration, the sectionRules assignment
    // that was already there, and the setRows one this task adds. Only the last reaches a
    // read-only table, and counting is what pins it — drop that assignment and this is 2.
    expect(src.match(/docUri = /g) ?? []).toHaveLength(3);
  });

  it('does not leave an unmatched local target pending', () => {
    // pendingSelectName survives a miss by design (a cross-tab target arrives before its
    // rows). A LOCAL target's row is already here, so a miss is a bad target, and leaving
    // it pending would hijack the next repaint.
    //
    // Two clearings: the one inside applyPendingNameSelection, which runs only on a HIT,
    // and the one on the miss branch after the local call. Counting them is what makes
    // this assertion about the second — matching either would have passed before it
    // existed.
    expect(src.match(/pendingSelectName = null;/g) ?? []).toHaveLength(2);
  });
});

// ── the routing, driven for real ──────────────────────────────────────────────────
// Everything above reads table-main as text. This imports it and clicks links in it, so
// the assertions are about the listener that actually ships rather than about a copy of it
// rewritten here. That distinction is the whole reason to bother: a reconstructed listener
// is one rule on two paths, and it goes on passing after the shipped one changes.
//
// It is importable after all, with two stubs: `acquireVsCodeApi` as a global (the module
// calls it at top level) and a `<dex-tree-table>` in the body for it to bind to, both in
// place before the dynamic import runs. Importing it once, in beforeAll, is not a choice —
// a module body runs once per test FILE, and this one wires window and body listeners.
describe('a local click that finds no row still reaches the host', () => {
  const posted: { type: string; [k: string]: unknown }[] = [];
  let table: any;

  beforeAll(async () => {
    (globalThis as any).acquireVsCodeApi = () => ({
      postMessage: (m: unknown) => posted.push(m as { type: string }),
    });
    document.body.innerHTML = '<dex-tree-table></dex-tree-table>';
    await import('../src/webview/table-main.js');
    table = document.querySelector('dex-tree-table');
  });

  // A repaint carrying one row, from THIS document — the setRows `docUri` is what lets the
  // routing fire at all, so this doubles as the end-to-end check that the field arrives.
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

  it('selects locally and posts no navigate when the row is here', () => {
    // The point of the whole optimisation, and the assertion that keeps the fast path
    // fast: one `select`, and nothing that would make the host open and re-focus the tab
    // the user is already looking at.
    click(`artFsAimCmd@${HERE}`);
    expect(types()).toEqual(['select']);
    expect(posted[0].rowIds).toEqual(['r0']);
  });

  it('falls back to the host when the name matches no row', () => {
    // linkRoute's allowlist is a claim about every target that will ever carry this
    // document's uri. It holds for today's producers, but core's resolveLink reads the
    // name half as an EXPRESSION, not a whole name, so a same-document `[tau 1]@here`
    // has no colon, routes local, and finds nothing. Handing the miss to the host — which
    // can resolve it — is what makes the allowlist merely an optimisation rather than
    // something that has to stay exhaustive forever.
    click(`[tau 1]@${HERE}`);
    expect(types()).toEqual(['navigate']);
    // The RAW target, not the name half: the host needs the whole `name@source` grammar
    // to know which document to resolve in.
    expect(posted[0].target).toBe(`[tau 1]@${HERE}`);
  });

  it('does not select twice when it falls back', () => {
    // The fallback must not ALSO take the local path: a `select` here plus a host
    // navigation would re-focus the tab and undo the optimisation on exactly the clicks
    // that are already the slow ones.
    click(`nosuch@${HERE}`);
    expect(types()).not.toContain('select');
  });

  it('does not let a missed local target hijack the next repaint', async () => {
    // pendingSelectName is deliberately sticky for a cross-tab target, which legitimately
    // arrives before its rows. A local miss is not that — the rows were already here — so
    // the slot has to be cleared, or the next repaint that happens to contain the name
    // selects it out of nowhere, long after the click.
    click(`latecomer@${HERE}`);
    posted.length = 0;
    await paint(['artFsAimCmd', 'latecomer']);
    expect(types()).not.toContain('select');
  });

  it('still hands a cross-document target straight to the host', () => {
    // The path that existed before any of this, unchanged.
    click('Kp@file:///w/Other.sldd');
    expect(types()).toEqual(['navigate']);
  });

  it('selects locally for a target carrying the binary-edit srcId', () => {
    // The shipped listener, for the provider whose srcId is not its uri. Driven here and not
    // only through linkRoute() because what matters is that the string setRows delivers and
    // the string core builds are reconciled somewhere on this path.
    click(`artFsAimCmd@binedit:${HERE}`);
    expect(types()).toEqual(['select']);
    expect(posted[0].rowIds).toEqual(['r0']);
  });
});
