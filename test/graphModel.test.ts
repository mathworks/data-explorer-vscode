// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { RelGraph, type GraphSource, type GraphNode } from '../src/host/graphModel.js';

// Build a graph from a compact spec. uriStrings are file:///<path>.
function src(path: string, extra: Partial<GraphSource> = {}): GraphSource {
  return {
    uriString: `file:///${path}`,
    path: `/${path}`,
    type: path.endsWith('.slx')
      ? 'model'
      : path.endsWith('.mat')
        ? 'mat'
        : path.endsWith('.prj')
          ? 'project'
          : 'sldd',
    slddRefs: [],
    modelRefs: [],
    dataSources: [],
    dataDictionary: null,
    ...extra,
  };
}
const labels = (ns: GraphNode[]) => ns.map((n) => n.label);
const byLabel = (ns: GraphNode[], l: string) => ns.find((n) => n.label === l)!;
// Files at path `/x` land in the root folder group labeled '/'. Look it up by
// label so this stays correct regardless of group ordering.
const topRoots = (g: RelGraph): GraphNode[] => {
  const root = g.roots().find((r) => r.label === '/');
  return root ? g.children(root) : [];
};

describe('RelGraph sldd-only parity', () => {
  it('nests a referenced dictionary under its parent', () => {
    const g = new RelGraph([
      src('top.sldd', { slddRefs: ['child.sldd'] }),
      src('child.sldd'),
    ]);
    expect(labels(topRoots(g))).toEqual(['top.sldd']);
    const top = byLabel(topRoots(g), 'top.sldd');
    expect(labels(g.children(top))).toEqual(['child.sldd']);
  });

  it('marks unresolved references as missing leaves', () => {
    const g = new RelGraph([src('top.sldd', { slddRefs: ['ghost.sldd'] })]);
    const top = byLabel(topRoots(g), 'top.sldd');
    const ghost = byLabel(g.children(top), 'ghost.sldd');
    expect(ghost.kind).toBe('missing');
    expect(g.children(ghost)).toEqual([]);
  });
});

describe('RelGraph model relationships', () => {
  it('shows referenced models as direct children and data under External Data', () => {
    const g = new RelGraph([
      src('ctrl.slx', { modelRefs: ['plant.slx'], dataDictionary: 'params.sldd', dataSources: ['signals.mat'] }),
      src('plant.slx'),
      src('params.sldd'),
      src('signals.mat'),
    ]);
    const ctrl = byLabel(topRoots(g), 'ctrl.slx');
    const kids = g.children(ctrl);
    // plant.slx is a direct child; External Data is a group child.
    expect(labels(kids)).toEqual(['plant.slx', 'External Data']);
    const ext = byLabel(kids, 'External Data');
    expect(ext.kind).toBe('group');
    expect(labels(g.children(ext)).sort()).toEqual(['params.sldd', 'signals.mat']);
  });

  it('omits External Data when a model has no data links', () => {
    const g = new RelGraph([src('ctrl.slx', { modelRefs: ['plant.slx'] }), src('plant.slx')]);
    const ctrl = byLabel(topRoots(g), 'ctrl.slx');
    expect(labels(g.children(ctrl))).toEqual(['plant.slx']);
  });

  it('leaves a mat node as a non-expandable leaf', () => {
    const g = new RelGraph([src('a.slx', { dataSources: ['d.mat'] }), src('d.mat')]);
    const a = byLabel(topRoots(g), 'a.slx');
    const ext = byLabel(g.children(a), 'External Data');
    const mat = byLabel(g.children(ext), 'd.mat');
    expect(mat.hasChildren).toBe(false);
    expect(g.children(mat)).toEqual([]);
  });

  it('terminates a model-ref cycle', () => {
    const g = new RelGraph([
      src('root.slx', { modelRefs: ['a.slx'] }),
      src('a.slx', { modelRefs: ['b.slx'] }),
      src('b.slx', { modelRefs: ['a.slx'] }),
    ]);
    const root = byLabel(topRoots(g), 'root.slx');
    const a = byLabel(g.children(root), 'a.slx');
    const b = byLabel(g.children(a), 'b.slx');
    const aAgain = byLabel(g.children(b), 'a.slx');
    expect(aAgain.cycle).toBe(true);
    expect(g.children(aAgain)).toEqual([]);
  });
});

