// Copyright 2026 The MathWorks, Inc.
// Workspace-wide index of entry NAMES inside Simulink data sources, powering a
// global "search entries by name" feature. It is deliberately standalone: it
// does not depend on the relationship graph or the usage graph, and it reads
// only names (never resolves them).
//
// The index is a Map<uriString, NameRecord[]> — one bucket per file — so that
// (a) duplicate names within and across files are preserved (each occurrence is
// its own record), and (b) an incremental update after a file change is a
// single-key replace rather than a full rebuild. Built LAZILY on first query
// and cached via a module Promise; invalidated wholesale via invalidate().
//
// This module does the vscode file I/O; where each name comes FROM — the shared
// source cache for a model's parse, this file's own scanners for a .sldd or a
// .mat, and an unsaved buffer over both — is nameScan.ts, and the pure
// name-extraction core is nameExtract.ts. Both are vscode-free and unit-tested.
import * as vscode from 'vscode';
import { mapLimited } from './scanRead.js';
import { toArrayBuffer } from '../common/bytes.js';
import { GRAPH_GLOB } from '../common/fileTypes.js';
import type { NameRecord } from './nameExtract.js';
import { namesOfFile, type NameReader } from './nameScan.js';
import { readerFor, sourceCache, sourceFilesOf } from './sourceReads.js';
import type { SourceFile } from './sourceCache.js';

export type { EntryKind, NameRecord } from './nameExtract.js';

// uriString -> that file's name records. Null when the lazy build hasn't run.
let index: Map<string, NameRecord[]> | null = null;
let buildPromise: Promise<void> | null = null;

// Drop the whole index; the next ensureIndex() rebuilds it. Called on any
// workspace file create/delete/change where a targeted reindex isn't enough.
export function invalidate(): void {
  index = null;
  buildPromise = null;
}

export async function ensureIndex(): Promise<void> {
  if (!buildPromise) buildPromise = build();
  return buildPromise;
}

export async function listEntries(): Promise<NameRecord[]> {
  await ensureIndex();
  const out: NameRecord[] = [];
  // NB: append with a loop, not `out.push(...bucket)`. A data source can hold
  // tens of thousands of entries, and spreading a huge array as call arguments
  // overflows the engine's argument limit ("Maximum call stack size exceeded").
  for (const bucket of index?.values() ?? []) {
    for (const rec of bucket) out.push(rec);
  }
  return out;
}

// Re-read + parse just this file and replace its bucket. Judgment call: if the
// lazy build hasn't happened yet (index is null), this is a no-op — building an
// index off a single file would give incomplete answers, so we let the first
// listEntries() do the full scan instead. Once built, this keeps the index
// current after an edit without a full rebuild.
export async function reindexFile(uri: vscode.Uri): Promise<void> {
  if (!index) return;
  const [file] = sourceFilesOf([uri]);
  index.set(uri.toString(), await namesOfFile(sourceCache, nameReader([uri]), file));
}

// Drop one file's bucket (e.g. the file was deleted). Safe before build.
export function removeFile(uriString: string): void {
  index?.delete(uriString);
}

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
// which also keeps the full build() unaffected.
//
// Answering `null` rather than the disk bytes is what lets nameScan tell the two
// cases apart, and it has to: buffer bytes must never be stored in the shared
// cache, whose keys are the DISK file's `mtime:size` (see nameScan.ts).
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

async function build(): Promise<void> {
  const map = new Map<string, NameRecord[]>();
  let uris: vscode.Uri[] = [];
  try {
    uris = await vscode.workspace.findFiles(GRAPH_GLOB);
  } catch {
    /* no workspace folder open — nothing to scan; the index is legitimately empty */
  }
  // A few files at a time, and nothing oversized — see scanRead. This scan is the
  // heaviest of the three (it needs each model's full parse to collect its block
  // names), so it is also the one that must not hold the whole folder at once. One
  // reader for the whole pass, so every file is versioned and read the same way.
  const reader = nameReader(uris);
  await mapLimited(sourceFilesOf(uris), async (file) => {
    const records = await namesOfFile(sourceCache, reader, file);
    if (records.length > 0) map.set(file.uriString, records);
  });
  // Assigned on exactly ONE path, deliberately. `index` non-null is what marks
  // the build as done: reindexFile no-ops while it is null, and listEntries reads
  // through it. A failure path that resolved buildPromise WITHOUT setting it
  // would leave the module permanently half-built — ensureIndex() satisfied, so
  // no rebuild is ever attempted, while every query returns nothing.
  index = map;
}
