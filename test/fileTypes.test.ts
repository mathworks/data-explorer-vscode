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
// These tests therefore check two things: that every consumer derives from the
// shared list, and that no consumer has quietly grown its own copy again.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MODEL_EXTS,
  SUPPORTED_EXTS,
  GRAPH_EXTS,
  SUPPORTED_RE,
  GRAPH_FILE_RE,
  MODEL_RE,
  SUPPORTED_GLOB,
  GRAPH_GLOB,
  isModelPath,
  stripModelExt,
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

describe('the derived matchers', () => {
  it('matches every supported extension and nothing else', () => {
    for (const ext of SUPPORTED_EXTS) {
      expect(SUPPORTED_RE.test(`/w/model.${ext}`), `.${ext} must be supported`).toBe(true);
    }
    expect(SUPPORTED_RE.test('/w/notes.txt')).toBe(false);
    expect(SUPPORTED_RE.test('/w/archive.zip')).toBe(false);
  });

  it('matches case-insensitively, so a .MDL from Windows is not skipped', () => {
    // The host's routing regex used to be case-SENSITIVE while the usage graph's
    // was not, so `Model.SLX` was a graph participant the editor router did not
    // recognise. These files live on case-insensitive filesystems.
    expect(SUPPORTED_RE.test('/w/Model.SLX')).toBe(true);
    expect(SUPPORTED_RE.test('/w/Legacy.MDL')).toBe(true);
    expect(GRAPH_FILE_RE.test('/w/Legacy.MDL')).toBe(true);
    expect(MODEL_RE.test('/w/Legacy.MDL')).toBe(true);
  });

  it('does not match an extension that merely appears mid-path', () => {
    // `**/*.{...}` anchors at the end; the regexes must agree, or the two
    // discovery paths disagree about the same file.
    expect(SUPPORTED_RE.test('/w/slx/readme.txt')).toBe(false);
    expect(MODEL_RE.test('/w/model.mdl.bak')).toBe(false);
  });

  it('recognises both model containers as models, and non-models as not', () => {
    expect(isModelPath('/w/ctrl.slx')).toBe(true);
    expect(isModelPath('/w/ctrl.mdl')).toBe(true);
    expect(isModelPath('/w/params.sldd')).toBe(false);
    expect(isModelPath('/w/signals.mat')).toBe(false);
    expect(isModelPath('/w/proj.prj')).toBe(false);
  });
});

describe('model-name helpers', () => {
  it('strips either container extension to the bare model name', () => {
    // The usage graph labels a model by this name and matches block paths against
    // it, so a `.mdl` left labelled `engine.mdl` would match nothing.
    expect(stripModelExt('engine.slx')).toBe('engine');
    expect(stripModelExt('engine.mdl')).toBe('engine');
    expect(stripModelExt('engine.MDL')).toBe('engine');
    // Not a model: left alone rather than half-stripped.
    expect(stripModelExt('params.sldd')).toBe('params.sldd');
  });

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

  for (const file of CONSUMERS) {
    it(`${file} names no glob or extension alternation of its own`, () => {
      const src = code(file);
      expect(GLOB_LITERAL.test(src), `${file} should use SUPPORTED_GLOB/GRAPH_GLOB`).toBe(false);
      expect(EXT_ALTERNATION.test(src), `${file} should use a shared matcher`).toBe(false);
    });
  }

  it('every consumer that discovers or routes files imports the shared module', () => {
    for (const file of CONSUMERS) {
      expect(read(file), `${file} must import from common/fileTypes`).toContain('fileTypes.js');
    }
  });

  it('routes both model containers through core’s format-sniffing parseModel', () => {
    // parseSlx on a `.mdl` throws "invalid zip data". Every model read must go
    // through parseModel, which decides from the BYTES — that is also what makes a
    // mislabelled file open instead of failing.
    for (const file of ['src/host/usageGraph.ts', 'src/host/nameIndex.ts', 'src/host/slxStructure.ts']) {
      const src = code(file);
      expect(src, `${file} must use parseModel`).toContain('parseModel');
      expect(src, `${file} must not call parseSlx directly`).not.toContain('parseSlx');
    }
  });
});
