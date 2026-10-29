// Copyright 2026 The MathWorks, Inc.
//
// The extension's reads, over node:fs instead of `vscode.workspace.fs`, for the goldens: a
// project's store (projectStore.ts) and the shared source cache's reader (sourceReads.ts). Both
// originals read through `vscode`, which vitest cannot load, so their rules are copied here,
// each with the line it mirrors.
//
// Every file is read by its fake path (fixtures.ts), which maps back to one place in the repo.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isTomlProjectFile, TOML_PROJECT_FILE, type SourceFile } from 'data-explorer-core';
import type { GraphReader } from 'data-explorer-view/model';
import { byCodePoint, REPO } from './fixtures.js';

/** The repo path a fake `/fx/<rel>` path was made from. */
export const repoPathOf = (fakePath: string): string => join(REPO, fakePath.replace(/^\/fx\//, ''));

// mirrors projectStore.ts:45 readTextIfPresent (and BinaryEditorProvider.ts:155, its twin).
export function readTextIfPresent(abs: string): string | undefined {
  try {
    return new TextDecoder().decode(readFileSync(abs));
  } catch {
    return undefined;
  }
}

// mirrors projectStore.ts:54 readDirInto. `statSync` follows a link, as the bitmask test there does.
function readDirInto(dirAbs: string, relDir: string, out: Record<string, string>): void {
  let names: string[];
  try {
    names = readdirSync(dirAbs);
  } catch {
    return;
  }
  for (const name of names) {
    const childAbs = join(dirAbs, name);
    const childRel = `${relDir}/${name}`;
    const stat = statSync(childAbs);
    if (stat.isDirectory()) readDirInto(childAbs, childRel, out);
    else if (stat.isFile() && /\.xml$/i.test(name)) {
      const text = readTextIfPresent(childAbs);
      if (text !== undefined) out[childRel] = text;
    }
  }
}

/**
 * mirrors projectStore.ts:28 readProjectStore, for the project marker at repo path `abs` — plus a
 * sort of the map, because the order a directory lists in is the filesystem's, not the project's,
 * and a golden must not depend on which filesystem wrote it.
 */
export function readProjectStore(abs: string): Record<string, string> {
  if (isTomlProjectFile(abs)) {
    const text = readTextIfPresent(abs);
    return text === undefined ? {} : { [TOML_PROJECT_FILE]: text };
  }
  const files: Record<string, string> = {};
  readDirInto(join(dirname(abs), 'resources', 'project'), 'resources/project', files);
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => byCodePoint(a, b)));
}

/**
 * mirrors sourceReads.ts:149 readerFor, plus the project store SectionsTreeProvider.ts's `reader` adds.
 *
 * The version is the file's size and not `mtime:size` (scanRead.ts scanVersion): an mtime is the
 * checkout's, and within one run of one cache only the version's stability matters. The scan
 * cap (MAX_SCAN_BYTES, 512 MB) is left out, since no fixture is within five orders of it.
 */
export function nodeReader(files: readonly SourceFile[]): GraphReader {
  const known = new Set(files.map((f) => f.uriString));
  return {
    version: async (file) => {
      if (!known.has(file.uriString)) return null;
      try {
        return String(statSync(repoPathOf(file.path)).size);
      } catch {
        return null;
      }
    },
    bytes: async (file) => {
      if (!known.has(file.uriString)) return null;
      try {
        const b = readFileSync(repoPathOf(file.path));
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      } catch {
        return null;
      }
    },
    projectStore: async (file) => (known.has(file.uriString) ? readProjectStore(repoPathOf(file.path)) : null),
  };
}