describe('RelGraph roots selection', () => {
  it('returns every file (sorted) when there are no relationships', () => {
    const g = new RelGraph([src('b.sldd'), src('a.slx'), src('c.mat')]);
    expect(labels(topRoots(g))).toEqual(['a.slx', 'b.sldd', 'c.mat']);
  });

  it('excludes any file referenced by another (model, sldd, or mat)', () => {
    const g = new RelGraph([
      src('top.slx', { modelRefs: ['sub.slx'], dataDictionary: 'd.sldd', dataSources: ['x.mat'] }),
      src('sub.slx'),
      src('d.sldd'),
      src('x.mat'),
    ]);
    // Only top.slx is unreferenced.
    expect(labels(topRoots(g))).toEqual(['top.slx']);
  });

  it('falls back to all files when the graph is entirely cyclic (no true root)', () => {
    const g = new RelGraph([
      src('a.slx', { modelRefs: ['b.slx'] }),
      src('b.slx', { modelRefs: ['a.slx'] }),
    ]);
    expect(labels(topRoots(g)).sort()).toEqual(['a.slx', 'b.slx']);
  });

  it('returns [] for an empty workspace', () => {
    const g = new RelGraph([]);
    expect(g.roots()).toEqual([]);
  });

  it('marks a root as expandable via hasChildren only when it has links', () => {
    const g = new RelGraph([
      src('withRef.sldd', { slddRefs: ['leaf.sldd'] }),
      src('leaf.sldd'),
      src('lonely.mat'),
    ]);
    const roots = topRoots(g);
    expect(byLabel(roots, 'withRef.sldd').hasChildren).toBe(true);
    // leaf.sldd is referenced (not a root); lonely.mat is a root but a leaf.
    expect(byLabel(roots, 'lonely.mat').hasChildren).toBe(false);
  });
});

describe('RelGraph shared targets (graph-as-tree duplication)', () => {
  it('shows a dictionary referenced by two models under both (expansion tree)', () => {
    const g = new RelGraph([
      src('a.slx', { dataDictionary: 'shared.sldd' }),
      src('b.slx', { dataDictionary: 'shared.sldd' }),
      src('shared.sldd'),
    ]);
    const roots = topRoots(g);
    expect(labels(roots)).toEqual(['a.slx', 'b.slx']); // shared is referenced, not a root
    for (const modelLabel of ['a.slx', 'b.slx']) {
      const m = byLabel(roots, modelLabel);
      const ext = byLabel(g.children(m), 'External Data');
      expect(labels(g.children(ext))).toEqual(['shared.sldd']);
    }
  });

  it('expands a referenced dictionary’s own sldd refs under a model’s External Data', () => {
    const g = new RelGraph([
      src('m.slx', { dataDictionary: 'parent.sldd' }),
      src('parent.sldd', { slddRefs: ['base.sldd'] }),
      src('base.sldd'),
    ]);
    const m = byLabel(topRoots(g), 'm.slx');
    const ext = byLabel(g.children(m), 'External Data');
    const parent = byLabel(g.children(ext), 'parent.sldd');
    expect(parent.kind).toBe('sldd');
    expect(parent.hasChildren).toBe(true);
    expect(labels(g.children(parent))).toEqual(['base.sldd']);
  });
});

describe('RelGraph External Data group internals', () => {
  it('lists the linked dictionary before other data sources', () => {
    const g = new RelGraph([
      src('m.slx', { dataDictionary: 'primary.sldd', dataSources: ['a.mat', 'b.sldd'] }),
      src('primary.sldd'),
      src('a.mat'),
      src('b.sldd'),
    ]);
    const m = byLabel(topRoots(g), 'm.slx');
    const ext = byLabel(g.children(m), 'External Data');
    // dataDictionary is prepended, then dataSources in order.
    expect(labels(g.children(ext))).toEqual(['primary.sldd', 'a.mat', 'b.sldd']);
  });

  it('shows unresolved external data as a missing node', () => {
    const g = new RelGraph([src('m.slx', { dataSources: ['gone.mat'] })]);
    const m = byLabel(topRoots(g), 'm.slx');
    const ext = byLabel(g.children(m), 'External Data');
    const gone = byLabel(g.children(ext), 'gone.mat');
    expect(gone.kind).toBe('missing');
  });

  it('terminates a model->dictionary->...->model style cycle through External Data', () => {
    // model m references dict d; d has no back-ref, so no cycle. Instead test a
    // model self-referenced via data sources pointing back to an ancestor model.
    const g = new RelGraph([
      src('root.slx', { modelRefs: ['m.slx'] }),
      src('m.slx', { dataSources: ['root.slx'] }), // data source resolves to an ancestor model
    ]);
    const root = byLabel(topRoots(g), 'root.slx');
    const m = byLabel(g.children(root), 'm.slx');
    const ext = byLabel(g.children(m), 'External Data');
    const rootAgain = byLabel(g.children(ext), 'root.slx');
    expect(rootAgain.cycle).toBe(true);
    expect(g.children(rootAgain)).toEqual([]);
  });
});

