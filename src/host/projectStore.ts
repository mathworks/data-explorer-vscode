// Copyright 2026 The MathWorks, Inc.
import * as vscode from 'vscode';

// A MATLAB/Simulink Project's structure lives in a sibling `resources/project/`
// store next to the .prj marker file. Read every *.xml under that store into a
// map keyed by POSIX relpath relative to the project ROOT (the directory
// containing the .prj), e.g. "resources/project/root/x.xml". These keys are
// what ProjectParser expects (it only reads entries under "resources/project/").

/**
 * Read the project store for a .prj file. `prjUri` points at
 * `<projectRoot>/<name>.prj`; the store is `<projectRoot>/resources/project/`.
 * Missing/unreadable stores yield an empty map (never throws for that case).
 */
export async function readProjectStore(prjUri: vscode.Uri): Promise<Record<string, string>> {
  const rootUri = vscode.Uri.joinPath(prjUri, '..');
  const storeUri = vscode.Uri.joinPath(rootUri, 'resources', 'project');
  const files: Record<string, string> = {};
  await readDirInto(storeUri, 'resources/project', files);
  return files;
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
    if (type === vscode.FileType.Directory) {
      await readDirInto(childUri, childRel, out);
    } else if (type === vscode.FileType.File && name.endsWith('.xml')) {
      try {
        const bytes = await vscode.workspace.fs.readFile(childUri);
        out[childRel] = new TextDecoder().decode(bytes);
      } catch {
        /* skip unreadable file */
      }
    }
  }
}
