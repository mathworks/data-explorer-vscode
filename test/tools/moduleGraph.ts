// Copyright 2026 The MathWorks, Inc.
//
// Reads a source tree's import graph, keeping the ONE distinction the boundary tests
// are about: whether an edge survives compilation.
//
// `import type { X } from './y.js'` is erased by tsc — it constrains nothing at
// runtime, creates no load-order dependency, and pulls no bytes into a bundle.
// `import { x } from './y.js'` does all three. This extension is built as THREE
// bundles from one `src/` — the Node host, the browser web-extension host, and the
// vite webview — and the split between them is held by that difference alone:
// `src/common/protocol.ts` and `src/webview/` name host types with `import type`
// and so ship none of the host's code, though a maintainer dropping one `type`
// keyword would pull `vscode` into a browser bundle. A graph walker that cannot see
// the keyword cannot tell the safe reach from the fatal one, so this one is built
// around it.
//
// This file is a deliberate copy of the same walker in the data-explorer-core repo.
// It is MECHANISM, not a rule: the invariants it is pointed at differ per repo (see
// each repo's moduleBoundaries.test.ts), and the alternative — publishing a test
// helper from core's barrel — would widen that package's public surface to serve a
// test here, which this repo's notes forbid outright.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export interface ModuleEdge {
  /** Importing file, tree-relative, `/`-separated. */
  from: string;
  /** The specifier exactly as written. */
  specifier: string;
  /** Tree-relative path the specifier resolves to, or null when it leaves the tree. */
  to: string | null;
  /** True when tsc erases this edge: `import type`/`export type`. */
  typeOnly: boolean;
  /** 1-based line of the statement, so a failure names a place to look. */
  line: number;
}

export interface ModuleGraph {
  /** Every `.ts` file under the root, tree-relative. */
  files: string[];
  edges: ModuleEdge[];
}

// Comments have to go before anything is matched. This package's comments explain
// rules by QUOTING code, `export { a } from './b.js'` included, so a walker that reads
// raw text invents edges that no build ever sees. Blanking rather than deleting keeps
// every line number pointing at the real line.
export function blankCommentsAndKeepLines(src: string): string {
  const out = src.split('');
  let mode: 'code' | 'line' | 'block' | "'" | '"' | '`' = 'code';
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    const d = src[i + 1];
    if (mode === 'code') {
      // `\/\/` inside a regex literal is not a comment. Tracking regex literals
      // properly needs a parser; refusing an escaped slash costs nothing and is the
      // only way this misfires in practice.
      if (c === '/' && d === '/' && src[i - 1] !== '\\') {
        mode = 'line';
        out[i] = out[i + 1] = ' ';
        i += 2;
        continue;
      }
      if (c === '/' && d === '*') {
        mode = 'block';
        out[i] = out[i + 1] = ' ';
        i += 2;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') mode = c;
      i += 1;
      continue;
    }
    if (mode === 'line') {
      if (c === '\n') mode = 'code';
      else out[i] = ' ';
      i += 1;
      continue;
    }
    if (mode === 'block') {
      if (c === '*' && d === '/') {
        out[i] = out[i + 1] = ' ';
        mode = 'code';
        i += 2;
        continue;
      }
      if (c !== '\n') out[i] = ' ';
      i += 1;
      continue;
    }
    // Inside a string literal: only the matching quote closes it, and a backslash
    // escapes whatever follows (including that quote).
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === mode) mode = 'code';
    i += 1;
  }
  return out.join('');
}

// An import/export statement, cut at the first `;`. The cut is what makes this safe
// without a parser: a clause can span lines but never contains a semicolon, so a
// statement can never absorb the one after it and misattribute its specifier.
const STATEMENT = /(^|\n)[ \t]*(?:import|export)\b[^;]*;/g;
// A module specifier is only a specifier when a `from` introduces it, or when the whole
// statement is a bare side-effect `import`. Matching any trailing string literal instead
// reads `export default class PropName { static key = 'Name'` — cut at its first `;` —
// as an import of a package called `Name`, and then every "is this dependency declared"
// answer is noise.
const FROM_IMPORT = /^(?:import|export)\b([\s\S]*?)\bfrom\s*(['"])([^'"]+)\2\s*$/;
const BARE_IMPORT = /^import\s*(['"])([^'"]+)\1\s*$/;

function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}

/** Every `.ts` file under `root`, excluding declaration files, tree-relative. */
export function sourceFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) found.push(toPosix(relative(root, full)));
    }
  };
  walk(root);
  return found;
}

export function readModuleGraph(root: string): ModuleGraph {
  const files = sourceFiles(root);
  const known = new Set(files);
  const edges: ModuleEdge[] = [];

  for (const file of files) {
    const abs = join(root, file);
    const text = blankCommentsAndKeepLines(readFileSync(abs, 'utf8'));
    STATEMENT.lastIndex = 0;
    for (const match of text.matchAll(STATEMENT)) {
      const statement = match[0].trim().replace(/;$/, '');
      const withFrom = FROM_IMPORT.exec(statement);
      const bare = withFrom ? null : BARE_IMPORT.exec(statement);
      if (!withFrom && !bare) continue;
      const specifier = withFrom ? withFrom[3] : bare![2];
      // `type` LEADING the clause erases the whole statement. `import { type A, b }`
      // does not — `b` is a value, so the module is still loaded at runtime. A bare
      // side-effect import is always a runtime edge; that is all it is for.
      const typeOnly = withFrom !== null && /^type\b/.test(withFrom[1].trim());
      let to: string | null = null;
      if (specifier.startsWith('.')) {
        // TS writes `.js` in the specifier and means the `.ts` beside it.
        const base = toPosix(relative(root, resolve(dirname(abs), specifier))).replace(/\.js$/, '');
        to = [`${base}.ts`, `${base}/index.ts`].find((candidate) => known.has(candidate)) ?? null;
      }
      const line = text.slice(0, match.index).split('\n').length + (match[1] === '\n' ? 1 : 0);
      edges.push({ from: file, specifier, to, typeOnly, line });
    }
  }
  return { files, edges };
}

/** Edges that survive compilation and stay inside the tree. */
export function runtimeEdges(graph: ModuleGraph): Array<ModuleEdge & { to: string }> {
  return graph.edges.filter((e): e is ModuleEdge & { to: string } => !e.typeOnly && e.to !== null);
}

/**
 * Every distinct cycle in the runtime graph, each as the list of files in it. A cycle
 * here is a load-order hazard, not a style problem: whichever module the bundler
 * evaluates first sees the other's bindings uninitialised.
 */
export function runtimeCycles(graph: ModuleGraph): string[][] {
  const out = new Map<string, string[]>();
  for (const e of runtimeEdges(graph)) {
    const list = out.get(e.from) ?? [];
    list.push(e.to);
    out.set(e.from, list);
  }
  const cycles = new Map<string, string[]>();
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (node: string): void => {
    state.set(node, 1);
    stack.push(node);
    for (const next of out.get(node) ?? []) {
      if (state.get(next) === 1) {
        const cycle = stack.slice(stack.indexOf(next));
        cycles.set([...cycle].sort().join('|'), cycle);
      } else if (!state.has(next)) visit(next);
    }
    stack.pop();
    state.set(node, 2);
  };
  for (const file of graph.files) if (!state.has(file)) visit(file);
  return [...cycles.values()];
}

/** `path/to/file.ts:12` for every edge, so an assertion failure is actionable. */
export function describeEdges(edges: ModuleEdge[]): string[] {
  return edges.map((e) => `${e.from}:${e.line} -> ${e.specifier}`);
}
