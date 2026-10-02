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
//
// R2026b added a format identified by NAME rather than by extension — `matlab.toml`, the whole
// definition of a project stored in the one file, with no `.prj` and no `resources/` beside it —
// so the list is now two lists and every pin below comes in two halves. The name half carries a
// hazard the extension half does not: `.toml` as an EXTENSION would admit every `Cargo.toml`,
// `pyproject.toml` and `ruff.toml` in a workspace as a MATLAB project, which is a wrong answer
// a user SEES (a tree row, an editor offer, a page that declares nothing), so the tests below
// pin the exclusion as hard as the inclusion.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isMatFile,
  isModelFile,
  isProjectFile,
  isSlddFile,
  isTomlProjectFile,
  projectFallbackName,
  projectNameOf,
  refModelExt,
  TOML_PROJECT_FILE,
} from 'data-explorer-core';
import {
  MODEL_EXTS,
  SUPPORTED_EXTS,
  SUPPORTED_NAMES,
  GRAPH_EXTS,
  SUPPORTED_GLOB,
  GRAPH_GLOB,
  isSupportedPath,
  isGraphPath,
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
    // A FLAT brace union of whole patterns for the supported glob, because a bare FILENAME
    // cannot be spelled inside a `*.{…}` suffix list — the `*.` prefix is outside the braces.
    // The graph glob keeps the nested form: it has no named marker to carry, deliberately.
    expect(SUPPORTED_GLOB).toBe('{**/*.sldd,**/*.mat,**/*.prj,**/*.slx,**/*.mdl,**/matlab.toml}');
    expect(GRAPH_GLOB).toBe('**/*.{sldd,mat,slx,mdl}');
    for (const ext of SUPPORTED_EXTS) expect(SUPPORTED_GLOB).toContain(`**/*.${ext}`);
    for (const name of SUPPORTED_NAMES) expect(SUPPORTED_GLOB).toContain(`**/${name}`);
    for (const ext of GRAPH_EXTS) expect(GRAPH_GLOB).toContain(ext);
  });

  it('carries the named project marker, and never as an extension', () => {
    // The hazard, pinned from both sides. In the glob by NAME, so a TOML-format project is
    // discovered at all; absent from SUPPORTED_EXTS, so a `.toml` suffix admits nothing — the
    // one-word edit that would make `Cargo.toml` a MATLAB project is adding it to that list.
    expect([...SUPPORTED_NAMES]).toEqual([TOML_PROJECT_FILE]);
    expect(SUPPORTED_EXTS as readonly string[]).not.toContain('toml');
    expect(SUPPORTED_GLOB).not.toContain('*.toml');
    // Not in the graph lists either: a project defines no variables and no parameter usages,
    // in any of its four formats.
    expect(GRAPH_EXTS as readonly string[]).not.toContain('toml');
    expect(GRAPH_GLOB).not.toContain('toml');
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

// The same seam for the half of the list identified by NAME. One row, and a table anyway, so
// that the next marker is a line here rather than a second way of asking the question.
const NAME_KINDS: ReadonlyArray<readonly [string, string, (p: string) => boolean]> = [
  [TOML_PROJECT_FILE, 'project', isTomlProjectFile],
];

describe('the named markers and core’s kind tests agree', () => {
  it('names a kind test for every supported name, and no name core alone knows', () => {
    expect(NAME_KINDS.map(([name]) => name).sort()).toEqual([...SUPPORTED_NAMES].sort());
  });

  it('classifies a marker found by name as a project, in any case', () => {
    for (const [name, kind, test] of NAME_KINDS) {
      // The PATH, because a name marker is only a marker in a folder: `isTomlProjectFile`
      // compares basenames, and every consumer here holds a path rather than a bare name.
      expect(test(`/w/MyProj/${name}`), `${name} must be a ${kind} definition`).toBe(true);
      expect(isProjectFile(`/w/MyProj/${name}`), `${name} must be a ${kind}`).toBe(true);
      expect(isProjectFile(`/w/MyProj/${name.toUpperCase()}`), `${name} is case-insensitive`).toBe(true);
      // Not any other kind, the same sweep the extension table makes: the marker reaching the
      // dictionary or model readers would be a text file handed to a zip parser.
      for (const other of [isSlddFile, isMatFile, isModelFile]) {
        expect(other(`/w/MyProj/${name}`), `${name} is a ${kind} and nothing else`).toBe(false);
      }
    }
  });

  it('claims no other .toml in the workspace, which is why this is a NAME', () => {
    // The wrong answer this design exists to prevent, and it is user-visible: a tree row, an
    // "open in Data Explorer" offer, and a project page reporting that Cargo declares nothing.
    for (const stray of ['/w/Cargo.toml', '/w/pyproject.toml', '/w/ruff.toml', '/w/matlab.toml.bak']) {
      expect(isProjectFile(stray), `${stray} must not be a project`).toBe(false);
      expect(isSupportedPath(stray), `${stray} must not be supported`).toBe(false);
    }
    // A folder NAMED matlab.toml is not one either — the test is the last segment of a path,
    // and a directory never reaches these predicates as one.
    expect(isProjectFile('/w/matlab.toml/readme.md')).toBe(false);
  });
});

// The reduction a project's NAME comes from, which R2026b split in two: the stem for a `.prj`,
// the parent FOLDER for a `matlab.toml`. Pinned here for the reason `projectNameOf` is below —
// core is a pinned dependency, and three host paths make this call (the project page, the
// tree's project-group label, and the name handed to `parseProject` for the tree), so a drift
// when the pin moves shows up as one project appearing under two names.
describe('projectFallbackName', () => {
  it('names a TOML project after the folder holding its definition', () => {
    expect(projectFallbackName(`/w/ABS_Model/${TOML_PROJECT_FILE}`)).toBe('ABS_Model');
    // Not the stem of the file: `matlab.toml` is the name in EVERY project of this format, so
    // a reduction of the filename titles all of them "matlab" (or leaves "matlab.toml" as the
    // page heading, which is what `projectNameOf` would have done here).
    expect(projectFallbackName(`/w/ABS_Model/${TOML_PROJECT_FILE}`)).not.toBe('matlab');
    expect(projectFallbackName(`/w/ABS_Model/${TOML_PROJECT_FILE}`)).not.toBe(TOML_PROJECT_FILE);
  });

  it('leaves a .prj exactly as projectNameOf had it', () => {
    expect(projectFallbackName('/w/MyProj/MyProj.prj')).toBe('MyProj');
    expect(projectFallbackName('/w/MyProj/My.Big.Project.PRJ')).toBe('My.Big.Project');
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

  it('supports every name in the name list, in any case', () => {
    for (const name of SUPPORTED_NAMES) {
      expect(isSupportedPath(`/w/MyProj/${name}`), `${name} must be supported`).toBe(true);
      expect(
        isSupportedPath(`/w/MyProj/${name.toUpperCase()}`),
        `${name} must be case-insensitive`,
      ).toBe(true);
    }
    // And it comes for free: `isSupportedPath` is a union of core's kind tests, and
    // `isProjectFile` is name-aware now, so nothing in that function mentions a name. This
    // test is what says the free answer is the RIGHT one — the consequence is that editing
    // `matlab.toml` in a text editor re-reads its tree row and badges it modified.
  });

  it('admits precisely the graph list to the usage and name graphs', () => {
    for (const ext of GRAPH_EXTS) {
      expect(isGraphPath(`/w/thing.${ext}`), `.${ext} must participate`).toBe(true);
    }
    // The one difference between the two questions, and the reason there are two: a
    // project is opened but contributes no variables and no parameter usages. True of a
    // project in EVERY format, which is why the named marker is tested here beside the `.prj`
    // rather than only in its own block.
    expect(isGraphPath('/w/proj.prj')).toBe(false);
    expect(isSupportedPath('/w/proj.prj')).toBe(true);
    for (const name of SUPPORTED_NAMES) {
      expect(isGraphPath(`/w/MyProj/${name}`), `${name} is not a graph participant`).toBe(false);
    }
    for (const ext of SUPPORTED_EXTS) {
      if (GRAPH_EXTS.includes(ext as never)) continue;
      expect(isGraphPath(`/w/thing.${ext}`), `.${ext} is not a graph participant`).toBe(false);
    }
  });
});

// The two name reductions this host used to make for itself, now core's — asserted here on
// the cases the local copies asserted, which is what said the copies could go.
//
// They stay for the same reason the kind tests above do: core is a PINNED dependency, so
// these are the consumer's side of a contract, and a consumer-side pin is the only kind
// that notices an upstream behaviour change when the pin moves. Core's own
// `test/fileKinds.test.ts` covers both functions more thoroughly, but it would be edited in
// the same commit that changed them; this file would not.
describe('model-name helpers', () => {
  it('completes a reference with the PARENT model’s own extension', () => {
    // A legacy hierarchy is legacy throughout: a .mdl model's references are .mdl
    // siblings, and labelling them .slx resolves to nothing. The same call completes
    // these names for core's own tree (ModelSectionNode.addReferenceEntry), which is
    // why keeping a second copy here was a second opinion about one string.
    expect(refModelExt('/w/legacy.mdl')).toBe('.mdl');
    expect(refModelExt('/w/modern.slx')).toBe('.slx');
    expect(refModelExt('/w/Legacy.MDL')).toBe('.mdl');
  });
});

// The other reduction, and the reason it is a function rather than two `replace` calls: one
// of its two callers labels a tree row with the answer and the other hands it to core's
// parser as the project's name. Those must be the same string for the same file, and there
// was nothing keeping them so until both asked core.
describe('projectNameOf', () => {
  it('takes the `.prj` off, in either case', () => {
    expect(projectNameOf('MyProj.prj')).toBe('MyProj');
    expect(projectNameOf('MyProj.PRJ')).toBe('MyProj');
  });

  it('keeps the rest of the name exactly as written', () => {
    // It is a LABEL: the case and the dots belong to whoever named the project.
    expect(projectNameOf('My.Big.Project.prj')).toBe('My.Big.Project');
    expect(projectNameOf('ABS_Model.PRJ')).toBe('ABS_Model');
  });

  it('leaves a name with no `.prj` alone', () => {
    // Both callers reach it having already decided the source is a project, so this arm
    // is defensive — but returning '' or null here would label a group with nothing.
    expect(projectNameOf('MyProj')).toBe('MyProj');
    expect(projectNameOf('')).toBe('');
  });

  it('strips only the LAST extension', () => {
    expect(projectNameOf('old.prj.bak')).toBe('old.prj.bak');
    expect(projectNameOf('renamed.prj.prj')).toBe('renamed.prj');
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
    // nameScan.ts is the kind DISPATCH the name index used to hold itself: which reader a
    // candidate's names come from. It moved out when the model read went through the shared
    // cache, and the scan has to follow it, not the file it left.
    'src/host/nameScan.ts',
    'src/host/structuralIndex.ts',
    'src/host/slxStructure.ts',
    'src/host/SlddModel.ts',
    'src/host/BinaryEditorProvider.ts',
    // graphModel.ts classifies nothing — it is handed a `type` already decided — but it
    // does REDUCE a name: a project group is labelled with its marker's name. That is the
    // same kind of second copy, so it is held to the same scan.
    'src/host/graphModel.ts',
    // projectStore.ts is where a name-identified marker arrives first: it decides, from the
    // marker alone, whether there is a `resources/project/` tree to walk or a single file to
    // read. That is a kind test and a name, so it belongs under the scan — a `endsWith('.prj')`
    // or a bare `'matlab.toml'` here would be the fifth copy of the rule, on the one path where
    // getting it wrong reads a project's definition from the wrong place entirely.
    'src/host/projectStore.ts',
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

  // A single extension anchored at the end, e.g. `/\.prj$/i` — the shape the alternation
  // above does not catch, because one extension is not an alternation. It is how the same
  // rule got written twice here: `graphModel` labelling a project group and
  // `structuralIndex` naming a project for core's parser each spelled
  // `basename(p).replace(/\.prj$/i, '')`, and a label a user reads has to agree with the
  // name the parser is told. Both now call core's `projectNameOf` — and this is what stops
  // a third copy from growing here, in either repo's absence of a shared test.
  const SINGLE_EXT_ANCHOR = new RegExp(`\\\\\\.(${SUPPORTED_EXTS.join('|')})\\$`, 'i');

  // A marker spelled out as a string, e.g. `'matlab.toml'` — the shape every check above
  // misses, because a NAME is not an extension and so appears in none of their forms.
  //
  // It is the quietest copy of all four. An extension literal at least looks like a rule; a
  // filename in a comparison looks like a filename, and there are now five host paths that
  // must agree about this one ('is this a project?', 'where is its definition?', 'what is it
  // called?', 'which view type opens it?', 'which key does core dispatch on?'). The failure is
  // not a missed file but a SPLIT: one path case-sensitive against a `MATLAB.TOML` the glob
  // found, so the same project is a tree row and not a project page. Both spellings come from
  // core — `TOML_PROJECT_FILE` for the string, `isTomlProjectFile` for the test — and the
  // constant exists so that this scan can be absolute about the literal.
  //
  // Case-insensitive on purpose, unlike the leak check's needle scan: there is no legitimate
  // `MATLAB.TOML` in this host's code, so the broader match costs nothing and catches the copy
  // most likely to be written by hand.
  const NAME_LITERAL = new RegExp(
    `(['"\`])(${SUPPORTED_NAMES.map((n) => n.replace(/\./g, '\\.')).join('|')})\\1`,
    'i',
  );

  for (const file of CONSUMERS) {
    it(`${file} names no glob or extension test of its own`, () => {
      const src = code(file);
      expect(GLOB_LITERAL.test(src), `${file} should use SUPPORTED_GLOB/GRAPH_GLOB`).toBe(false);
      expect(EXT_ALTERNATION.test(src), `${file} should use a shared matcher`).toBe(false);
      expect(ENDSWITH_EXT.test(src), `${file} should use one of core's kind tests`).toBe(false);
      expect(SINGLE_EXT_ANCHOR.test(src), `${file} should use a shared matcher or reducer`).toBe(false);
      expect(NAME_LITERAL.test(src), `${file} should use core's TOML_PROJECT_FILE`).toBe(false);
    });
  }

  it('the scan would catch a hand-written marker name', () => {
    // The scan's own test, because a regex asserting that something is ABSENT passes just as
    // well when it can match nothing at all — and this one is built at run time out of
    // SUPPORTED_NAMES, so a typo in the escaping is invisible from the results above.
    for (const name of SUPPORTED_NAMES) {
      expect(NAME_LITERAL.test(`if (base === '${name}') return true;`)).toBe(true);
      expect(NAME_LITERAL.test(`const marker = "${name.toUpperCase()}";`)).toBe(true);
      // And the escaping holds: a dot in the name is a dot, not "any character".
      expect(NAME_LITERAL.test(`'${name.replace('.', 'X')}'`)).toBe(false);
    }
    expect(NAME_LITERAL.test("const p = 'Cargo.toml';")).toBe(false);
  });

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

  it('routes both model containers through a core reader that sniffs the format', () => {
    // parseSlx on a `.mdl` throws "invalid zip data". Every model read must go through a
    // reader that decides from the BYTES — that is also what makes a mislabelled file
    // open instead of failing.
    //
    // TWO core readers qualify, and what they have in common is the point: `parseModel`
    // and `scanModelStructure` dispatch on the same ZIP magic in the same core module,
    // the second being the first narrowed to three relationship fields over a filtered
    // set of OPC parts. So slxStructure.ts reads models with the scanner and
    // nameScan.ts with the full parse — it needs block parameters, which the scanner
    // deliberately does not carry — and neither is choosing a format on this host's
    // behalf. What is barred is reaching PAST the sniff to a single-format reader.
    //
    // nameScan.ts, not nameIndex.ts: the name index's model read is the SHARED parse now
    // (sourceCache.parsedModelOf), and the only model read left in this repo outside that
    // one accessor is the buffer of an unsaved document, which nameScan owns.
    //
    // The usage graph's model read is no longer in this repo at all — it is core's
    // `buildUsageIndex`, which dispatches through the same `parseModel`. Pinning that
    // by scanning a file in node_modules would assert against a pinned artifact, so it
    // is pinned by BEHAVIOUR instead: test/usageEndToEnd.test.ts runs a classic
    // legacy_ctrl.mdl through the graph and expects its blocks, and parseSlx on a
    // `.mdl` throws rather than returning nothing.
    for (const file of ['src/host/nameScan.ts', 'src/host/slxStructure.ts']) {
      const src = code(file);
      expect(
        src.includes('parseModel') || src.includes('scanModelStructure'),
        `${file} must read models through parseModel or scanModelStructure`,
      ).toBe(true);
      expect(src, `${file} must not call parseSlx directly`).not.toContain('parseSlx');
      expect(src, `${file} must not call parseMdl directly`).not.toContain('parseMdl');
    }
  });
});
