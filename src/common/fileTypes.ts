// Copyright 2026 The MathWorks, Inc.
// The supported file names, in ONE place — the extensions, plus the one marker named
// outright.
//
// This list was the most-duplicated rule in the repo: before this module it was
// spelled out in six independent literals — two extension regexes, three
// `findFiles` globs, and the file-system watcher's glob — plus the `customEditors`
// selector in package.json. Adding `.mdl` meant finding all six, and a miss is
// invisible to any single test: the file opens but never appears in the
// relationship tree, or appears there but contributes no Usage links, or is read
// once and then never re-read when it changes on disk.
//
// R2026b made the list not quite only extensions. `matlab.project.DefinitionFiles.Toml`
// stores a project's whole definition in one `matlab.toml` at the project root and deletes
// both `resources/` and the `<name>.prj` marker, so the only thing on disk that says
// "project here" is a NAME — the first such file this host discovers. It is deliberately not
// an extension on SUPPORTED_EXTS: `.toml` is the configuration format of half the tooling a
// MATLAB repository sits beside, so admitting the extension would make every `Cargo.toml`,
// `pyproject.toml` and `ruff.toml` in a workspace a MATLAB project — discovered, listed in
// the tree, offered for opening, and then reported as a project that declares nothing. The
// name comes from core (`TOML_PROJECT_FILE`) for the same reason the kind tests do; this
// module only has to get it into a glob.
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
// The two name REDUCTIONS this module used to hold went the same way, and for the same
// reason. Which extension completes a bare model reference (`refModelExt`) and what a
// `.prj` calls itself (`projectNameOf`) are properties of the formats; core decides both
// for its own tree and publishes them, so a host keeping its own copy was a second
// opinion about a string a user READS — a graph group label beside the name core's parser
// was told. Both are core's calls now, at the three sites that used to import them from
// here, and the literal scan in test/fileTypes.test.ts is what stops a fourth.
//
// Those two are not independent: a format present in the list but in none of core's
// tests is discovered and then unclassifiable, and one in core's tests but absent from
// the list is never discovered at all. test/fileTypes.test.ts pins them against each
// other in both directions, which is the only place that agreement can be checked —
// and it also scans the host sources for stray literals, since a consumer that spells
// its own `endsWith('.sldd')` is outside both.
//
// These are pure (no vscode dependency) so both the host and its tests can use them.
import { isMatFile, isModelFile, isProjectFile, isSlddFile, TOML_PROJECT_FILE } from 'data-explorer-core';

/**
 * Simulink models.
 *
 * `.slx` is a ZIP OPC package. `.mdl` is either the SAME package written as text
 * (modern `save_system`) or the classic pre-R2012 nested-brace format — core's
 * `parseModel` decides which from the bytes, so nothing in this host has to tell
 * the two `.mdl` flavours apart, or even know there are two.
 */
export const MODEL_EXTS = ['slx', 'mdl'] as const;

/** Every format the extension opens that is identified by its EXTENSION. */
export const SUPPORTED_EXTS = ['sldd', 'mat', 'prj', ...MODEL_EXTS] as const;

/**
 * Every file the extension opens that is identified by its NAME.
 *
 * One entry, and a list anyway, because the two things that read it below both want to
 * treat the names as a set alongside the extensions — and because the next such marker
 * (MATLAB is adding formats to a project, not retiring them) should be one string here
 * rather than a second code path. See the header for why these cannot be extensions.
 */
export const SUPPORTED_NAMES = [TOML_PROJECT_FILE] as const;

/**
 * The files the usage and name graphs read: models, plus the data they reference.
 * A `.prj` is excluded deliberately — it defines no variables and no parameter
 * usages, so it contributes nothing to either graph. The same goes for the named
 * project marker, which is why SUPPORTED_NAMES has no counterpart here: a project is
 * a project to these graphs whichever format it is stored in, and that means absent.
 */
export const GRAPH_EXTS = ['sldd', 'mat', ...MODEL_EXTS] as const;

function extGlob(exts: readonly string[]): string {
  return `**/*.{${exts.join(',')}}`;
}

// A FLAT brace union of whole patterns — `{**/*.sldd,**/*.mat,**/*.prj,**/*.slx,**/*.mdl,
// **/matlab.toml}` — which is the one shape that can say this at all. (Line comments, not a
// JSDoc block: a glob written out contains `*/`, which would close the comment.)
//
// The obvious edit is to keep `extGlob`'s nested form and widen its brace list to
// `**/*.{sldd,…,toml}`, and it is wrong twice over: it admits every `.toml` in the workspace
// (see the header), and there is no way to spell a bare FILENAME inside a `*.{…}` suffix list,
// because the `*.` prefix sits outside the braces. So the braces move to the outside and each
// alternative carries its own prefix and its own suffix. VS Code's glob dialect expands a brace
// group of complete patterns exactly like a list of alternatives, which both consumers need:
// the same string is handed to `workspace.findFiles` (the tree, the name index) and to
// `createFileSystemWatcher` (extension.ts), and a marker missing from either is a project the
// tree never lists or one that goes stale the moment it is edited.
//
// Derived from the two lists rather than written out, for the reason this module exists: this
// is the fourth consumer of the same rule, and the one no import can reach from the manifest.
/** `findFiles` glob for every supported file — every extension, plus every named marker. */
export const SUPPORTED_GLOB = `{${[
  ...SUPPORTED_EXTS.map((ext) => `**/*.${ext}`),
  ...SUPPORTED_NAMES.map((name) => `**/${name}`),
].join(',')}}`;

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
 *
 * Asking core is also what makes a `matlab.toml` supported here for free, with nothing in
 * this function to change: `isProjectFile` is name-aware now. That is worth saying because
 * "supported" sounds like a routing decision and here it is not — this predicate's two
 * consumers (extension.ts: the dirty-badge/name-reindex on a text change, and the
 * refresh-on-disk-save) choose no editor at all, so admitting the marker cannot affect which
 * view a `matlab.toml` opens in. What it does buy is the side effect worth having: hand-edit
 * the one file a TOML project's definition lives in, save it, and its tree row re-reads.
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
