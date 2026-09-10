// Copyright 2026 The MathWorks, Inc.
// The supported file extensions, in ONE place — and ONLY the extensions.
//
// This list was the most-duplicated rule in the repo: before this module it was
// spelled out in six independent literals — two extension regexes, three
// `findFiles` globs, and the file-system watcher's glob — plus the `customEditors`
// selector in package.json. Adding `.mdl` meant finding all six, and a miss is
// invisible to any single test: the file opens but never appears in the
// relationship tree, or appears there but contributes no Usage links, or is read
// once and then never re-read when it changes on disk.
//
// WHICH KIND a file is, though, is not this module's to say any more — it is core's
// (`isSlddFile`/`isMatFile`/`isProjectFile`/`isModelFile`, published for exactly this
// reason). It is a property of the format, this host is one of several readers that
// has to decide it, and core's own parsers dispatch on those same tests: a host with
// its own copy is a second opinion about whether `Params.SLDD` is a dictionary, and
// the last time these disagreed the file was found by the glob, admitted to the usage
// graph, and then classified as nothing at all. So every kind question in this host
// goes to core, and what is left here is the extension LIST plus the things only
// vscode needs it for — a `findFiles` glob and the `package.json` selector — neither
// of which core has any concept of.
//
// Those two are not independent: a format present in the list but in none of core's
// tests is discovered and then unclassifiable, and one in core's tests but absent from
// the list is never discovered at all. test/fileTypes.test.ts pins them against each
// other in both directions, which is the only place that agreement can be checked —
// and it also scans the host sources for stray literals, since a consumer that spells
// its own `endsWith('.sldd')` is outside both.
//
// These are pure (no vscode dependency) so both the host and its tests can use them.
import { isMatFile, isModelFile, isProjectFile, isSlddFile } from 'data-explorer-core';

/**
 * Simulink models.
 *
 * `.slx` is a ZIP OPC package. `.mdl` is either the SAME package written as text
 * (modern `save_system`) or the classic pre-R2012 nested-brace format — core's
 * `parseModel` decides which from the bytes, so nothing in this host has to tell
 * the two `.mdl` flavours apart, or even know there are two.
 */
export const MODEL_EXTS = ['slx', 'mdl'] as const;

/** Every format the extension opens. */
export const SUPPORTED_EXTS = ['sldd', 'mat', 'prj', ...MODEL_EXTS] as const;

/**
 * The files the usage and name graphs read: models, plus the data they reference.
 * A `.prj` is excluded deliberately — it defines no variables and no parameter
 * usages, so it contributes nothing to either graph.
 */
export const GRAPH_EXTS = ['sldd', 'mat', ...MODEL_EXTS] as const;

function extGlob(exts: readonly string[]): string {
  return `**/*.{${exts.join(',')}}`;
}

/** `findFiles` glob for every supported file. */
export const SUPPORTED_GLOB = extGlob(SUPPORTED_EXTS);

/** `findFiles` glob for the usage/name graphs. */
export const GRAPH_GLOB = extGlob(GRAPH_EXTS);

/**
 * True if this extension opens `path` at all — the routing question, asked of a tab
 * or a changed document rather than of a folder listing.
 *
 * A union of core's kind tests rather than a regex over SUPPORTED_EXTS, so that being
 * "supported" means precisely "some reader will know what this is". Case-INSENSITIVE,
 * because core's tests are: that unifies a split which used to exist here, where the
 * host's routing regex was case-sensitive while the usage graph's was not, so
 * `Model.SLX` was a graph participant the editor router did not recognise. These files
 * live on case-insensitive filesystems (macOS, Windows), where that asymmetry is a bug.
 */
export function isSupportedPath(path: string): boolean {
  return isGraphPath(path) || isProjectFile(path);
}

/**
 * True if `path` names a file the usage/name graphs read. The same set as
 * `isSupportedPath` minus the project marker — see GRAPH_EXTS.
 */
export function isGraphPath(path: string): boolean {
  return isModelFile(path) || isSlddFile(path) || isMatFile(path);
}

/**
 * The model extension to give a reference found INSIDE the model at `path`.
 *
 * A model file names its references without an extension, but the graph resolves
 * edges by filename, so the bare name has to be completed. It takes the parent
 * model's own extension: a reference is far likelier to be the same generation of
 * file as the model referencing it — a legacy `.mdl` hierarchy is legacy
 * throughout — and a `.mdl` model whose children were all labelled `.slx` would
 * link to nothing. Mirrors core's `ModelSectionNode.addReferenceEntry`, which
 * completes the same names for the tree that this completes for the graph.
 */
export function refModelExt(path: string): string {
  return /\.mdl$/i.test(path) ? '.mdl' : '.slx';
}

/**
 * A project's NAME, given the basename of its `.prj` — the file's name with the
 * extension taken off.
 *
 * Two callers in this host need it, and they needed it for different reasons, which is
 * why they each grew their own copy of the strip. `graphModel` labels a project group
 * with it, and that label is what a user reads in the relationship tree. `structuralIndex`
 * hands it to core's `parseProject`, which takes a project NAME rather than a filename
 * because that is what a `.prj` calls itself in its own metadata — the argument is the
 * fallback when the store carries no name, and core also uses it as the sentinel for
 * "the store has not supplied one yet".
 *
 * Nothing in this host reads `parsed.name` back today, so that second caller's strip is
 * currently inert; it is still the argument that decides the field, which is why it goes
 * through the same function rather than being simplified away.
 *
 * Mirrors core's published `projectNameOf`, and — like `refModelExt` above — exists here
 * only until the core pin moves past the version that publishes it. Both delete together.
 */
export function projectName(basename: string): string {
  return basename.replace(/\.prj$/i, '');
}
