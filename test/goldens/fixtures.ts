// Copyright 2026 The MathWorks, Inc.
//
// Which files the golden payloads cover, what each is called while it is open, and where its
// snapshots live.
//
// FOUND, NOT LISTED. The corpus is every file under the fixture roots that the extension opens
// (`isSupportedPath`, the extension's own routing predicate), so a fixture added for some other
// suite is pinned here the first time this runs, with nothing to remember. What is left out is
// left out by name below, each with the reason, because a blind spot in a no-regression net is
// only acceptable when someone chose it.
//
// ONE SPELLING PER FILE, AND NOT THE DISK'S. A row id embeds its source's id, which is the uri
// the view was opened under, and so do `docUri`, `_matrix.nodeId` and every Usage link. Opened
// under its real path, every snapshot would name the checkout it was written in and differ
// between a laptop and CI. So each file is opened as `file:///fx/<its path in the repo>`, a uri
// that is the same on every machine and still says which fixture a row came from.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect } from 'vitest';
import { isSupportedPath } from '../../src/common/fileTypes.js';
import type { SourceFile } from '../../src/host/sourceCache.js';

/** The repository root, which every fixture path below is relative to. */
export const REPO = resolve(import.meta.dirname, '../..');

/**
 * The fixture roots: the unit suite's, the integration suite's, and the two projects MATLAB wrote
 * for the project parity suite. The rest of test/parity/artifacts is that suite's input and is
 * pinned there against MATLAB's own answers.
 */
export const FIXTURE_ROOTS = ['test/fixtures', 'test-integration/fixtures', 'test/parity/artifacts/project'];

/**
 * Directories that are not fixtures at all: other suites WRITE them on every run (both are
 * gitignored), and they can be mid-write while this suite reads, since vitest runs files in
 * parallel. A snapshot of either would pin another test's scratch output.
 */
const SCRATCH_DIRS = new Set(['test/fixtures/rt_out', 'test/fixtures/parity_out']);

/**
 * The integration workspace is a fixture folder the integration suite also makes working copies
 * in, beside the sources, and deletes in teardown; .gitignore ignores the folder and re-admits
 * these four. The same rule here, so that a leftover copy from an interrupted integration run is
 * not pinned on one machine and missing on the next. A new source fixture there already needs a
 * `git add -f` (see .gitignore); it needs adding to this list in the same change.
 */
const WORKSPACE_DIR = 'test-integration/fixtures/workspace';
const WORKSPACE_SOURCES = new Set(['binary.sldd', 'data.sldd', 'model.slx', 'params.sldd']);

