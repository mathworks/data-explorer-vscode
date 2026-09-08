// Copyright 2026 The MathWorks, Inc.
// Pure (vscode-free) core of the workspace name index: turns already-parsed
// Simulink data-source content into flat, dup-preserving name records. Split
// from nameIndex.ts (which does the file I/O + parser dispatch) so the
// name-extraction rules are unit-testable without touching the filesystem.
//
// This module is deliberately independent of the usage graph (core's
// `buildUsageIndex`, reached through usageCells.ts) and the relationship graph:
// it answers only "what entry names exist, and where", never how they resolve or
// relate. Duplicate names across files are preserved (each becomes its own record)
// so a global "search entries by name" can list every occurrence.
import { blockKey, blockLabel, joinBlockPath } from 'data-explorer-core';
import { uriBasename } from '../common/pathUtil.js';

export type EntryKind = 'sldd' | 'mat' | 'workspace' | 'block';

export interface NameRecord {
  name: string;
  sourceUri: string;
  sourceLabel: string;
  kind: EntryKind;
  // Blocks only, and both from core's identity rules (see namesFromSlx).
  //
  // `selectName` is what a reveal travels as — the block's KEY, its SID — because the
  // row it means may print something else entirely (`<SID: 65>`), and `name` above is
  // only the label. Absent for every other kind, whose name IS its identity, so a
  // caller reveals `selectName ?? name`.
  //
  // `blockPath` is where the block sits in the model (`Controller/Gain`). A model may
  // hold four blocks named `Gain`, so the label alone does not say which hit is which.
  selectName?: string;
  blockPath?: string;
}

// One record per named item, all sharing a source and kind. Items with an
// empty/falsy name are dropped (an unnamed thing can't be searched for). Every
// extractor below funnels through this; they differ only in what they iterate,
// which field holds the name (`nameOf`), and which `kind` the records carry.
function nameRecords<T>(
  items: Iterable<T>,
  nameOf: (item: T) => string | undefined,
  sourceUri: string,
  kind: EntryKind,
): NameRecord[] {
  const label = uriBasename(sourceUri);
  const records: NameRecord[] = [];
  for (const item of items) {
    const name = nameOf(item);
    if (!name) continue;
    records.push({ name, sourceUri, sourceLabel: label, kind });
  }
  return records;
}

// Entry names from an .sldd (JSON or binary/zip; both share the in-memory
// __MW_TEXT_PARTS__ shape). Traversal mirrors usageGraph's slddSummary:
// content.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries[].name.
export function namesFromSldd(content: Record<string, unknown>, sourceUri: string): NameRecord[] {
  const parts = content?.__MW_TEXT_PARTS__ as Record<string, unknown> | undefined;
  const chunk = parts?.['__MW_TEXT_PART__/data/chunk0'] as Record<string, unknown> | undefined;
  const inner = chunk?.__MW_TEXT_content as Record<string, unknown> | undefined;
  const entries = (inner?.entries as { name?: string }[] | undefined) ?? [];
  return nameRecords(entries, (entry) => entry?.name, sourceUri, 'sldd');
}

// Variable names from a parsed .mat.
export function namesFromMat(parsed: { variables: { name?: string }[] }, sourceUri: string): NameRecord[] {
  return nameRecords(parsed?.variables ?? [], (v) => v?.name, sourceUri, 'mat');
}

// Model-workspace variable names (kind 'workspace') plus referenced blocks
// (kind 'block') from a parsed .slx — both live in the same model file. A block is
// emitted once even if it uses multiple params (the usage of a block many times is a
// graph concern, not a name one).
//
// One record per BLOCK, keyed by core's `blockKey` — the SID — and never by the name.
// A name is unique only inside its own system: f14.slx holds four blocks named `Gain`
// in four subsystems, which deduped by name gave ONE search hit that could reveal only
// whichever row came first, and the Constant whose label the file leaves blank had no
// hit at all (an empty name was dropped). Both are now searchable, told apart by their
// path, and revealed by the key the row publishes as `_blockKey`.
//
// A block with neither a name nor a SID has no key, and is still dropped: nothing could
// be searched for, and nothing could be selected if it were found.
export function namesFromSlx(
  parsed: {
    workspace?: { name?: string }[];
    blockParamUsages?: { blockName?: string; sid?: string; systemPath?: string }[];
  },
  sourceUri: string,
): NameRecord[] {
  const sourceLabel = uriBasename(sourceUri);
  // Insertion order keeps each block at its first parameter usage, as the Set did.
  const blocks = new Map<string, NameRecord>();
  for (const u of parsed?.blockParamUsages ?? []) {
    const name = u?.blockName ?? '';
    const sid = u?.sid ?? '';
    const key = blockKey(name, sid);
    if (!key || blocks.has(key)) continue;
    const label = blockLabel(name, sid);
    blocks.set(key, {
      name: label,
      sourceUri,
      sourceLabel,
      kind: 'block',
      selectName: key,
      blockPath: joinBlockPath(u?.systemPath ?? '', label),
    });
  }
  return [
    ...nameRecords(parsed?.workspace ?? [], (v) => v?.name, sourceUri, 'workspace'),
    ...blocks.values(),
  ];
}
