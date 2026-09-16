// Copyright 2026 The MathWorks, Inc.
// Tier-1 orchestration: turn workspace files into GraphSource records for the relationship
// graph. vscode-free (callers supply the reader and the already-extracted artifacts).
//
// ONE SHAPER, AND IT TAKES THE ARTIFACT. `graphSourcesOf` is what the tree uses: a pass over
// the SHARED cheap tier, so a folder the usage plan or the name index has already looked at
// costs a `stat` per file and no reads at all (sourceCache.ts). `buildGraphSource` is the
// shaping itself, and what it accepts is what the cheap tier already extracted — a model's
// `SlxStructure`, a dictionary's reference list, a project's store — never bytes.
//
// It used to accept bytes as well, and re-derive from them (`extractSlxStructure`, plus a
// regex over a textual dictionary) exactly what the cheap tier had already computed.
// No production caller ever passed them: `graphSourcesOf` is the only one and it fills the
// artifact fields. So that branch was a second copy of one extraction, reachable only from the
// tests that pinned it — "one rule, two paths", the bug class this repo keeps hitting, in the
// form it takes here: a tree drawn from cached artifacts that disagreed with a tree drawn from
// bytes is a missing edge in one of the two, silently. A caller holding bytes runs the
// extraction at its own call site and hands the result in, which is what `graphSourcesOf`
// does through the cache. The relationship fields are then one mapping and the failure policy
// one `catch`, with nothing left to drift against.
import type { GraphSource, SourceType } from './graphModel.js';
import { mapLimited } from './mapLimited.js';
import { type SlxStructure } from './slxStructure.js';
import { cheapAll, sourceKind, type SourceCache, type SourceFile, type SourceReader } from './sourceCache.js';
import { isProjectFile, parseProject, projectNameOf } from 'data-explorer-core';
import { basename } from '../common/pathUtil.js';

/** A project's structure, keyed by store-relative POSIX path — see projectStore.ts. */
export type ProjectStore = Record<string, string>;

/**
 * One file to shape, and what has already been extracted for it.
 *
 * NO BYTES, deliberately. Every relationship field here is an ARTIFACT the caller already
 * holds — which is the whole reason the tree reads the cache, since it must not hold a 20 MB
 * dictionary again to learn what it references. A caller that has only bytes runs the same
 * extraction the cheap tier runs (`extractSlxStructure`, `scanSldd`) and passes the result; see
 * the header for what re-deriving it in here cost.
 *
 * Every field is optional and absence is never an error: a file the cache has no artifact for
 * — oversized, unreadable, gone between the glob and the read — is still a node, because it is
 * still in the folder. It just draws no edges.
 */
export interface RawFile {
  uriString: string;
  path: string;
  // For a .prj: the project's resources/project/**/*.xml text, keyed by relpath
  // (relative to the project root). The host reads these; the parser stays pure.
  projectFiles?: ProjectStore;
  structure?: SlxStructure;        // a model's relationships
  slddRefs?: readonly string[];    // a dictionary's references, RAW (see slddRefs.ts)
}

/**
 * How the tree reads: the shared cache's own reader, plus the one source the cache has no
 * concept of.
 *
 * A `.prj` is FETCHED, never cached (sourceCache.ts says why: the store is a directory tree
 * beside the marker file, and the marker's `mtime:size` cannot key it). So the store arrives
 * here, per build, from the consumer that wants one — the same layering `NameReader.dirtyBytes`
 * uses for the other thing the cache must not hold.
 */
export interface GraphReader extends SourceReader {
  /** A project's store, or `null` when it cannot be reached. */
  projectStore(file: SourceFile): Promise<ProjectStore | null>;
}

/**
 * What kind of node `path` draws as — a MAPPING of the one classifier's answer, not a second
 * reading of the path.
 *
 * `sourceKind` is that classifier (sourceCache.ts), and this used to be a rival to it: it
 * tested `isModelFile`/`isMatFile`/`isProjectFile` itself, never asked `isSlddFile` at all, and
 * answered `'sldd'` for anything left over — which is precisely the fallback `sourceKind`'s own
 * doc calls "the trap this replaces". Two classifiers for one question is this repo's recurring
 * bug class in its purest form (see the header): each looks right alone, and the disagreement
 * reaches the user as a file with the wrong icon, the wrong row builder and the wrong
 * relationship extraction — which is how a `.mdl` came to be drawn as a dictionary with no
 * children.
 *
 * The two vocabularies are not the same and neither is redundant. `SourceKind` names the FORMAT,
 * for a reader deciding what to parse; `SourceType` names what the graph DRAWS, and its members
 * are `NodeKind`s the tree renders (graphModel.ts). So `'prj'` becomes `'project'` here, and
 * that spelling is the reason this mapping exists at all rather than the two types being one.
 *
 * EXHAUSTIVE by construction — every `SourceKind` by name, no `default`, no `else` — so a format
 * added to core and to `sourceKind` fails to COMPILE here instead of quietly taking a fallback.
 * `null` is a written case for that same reason.
 *
 * WHY `null` MAPS TO `'sldd'`, both halves:
 *
 *   Safe, because production cannot reach it. `graphSourcesOf` is the only caller, its files come
 *   out of the supported glob (`SUPPORTED_GLOB`, whose extensions `sourceKind` all name — pinned
 *   from `SUPPORTED_EXTS` in sourceCache.test.ts and again in structuralIndex.test.ts), and every
 *   relationship field it fills comes off an already-classified cheap artifact. An unknown
 *   extension arriving here would carry no artifact anyway, so what it gets is the empty node.
 *
 *   Kept, and not `null`, because the graph needs a `SourceType` for EVERY file the tree lists.
 *   A file in the folder and absent from the view is the worst failure available here (see
 *   `graphSourcesOf`), so there has to be an answer; making it nullable would push "no kind"
 *   into `GraphSource`, `NodeKind`, the icon table and every row builder to describe a case no
 *   glob produces. `'sldd'` is the harmless one of the four: with no `slddRefs` supplied it
 *   draws no edges, where `'model'` would advertise relationships nothing extracted.
 */