describe('RelGraph.resolve', () => {
  it('resolves by basename, case-insensitively, ignoring directories', () => {
    const g = new RelGraph([src('sub/dir/Thing.SLDD')]);
    expect(g.resolve('thing.sldd')).toEqual(['file:///sub/dir/Thing.SLDD']);
    expect(g.resolve('OTHER/Thing.sldd')).toEqual(['file:///sub/dir/Thing.SLDD']);
  });

  it('returns all files sharing a basename (collision)', () => {
    const g = new RelGraph([src('a/dup.sldd'), src('b/dup.sldd')]);
    expect(g.resolve('dup.sldd').sort()).toEqual(['file:///a/dup.sldd', 'file:///b/dup.sldd']);
  });

  it('returns [] for an unknown reference', () => {
    const g = new RelGraph([src('a.sldd')]);
    expect(g.resolve('missing.sldd')).toEqual([]);
  });

  it('nests a referenced file under BOTH parents when a basename collides', () => {
    const g = new RelGraph([
      src('top.sldd', { slddRefs: ['dup.sldd'] }),
      src('a/dup.sldd'),
      src('b/dup.sldd'),
    ]);
    const top = byLabel(topRoots(g), 'top.sldd');
    // Both collision targets appear as children.
    expect(labels(g.children(top))).toEqual(['dup.sldd', 'dup.sldd']);
  });
});

describe('RelGraph project relationships', () => {
  it('groups project member files under a project group', () => {
    const g = new RelGraph([
      src('proj/MyProj/MyProj.prj'),
      src('proj/MyProj/top.slx', { modelRefs: ['plant.slx'] }),
      src('proj/MyProj/plant.slx'),
    ]);
    const roots = g.roots();
    expect(labels(roots)).toEqual(['MyProj']);
    const proj = byLabel(roots, 'MyProj');
    expect(proj.groupKind).toBe('project');
    // top.slx is the group root; plant.slx nests under it (referenced in-group).
    expect(labels(g.children(proj))).toEqual(['top.slx']);
    const top = byLabel(g.children(proj), 'top.slx');
    expect(labels(g.children(top))).toEqual(['plant.slx']);
  });
});

describe('RelGraph node identity', () => {
  it('carries uriString on resolved nodes and omits it on missing nodes', () => {
    const g = new RelGraph([src('top.sldd', { slddRefs: ['real.sldd', 'ghost.sldd'] }), src('real.sldd')]);
    const kids = g.children(byLabel(topRoots(g), 'top.sldd'));
    expect(byLabel(kids, 'real.sldd').uriString).toBe('file:///real.sldd');
    expect(byLabel(kids, 'ghost.sldd').uriString).toBeUndefined();
  });

  it('does not treat a mat with (spurious) refs as expandable', () => {
    // Defensive: even if a mat somehow carries refs, mats have no children.
    const g = new RelGraph([src('x.mat', { slddRefs: ['y.sldd'] }), src('y.sldd')]);
    const x = byLabel(topRoots(g), 'x.mat');
    expect(x.hasChildren).toBe(false);
    expect(g.children(x)).toEqual([]);
  });
});

