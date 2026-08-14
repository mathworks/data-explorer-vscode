// Copyright 2026 The MathWorks, Inc.
// Pure (vscode-free) core of the workspace name index: turns already-parsed
// Simulink data-source content into flat, dup-preserving name records. Split
// from nameIndex.ts (which does the file I/O + parser dispatch) so the
// name-extraction rules are unit-testable without touching the filesystem.
//
// This module is deliberately independent of the usage graph (usageResolve.ts)
// and the relationship graph: it answers only "what entry names exist, and
// where", never how they resolve or relate. Duplicate names across files are
// preserved (each becomes its own record) so a global "search entries by name"
// can list every occurrence.
import { uriBasename } from '../common/pathUtil.js';

export type EntryKind = 'sldd' | 'mat' | 'workspace' | 'block';

export interface NameRecord {
  name: string;
  sourceUri: string;
  sourceLabel: string;
  kind: EntryKind;
}

// Entry names from an .sldd (JSON or binary/zip; both share the in-memory
// __MW_TEXT_PARTS__ shape). Traversal mirrors usageGraph's slddSummary:
// content.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries[].name.
export function namesFromSldd(content: Record<string, unknown>, sourceUri: string): NameRecord[] {
  const label = uriBasename(sourceUri);
  const parts = content?.__MW_TEXT_PARTS__ as Record<string, unknown> | undefined;
  const chunk = parts?.['__MW_TEXT_PART__/data/chunk0'] as Record<string, unknown> | undefined;
  const inner = chunk?.__MW_TEXT_content as Record<string, unknown> | undefined;
  const entries = (inner?.entries as { name?: string }[] | undefined) ?? [];
  const records: NameRecord[] = [];
  for (const entry of entries) {
    const name = entry?.name;
    if (!name) continue; // drop empty/falsy names
    records.push({ name, sourceUri, sourceLabel: label, kind: 'sldd' });
  }
  return records;
}

// Variable names from a parsed .mat.
export function namesFromMat(parsed: { variables: { name?: string }[] }, sourceUri: string): NameRecord[] {
  const label = uriBasename(sourceUri);
  const records: NameRecord[] = [];
  for (const v of parsed?.variables ?? []) {
    const name = v?.name;
    if (!name) continue; // drop empty/falsy names
    records.push({ name, sourceUri, sourceLabel: label, kind: 'mat' });
  }
  return records;
}

// Model-workspace variable names (kind 'workspace') plus referenced block names
// (kind 'block') from a parsed .slx — both live in the same model file. A block
// is emitted once even if it uses multiple params, deduped WITHIN this file via
// a Set (the usage of a block many times is a graph concern, not a name one).
export function namesFromSlx(
  parsed: { workspace?: { name?: string }[]; blockParamUsages?: { blockName?: string }[] },
  sourceUri: string,
): NameRecord[] {
  const label = uriBasename(sourceUri);
  const records: NameRecord[] = [];

  for (const v of parsed?.workspace ?? []) {
    const name = v?.name;
    if (!name) continue; // drop empty/falsy names
    records.push({ name, sourceUri, sourceLabel: label, kind: 'workspace' });
  }

  const seenBlocks = new Set<string>();
  for (const u of parsed?.blockParamUsages ?? []) {
    const name = u?.blockName;
    if (!name) continue; // drop empty/falsy names
    if (seenBlocks.has(name)) continue; // one record per block within this file
    seenBlocks.add(name);
    records.push({ name, sourceUri, sourceLabel: label, kind: 'block' });
  }

  return records;
}
