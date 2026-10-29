// Copyright 2026 The MathWorks, Inc.
// Workspace-wide index of entry NAMES inside Simulink data sources, powering a
// global "search entries by name" feature: view's `NameIndex`, one for the window, over what only
// this host knows — the folder `findFiles` lists, and an open document's unsaved text.
//
// The index itself (one bucket per file, built lazily on first query and kept, a targeted
// reindex for an edited file, invalidated wholesale), where each name comes from (view's
// nameScan.ts) and the name extraction (view's nameExtract.ts) are view's. What is left here is
// the vscode file I/O: the listing, the reads through the window's shared source cache, and the
// dirty-buffer override.
import * as vscode from 'vscode';
import type { SourceFile } from 'data-explorer-core';
import { NameIndex, type NameReader, type NameRecord } from 'data-explorer-view/model';
import { toArrayBuffer } from '../common/bytes.js';
import { GRAPH_GLOB } from '../common/fileTypes.js';
import { readerFor, sourceCache, sourceFilesOf } from './sourceReads.js';

export type { EntryKind, NameRecord } from 'data-explorer-view/model';

// The file's UNSAVED bytes, when an open document has some, and `null` when the
// scan should read disk instead.
//
// This matters because reindexFile is driven by onDidChangeTextDocument, which
// fires per keystroke on an UNSAVED buffer. Reading disk there re-derives the
// names the file had before the edit, so renaming an entry in an open .sldd left
// search offering the OLD name (which no longer resolves to a row) and never the
// new one, until the file was saved. The reindex looked like it worked, because
// it did run — it just re-read the wrong bytes.
//
// A dirty document is only ever text: VS Code cannot mirror a compressed-binary
// .sldd as a TextDocument, and the writable binary editor keeps its edits in its
// own edit stack rather than a TextDocument, so `isDirty` here always implies the
// JSON format and encoding the string back to bytes is lossless. A clean (or
// unopened) document has no in-memory state worth preferring, so it reads disk —
// which also keeps the full build unaffected.
//
// Answering `null` rather than the disk bytes is what lets view's nameScan tell the two
// cases apart, and it has to: buffer bytes must never be stored in the shared
// cache, whose keys are the DISK file's `mtime:size`.
function dirtyBytesOf(file: SourceFile): ArrayBuffer | null {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === file.uriString);
  if (!open?.isDirty) return null;
  // Already in memory and already bounded — VS Code will not mirror a document
  // this scan's cap would exclude (its own sync limit is far below it).
  return toArrayBuffer(new TextEncoder().encode(open.getText()));
}

// How this index reads: the shared cache's own scan reader — same cap, same
// `mtime:size` version, so a model it parses is one every other consumer gets for
// free — with the dirty-buffer override layered on top of it.
function nameReader(uris: readonly vscode.Uri[]): NameReader {
  return { ...readerFor(uris), dirtyBytes: dirtyBytesOf };
}

// The Uris each read goes through, rather than ones rebuilt from their strings: a pass's are the
// Uris its own `findFiles` returned, by the listing `NameIndex` hands back to `reader`; a reindex's
// is the Uri `reindexFile` was given, by its string.
const listed = new WeakMap<readonly SourceFile[], readonly vscode.Uri[]>();
const reindexed = new Map<string, vscode.Uri>();

/** The window's name index. */
export const nameIndex = new NameIndex({
  files: {
    async list() {
      let uris: vscode.Uri[] = [];
      try {
        uris = await vscode.workspace.findFiles(GRAPH_GLOB);
      } catch {
        /* no workspace folder open — nothing to scan; the index is legitimately empty */
      }
      const files = sourceFilesOf(uris);
      listed.set(files, uris);
      return files;
    },
  },
  reader: (files) =>
    nameReader(listed.get(files) ?? files.map((f) => reindexed.get(f.uriString) ?? vscode.Uri.parse(f.uriString))),
  cache: sourceCache,
});

// Drop the whole index; the next ensureIndex() rebuilds it. Called on any
// workspace file create/delete/change where a targeted reindex isn't enough.
export function invalidate(): void {
  nameIndex.invalidate();
}

export function ensureIndex(): Promise<void> {
  return nameIndex.ensure();
}

export function listEntries(): Promise<NameRecord[]> {
  return nameIndex.list();
}

// Re-read + parse just this file and replace its bucket. If the lazy build hasn't happened yet,
// this is a no-op — building an index off a single file would give incomplete answers, so the
// first listEntries() does the full scan instead. Once built, this keeps the index current after
// an edit without a full rebuild.
export function reindexFile(uri: vscode.Uri): Promise<void> {
  const [file] = sourceFilesOf([uri]);
  reindexed.set(file.uriString, uri);
  return nameIndex.reindex(file);
}

// Drop one file's bucket (e.g. the file was deleted). Safe before build.
export function removeFile(uriString: string): void {
  reindexed.delete(uriString);
  nameIndex.remove(uriString);
}
