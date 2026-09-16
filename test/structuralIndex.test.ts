// Copyright 2026 The MathWorks, Inc.
//
// The shaper, over the input it actually ships with.
//
// `buildGraphSource` takes ARTIFACTS — a model's `SlxStructure`, a dictionary's raw reference
// list, a project's store — and never bytes. It used to accept bytes as well and re-derive from
// them, and no production caller ever passed any: `graphSourcesOf` is the only caller and it
// fills the artifact fields off the shared cheap tier. So these tests run the extraction at the
// CALL SITE, with the same functions the cheap tier calls, which is exactly what the production
// caller does — a test driving a branch nothing ships is a test that cannot fail for a user.
//
// Two things therefore no longer belong to this file and have moved rather than gone: whether an
// extraction TOLERATES a file it cannot read (that is the extraction's own property, or the
// cheap tier's `catch`), and the format sniff that decides how a dictionary's bytes are read.
// Both are asserted below through `graphSourcesOf`, over an in-memory folder, because that is
// where they hold in production.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { SUPPORTED_EXTS } from '../src/common/fileTypes.js';
import type { GraphSource, SourceType } from '../src/host/graphModel.js';
import { scanSldd } from '../src/host/slddContent.js';
import { extractSlxStructure } from '../src/host/slxStructure.js';
import { newSourceCache, sourceKind, type SourceFile } from '../src/host/sourceCache.js';
import {
  buildGraphSource,
  graphSourcesOf,
  type GraphReader,
  type RawFile,
} from '../src/host/structuralIndex.js';

