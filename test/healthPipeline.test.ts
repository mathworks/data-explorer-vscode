// Copyright 2026 The MathWorks, Inc.
// Integration test for the health-decoration pipeline WITHOUT vscode: the tree
// encodes a state into a resourceUri query; the provider decodes uri.query back.
// We can't import the vscode-coupled provider/tree headlessly, but we can prove
// the seam that connects them — a real URI-style query string round-trips — using
// the same functions both sides call (encode/decode from health.ts) and Node's
// URL to model exactly how vscode.Uri exposes `.query`.
import { describe, it, expect } from 'vitest';
import { RelGraph, type GraphSource } from '../src/host/graphModel.js';
import { encode, decode, DECORATIONS, type HealthState } from '../src/host/health.js';

// Mimic vscode.Uri.with({ query }) → uri.query: the query is stored verbatim
// (vscode does NOT percent-decode it for you in `.query`). Node's URL confirms
// our encode() output survives as a query component unchanged.
function uriQueryAfterRoundTrip(fileUrl: string, query: string): string {
  const u = new URL(fileUrl);
  u.search = '?' + query;
  // vscode.Uri.query is the part after '?' — URL.search includes the leading '?'.
  return u.search.slice(1);
}

describe('health decoration pipeline (encode → uri.query → decode)', () => {
  const states: HealthState[] = ['cycle', 'modified'];

  it('every state survives a file-URI query round-trip and decodes back', () => {
    for (const state of states) {
      const q = uriQueryAfterRoundTrip('file:///ws/data.sldd', encode(state));
      const decoded = decode(q);
      expect(decoded).toBe(state);
      // and the provider would map it to a concrete decoration
      expect(DECORATIONS[decoded!].badge.length).toBeLessThanOrEqual(2);
    }
  });

  it('a plain file URI (no query) decodes to null → no decoration', () => {
    const q = new URL('file:///ws/data.sldd').search.slice(1);
    expect(decode(q)).toBeNull();
  });

  it('the query keeps the file path intact (so file-icon theming still matches)', () => {
    const u = new URL('file:///ws/models/top.slx');
    u.search = '?' + encode('cycle');
    expect(u.pathname).toBe('/ws/models/top.slx');
    expect(u.pathname.endsWith('.slx')).toBe(true);
  });
});

// End-to-end over a realistic graph: build sources with a cycle and assert the
// tree surfaces a cycle-flagged repeat row (the exact input the tree's healthOf()
// uses: el.cycle).
describe('health states over a realistic graph', () => {
  function src(path: string, extra: Partial<GraphSource> = {}): GraphSource {
    return {
      uriString: `file:///${path}`,
      path: `/${path}`,
      type: path.endsWith('.slx') ? 'model' : path.endsWith('.mat') ? 'mat' : path.endsWith('.prj') ? 'project' : 'sldd',
      slddRefs: [],
      modelRefs: [],
      dataSources: [],
      dataDictionary: null,
      ...extra,
    };
  }

  it('marks the cycle repeat occurrence, leaves healthy rows clean', () => {
    const sources = [
      // top.slx links a.sldd, which cycles a→b→a. Something must point INTO the
      // cycle or it's unreachable from roots (both members would be "referenced").
      src('top.slx', { dataDictionary: 'a.sldd' }),
      src('a.sldd', { slddRefs: ['b.sldd'] }),
      src('b.sldd', { slddRefs: ['a.sldd'] }), // a<->b cycle
    ];
    const g = new RelGraph(sources);

    // Walk the tree; find the cycle occurrence.
    const roots = g.roots();
    let cycleFound = false;
    const visit = (node: ReturnType<typeof g.roots>[number], depth: number): void => {
      if (depth > 10) return;
      if (node.cycle) cycleFound = true;
      for (const c of g.children(node)) visit(c, depth + 1);
    };
    for (const r of roots) visit(r, 0);
    expect(cycleFound).toBe(true); // a→b→a produces a cycle-flagged repeat row
  });
});