describe('RelGraph folder/project grouping', () => {
  // Helper: children of the group with the given label.
  const groupKids = (g: RelGraph, groupLabel: string) =>
    g.children(byLabel(g.roots(), groupLabel));

  it('roots() returns group headers, not files', () => {
    const g = new RelGraph([src('binary/top.slx'), src('binary/util.sldd')]);
    const roots = g.roots();
    expect(roots.every((r) => r.kind === 'group')).toBe(true);
    expect(labels(roots)).toEqual(['binary']);
    expect(byLabel(roots, 'binary').groupKind).toBe('folder');
  });

  it('always shows the header for a single-folder workspace', () => {
    const g = new RelGraph([src('only/a.slx')]);
    expect(labels(g.roots())).toEqual(['only']);
    expect(labels(groupKids(g, 'only'))).toEqual(['a.slx']);
  });

  it('places same-basename files in separate folder groups (no top-level dup)', () => {
    const g = new RelGraph([
      src('binary/top.slx'), src('binary/util.sldd'),
      src('text/top.slx'), src('text/util.sldd'),
    ]);
    expect(labels(g.roots())).toEqual(['binary', 'text']);
    expect(labels(groupKids(g, 'binary')).sort()).toEqual(['top.slx', 'util.sldd']);
    expect(labels(groupKids(g, 'text')).sort()).toEqual(['top.slx', 'util.sldd']);
  });

  it('resolves a reference to the same-folder file first', () => {
    const g = new RelGraph([
      src('binary/top.slx', { dataDictionary: 'util.sldd' }),
      src('binary/util.sldd'),
      src('text/top.slx', { dataDictionary: 'util.sldd' }),
      src('text/util.sldd'),
    ]);
    const binTop = byLabel(groupKids(g, 'binary'), 'top.slx');
    const binExt = byLabel(g.children(binTop), 'External Data');
    const binUtil = byLabel(g.children(binExt), 'util.sldd');
    expect(binUtil.uriString).toBe('file:///binary/util.sldd'); // not text/
  });

  it('falls back to a global match when no same-group file exists', () => {
    const g = new RelGraph([
      src('models/ctrl.slx', { dataDictionary: 'shared.sldd' }),
      src('data/shared.sldd'),
    ]);
    const ctrl = byLabel(groupKids(g, 'models'), 'ctrl.slx');
    const ext = byLabel(g.children(ctrl), 'External Data');
    const shared = byLabel(g.children(ext), 'shared.sldd');
    expect(shared.uriString).toBe('file:///data/shared.sldd');
  });

  it('makes a .prj its own project group of the scanned files under it', () => {
    const g = new RelGraph([
      src('project/MyProj/MyProj.prj'),
      src('project/MyProj/models/projmodel.slx'),
    ]);
    const roots = g.roots();
    expect(labels(roots)).toEqual(['MyProj']);
    expect(byLabel(roots, 'MyProj').groupKind).toBe('project');
    expect(labels(g.children(byLabel(roots, 'MyProj')))).toEqual(['projmodel.slx']);
  });

  it('shows an empty project group when it has only unscanned files', () => {
    // libfun.m is never scanned, so LibProj has no member sources.
    const g = new RelGraph([src('project/LibProj/LibProj.prj')]);
    const roots = g.roots();
    expect(labels(roots)).toEqual(['LibProj']);
    expect(byLabel(roots, 'LibProj').hasChildren).toBe(false);
    expect(g.children(byLabel(roots, 'LibProj'))).toEqual([]);
  });

  it('assigns a file to the longest-matching (nested) project root', () => {
    const g = new RelGraph([
      src('outer/Outer.prj'),
      src('outer/inner/Inner.prj'),
      src('outer/inner/deep.slx'),
    ]);
    expect(labels(g.children(byLabel(g.roots(), 'Inner')))).toEqual(['deep.slx']);
    expect(g.children(byLabel(g.roots(), 'Outer'))).toEqual([]);
  });

  it('orders project groups before folder groups, alphabetical within each', () => {
    const g = new RelGraph([
      src('zzz/z.slx'),
      src('aaa/a.slx'),
      src('proj/Beta/Beta.prj'),
      src('proj/Alpha/Alpha.prj'),
    ]);
    expect(labels(g.roots())).toEqual(['Alpha', 'Beta', 'aaa', 'zzz']);
  });

  it('a workspace-root .prj claims only root-level files, not subfolders', () => {
    const g = new RelGraph([
      src('Root.prj'),
      src('a.slx'),            // dir '' -> belongs to Root project
      src('sub/b.slx'),        // dir '/sub' -> its own folder group, NOT Root
    ]);
    expect(labels(g.children(byLabel(g.roots(), 'Root')))).toEqual(['a.slx']);
    expect(labels(g.roots())).toEqual(['Root', 'sub']); // 'sub' is a separate folder group
  });

  it('referencedUriStrings reflects scoped (same-group) resolution', () => {
    const g = new RelGraph([
      src('binary/top.slx', { dataDictionary: 'util.sldd' }),
      src('binary/util.sldd'),
      src('text/top.slx', { dataDictionary: 'util.sldd' }),
      src('text/util.sldd'),
    ]);
    const ref = g.referencedUriStrings();
    expect(ref.has('file:///binary/util.sldd')).toBe(true);
    expect(ref.has('file:///text/util.sldd')).toBe(true);
  });
});
