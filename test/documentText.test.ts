// Copyright 2026 The MathWorks, Inc.
//
// Which text the window's name index scans for a file instead of the file on disk.
//
// VS Code reports an edit to a clean document while the document still reads clean, and its dirty
// flag only after it, as a change of its own that carries no content. The index asked `isDirty`
// alone, so once a search had built it, the first edit after every open or save made it read the whole
// file from disk, and offer the names the file had before the edit. The document a reindex answers a
// content change of is now read whatever its flag says; any other open document only while it is
// dirty, so a clean one still reads the file through the shared cache.
//
// The end-to-end half, through the registered extension, a real search and a counted file system, is
// test-integration/suite/nameIndexFirstEdit.test.ts.
import { describe, it, expect } from 'vitest';
import { textOverDisk, type OpenText } from '../src/host/documentText.js';

const URI = 'file:///w/data.sldd';

function doc(uri: string, text: string, isDirty: boolean, isClosed = false): OpenText {
  return { uri: { toString: () => uri }, isDirty, isClosed, getText: () => text };
}

describe('the text the name index scans instead of the file', () => {
  it("is the changed document's, though VS Code still reports it clean", () => {
    const changed = doc(URI, 'edited', false);
    expect(textOverDisk(URI, changed, [changed])).toBe('edited');
  });

  it("is a dirty open document's, with no change to answer (a watcher's reindex)", () => {
    expect(textOverDisk(URI, undefined, [doc(URI, 'unsaved', true)])).toBe('unsaved');
  });

  it('is none for a clean open document, or a file no document has open: the file is read', () => {
    expect(textOverDisk(URI, undefined, [doc(URI, 'as on disk', false)])).toBeUndefined();
    expect(textOverDisk(URI, undefined, [])).toBeUndefined();
  });

  it("is never another file's changed document", () => {
    const other = doc('file:///w/other.sldd', 'other', false);
    expect(textOverDisk(URI, other, [other, doc(URI, 'as on disk', false)])).toBeUndefined();
  });

  it('is not a changed document since closed, which has no text left to stand for the file', () => {
    expect(textOverDisk(URI, doc(URI, 'gone', false, true), [])).toBeUndefined();
  });
});
