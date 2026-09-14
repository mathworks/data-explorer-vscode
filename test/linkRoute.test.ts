// Copyright 2026 The MathWorks, Inc.
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
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

  it('sends a link into another document to the host', () => {
    expect(linkRoute(`Kp@file:///w/Other.sldd`, HERE)).toEqual({ kind: 'host' });
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
  // table-main.ts runs top-level side effects against a live table element, so it is not
  // importable here — the same reason multiSelectInvariants.test.ts reads it as source.
  const src = blankCommentsAndKeepLines(
    readFileSync(fileURLToPath(new URL('../src/webview/table-main.ts', import.meta.url)), 'utf8'),
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
    // and the unconditional one after the local call. Counting them is what makes this
    // assertion about the second — matching either would have passed before it existed.
    expect(src.match(/pendingSelectName = null;/g) ?? []).toHaveLength(2);
  });
});
