// Copyright 2026 The MathWorks, Inc.
//
// The supported-extension list is one rule with many consumers, which is the bug
// class this repo keeps hitting. Before src/common/fileTypes.ts it was written out
// six times — the host's routing regex, the file-system watcher's glob, the
// sections tree's findFiles glob, the usage graph's regex AND its glob, and the
// name index's glob — plus the customEditors selector in package.json.
//
// Adding `.mdl` is exactly the change that exposes how bad that is, because every
// miss fails QUIETLY and differently:
//   - miss the tree's glob        → the file opens, but never appears in the tree
//   - miss the watcher's glob     → it appears, but goes stale when edited on disk
//   - miss the usage graph's glob → it appears, but its parameters look unused
//   - miss the name index's glob  → it appears, but search cannot find its entries
// No single feature test covers all four, so the guard has to be the list itself.
//
// The list is now only HALF the rule. WHICH KIND a file is belongs to core, which
// publishes `isModelFile`/`isSlddFile`/`isMatFile`/`isProjectFile` and dispatches its
// own parsers on them; this host asks core rather than keeping a second opinion about
// whether `Params.SLDD` is a dictionary. What is left here is the extension LIST, for
// the two things only vscode needs it for: a `findFiles` glob and the `package.json`
// selector.
//
// Splitting the rule that way creates the failure this file has to catch, because the
// halves are not independent:
//   - in the list, in none of core's tests → discovered, then classified as nothing
//   - in core's tests, absent from the list → never discovered at all
// Neither half can see the other, so this is the only place that agreement is
// checkable, and it is pinned in BOTH directions below. The scan at the bottom then
// covers the third case: a consumer that quietly grows its own copy of either half.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMatFile, isModelFile, isProjectFile, isSlddFile } from 'data-explorer-core';
import {
  MODEL_EXTS,
  SUPPORTED_EXTS,
  GRAPH_EXTS,
  SUPPORTED_GLOB,
  GRAPH_GLOB,
  isSupportedPath,
  isGraphPath,
  refModelExt,
} from '../src/common/fileTypes.js';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('the shared extension list', () => {
  it('treats .mdl as a model alongside .slx', () => {
    expect([...MODEL_EXTS]).toEqual(['slx', 'mdl']);
  });

  it('includes both model containers in the supported and graph lists', () => {
    for (const ext of MODEL_EXTS) {
      expect(SUPPORTED_EXTS, `${ext} must be a supported format`).toContain(ext);
      expect(GRAPH_EXTS, `${ext} must participate in the usage graph`).toContain(ext);
    }
  });

  it('keeps .prj out of the graph list, since it defines no variables', () => {
    expect(SUPPORTED_EXTS).toContain('prj');
    expect(GRAPH_EXTS).not.toContain('prj');
  });

  it('derives globs that name every extension in their list', () => {
    expect(SUPPORTED_GLOB).toBe('**/*.{sldd,mat,prj,slx,mdl}');
    expect(GRAPH_GLOB).toBe('**/*.{sldd,mat,slx,mdl}');
    for (const ext of SUPPORTED_EXTS) expect(SUPPORTED_GLOB).toContain(ext);
    for (const ext of GRAPH_EXTS) expect(GRAPH_GLOB).toContain(ext);
  });
});

// The seam. Every extension this host discovers is claimed by exactly one of core's
// kind tests, and every kind test's extension is discoverable — the two halves of one
// rule, checked against each other because nothing else can.
const KINDS: ReadonlyArray<readonly [string, string, (p: string) => boolean]> = [
  ['sldd', 'dictionary', isSlddFile],
  ['mat', 'MAT-file', isMatFile],
  ['prj', 'project', isProjectFile],
  ['slx', 'model', isModelFile],
  ['mdl', 'model', isModelFile],
];