/** Repo-relative POSIX paths of every file under `rel` that the extension opens, recursively. */
function supportedUnder(rel: string): string[] {
  if (SCRATCH_DIRS.has(rel)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(join(REPO, rel), { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...supportedUnder(child));
    else if (entry.isFile() && isSupportedPath(entry.name)) {
      if (rel === WORKSPACE_DIR && !WORKSPACE_SOURCES.has(entry.name)) continue;
      out.push(child);
    }
  }
  return out;
}

/**
 * Code-point order, never `localeCompare`: it is the folder order a tree and a Usage graph are
 * built in, which decides which of two same-named files a reference resolves to, and it must
 * not depend on the machine's locale.
 */
export const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Every fixture file, repo-relative, sorted. */
export function fixtureFiles(): string[] {
  return FIXTURE_ROOTS.flatMap(supportedUnder).sort(byCodePoint);
}

/**
 * The fixture FOLDERS a relationship tree is drawn for: each integration folder (each one is a
 * workspace some integration test opens), the unit suite's whole fixture tree (the corpus with
 * the most cross-file references), and the parity projects' folder, the only one holding `.prj`
 * markers and so the only one whose tree has project groups.
 */
export function fixtureFolders(): string[] {
  const integration = readdirSync(join(REPO, 'test-integration/fixtures'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `test-integration/fixtures/${e.name}`);
  return ['test/fixtures', 'test/parity/artifacts/project', ...integration].sort(byCodePoint);
}

/** The supported files under one fixture folder, as `fixtureFiles` would list them. */
export function filesUnder(folder: string): string[] {
  return supportedUnder(folder).sort(byCodePoint);
}

/** The uri and path a fixture is opened under: the same on every machine (see the header). */
export function fakeFile(rel: string): SourceFile {
  return { uriString: `file:///fx/${rel}`, path: `/fx/${rel}` };
}

/** The basename the providers name a document by (`basename(uri.path)`). */
export function nameOf(rel: string): string {
  return rel.slice(rel.lastIndexOf('/') + 1);
}

/** A fixture's bytes, as the providers hold them: a fresh ArrayBuffer of exactly the file. */
export function bytesOf(rel: string): ArrayBuffer {
  const b = readFileSync(join(REPO, rel));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

/** The directory one fixture's (or fixture folder's) snapshots live in, under any root. */
const snapshotKey = (rel: string): string => rel.split('/').join('__');

/**
 * Where one fixture's snapshot of one kind lives — the layout other tooling reads, so it is
 * spelled once: `__snapshots__/<repo path with '/' as '__'>/<kind>.json`, beside this file.
 */
export function snapshotPath(rel: string, kind: string): string {
  return join(import.meta.dirname, '__snapshots__', snapshotKey(rel), `${kind}.json`);
}

/**
 * The largest snapshot kept whole. Written out in full the corpus is 7.2 MB, and 5.1 MB of that is
 * the snapshots of twelve fixtures with a few hundred rows each, every one of which is also asked
 * of the inspector and the lazy fetch. Kept whole up to this, the corpus is 2.7 MB, and every
 * fixture's first paint keeps its envelope, its banners and its first rows in the clear.
 */
export const FULL_SNAPSHOT_LIMIT = 48 * 1024;

/** How many rows (or entries) a digested snapshot still shows, so its diff still says something. */
const DIGEST_HEAD = 20;

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/**
 * A row list too large to keep, as what still pins it exactly: the hash of its full text, its
 * length, and its first rows in the clear.
 */
function digestRows(rows: unknown[]): unknown {
  return {
    digested: true,
    sha256: sha256(JSON.stringify(rows, null, 1)),
    rowCount: rows.length,
    firstRows: rows.slice(0, DIGEST_HEAD),
  };
}

/**
 * A snapshot over FULL_SNAPSHOT_LIMIT, digested where its bulk is and nowhere else.
 *
 * A list of messages (a paint) keeps every message and digests only each one's `rows`, so the
 * envelope, the banner and the section rules stay readable. A map of answers by row id (the
 * inspector's, a matrix's, the lazy fetches') keeps every row id and digests each answer on its
 * own, so a changed answer is still named by the row it belongs to.
 *
 * Equal digests mean equal payloads, which is the property a move has to keep. What a digest
 * cannot show is HOW an answer changed: for that, run the old and the new code with
 * GOLDENS_FULL_DIR set (see FULL_DIR) and diff the two directories.
 */
function digest(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((m) => (m && Array.isArray(m.rows) ? { ...m, rows: digestRows(m.rows) } : m));
  const entries = Object.entries(value as Record<string, unknown>);
  return {
    digested: true,
    sha256: sha256(JSON.stringify(value, null, 1)),
    entryCount: entries.length,
    // 64 bits of each answer's hash: enough to tell one answer from another, at a quarter the length.
    entries: Object.fromEntries(entries.map(([id, answer]) => [id, sha256(JSON.stringify(answer, null, 1)).slice(0, 16)])),
  };
}

/**
 * The text a snapshot holds. What a webview receives is JSON (postMessage serializes), so JSON is
 * the honest record of it: a field that is `undefined` is absent there and absent here. One space
 * of indent keeps the files diffable line by line without doubling their size.
 */
export function snapshotText(value: unknown): string {
  const full = JSON.stringify(value, null, 1);
  return (full.length <= FULL_SNAPSHOT_LIMIT ? full : JSON.stringify(digest(value), null, 1)) + '\n';
}

/**
 * Where to write every payload WHOLE as well, never digested, or undefined to write none: the
 * `GOLDENS_FULL_DIR` environment variable, in the same `<key>/<kind>.json` layout as the snapshots.
 *
 * For what a digest cannot do. A digest says THAT a payload changed; this is what shows how, by
 * diffing two runs' directories (the code before a change and after it), and it is the only form
 * that can be replayed into a webview, which needs every row. Outside the repo, deliberately: it
 * is regenerated from whatever code is checked out, so committing it would pin nothing new.
 */
const FULL_DIR = process.env.GOLDENS_FULL_DIR ? resolve(process.env.GOLDENS_FULL_DIR) : undefined;

/** Hold `value` to its golden snapshot of `kind` — and, when asked, write it out whole (FULL_DIR). */
export async function expectGolden(value: unknown, rel: string, kind: string): Promise<void> {
  if (FULL_DIR) {
    const dir = join(FULL_DIR, snapshotKey(rel));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${kind}.json`), JSON.stringify(value, null, 1) + '\n');
  }
  await expect(snapshotText(value)).toMatchFileSnapshot(snapshotPath(rel, kind));
}
