// Copyright 2026 The MathWorks, Inc.
// The supported file names as VS Code spells them — `findFiles` globs over core's lists of
// the extensions, plus the one marker named outright.
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
// name comes from core (`SUPPORTED_NAMES`) for the same reason the kind tests do; this
// module only has to get it into a glob.
//
// WHICH KIND a file is, though, is not this module's to say any more — it is core's
// (`isSlddFile`/`isMatFile`/`isProjectFile`/`isModelFile`, published for exactly this
// reason). It is a property of the format, this host is one of several readers that
// has to decide it, and core's own parsers dispatch on those same tests: a host with
// its own copy is a second opinion about whether `Params.SLDD` is a dictionary, and
// the last time these disagreed the file was found by the glob, admitted to the usage
// graph, and then classified as nothing at all. So every kind question in this host
// goes to core.
//
// The extension LIST went the same way, and for the same reason: the lists and the kind
// tests are two halves of one rule — a format in the list but in none of the tests is
// discovered and then unclassifiable, one in the tests but not the list is never
// discovered at all — so core keeps them beside each other (`MODEL_EXTS`, `SUPPORTED_EXTS`,
// `SUPPORTED_NAMES`, `GRAPH_EXTS`, and the matching predicates `isSupportedPath` /
// `isGraphPath`). What is left here is only what vscode needs the list FOR — a `findFiles`
// glob and the `package.json` selector — neither of which core has any concept of.
//
// The two name REDUCTIONS this module used to hold went the same way, and for the same
// reason. Which extension completes a bare model reference (`refModelExt`) and what a
// `.prj` calls itself (`projectNameOf`) are properties of the formats; core decides both
// for its own tree and publishes them, so a host keeping its own copy was a second
// opinion about a string a user READS — a graph group label beside the name core's parser
// was told. Both are core's calls now, at the three sites that used to import them from
// here, and the literal scan in test/fileTypes.test.ts is what stops a fourth.
//
// test/fileTypes.test.ts still pins the lists against core's kind tests in both
// directions, from this side of the pin — and it also scans the host sources for stray
// literals, since a consumer that spells its own `endsWith('.sldd')` is outside both.
//
// These are pure (no vscode dependency) so both the host and its tests can use them.
import { GRAPH_EXTS, SUPPORTED_EXTS, SUPPORTED_NAMES } from 'data-explorer-core';

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