describe('the list and core’s kind tests agree', () => {
  it('names a kind test for every supported extension, and no extension core alone knows', () => {
    // Set equality, in both directions, and the reason this table is written out by
    // hand: adding a format to SUPPORTED_EXTS without saying which of core's tests
    // claims it fails HERE, where the answer is cheap, rather than as a file that
    // appears in the tree and then renders as nothing. And a kind test that core grows
    // (say `.slxp`) is only reachable once its extension joins the list.
    expect([...new Set(KINDS.map(([ext]) => ext))].sort()).toEqual([...SUPPORTED_EXTS].sort());
  });

  it('classifies every supported extension as exactly its own kind', () => {
    for (const [ext, kind, test] of KINDS) {
      expect(test(`/w/thing.${ext}`), `.${ext} must be a ${kind}`).toBe(true);
      for (const [otherExt, otherKind, otherTest] of KINDS) {
        if (otherKind === kind) continue;
        expect(otherTest(`/w/thing.${ext}`), `.${ext} is not a ${otherKind}`).toBe(false);
        expect(test(`/w/thing.${otherExt}`), `.${otherExt} is not a ${kind}`).toBe(false);
      }
    }
  });

  it('classifies an upper-cased name, which is why the tests are core’s', () => {
    // `Params.SLDD` is found by SUPPORTED_GLOB, so a classifier that is stricter than
    // the glob accepts the file and then does nothing with it: no variables in the
    // graph, the wrong row builder, and a skip past the editable-JSON redirect into
    // the read-only view. Every copy this host used to keep was case-SENSITIVE; core's
    // are not, and there is now one of them.
    for (const [ext, kind, test] of KINDS) {
      expect(test(`/w/Thing.${ext.toUpperCase()}`), `.${ext.toUpperCase()} must be a ${kind}`).toBe(true);
    }
  });

  it('anchors at the end, so the globs and the kind tests admit the same files', () => {
    // `**/*.{...}` matches the end of the name only; a kind test that did not would
    // classify files discovery never offers, and the disagreement would surface as a
    // routing decision made for a file nothing else in the host knows about.
    expect(isSlddFile('/w/params.slddx')).toBe(false);
    expect(isMatFile('/w/notes.material')).toBe(false);
    expect(isModelFile('/w/model.mdl.bak')).toBe(false);
    expect(isSupportedPath('/w/slx/readme.txt')).toBe(false);
  });
});

describe('the host’s two routing questions', () => {
  it('supports precisely the extensions in the supported list', () => {
    for (const ext of SUPPORTED_EXTS) {
      expect(isSupportedPath(`/w/thing.${ext}`), `.${ext} must be supported`).toBe(true);
      expect(isSupportedPath(`/w/Thing.${ext.toUpperCase()}`), `.${ext} must be case-insensitive`).toBe(true);
    }
    expect(isSupportedPath('/w/notes.txt')).toBe(false);
    expect(isSupportedPath('/w/archive.zip')).toBe(false);
  });

  it('admits precisely the graph list to the usage and name graphs', () => {
    for (const ext of GRAPH_EXTS) {
      expect(isGraphPath(`/w/thing.${ext}`), `.${ext} must participate`).toBe(true);
    }
    // The one difference between the two questions, and the reason there are two: a
    // project is opened but contributes no variables and no parameter usages.
    expect(isGraphPath('/w/proj.prj')).toBe(false);
    expect(isSupportedPath('/w/proj.prj')).toBe(true);
    for (const ext of SUPPORTED_EXTS) {
      if (GRAPH_EXTS.includes(ext as never)) continue;
      expect(isGraphPath(`/w/thing.${ext}`), `.${ext} is not a graph participant`).toBe(false);
    }
  });
});

describe('model-name helpers', () => {
  it('completes a reference with the PARENT model’s own extension', () => {
    // A legacy hierarchy is legacy throughout: a .mdl model's references are .mdl
    // siblings, and labelling them .slx resolves to nothing. Mirrors core's
    // ModelSectionNode.addReferenceEntry.
    expect(refModelExt('/w/legacy.mdl')).toBe('.mdl');
    expect(refModelExt('/w/modern.slx')).toBe('.slx');
    expect(refModelExt('/w/Legacy.MDL')).toBe('.mdl');
  });
});

