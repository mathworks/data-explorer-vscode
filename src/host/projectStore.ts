// Copyright 2026 The MathWorks, Inc.
import * as vscode from 'vscode';
import { isTomlProjectFile, TOML_PROJECT_FILE } from 'data-explorer-core';

// A MATLAB/Simulink Project's structure lives in a sibling `resources/project/`
// store next to the .prj marker file. Read every *.xml under that store into a
// map keyed by POSIX relpath relative to the project ROOT (the directory
// containing the .prj), e.g. "resources/project/root/x.xml". These keys are
// what ProjectParser expects (it only reads entries under "resources/project/").
//
// R2026b's TOML format has no store to walk at all: `matlab.project.DefinitionFiles.Toml`
// puts the whole definition in one `matlab.toml` at the project root and deletes both
// `resources/` and the `<name>.prj` marker. So that case reads ONE file — and still hands
// back a map, keyed by the marker's own name, because the map is the interface
// `parseProject` dispatches on: finding a `matlab.toml` entry is how it knows to run the
// TOML reader rather than ProjectParser. One shape in, four formats read, and no caller of
// this function has to know which it got.

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
  if (isTomlProjectFile(prjUri.path)) {
    // Keyed with core's constant rather than with the basename as it was found on disk.
    // Either would be read — `parseProject` matches the entry by basename, case-insensitively,
    // precisely so a host keying by a longer path or a `MATLAB.TOML` is not punished for it —
    // but the constant is the one spelling of this name in both repos, and a map whose key
    // came off the filesystem is a map a test has to be told the case of.
    const text = await readTextIfPresent(prjUri);
    return text === undefined ? {} : { [TOML_PROJECT_FILE]: text };
  }
  const rootUri = vscode.Uri.joinPath(prjUri, '..');
  const storeUri = vscode.Uri.joinPath(rootUri, 'resources', 'project');
  const files: Record<string, string> = {};
  await readDirInto(storeUri, 'resources/project', files);
  return files;
}

/** One file's text, or undefined when it cannot be read — see readProjectStore. */
async function readTextIfPresent(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined; // marker gone between the glob and the read, or unreadable
  }
}

async function readDirInto(
  dirUri: vscode.Uri,
  relDir: string,
  out: Record<string, string>,
): Promise<void> {
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(dirUri);
  } catch {
    return; // directory absent/unreadable
  }
  for (const [name, type] of entries) {
    const childUri = vscode.Uri.joinPath(dirUri, name);
    const childRel = `${relDir}/${name}`;
    // A bitmask, not an enum value — the same reason `openProjectPath` masks in
    // BinaryEditorProvider: a symlinked entry is Directory|SymbolicLink or
    // File|SymbolicLink, so an equality test matches neither and the store
    // document is skipped in silence, leaving the project looking as though that
    // part of it were never written.
    if (type & vscode.FileType.Directory) {
      await readDirInto(childUri, childRel, out);
    } else if (type & vscode.FileType.File && /\.xml$/i.test(name)) {
      // Case-insensitive for the same reason as the extensions in common/fileTypes:
      // these names come off a case-insensitive filesystem, so an `.XML` store
      // document would be silently skipped and cost whatever entity it described.
      // Not shared with that module — `.xml` is a part name INSIDE a project store,
      // not a format this extension opens.
      try {
        const bytes = await vscode.workspace.fs.readFile(childUri);
        out[childRel] = new TextDecoder().decode(bytes);
      } catch {
        /* skip unreadable file */
      }
    }
  }
}
