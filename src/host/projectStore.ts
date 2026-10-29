// Copyright 2026 The MathWorks, Inc.
import * as vscode from 'vscode';
import { readProjectStore as readStore, type StoreEntry, type StoreFs } from 'data-explorer-core';

// Where a project's definition lives — the `resources/project/` store beside a `.prj`, or the
// one `matlab.toml` that IS the definition in R2026b's format — and which files of a store are
// read, are core's rules (`readProjectStore`). What is left here is the filesystem: the two
// reads the walk makes, through `workspace.fs`, over the marker's own `/`-separated uri path.

/**
 * Read the project definition for a project marker. For a `<projectRoot>/<name>.prj` the
 * store is `<projectRoot>/resources/project/`; for a `<projectRoot>/matlab.toml` the
 * definition is that file.
 *
 * Missing/unreadable definitions yield an empty map (never throws for that case) — and
 * `parseProject` turns an empty map into an empty project that says so in its warnings,
 * which is what puts an unreachable store on the page instead of behind a throw.
 */
export async function readProjectStore(prjUri: vscode.Uri): Promise<Record<string, string>> {
  return readStore(prjUri.path, storeFsBeside(prjUri));
}

/** `StoreFs` over `workspace.fs`, for paths on the same scheme and authority as `prjUri`. */
function storeFsBeside(prjUri: vscode.Uri): StoreFs {
  const at = (path: string) => prjUri.with({ path });
  return {
    readText: async (path) => new TextDecoder().decode(await vscode.workspace.fs.readFile(at(path))),
    list: async (path) =>
      (await vscode.workspace.fs.readDirectory(at(path))).map(([name, type]) => ({
        name,
        type: entryType(type),
      })),
  };
}

/**
 * A bitmask, not an enum value — the same reason `openProjectPath` masks in
 * BinaryEditorProvider: a symlinked entry is Directory|SymbolicLink or File|SymbolicLink, so
 * an equality test matches neither and the store document is skipped in silence, leaving the
 * project looking as though that part of it were never written. A dangling link has neither
 * bit and is `'other'`, which the walk skips.
 */
function entryType(type: vscode.FileType): StoreEntry['type'] {
  if (type & vscode.FileType.Directory) return 'directory';
  if (type & vscode.FileType.File) return 'file';
  return 'other';
}
