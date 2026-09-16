// Copyright 2026 The MathWorks, Inc.
// Tier-1 orchestration: turn workspace files into GraphSource records for the relationship
// graph. Dispatches by extension. vscode-free (callers read files and pass bytes/text in).
//
// TWO WAYS IN, ONE SHAPER. `graphSourcesOf` is what the tree uses: a pass over the SHARED
// cheap tier, so a folder the usage plan or the name index has already looked at costs a
// `stat` per file and no reads at all (sourceCache.ts). `buildGraphSource` is the same
// shaping for a caller holding the bytes itself, and the cache pass goes THROUGH it —
// which is the point. The relationship fields are one mapping, the failure policy is one
// `catch`, and neither is written twice; what differs between the two entry points is only
// where the extraction came from, and even that is the same function either way
// (`extractSlxStructure`, `refsFromSlddBytes`). "One rule, two paths" is the bug class this
// repo keeps hitting, and a tree drawn from cached artifacts that disagreed with a tree
// drawn from bytes is exactly its shape: a missing edge, in one of the two, silently.
import type { GraphSource, SourceType } from './graphModel.js';
import { mapLimited } from './mapLimited.js';
import { extractReferences, refsFromSlddBytes } from './slddRefs.js';
import { extractSlxStructure, type SlxStructure } from './slxStructure.js';
import { cheapAll, type SourceCache, type SourceFile, type SourceReader } from './sourceCache.js';
import { isMatFile, isModelFile, isProjectFile, parseProject, projectNameOf } from 'data-explorer-core';
import { basename } from '../common/pathUtil.js';

/** A project's structure, keyed by store-relative POSIX path — see projectStore.ts. */
export type ProjectStore = Record<string, string>;

export interface RawFile {
  uriString: string;
  path: string;
  bytes?: ArrayBuffer; // for binary formats
  text?: string;       // for JSON .sldd (already read as text)
  // For a .prj: the project's resources/project/**/*.xml text, keyed by relpath
  // (relative to the project root). The host reads these; the parser stays pure.
  projectFiles?: ProjectStore;
  // What the shared cheap tier already extracted for this file, when the caller has it.
  // PREFERRED over the bytes below, and normally supplied INSTEAD of them: the whole reason
  // the tree reads the cache is that it does not have to hold a 20 MB dictionary again to
  // learn what it references. Same values either way — `graphSourcesOf` fills these from the
  // artifacts the cheap tier built with the very functions this file's byte branches call.
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

function typeOf(path: string): SourceType {
  // Both model containers are the same SourceType: a `.mdl` is a Simulink model,
  // so it gets the model icon, the model row builder, and the model relationship
  // extraction — not the `.sldd` fallback this used to drop it into.
  if (isModelFile(path)) return 'model';
  if (isMatFile(path)) return 'mat';
  if (isProjectFile(path)) return 'project';
  return 'sldd';
}

function empty(uriString: string, path: string, type: SourceType): GraphSource {
  return { uriString, path, type, slddRefs: [], modelRefs: [], dataSources: [], dataDictionary: null };
}

export function buildGraphSource(file: RawFile): GraphSource {
  const type = typeOf(file.path);
  const base = empty(file.uriString, file.path, type);

  try {
    if (type === 'model') {
      // The cheap tier's artifact if the caller brought one, else the same extraction over the
      // bytes. A model with neither is still a node: it is in the folder, so it belongs in the
      // tree — it just draws no edges.
      const s = file.structure ?? (file.bytes ? extractSlxStructure(file.bytes, file.path) : null);
      if (!s) return base;
      // Copied, like the dictionary branch below, because `s` may be a CACHED artifact now: a
      // consumer that sorted a source's list in place would be rewriting what every later build
      // and every other consumer reads. The lists are a handful of names.
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
    if (type === 'sldd') {
      // The cheap tier's list first, for the same reason the model branch takes its
      // structure. Then text, then bytes — `refsFromSlddBytes` decides the FORMAT with
      // core's own sniff and reads the references without building the entry tree; the tree
      // deliberately does not parse a whole dictionary to draw a handful of edges. All three
      // are the same list: the cheap tier fills it by calling that same function.
      if (file.slddRefs) return { ...base, slddRefs: [...file.slddRefs] };
      if (file.text != null) return { ...base, slddRefs: extractReferences(file.text) };
      if (file.bytes) return { ...base, slddRefs: refsFromSlddBytes(file.bytes) };
    }
    // mat and everything else: node with no outbound relationships.
    return base;
  } catch {
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
