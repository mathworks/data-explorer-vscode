// Copyright 2026 The MathWorks, Inc.
// Cross-format relationship graph rendered as an expansion tree. vscode-free so
// it can be unit-tested. The top level groups files by Simulink Project (.prj)
// or containing folder; within a group the existing relationship model applies.
import { refBasename } from './slddRefs.js';

export type SourceType = 'model' | 'sldd' | 'mat' | 'project';
export type NodeKind = SourceType | 'missing' | 'group';
export type GroupKind = 'external-data' | 'project' | 'folder';

// One workspace file plus its Tier-1 relationships (names, resolved by basename).
export interface GraphSource {
  uriString: string;
  path: string;              // fs-style path, for label + sorting + grouping
  type: SourceType;
  slddRefs: string[];        // sldd -> sldd
  modelRefs: string[];       // model -> model
  dataSources: string[];     // model -> sldd/mat (external data)
  dataDictionary: string | null; // model -> primary linked dictionary
  projectFiles?: string[];   // parsed .prj members (no longer used for the tree)
  projectRefs?: string[];    // parsed .prj references (no longer used for the tree)
}

export interface GraphNode {
  kind: NodeKind;
  uriString?: string;        // resolved real files; .prj uri for a project group
  label: string;
  ancestors: ReadonlySet<string>;
  cycle: boolean;
  hasChildren: boolean;      // expandable?
  groupKind?: GroupKind;     // set when kind === 'group'
  groupKey?: string;         // directory path identifying a project/folder group
}

const SYNTHETIC_EXTERNAL_DATA = 'External Data';

function basenameOf(path: string): string {
  return path.split('/').pop() ?? path;
}

function dirnameOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i <= 0 ? '' : path.slice(0, i);
}

interface Group {
  key: string;                 // directory path (prefix)
  kind: 'project' | 'folder';
  label: string;
  uriString?: string;          // .prj uri for project groups
  members: string[];           // uriStrings of scanned member sources
}

export class RelGraph {
  private readonly sources: Map<string, GraphSource>;
  private readonly byBasename = new Map<string, string[]>();
  private readonly groupOf = new Map<string, string>(); // source uri -> group key
  private readonly groups = new Map<string, Group>();

  constructor(sources: GraphSource[]) {
    this.sources = new Map(sources.map((s) => [s.uriString, s]));
    for (const s of sources) {
      const base = refBasename(s.path);
      const list = this.byBasename.get(base) ?? [];
      list.push(s.uriString);
      this.byBasename.set(base, list);
    }
    this.computeGroups(sources);
  }

  // Bucket every source into a project group (path under a .prj's directory) or
  // a folder group (its containing directory). Membership is by path, so
  // same-basename files in different folders never collide.
  private computeGroups(sources: GraphSource[]): void {
    // Project roots: the directory of each .prj. Sort longest-first so a nested
    // project claims files before its ancestor project does.
    const projectRoots = sources
      .filter((s) => s.type === 'project')
      .map((s) => ({
        dir: dirnameOf(s.path),
        label: basenameOf(s.path).replace(/\.prj$/i, ''),
        uriString: s.uriString,
      }))
      .sort((a, b) => b.dir.length - a.dir.length);

    // Every project gets a group, even with zero scanned members.
    // Invariant: at most one .prj per directory. If two exist in the same dir,
    // the first (by source order) defines the project group; the rest are ignored.
    for (const pr of projectRoots) {
      if (!this.groups.has(pr.dir)) {
        this.groups.set(pr.dir, {
          key: pr.dir, kind: 'project', label: pr.label,
          uriString: pr.uriString, members: [],
        });
      }
    }

    for (const s of sources) {
      if (s.type === 'project') continue; // .prj is a header, not a member
      const dir = dirnameOf(s.path);
      const proj = projectRoots.find((pr) =>
        dir === pr.dir || (pr.dir !== '' && dir.startsWith(pr.dir + '/'))
      );
      const key = proj ? proj.dir : dir;
      if (!this.groups.has(key)) {
        this.groups.set(key, { key, kind: 'folder', label: basenameOf(dir) || '/', members: [] });
      }
      this.groupOf.set(s.uriString, key);
      this.groups.get(key)!.members.push(s.uriString);
    }
  }

  resolve(ref: string): string[] {
    return this.byBasename.get(refBasename(ref)) ?? [];
  }

  // Resolve a reference preferring targets in the referrer's own group; fall back
  // to the global basename match when the group has none.
  private resolveScoped(ref: string, referrer: string | undefined): string[] {
    const all = this.resolve(ref);
    if (!referrer) return all;
    const g = this.groupOf.get(referrer);
    if (g == null) return all;
    const inScope = all.filter((t) => this.groupOf.get(t) === g);
    return inScope.length > 0 ? inScope : all;
  }