function fixture(name: string): ArrayBuffer {
  const b = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

const toArrayBuffer = (u8: Uint8Array): ArrayBuffer =>
  u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

/**
 * A model as its consumer hands it over: the path, and the structure extracted for it.
 *
 * `extractSlxStructure` is called HERE, on the way in, because that is where production calls
 * it — `cheapOf` runs it to build the artifact and `graphSourcesOf` passes the artifact along.
 * The path goes to both, and it has to be the same one: a model completes a bare reference with
 * its OWN container's extension (`refModelExt`), so extracting under a different name than the
 * node is built with would name different reference files.
 */
function modelFile(name: string): RawFile {
  const path = `/${name}`;
  return { uriString: `file:///${name}`, path, structure: extractSlxStructure(fixture(name), path) };
}

/**
 * A dictionary as its consumer hands it over: the path, and the references read off its bytes.
 *
 * `scanSldd` is the one extraction, for either on-disk format, and it is what the cheap tier
 * calls (`dataCheapOf` in sourceCache.ts). It THROWS on a dictionary it cannot read, where the
 * regex this used to run over textual bytes answered an empty list — so the tolerance case is
 * asserted through `pass()` below, which is the route that catches in production.
 */
function slddFile(name: string, bytes: ArrayBuffer): RawFile {
  return { uriString: `file:///${name}`, path: `/${name}`, slddRefs: scanSldd(bytes).refs };
}

// A real compressed .sldd: the zip layout parseBinarySldd reads, carrying only
// what the reference scan needs. Built here rather than checked in as a fixture
// so the reference list is visible next to the assertion.
function binarySlddBytes(refs: string[]): ArrayBuffer {
  const objects = refs
    .map((r) => `<Object Class="DD.DICTIONARYREFERENCE"><P Name="Subdictionary">${r}</P></Object>`)
    .join('');
  const xml = `<?xml version="1.0"?><DataSource FormatVersion="1">${objects}</DataSource>`;
  return toArrayBuffer(zipSync({ 'data/chunk0.xml': strToU8(xml) }));
}

/**
 * A textual dictionary, in the shape MATLAB actually writes one.
 *
 * The three-key wrapper is not decoration: a textual `.sldd` carries its content under
 * `__MW_TEXT_PARTS__ -> __MW_TEXT_PART__/data/chunk0 -> __MW_TEXT_content`, which is where core's
 * reader looks for `entries` and `Dictionary References` (`slddChunkContent`), and every real
 * fixture in this folder has it. This helper used to write the field at the TOP level, which the
 * retired regex found because it searched the raw text for the key wherever it sat — so the
 * helper was building a file no dictionary is, and the assertion below passed on it. Reading a
 * dictionary the way production reads one means the fixture has to be one.
 */
const jsonSlddBytes = (refs: unknown[]): ArrayBuffer =>
  toArrayBuffer(
    new TextEncoder().encode(
      JSON.stringify({
        __MW_TEXT_PARTS__: {
          '__MW_TEXT_PART__/data/chunk0': {
            __MW_TEXT_content: { entries: [], 'Dictionary References': refs },
          },
        },
      }),
    ),
  );

/**
 * One pass of the production entry point over an in-memory folder.
 *
 * `path -> bytes`, with `null` for a file the reader cannot answer for. A fresh cache per call,
 * so each test is one cold pass; what the cache SAVES on a second pass is treeSources.test.ts's
 * subject, not this file's. No project store — the `.prj` branch is driven directly below,
 * where the store can be written out beside the assertion.
 */
async function pass(folder: ReadonlyMap<string, ArrayBuffer | null>): Promise<GraphSource[]> {
  const files: SourceFile[] = [...folder.keys()].map((path) => ({ uriString: `file://${path}`, path }));
  const reader: GraphReader = {
    version: async (f) => `v1:${f.path}`,
    bytes: async (f) => folder.get(f.path) ?? null,
    projectStore: async () => null,
  };
  return graphSourcesOf(newSourceCache(), reader, files);
}

const sourceFor = (sources: readonly GraphSource[], path: string): GraphSource => {
  const found = sources.find((s) => s.path === path);
  if (!found) throw new Error(`${path} is not in the graph at all`);
  return found;
};

describe('buildGraphSource', () => {
  it('extracts model relationships from an .slx', () => {
    const s = buildGraphSource(modelFile('model_with_refs.slx'));
    expect(s.type).toBe('model');
    expect(s.modelRefs).toContain('plant.slx');
    expect(s.dataDictionary).toBe('params.sldd');
    expect(s.dataSources).toContain('signals.mat');
  });

  it('maps every field of a model structure onto the node, and nothing else', () => {
    // The mapping itself, which is what is left in this branch once the extraction moved out:
    // three fields renamed (`modelReferences` -> `modelRefs`, `externalDataSources` ->
    // `dataSources`) and one carried through. A branch that dropped one of them would leave the
    // node looking complete — an empty list is what a model with no such relationship has — so
    // the structure here has all three populated.
    const structure = {
      dataDictionary: 'd.sldd',
      modelReferences: ['a.slx', 'b.mdl'],
      externalDataSources: ['s.mat'],
    };
    const s = buildGraphSource({ uriString: 'file:///m.slx', path: '/m.slx', structure });
    expect(s.modelRefs).toEqual(['a.slx', 'b.mdl']);
    expect(s.dataSources).toEqual(['s.mat']);
    expect(s.dataDictionary).toBe('d.sldd');
    // And the dictionary field a model never fills stays empty rather than borrowing one.
    expect(s.slddRefs).toEqual([]);
  });

  it('copies the structure it was handed, so a consumer cannot rewrite the artifact', () => {
    // The lists arrive from the CACHE, so they are the very arrays every later build and every
    // other consumer reads. A `.sort()` for display would corrupt them permanently: no
    // `mtime:size` can notice a mutated artifact, so it survives every rebuild until the file
    // itself changes. treeSources.test.ts pins this over a real cache; here it is the copy.
    const structure = {
      dataDictionary: 'd.sldd',
      modelReferences: ['b.slx', 'a.slx'],
      externalDataSources: ['s.mat'],
    };
    const s = buildGraphSource({ uriString: 'file:///m.slx', path: '/m.slx', structure });
    s.modelRefs.sort();
    s.dataSources.length = 0;
    expect(structure.modelReferences).toEqual(['b.slx', 'a.slx']);
    expect(structure.externalDataSources).toEqual(['s.mat']);
  });

  it('treats a compressed .sldd as an sldd node with no references', () => {
    // This fixture declares none; a compressed .sldd that DOES is covered below.
    const s = buildGraphSource(slddFile('compressed.sldd', fixture('compressed.sldd')));
    expect(s.type).toBe('sldd');
    expect(s.slddRefs).toEqual([]);
  });

  it('extracts dictionary references from a COMPRESSED .sldd, not just a JSON one', () => {
    // The zip path reads the references out of a different shape than the text
    // path (the parsed binary content's __MW_TEXT_PARTS__ chunk, not a JSON
    // object). A binary dictionary whose refs came back empty would draw its
    // referenced dictionaries nowhere in the Sections tree even though the file
    // names them — the same file saved as JSON text would show them.
    const bytes = binarySlddBytes(['base.sldd', 'shared/common.sldd']);
    // The extraction, then the node built from it — the two halves the production caller does in
    // that order. Asserting the first is what stops this becoming a test of an empty list.
    expect(scanSldd(bytes).refs).toEqual(['base.sldd', 'shared/common.sldd']);
    const s = buildGraphSource(slddFile('bin.sldd', bytes));
    expect(s.type).toBe('sldd');
    expect(s.slddRefs).toEqual(['base.sldd', 'shared/common.sldd']);
  });

  it('copies the reference list it was handed, so a consumer cannot rewrite the artifact', () => {
    const slddRefs = ['b.sldd', 'a.sldd'];
    const s = buildGraphSource({ uriString: 'file:///d.sldd', path: '/d.sldd', slddRefs });
    s.slddRefs.sort();
    s.slddRefs.push('poisoned');
    expect(slddRefs).toEqual(['b.sldd', 'a.sldd']);
  });

  it('classifies a .mat as a mat node with no outbound refs', () => {
    // A MAT-file inherits nothing, so it has no artifact this shaper reads at all: the node is
    // its classification plus four empty relationship fields.
    const s = buildGraphSource({ uriString: 'file:///x.mat', path: '/x.mat' });
    expect(s.type).toBe('mat');
    expect(s.slddRefs).toEqual([]);
    expect(s.modelRefs).toEqual([]);
    expect(s.dataDictionary).toBeNull();
  });

  it('reads object-form references out of JSON .sldd bytes', () => {
    // A reference is a bare string in a compressed dictionary and may be an object carrying a
    // `file` field in a textual one (slddRefs.ts). Both forms in one file, so the node carries
    // the reduction rather than the raw JSON.
    const bytes = jsonSlddBytes([{ file: 'base.sldd' }, 'extra.sldd']);
    const s = buildGraphSource(slddFile('o.sldd', bytes));
    expect(s.slddRefs).toEqual(['base.sldd', 'extra.sldd']);
  });

  it('reads a JSON .sldd out of BYTES, not only a zip one', () => {
    // The format sniff, which is core's and is the first thing `scanSldd` decides: JSON text and
    // a zip archive both arrive here as an ArrayBuffer, and a caller that assumed zip would
    // report no references at all for every textual dictionary in the folder.
    const bytes = jsonSlddBytes(['fromBytes.sldd']);
    const s = buildGraphSource(slddFile('b.sldd', bytes));
    expect(s.type).toBe('sldd');
    expect(s.slddRefs).toEqual(['fromBytes.sldd']);
  });

  it('returns an empty model node for a model the cache has no structure for', () => {
    // Oversized, unreadable, or gone between the glob and the read. The file is in the folder,
    // so it is in the tree; it just draws no edges.
    const s = buildGraphSource({ uriString: 'file:///m.slx', path: '/m.slx' });
    expect(s.type).toBe('model');
    expect(s.modelRefs).toEqual([]);
    expect(s.dataSources).toEqual([]);
    expect(s.dataDictionary).toBeNull();
  });

  it('tolerates a corrupt .slx, yielding an empty model node', () => {
    // Two claims in order, both of them the production sequence: `extractSlxStructure` answers a
    // corrupt model with the all-empty structure instead of throwing (which is why `cheapOf`
    // needs no guard around it), and the shaper turns that into a node with no edges.
    const structure = extractSlxStructure(new ArrayBuffer(4), '/c.slx');
    expect(structure).toEqual({ dataDictionary: null, modelReferences: [], externalDataSources: [] });
    const s = buildGraphSource({ uriString: 'file:///c.slx', path: '/c.slx', structure });
    expect(s.type).toBe('model');
    expect(s.modelRefs).toEqual([]);
    expect(s.dataDictionary).toBeNull();
  });

  it('returns an empty sldd node for a dictionary the cache has no references for', () => {
    const s = buildGraphSource({ uriString: 'file:///n.sldd', path: '/n.sldd' });
    expect(s.type).toBe('sldd');
    expect(s.slddRefs).toEqual([]);
  });

  it('preserves uriString and path verbatim on the produced source', () => {
    const s = buildGraphSource({ uriString: 'file:///deep/path/x.mat', path: '/deep/path/x.mat' });
    expect(s.uriString).toBe('file:///deep/path/x.mat');
    expect(s.path).toBe('/deep/path/x.mat');
  });

  it('classifies an upper-cased extension by its kind, not by the sldd fallback', () => {
    // This test used to assert the opposite, pinning what `typeOf` then did: it matched
    // only lowercase, so anything else fell through to the `sldd` DEFAULT. That default
    // is what made the old behaviour so quiet — `X.MAT` was not rejected, it was
    // confidently mis-typed, taking the dictionary icon, the dictionary row builder and
    // the dictionary reference reading, none of which a MAT-file has. The kind tests are
    // shared and case-insensitive now (core's, through `sourceKind`), so the fallback catches
    // only what it should. Generalised over every supported format by the derived pin below;
    // kept as the case that was actually reported.
    const typeOf = (path: string): SourceType => buildGraphSource({ uriString: `file://${path}`, path }).type;
    expect(typeOf('/X.MAT')).toBe('mat');
    expect(typeOf('/C.SLX')).toBe('model');
    expect(typeOf('/P.PRJ')).toBe('project');
    // And the fallback still answers for a dictionary, in either case.
    expect(typeOf('/D.SLDD')).toBe('sldd');
    expect(typeOf('/d.sldd')).toBe('sldd');
  });
});

// The mapping from core's format kinds to the node kinds the tree draws, pinned against the list
// of formats this extension opens.
//
// `typeOf` derives its answer from `sourceKind` — one classifier, exhaustively mapped — and the
// thing that pin cannot cover on its own is the LIST. `sourceCache.test.ts` requires every
// SUPPORTED_EXTS extension to name a `SourceKind`; nothing required every one of them to reach
// a `SourceType`, and the gap matters because the unknown-extension case here is not an error,
// it is `'sldd'`. So a `.slxp` added to core's predicates and to the list would classify as a
// dictionary, draw the dictionary icon, and go looking for dictionary references in it — the
// same silent mis-typing a `.mdl` used to get, with no test anywhere failing.
describe('every format the extension opens draws as a deliberate kind', () => {
  const typeOf = (path: string): SourceType => buildGraphSource({ uriString: `file://${path}`, path }).type;

  // Written out by hand — this IS the mapping, so deriving it from the thing it pins would
  // assert nothing — but KEYED by SUPPORTED_EXTS, so a format that joins the list and not this
  // table fails to compile, and (since vitest does not typecheck) fails the set comparison below
  // at run time as well.
  const TYPE_OF: Readonly<Record<(typeof SUPPORTED_EXTS)[number], SourceType>> = {
    slx: 'model',
    mdl: 'model',
    sldd: 'sldd',
    mat: 'mat',
    prj: 'project',
  };

  it('names a SourceType for every extension the glob offers, and none for anything else', () => {
    // Set equality in both directions: an extension in the list with no entry here, or an entry
    // here for an extension discovery never offers.
    expect(Object.keys(TYPE_OF).sort()).toEqual([...SUPPORTED_EXTS].sort());
    for (const ext of SUPPORTED_EXTS) {
      expect(typeOf(`/w/thing.${ext}`), `.${ext} draws as a ${TYPE_OF[ext]}`).toBe(TYPE_OF[ext]);
      // Upper-cased too, because the glob finds `Params.SLDD` and core's predicates accept it: a
      // kind test stricter than the glob is the disagreement this indirection removes.
      expect(typeOf(`/w/Thing.${ext.toUpperCase()}`), `.${ext.toUpperCase()} draws as a ${TYPE_OF[ext]}`).toBe(
        TYPE_OF[ext],
      );
    }
  });

  it('reaches none of them through the unknown-extension fallback', () => {
    // The half the table above cannot express. `typeOf`'s fallback answers `'sldd'`, which is
    // also `.sldd`'s own honest answer — so a `.sldd` that had stopped being CLASSIFIED and was
    // merely falling through would satisfy every assertion above. What distinguishes the two is
    // the classifier: the fallback is reached only when `sourceKind` returns `null`, so
    // requiring a non-null kind for every supported extension is exactly "no format the glob
    // offers is landing in the default".
    for (const ext of SUPPORTED_EXTS) {
      expect(sourceKind(`/w/thing.${ext}`), `.${ext} must be classified, not defaulted`).not.toBeNull();
      expect(sourceKind(`/w/Thing.${ext.toUpperCase()}`), `.${ext.toUpperCase()} likewise`).not.toBeNull();
    }
  });

  it('still draws an unrecognised extension as an edgeless dictionary node', () => {
    // The fallback itself, pinned so that changing it is a decision rather than a side effect.
    // Production cannot reach it — `graphSourcesOf`'s files come out of the supported glob — but
    // the graph needs a `SourceType` for every file the tree lists, and this is the harmless one
    // of the four: with no artifact supplied it draws no edges, where `'model'` would advertise
    // relationships nothing extracted.
    expect(sourceKind('/w/notes.txt')).toBeNull();
    const s = buildGraphSource({ uriString: 'file:///w/notes.txt', path: '/w/notes.txt' });
    expect(s.type).toBe('sldd');
    expect(s.slddRefs).toEqual([]);
    expect(s.modelRefs).toEqual([]);
    expect(s.dataDictionary).toBeNull();
  });
});

// A minimal but REAL project store (resources/project/**/*.xml), mirroring the
// hash-linked layout parseProject expects. Kept local so this test drives the
// buildGraphSource -> parseProject integration end-to-end with genuine input,
// not a stub: two member files under two folders, plus a project->project
// reference, so we can assert basenames, folder filtering, and refs.
function projectStore(): Record<string, string> {
  const DECL = '<?xml version="1.0" encoding="UTF-8"?>';
  const info = (body: string): string => `${DECL}\n${body}`;
  const p = (rel: string): string => `resources/project/${rel}`;
  const store: Record<string, string> = {};

  // root/ entry pointers.
  store[p('root/AAAAAAAAAAAAAAAAAAAAAAAAAAAAp.xml')] = info('<Info location="ProjectData" type="Info"/>');
  store[p('root/AAAAAAAAAAAAAAAAAAAAAAAAAAAAd.xml')] = info('<Info Name="Widget"/>');
  store[p('root/BBBBBBBBBBBBBBBBBBBBBBBBBBBBp.xml')] = info('<Info location="Root" type="Files"/>');
  // A genuine project->project reference living directly in root.
  store[p('root/GGGGGGGGGGGGGGGGGGGGGGGGGGGGp.xml')] = info('<Info location="ref-uuid" type="Reference"/>');
  store[p('root/GGGGGGGGGGGGGGGGGGGGGGGGGGGGd.xml')] = info('<Info Ref="SharedLib" Type="Relative"/>');
  // A reference whose def carries no Ref → its name is null, so buildGraphSource
  // falls back to the id (the pointer location). Exercises `r.name ?? r.id`.
  store[p('root/HHHHHHHHHHHHHHHHHHHHHHHHHHHHp.xml')] = info('<Info location="nameless-uuid" type="Reference"/>');
  store[p('root/HHHHHHHHHHHHHHHHHHHHHHHHHHHHd.xml')] = info('<Info Type="Relative"/>');

  // Files collection (hash BBB...): one File 'models', one File 'helper.m'.
  const files = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  store[p(`${files}/DDDDDDDDDDDDDDDDDDDDDDDDDDDDp.xml`)] = info('<Info location="models" type="File"/>');
  store[p(`${files}/DDDDDDDDDDDDDDDDDDDDDDDDDDDDd.xml`)] = info('<Info/>');
  store[p(`${files}/EEEEEEEEEEEEEEEEEEEEEEEEEEEEp.xml`)] = info('<Info location="helper.m" type="File"/>');
  store[p(`${files}/EEEEEEEEEEEEEEEEEEEEEEEEEEEEd.xml`)] = info('<Info/>');

  // 'models' File entity's own dir (hash DDD...) carries a DIR_SIGNIFIER → folder.
  const models = 'DDDDDDDDDDDDDDDDDDDDDDDDDDDD';
  store[p(`${models}/FFFFFFFFFFFFFFFFFFFFFFFFFFFFp.xml`)] = info('<Info location="1" type="DIR_SIGNIFIER"/>');
  store[p(`${models}/FFFFFFFFFFFFFFFFFFFFFFFFFFFFd.xml`)] = info('<Info/>');

  return store;
}

describe('buildGraphSource — .prj project branch', () => {
  it('maps a project to member basenames (files only, folders excluded) and its references', () => {
    const s = buildGraphSource({
      uriString: 'file:///proj/Widget.prj',
      path: '/proj/Widget.prj',
      projectFiles: projectStore(),
    });

    expect(s.type).toBe('project');
    // helper.m is a File (basename); 'models' is a folder and must be excluded.
    expect(s.projectFiles).toContain('helper.m');
    expect(s.projectFiles).not.toContain('models');
    // The project->project reference name is surfaced.
    expect(s.projectRefs).toContain('SharedLib');
    // A reference with no resolvable name falls back to its id (location).
    expect(s.projectRefs).toContain('nameless-uuid');
    // Base GraphSource fields stay intact.
    expect(s.slddRefs).toEqual([]);
    expect(s.modelRefs).toEqual([]);
  });

  it('returns an empty project node when a .prj has no projectFiles map', () => {
    // Without projectFiles the project branch is skipped and the base node
    // (no members/refs) is returned — never a throw.
    const s = buildGraphSource({ uriString: 'file:///p.prj', path: '/p.prj' });
    expect(s.type).toBe('project');
    expect(s.projectFiles).toBeUndefined();
    expect(s.projectRefs).toBeUndefined();
    expect(s.dataDictionary).toBeNull();
  });

  it('tolerates an empty project store, yielding no members and no refs', () => {
    const s = buildGraphSource({
      uriString: 'file:///empty/Empty.prj',
      path: '/empty/Empty.prj',
      projectFiles: {},
    });
    expect(s.type).toBe('project');
    expect(s.projectFiles).toEqual([]);
    expect(s.projectRefs).toEqual([]);
  });
});

describe('buildGraphSource — a malformed input is an empty node, never a failed build', () => {
  it('walks a store it cannot make sense of down to an empty project', () => {
    // Where the throw would come from if there were one. With the extractions moved out to the
    // caller, `parseProject` is the only call left inside the `try` that reads a file's content,
    // and it is TOLERANT: a store of unparseable XML comes back with no members and no
    // references rather than throwing. Pinned because that is what the node the user sees
    // depends on, and because it is core's tolerance rather than this host's — the `catch`
    // below is what covers it ceasing to be.
    const s = buildGraphSource({
      uriString: 'file:///boom/Boom.prj',
      path: '/boom/Boom.prj',
      projectFiles: { 'resources/project/root/notxml.xml': '<<< not xml at all' },
    });
    expect(s.type).toBe('project');
    expect(s.projectFiles).toEqual([]);
    expect(s.projectRefs).toEqual([]);
    expect(s.dataDictionary).toBeNull();
  });

  it('returns the base node when reading a supplied field throws', () => {
    // The `catch` itself, which is a policy about this whole body rather than about any one
    // call: one file that will not shape must not fail a pass over a folder. Driven with an
    // injected throw and not a real one on purpose — no input reachable from production makes
    // this body throw today (the extractions that could are the caller's now, and `parseProject`
    // tolerates what the test above hands it), so the guard is against a core call changing its
    // mind, and an injected throw is the only honest way to exercise it.
    const file = { uriString: 'file:///boom.sldd', path: '/boom.sldd' } as RawFile;
    Object.defineProperty(file, 'slddRefs', {
      get() {
        throw new Error('boom');
      },
      enumerable: true,
    });

    const s = buildGraphSource(file);
    expect(s.type).toBe('sldd');
    expect(s.uriString).toBe('file:///boom.sldd');
    expect(s.slddRefs).toEqual([]);
  });
});

// The behaviours that used to be asserted against `buildGraphSource`'s byte branches and now
// live on the production path: the extraction runs inside the cheap tier, so its tolerance and
// its format sniff are properties of a PASS over a folder, not of the shaper.
describe('a folder pass survives the files it cannot read', () => {
  const BROKEN = '/w/nochunk.sldd';
  const HEALTHY = '/w/good.sldd';
  const GONE = '/w/gone.sldd';

  // A zip with no data/chunk0.xml: `parseBinarySldd` throws on it, which is why the cheap tier
  // wraps that call. Before, this was asserted through `buildGraphSource`'s own `catch` — but
  // the throw was never reachable from production there, because production never handed it
  // bytes.
  const brokenZip = (): ArrayBuffer =>
    toArrayBuffer(zipSync({ 'metadata/mwcoreProperties.xml': strToU8('<x/>') }));

  it('gives the broken dictionary an empty node and every other file its edges', async () => {
    const sources = await pass(
      new Map([
        [BROKEN, brokenZip()],
        [HEALTHY, jsonSlddBytes(['base.sldd'])],
        [GONE, null],
      ]),
    );
    // Every file is a node — a file in the folder and absent from the view is the worst failure
    // available here — and the two that could not be read have nothing to say.
    expect(sources.map((s) => s.path)).toEqual([BROKEN, HEALTHY, GONE]);
    expect(sourceFor(sources, BROKEN).type).toBe('sldd');
    expect(sourceFor(sources, BROKEN).slddRefs).toEqual([]);
    expect(sourceFor(sources, GONE).slddRefs).toEqual([]);
    // Non-vacuity: the pass did not merely fail quietly for all three.
    expect(sourceFor(sources, HEALTHY).slddRefs).toEqual(['base.sldd']);
  });

  it('gives a dictionary of malformed JSON an empty node, with no throw', async () => {
    // The textual half of the same tolerance, and it MOVED here rather than being dropped. It
    // used to be asserted through `buildGraphSource`, where the regex that read a textual
    // dictionary answered `[]` for text it could not parse. The one extraction throws instead
    // (`JSON.parse` does), so the tolerance is the cheap tier's `catch` now — and this is the
    // route production takes to it.
    const BAD = '/w/bad.sldd';
    const sources = await pass(
      new Map([
        [BAD, toArrayBuffer(new TextEncoder().encode('{ oops'))],
        [HEALTHY, jsonSlddBytes(['base.sldd'])],
      ]),
    );
    expect(sourceFor(sources, BAD).type).toBe('sldd');
    expect(sourceFor(sources, BAD).slddRefs).toEqual([]);
    expect(sourceFor(sources, HEALTHY).slddRefs).toEqual(['base.sldd']);
  });

  it('reads a textual dictionary and a compressed one in the same pass', async () => {
    // The format sniff over the production path. Both formats reach the tier as bytes, and a
    // pass that assumed either one would report no references for every file in the other.
    const TEXT = '/w/text.sldd';
    const ZIP = '/w/zip.sldd';
    const sources = await pass(
      new Map([
        [TEXT, jsonSlddBytes(['fromJson.sldd'])],
        [ZIP, binarySlddBytes(['fromZip.sldd'])],
      ]),
    );
    expect(sourceFor(sources, TEXT).slddRefs).toEqual(['fromJson.sldd']);
    expect(sourceFor(sources, ZIP).slddRefs).toEqual(['fromZip.sldd']);
  });

  it('shapes a model out of the artifact the pass built for it', async () => {
    // The other end of the same claim: the structure `graphSourcesOf` passes in is the one the
    // cheap tier extracted, so a real model read through a real pass draws all three of its
    // relationship kinds without this file ever calling the extraction.
    const MODEL = '/w/model_with_refs.slx';
    const sources = await pass(new Map([[MODEL, fixture('model_with_refs.slx')]]));
    const s = sourceFor(sources, MODEL);
    expect(s.type).toBe('model');
    expect(s.modelRefs).toContain('plant.slx');
    expect(s.dataDictionary).toBe('params.sldd');
    expect(s.dataSources).toContain('signals.mat');
  });
});
