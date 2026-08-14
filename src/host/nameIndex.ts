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
// This module does the vscode file I/O + parser dispatch; the pure
// name-extraction core lives in nameExtract.ts (unit-tested).
import * as vscode from 'vscode';
import { parseSlx } from '../dex/datamodel/parser/SlxParser.js';
import { parseMat } from '../dex/datamodel/parser/MatParser.js';
import { parseBinarySldd } from '../dex/datamodel/parser/BinarySlddParser.js';
import { isZipBytes } from './slddFormat.js';
import { toArrayBuffer } from '../common/bytes.js';
import { basename } from '../common/pathUtil.js';
import { namesFromSldd, namesFromMat, namesFromSlx, type NameRecord } from './nameExtract.js';

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
  const records = await recordsForFile(uri);
  index.set(uri.toString(), records);
}

// Drop one file's bucket (e.g. the file was deleted). Safe before build.
export function removeFile(uriString: string): void {
  index?.delete(uriString);
}

async function build(): Promise<void> {
  const map = new Map<string, NameRecord[]>();
  let uris: vscode.Uri[];
  try {
    uris = await vscode.workspace.findFiles('**/*.{slx,sldd,mat}');
  } catch {
    index = map;
    return;
  }
  await Promise.all(
    uris.map(async (uri) => {
      const records = await recordsForFile(uri);
      if (records.length > 0) map.set(uri.toString(), records);
    }),
  );
  index = map;
}

// Read + parse a single file's NAMES ONLY. Any read/parse failure (corrupt or
// unreadable file) contributes nothing.
async function recordsForFile(uri: vscode.Uri): Promise<NameRecord[]> {
  let ab: ArrayBuffer;
  try {
    ab = toArrayBuffer(await vscode.workspace.fs.readFile(uri));
  } catch {
    return [];
  }
  const path = uri.path;
  const uriString = uri.toString();
  try {
    if (path.endsWith('.slx')) {
      const parsed = parseSlx(ab, basename(path));
      return namesFromSlx(parsed, uriString);
    }
    if (path.endsWith('.mat')) {
      const parsed = parseMat(ab);
      return namesFromMat(parsed, uriString);
    }
    if (path.endsWith('.sldd')) {
      const bytes = new Uint8Array(ab);
      const content = isZipBytes(bytes)
        ? (parseBinarySldd(ab) as Record<string, unknown>)
        : (JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>);
      return namesFromSldd(content, uriString);
    }
  } catch {
    /* unreadable/corrupt file contributes nothing */
  }
  return [];
}
