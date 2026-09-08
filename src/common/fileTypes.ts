// Copyright 2026 The MathWorks, Inc.
// The supported file extensions, in ONE place.
//
// This list was the most-duplicated rule in the repo: before this module it was
// spelled out in six independent literals — two extension regexes, three
// `findFiles` globs, and the file-system watcher's glob — plus the `customEditors`
// selector in package.json. Adding `.mdl` meant finding all six, and a miss is
// invisible to any single test: the file opens but never appears in the
// relationship tree, or appears there but contributes no Usage links, or is read
// once and then never re-read when it changes on disk.
//
// So the extension list lives here and every consumer derives from it.
// test/fileTypes.test.ts scans the host sources for stray literals to keep it that
// way, and test/manifest.test.ts holds package.json to the same list.
//
// These are pure (no vscode dependency) so both the host and its tests can use
// them.

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

function extRe(exts: readonly string[]): RegExp {
  return new RegExp(`\\.(${exts.join('|')})$`, 'i');
}

function extGlob(exts: readonly string[]): string {
  return `**/*.{${exts.join(',')}}`;
}

/**
 * Matches any supported file.
 *
 * Case-INSENSITIVE, which unifies a split that used to exist: the host's routing
 * regex was case-sensitive while the usage graph's was not, so `Model.SLX` was a
 * graph participant that the editor router did not recognise. These files live on
 * case-insensitive filesystems (macOS, Windows), where that asymmetry is a bug.
 */
export const SUPPORTED_RE = extRe(SUPPORTED_EXTS);

/** Matches a file the usage/name graphs read. */
export const GRAPH_FILE_RE = extRe(GRAPH_EXTS);

/** Matches a Simulink model, whichever container it uses. */
export const MODEL_RE = extRe(MODEL_EXTS);

/** Matches a data dictionary. */
export const SLDD_RE = extRe(['sldd']);

/** Matches a MAT-file. */
export const MAT_RE = extRe(['mat']);

/** Matches a MATLAB project marker. */
export const PROJECT_RE = extRe(['prj']);

/** `findFiles` glob for every supported file. */
export const SUPPORTED_GLOB = extGlob(SUPPORTED_EXTS);

/** `findFiles` glob for the usage/name graphs. */
export const GRAPH_GLOB = extGlob(GRAPH_EXTS);

/** True if `path` names a Simulink model (`.slx` or either flavour of `.mdl`). */
export function isModelPath(path: string): boolean {
  return MODEL_RE.test(path);
}

/*
 * WHICH KIND a supported file is, for the consumers that have to decide.
 *
 * These exist because `isModelPath` was shared while its three siblings were not:
 * every consumer that had to tell a dictionary from a MAT-file from a project spelled
 * its own `path.endsWith('.sldd')`, and all eight of those copies were
 * case-SENSITIVE while every matcher above is case-insensitive. So a file named
 * `Params.SLDD` was found by the globs, matched by GRAPH_FILE_RE, admitted to the
 * usage graph's file list — and then classified as neither dictionary nor MAT by the
 * summariser, contributing no variables and no Usage links. The same asymmetry sent it
 * past the editable-JSON redirect into the read-only view, gave it the wrong row
 * builder, and left it out of the sections tree's reference reading: eight independent
 * ways for one file to be half-supported.
 *
 * A model reference is matched with the same predicates, since a model records a
 * linked source as the user typed it (`EXTRADICT.SLDD` is a real dictionary link).
 * One rule for "is this a dictionary", whether the string came from a filesystem or
 * from inside a model.
 */

/** True if `path` names a data dictionary. */
export function isSlddPath(path: string): boolean {
  return SLDD_RE.test(path);
}

/** True if `path` names a MAT-file. */
export function isMatPath(path: string): boolean {
  return MAT_RE.test(path);
}

/** True if `path` names a MATLAB project. */
export function isProjectPath(path: string): boolean {
  return PROJECT_RE.test(path);
}

/**
 * Strip a model extension, giving the bare model name MATLAB uses internally
 * (`plant.slx` and `plant.mdl` are both the model `plant`).
 */
export function stripModelExt(name: string): string {
  return name.replace(MODEL_RE, '');
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