  // Outbound references that build the tree. projectFiles/projectRefs are
  // intentionally excluded — grouping is path-based, not project-definition-based.
  private outgoingRefs(s: GraphSource): string[] {
    return [
      ...s.slddRefs,
      ...s.modelRefs,
      ...s.dataSources,
      ...(s.dataDictionary ? [s.dataDictionary] : []),
    ];
  }

  // The set of sources pointed at by some reference, using scoped resolution.
  referencedUriStrings(): Set<string> {
    const referenced = new Set<string>();
    for (const s of this.sources.values()) {
      for (const ref of this.outgoingRefs(s)) {
        for (const t of this.resolveScoped(ref, s.uriString)) referenced.add(t);
      }
    }
    return referenced;
  }

  roots(): GraphNode[] {
    const groups = [...this.groups.values()].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'project' ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
    return groups.map((g) => this.toGroupNode(g));
  }

  private toGroupNode(g: Group): GraphNode {
    return {
      kind: 'group',
      groupKind: g.kind,
      groupKey: g.key,
      uriString: g.uriString,
      label: g.label,
      ancestors: new Set(),
      cycle: false,
      hasChildren: this.groupRoots(g).length > 0,
    };
  }

  // Members that nothing else in the SAME group references. Falls back to all
  // members when every member is referenced (a fully cyclic group).
  private groupRoots(g: Group): GraphSource[] {
    const referenced = new Set<string>();
    for (const uri of g.members) {
      const s = this.sources.get(uri)!;
      for (const ref of this.outgoingRefs(s)) {
        for (const t of this.resolveScoped(ref, uri)) {
          if (this.groupOf.get(t) === g.key) referenced.add(t);
        }
      }
    }
    const members = g.members.map((u) => this.sources.get(u)!)
      .sort((a, b) => a.path.localeCompare(b.path));
    const roots = members.filter((s) => !referenced.has(s.uriString));
    return roots.length > 0 ? roots : members;
  }

  children(node: GraphNode): GraphNode[] {
    if (node.kind === 'missing' || node.cycle) return [];

    if (node.kind === 'group') {
      if (node.groupKind === 'external-data') {
        const parent = node.uriString ? this.sources.get(node.uriString) : undefined;
        if (!parent) return [];
        return this.dataLinkChildren(parent, node.ancestors);
      }
      // project | folder group
      const g = node.groupKey != null ? this.groups.get(node.groupKey) : undefined;
      if (!g) return [];
      return this.groupRoots(g).map((s) => this.toNode(s, new Set()));
    }

    if (!node.uriString) return [];
    const src = this.sources.get(node.uriString);
    if (!src) return [];
    const path = new Set(node.ancestors);
    path.add(node.uriString);

    const children: GraphNode[] = [];
    if (src.type === 'model') {
      for (const ref of src.modelRefs) {
        children.push(...this.refToNodes(ref, path, src.uriString));
      }
      if (this.hasDataLinks(src)) {
        children.push({
          kind: 'group',
          groupKind: 'external-data',
          uriString: src.uriString, // carries parent id to compute its own children
          label: SYNTHETIC_EXTERNAL_DATA,
          ancestors: path,
          cycle: false,
          hasChildren: true,
        });
      }
    } else if (src.type === 'sldd') {
      for (const ref of src.slddRefs) {
        children.push(...this.refToNodes(ref, path, src.uriString));
      }
    }
    // project sources are never rendered as file nodes; mat: no children.
    return children;
  }

  private hasDataLinks(src: GraphSource): boolean {
    return src.dataSources.length > 0 || src.dataDictionary != null;
  }

  private dataLinkChildren(src: GraphSource, ancestors: ReadonlySet<string>): GraphNode[] {
    const path = new Set(ancestors);
    path.add(src.uriString);
    const names = [
      ...(src.dataDictionary ? [src.dataDictionary] : []),
      ...src.dataSources,
    ];
    const out: GraphNode[] = [];
    for (const ref of names) out.push(...this.refToNodes(ref, path, src.uriString));
    return out;
  }

  // Resolve a reference name to real node(s) or a single missing node.
  private refToNodes(ref: string, ancestors: ReadonlySet<string>, referrer: string | undefined): GraphNode[] {
    const targets = this.resolveScoped(ref, referrer);
    if (targets.length === 0) {
      return [{ kind: 'missing', label: ref, ancestors, cycle: false, hasChildren: false }];
    }
    return targets.map((t) => this.toNode(this.sources.get(t)!, ancestors));
  }

  private toNode(src: GraphSource, ancestors: ReadonlySet<string>): GraphNode {
    const cycle = ancestors.has(src.uriString);
    const hasChildren =
      !cycle &&
      (src.type === 'model'
        ? src.modelRefs.length > 0 || this.hasDataLinks(src)
        : src.type === 'sldd'
          ? src.slddRefs.length > 0
          : false);
    return {
      kind: src.type,
      uriString: src.uriString,
      label: basenameOf(src.path),
      ancestors,
      cycle,
      hasChildren,
    };
  }
}
