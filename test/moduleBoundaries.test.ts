// Copyright 2026 The MathWorks, Inc.
//
// The shape of this extension, asserted rather than described.
//
// One `src/` is built into THREE bundles — the Node host (`dist/extension.js`), the
// browser web-extension host (`dist/web/extension.js`), and the vite webview — and the
// only thing separating them is which file imports what. Everything asserted here
// already holds; the point is that until this file, each was held by nothing but the
// habit of the people editing it, and none of the four fails where it was broken:
//
//   * `vscode` reached from the webview breaks at RUNTIME, in a browser panel
//   * a value import where a type import was silently drags host code into the webview
//   * a deep import into data-explorer-core breaks whenever that package moves a file
//   * a stale coverage exclude prints 98% while hiding a file nobody tests
//
// So they are asserted here, where the failure names the file and line. The companion
// file in the data-explorer-core repo does the same for the package upstream; the two
// share a walker and nothing else, because the invariants are not the same ones.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  readModuleGraph,
  runtimeCycles,
  runtimeEdges,
  describeEdges,
  blankCommentsAndKeepLines,
  type ModuleEdge,
} from './tools/moduleGraph.js';

const repo = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const graph = readModuleGraph(repo('src'));
const pkg = JSON.parse(readFileSync(repo('package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
};

const under = (dir: string, file: string): boolean => file === `${dir}.ts` || file.startsWith(`${dir}/`);

// A walker that silently read nothing would make every assertion below pass. Floors,
// not counts — they fail if the tree moves or the matcher stops matching, and are not
// meant to be bumped whenever a file is added.
describe('the walker is actually reading this tree', () => {
  it('finds the modules and the imports between them', () => {
    expect(graph.files.length).toBeGreaterThan(60);
    expect(graph.files).toContain('extension.ts');
    expect(runtimeEdges(graph).length).toBeGreaterThan(100);
  });

  it('sees the `type` keyword, which the layering tests depend on', () => {
    // Without this, the two layering tests below would fail QUIETLY rather than
    // loudly: they would report erased edges as violations. Pinned on a known pair —
    // `protocol.ts` names four host types and runs none of their code.
    const protocolToHost = graph.edges.filter((e) => e.from === 'common/protocol.ts' && e.to?.startsWith('host/'));
    expect(protocolToHost.length).toBeGreaterThan(0);
    expect(protocolToHost.every((e) => e.typeOnly)).toBe(true);
    const hostRuns = runtimeEdges(graph).filter((e) => under('host', e.from) && under('host', e.to));
    expect(hostRuns.length, 'and a real value edge still reads as one').toBeGreaterThan(0);
  });
});

describe('the runtime module graph is acyclic', () => {
  it('has no cycle a bundler could evaluate in the wrong order', () => {
    const cycles = runtimeCycles(graph).map((c) => c.join(' -> '));
    expect(cycles).toEqual([]);
  });
});

describe('`vscode` stays on the host side of the wall', () => {
  const vscodeImports = graph.edges.filter((e) => e.specifier === 'vscode');

  it('is imported only from host/ and the activation entry', () => {
    // There is no `vscode` module in a browser panel or in the vite webview bundle: the
    // API arrives by `acquireVsCodeApi()` over `postMessage`, which is what
    // `common/protocol.ts` exists to type. An `import * as vscode` that reaches the
    // webview resolves to nothing and the panel fails to load — a blank editor with a
    // console error, with no test between the edit and the user.
    expect(vscodeImports.length, 'the host must still use it').toBeGreaterThan(0);
    const strays = vscodeImports.filter((e) => !under('host', e.from) && e.from !== 'extension.ts');
    expect(describeEdges(strays)).toEqual([]);
  });

  it('never arrives transitively, through common/ or a host module the webview runs', () => {
    // The rule above is worth nothing on its own: `webview/` importing any host module
    // that itself imports `vscode` gets the same broken bundle without naming `vscode`
    // anywhere. `common/` is shared by both sides and so is held to the same line.
    //
    // Type-only reaches are fine and four exist, all in `common/protocol.ts` plus a
    // pair in `webview/`, which is why this filters on erasure and not on the import's
    // text. What it forbids is a value edge from the browser side into the host's.
    const upward = runtimeEdges(graph).filter(
      (e) => (under('webview', e.from) || under('common', e.from)) && under('host', e.to),
    );
    expect(describeEdges(upward)).toEqual([]);
  });

  it('and the host never depends on the webview at all, in either sense', () => {
    // Asymmetric on purpose: the browser side may NAME host types, because the messages
    // it exchanges are host-shaped. The host has no reason to reach the other way even
    // for a type — `common/` is where anything shared belongs — so this one admits no
    // type-only exemption, and is the cheap guard against `common/` being bypassed.
    const downward = graph.edges.filter((e) => under('host', e.from) && e.to && under('webview', e.to));
    expect(describeEdges(downward)).toEqual([]);
  });
});

describe('data-explorer-core is used only through its published entries', () => {
  it('is never deep-imported, in src/ or in either test tree', () => {
    // The repo rule, and the reason for it: this package is pinned as a git dependency
    // and inlined by esbuild, so a deep path like `data-explorer-core/src/datamodel/...`
    // both breaks the moment that repo moves a file and bypasses the barrel that is the
    // agreed contract — the same barrel `publicTypeSurface.test.ts` over there exists to
    // hold stable. Its `exports` map publishes exactly two entries and nothing else, so
    // a deep import is not merely discouraged, it is unresolvable in a consumer's build.
    //
    // Both test trees are included because a test is where the temptation actually
    // shows up: reaching past the barrel for an internal symbol is how a datamodel test
    // ends up in this repo instead of in core, which is where it belongs.
    const allowed = new Set(['data-explorer-core', 'data-explorer-core/node']);
    const offenders: ModuleEdge[] = [];
    for (const tree of ['src', 'test', 'test-integration']) {
      for (const edge of readModuleGraph(repo(tree)).edges) {
        if (edge.specifier.startsWith('data-explorer-core') && !allowed.has(edge.specifier)) {
          offenders.push({ ...edge, from: `${tree}/${edge.from}` });
        }
      }
    }
    expect(describeEdges(offenders)).toEqual([]);
  });
});

describe('every third-party import is a declared dependency', () => {
  it('names nothing an install would not provide', () => {
    // `vscode` is the one exception, and not an oversight: it is injected by the running
    // editor and marked external in both esbuild bundles, so declaring it as a
    // dependency would try to install a package that does not exist. Everything else
    // reaching node_modules must be in `dependencies` — a devDependency or a hoisted
    // transitive resolves here and then is simply absent from the packaged VSIX.
    const declared = new Set([...Object.keys(pkg.dependencies), 'vscode']);
    const packageOf = (spec: string) => (spec.startsWith('@') ? spec.split('/', 2).join('/') : spec.split('/')[0]);
    // `node:` builtins have their own test below; letting them fail this one too reports
    // a builtin as a missing package, which sends a reader to package.json instead of to
    // the import.
    const bare = graph.edges.filter((e) => !e.specifier.startsWith('.') && !e.specifier.startsWith('node:'));
    const undeclared = bare.filter((e) => !declared.has(packageOf(e.specifier)));
    expect(describeEdges(undeclared)).toEqual([]);
  });

  it('reaches for no node: builtin, which is what lets a web bundle exist at all', () => {
    // `build:web` bundles this same `src/` with esbuild's browser platform, so a builtin
    // anywhere reachable from `extension.ts` fails that build outright. The build is
    // therefore the real gate and this test does not replace it; it fails in the unit
    // suite in milliseconds with a file and a line, rather than as a resolve error at
    // the end of a full build, and it also covers modules the entry does not reach yet.
    const builtins = graph.edges.filter((e) => e.specifier.startsWith('node:'));
    expect(describeEdges(builtins)).toEqual([]);
  });
});

describe('the coverage exclude list matches the files it claims to', () => {
  // The list in vitest.config.ts carries an instruction to keep it in sync with
  // `grep -l "from 'vscode'" src/host/*.ts`, which is to say it was maintained by hand
  // against a rule nothing checked. Both directions of drift are silent and both
  // mislead in the same direction:
  //
  //   a vscode-importing file LEFT OFF reports a flat 0% and drags the headline down,
  //   which reads as "coverage is fine, that one file is just unmeasurable";
  //   a vscode-FREE file left ON is hidden from the report entirely, so a genuinely
  //   untested module raises the number instead of lowering it.
  //
  // The second is why this is worth a test rather than a tidier comment: it is the
  // failure that makes a coverage report lie about a real gap.
  const excluded: string[] = (() => {
    const config = blankCommentsAndKeepLines(readFileSync(repo('vitest.config.ts'), 'utf8'));
    const block = /exclude:\s*\[([\s\S]*?)\]/.exec(config);
    expect(block, 'vitest.config.ts still has a coverage exclude list').toBeTruthy();
    return [...block![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  })();

  const importsVscode = graph.files
    .filter((f) => under('host', f))
    .filter((f) => graph.edges.some((e) => e.from === f && e.specifier === 'vscode'));

  it('excludes every host file that imports vscode', () => {
    expect(importsVscode.length).toBeGreaterThan(0);
    const missing = importsVscode.filter((f) => !excluded.includes(`src/${f}`));
    expect(missing.map((f) => `src/${f}`)).toEqual([]);
  });

  it('excludes no host file that does NOT import vscode', () => {
    // Every entry has to earn its place. A file whose `vscode` import was refactored
    // away — the whole point of the nameIndex→nameExtract style split — becomes
    // measurable, and leaving it excluded throws away the coverage the split bought.
    const unearned = excluded
      .filter((p) => p.startsWith('src/host/') && !p.includes('*'))
      .filter((p) => !importsVscode.includes(p.replace(/^src\//, '')));
    expect(unearned).toEqual([]);
  });
});
