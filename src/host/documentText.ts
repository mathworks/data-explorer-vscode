// Copyright 2026 The MathWorks, Inc.
//
// Which text the window's name index scans for a file instead of the file on disk (nameIndex.ts).
// vscode-free, so that the decision is unit-tested (test/documentText.test.ts).

/** What of an open TextDocument the decision reads. */
export interface OpenText {
  readonly uri: { toString(): string };
  readonly isDirty: boolean;
  readonly isClosed: boolean;
  getText(): string;
}

/**
 * The text a scan of `uriString` reads instead of the file, or undefined to read the file.
 *
 * `changed` is the document whose content change the scan answers, when it answers one. Its text is
 * the file as the user has it, whatever the dirty flag says yet: VS Code reports an edit to a CLEAN
 * document while the document still reads clean, and the dirty flag only after it, as a change of its
 * own that carries no content. Asking `isDirty` alone sent that first edit's scan to the disk: a
 * read of the whole file on the first edit after every open or save, and the names the file had
 * before the edit, offered by the search until the next edit.
 *
 * Any other open document counts only while it is dirty. A clean one holds what the file holds, which
 * the file is read for through the shared cache: a stat, for a file that has not changed.
 */
export function textOverDisk(uriString: string, changed: OpenText | undefined, open: readonly OpenText[]): string | undefined {
  if (changed && !changed.isClosed && changed.uri.toString() === uriString) return changed.getText();
  const doc = open.find((d) => d.uri.toString() === uriString);
  return doc?.isDirty ? doc.getText() : undefined;
}