// The scan. A stray literal is not a style problem: it is a second copy of the
// list that will not be updated next time a format is added.
describe('no consumer keeps its own copy of the list', () => {
  const CONSUMERS = [
    'src/extension.ts',
    'src/host/SectionsTreeProvider.ts',
    'src/host/usageGraph.ts',
    // usageCells.ts is deliberately NOT here: it neither discovers nor classifies a
    // file. It hands core's `buildUsageIndex` the bytes usageGraph.ts read, and core
    // dispatches on the filename with its own (case-insensitive) kind tests — so a
    // rule about this extension's globs and predicates has nothing to say about it.
    'src/host/nameIndex.ts',
    'src/host/structuralIndex.ts',
    'src/host/slxStructure.ts',
    'src/host/SlddModel.ts',
    'src/host/BinaryEditorProvider.ts',
  ];

  // Comments are stripped before scanning. A comment that mentions the old literal,
  // or explains why parseSlx is the wrong call here, is documentation — not a second
  // copy of the rule. Only code counts, or the guard would punish the explanations
  // that make these decisions legible.
  const code = (p: string) =>
    read(p)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');

  // A brace glob listing extensions, e.g. `**/*.{sldd,mat,slx}`.
  const GLOB_LITERAL = /\*\*\/\*\.\{[a-z,]+\}/;
  // An extension alternation regex, e.g. /\.(slx|sldd|mat)$/ — two or more
  // extensions ORed together and anchored at the end.
  const EXT_ALTERNATION = /\\\.\([a-z|]+\)\$/;

  // A hand-rolled kind test, e.g. `path.endsWith('.sldd')`. This is the copy that got
  // written eight times, and the one whose failure is quietest: it is case-SENSITIVE,
  // so it disagrees with every glob above about a file MATLAB or Windows named
  // `Params.SLDD` — the file is discovered, opened, indexed, and then classified as
  // nothing. Ask core: isSlddFile/isMatFile/isProjectFile/isModelFile.
  const ENDSWITH_EXT = new RegExp(`endsWith\\((['"])\\.(${SUPPORTED_EXTS.join('|')})\\1\\)`, 'i');

  for (const file of CONSUMERS) {
    it(`${file} names no glob or extension test of its own`, () => {
      const src = code(file);
      expect(GLOB_LITERAL.test(src), `${file} should use SUPPORTED_GLOB/GRAPH_GLOB`).toBe(false);
      expect(EXT_ALTERNATION.test(src), `${file} should use a shared matcher`).toBe(false);
      expect(ENDSWITH_EXT.test(src), `${file} should use one of core's kind tests`).toBe(false);
    });
  }

  it('every consumer that discovers or routes files takes the rule from a shared module', () => {
    // Either source counts, because the rule now lives in two places on purpose: the
    // extension LIST here (globs, manifest) and the kind tests in core. A consumer
    // that needs only to classify — SlddModel, structuralIndex, BinaryEditorProvider —
    // imports core alone and never mentions the list, which is correct. What must not
    // happen is a consumer deriving the rule from neither, and that is what the
    // literal scan above and this check bracket between them.
    for (const file of CONSUMERS) {
      const src = read(file);
      expect(
        src.includes('fileTypes.js') || src.includes("'data-explorer-core'"),
        `${file} must take its globs from common/fileTypes or its kind tests from core`,
      ).toBe(true);
    }
  });

  it('routes both model containers through core’s format-sniffing parseModel', () => {
    // parseSlx on a `.mdl` throws "invalid zip data". Every model read must go
    // through parseModel, which decides from the BYTES — that is also what makes a
    // mislabelled file open instead of failing.
    //
    // The usage graph's model read is no longer in this repo at all — it is core's
    // `buildUsageIndex`, which dispatches through the same `parseModel`. Pinning that
    // by scanning a file in node_modules would assert against a pinned artifact, so it
    // is pinned by BEHAVIOUR instead: test/usageEndToEnd.test.ts runs a classic
    // legacy_ctrl.mdl through the graph and expects its blocks, and parseSlx on a
    // `.mdl` throws rather than returning nothing.
    for (const file of ['src/host/nameIndex.ts', 'src/host/slxStructure.ts']) {
      const src = code(file);
      expect(src, `${file} must use parseModel`).toContain('parseModel');
      expect(src, `${file} must not call parseSlx directly`).not.toContain('parseSlx');
    }
  });
});