function typeOf(path: string): SourceType {
  switch (sourceKind(path)) {
    // Both model containers are one SourceType: a `.mdl` is a Simulink model, so it gets the
    // model icon, the model row builder and the model relationship extraction.
    case 'model':
      return 'model';
    case 'mat':
      return 'mat';
    case 'sldd':
      return 'sldd';
    case 'prj':
      return 'project';
    case null:
      return 'sldd';
  }
}

function empty(uriString: string, path: string, type: SourceType): GraphSource {
  return { uriString, path, type, slddRefs: [], modelRefs: [], dataSources: [], dataDictionary: null };
}

export function buildGraphSource(file: RawFile): GraphSource {
  const type = typeOf(file.path);
  const base = empty(file.uriString, file.path, type);

  try {
    if (type === 'model') {
      // No structure is not an error: a model the cache holds no artifact for is still a node —
      // it is in the folder, so it belongs in the tree — it just draws no edges.
      const s = file.structure;
      if (!s) return base;
      // Copied, like the dictionary branch below, because `s` is a CACHED artifact: a consumer
      // that sorted a source's list in place would be rewriting what every later build and every
      // other consumer reads, permanently — no `mtime:size` can notice a mutated artifact. The
      // lists are a handful of names.
      return {
        ...base,
        modelRefs: [...s.modelReferences],
        dataSources: [...s.externalDataSources],
        dataDictionary: s.dataDictionary,
      };
    }
    if (type === 'project' && file.projectFiles) {
      // parseProject takes a project NAME, not a filename — that is what a `.prj` calls
      // itself in its own metadata, and this argument is the fallback when the store
      // carries none. So the reduction is core's to make, and it is the same call
      // graphModel labels a project group with.
      const name = projectNameOf(basename(file.path));
      const parsed = parseProject(file.projectFiles, name);
      // Member files (basenames) nest under the project; referenced projects too.
      const projectFiles = parsed.files.filter((f) => !f.isFolder).map((f) => basename(f.path));
      const projectRefs = parsed.references.map((r) => r.name ?? r.id).filter((n): n is string => !!n);
      return { ...base, projectFiles, projectRefs };
    }
    if (type === 'sldd' && file.slddRefs) {
      // Copied for the reason the model branch gives: this list may be the cache's own array.
      // The list itself is whatever the caller extracted — one `scanSldd` in the cheap tier and
      // in any bytes-in-hand caller, which decides the FORMAT with core's own sniff and reads the
      // references without building the entry tree. The tree deliberately does not parse a whole
      // dictionary to draw a handful of edges.
      return { ...base, slddRefs: [...file.slddRefs] };
    }
    // mat, a dictionary with no artifact, and everything else: node with no outbound
    // relationships.
    return base;
  } catch {
    // One file that will not shape must not fail the whole build: the pass this is the body of
    // runs over a folder, and the graph above it has one failure mode and it is "no graph". The
    // extraction throws are gone from in here — the caller runs those, and both callers catch
    // (see `dataCheapOf` in sourceCache.ts) — so what is left to throw is `parseProject` over a
    // malformed store, which is a real file on disk and reachable.
    return base;
  }
}

/**
 * Every file's `GraphSource`, over the shared cheap tier.
 *
 * ONE artifact per file per content change, whoever asked for it: a folder the usage plan or
 * the name index has already passed over costs a `stat` per file here and no reads at all, and
 * a folder this pass reads is one the next consumer gets for free. That is the whole of what
 * this function adds — the shaping below is `buildGraphSource`'s.
 *
 * EVERY file in `files` yields a source, including the ones the cache has no artifact for:
 * oversized, unreadable, gone between the glob and the read, or a project. A file the tree
 * dropped would vanish from the view the user is looking at, which is a worse failure than any
 * missing edge — the file IS in the folder. So the walk is over `files`, never over the cheap
 * map, and a file with no artifact gets the empty node it has always had.
 *
 * In `files` order (mapLimited writes by index), because that order is folder order and folder
 * order decides which of two same-named files a reference resolves to.
 */
export async function graphSourcesOf(
  cache: SourceCache,
  reader: GraphReader,
  files: readonly SourceFile[],
): Promise<GraphSource[]> {
  const cheap = await cheapAll(cache, reader, files);
  return mapLimited(files, async (file) => {
    const raw: RawFile = { uriString: file.uriString, path: file.path };
    const entry = cheap.get(file.uriString)?.cheap;
    if (entry?.kind === 'model') raw.structure = entry.structure;
    else if (entry?.kind === 'sldd') raw.slddRefs = entry.refs;
    else if (isProjectFile(file.path)) {
      // Fetched every build, and deliberately: a `.prj` is the one source whose structure the
      // cache cannot key (sourceCache.ts). Cheap to fetch — the marker file's bytes are not
      // read at all, this is a walk of the sibling `resources/project/` tree.
      try {
        raw.projectFiles = (await reader.projectStore(file)) ?? undefined;
      } catch {
        /* unreachable store: the project is still a node, with no members */
      }
    }
    return buildGraphSource(raw);
  });
}
