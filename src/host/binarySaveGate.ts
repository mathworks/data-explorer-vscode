// Copyright 2026 The MathWorks, Inc.
//
// What a binary .sldd save may change, checked against the chunk as last read or saved.
//
// The maintainer's D12 addendum (V-125 (c)): the save gate byte-compares, against the chunk as
// last read or saved, every entry nobody edited (it must be its bytes), and the untouched parts
// of each edited entry (core's keptPartsViolations: every child whose bytes changed must be one
// the model changed, besides Name and LastMod), and refuses the save on any mismatch. It sees
// the chunks with a structure-aware scan (chunkEntries.ts), never with core's reader, because a
// reader and a writer can lose the same thing and a re-read then shows nothing lost.
//
// WHO SAYS WHAT WAS EDITED. Not the model: the model can be rebuilt from the chunk (a wide
// repaint re-reads it), and then it holds whatever the chunk says, edited or not. The edits say
// it: each one records the entries it changes (BinarySlddDocument.pushEdit), and every entry
// none of them names must be its bytes from the last-saved chunk. The record is a superset — an
// entry edited and then undone is still named — and that is safe, since an entry back to its
// bytes passes either way.
//
// WHAT AN EMPTY ANSWER MEANS. keptPartsViolations returns [] both when the untouched parts are
// kept and when it checked nothing: for an entry with no bytes it was read from, and for one whose
// bytes its scan cannot read (a processing instruction inside it, say). So the gate never reads
// [] as a pass on its own. It also asks the check about the empty text, which keeps nothing: a
// check that is armed for the entry reports it, and one that answers [] there checked nothing.
// An edited entry the last-saved chunk holds and the check cannot read is REFUSED, not passed
// on a weaker check: the edit writes such an entry whole from the model, which is the loss D12
// exists to stop, and the user can still save every other edit by undoing that one. An entry
// the last-saved chunk does not hold (a paste, a new entry) has nothing to keep.
//
// ASKED WHEN THE EDIT IS MADE, TOO. Asking the node at the save is not enough. Redo rebuilds an
// entry's node from the text the edit wrote, and a re-read of the chunk (the webview reloading,
// the repaint after a refused edit, a paste or move that could not state its ops) rebuilds it
// from the chunk: either way its bytes are then the edit's, which the check can read, though
// the file's could not be. And a rename of an entry with no UUID changes its key, so the gate
// finds no entry of the last-saved chunk to pair it with and takes it for a new one. So each
// edit asks the check about the entries it changes while their nodes still hold the bytes they
// were read from (uncheckableEntries), and the document keeps the answer, under every key the
// entry has gone by, until a save or a revert replaces the last-saved chunk; undo and redo put
// it back with their edit. The gate refuses an entry so recorded whose text is not the
// last-saved chunk's, when that chunk holds it under any of those keys.
//
// A CHUNK THE SCAN CANNOT READ. Then nothing can be compared entry by entry, so the whole chunk
// is compared: it saves only unchanged. None of the repository's binary dictionaries is one.

import { keptPartsViolations } from 'data-explorer-core';
import {
  chunkEntryKey,
  decodeXmlText,
  entryKey,
  scanChunkEntries,
  type ChunkEntries,
  type ChunkEntry,
} from './chunkEntries.js';

/** A key in a document's set of edited entries that stands for every entry: see `changedEntryKeys`. */
export const EVERY_ENTRY = '*';

/** The chunk as a document last read or wrote it, scanned once, when a save first needs it. */
export class SavedChunk {
  private scanned: ChunkEntries | undefined;
  constructor(readonly xml: string) {}
  get scan(): ChunkEntries {
    return (this.scanned ??= scanChunkEntries(this.xml));
  }
}

function byKey(entries: readonly ChunkEntry[]): Map<string, ChunkEntry[]> {
  const map = new Map<string, ChunkEntry[]>();
  for (const entry of entries) {
    const key = chunkEntryKey(entry);
    const list = map.get(key);
    if (list) list.push(entry);
    else map.set(key, [entry]);
  }
  return map;
}

/**
 * The keys (chunkEntries.entryKey) of the entries whose text differs between two chunks, or
 * that only one of them holds: what an edit that could not say what it changed has changed.
 * EVERY_ENTRY when either chunk cannot be scanned.
 */
export function changedEntryKeys(before: string, after: string): Set<string> {
  const a = scanChunkEntries(before);
  const b = scanChunkEntries(after);
  if (!a.clean || !b.clean) return new Set([EVERY_ENTRY]);
  const changed = new Set<string>();
  const was = byKey(a.entries);
  const now = byKey(b.entries);
  for (const key of new Set([...was.keys(), ...now.keys()])) {
    const x = was.get(key) ?? [];
    const y = now.get(key) ?? [];
    if (x.length !== y.length || x.some((e, i) => before.slice(e.start, e.end) !== after.slice(y[i].start, y[i].end))) {
      changed.add(key);
    }
  }
  return changed;
}

// The chunk without its entries — the prolog, the root's tags, the dictionary's own objects —
// and without the whitespace between tags there, which is layout: an entry's line brings some
// with it and takes some away, and removing the last entry joins what was on either side of it.
function outsideEntries(xml: string, entries: readonly ChunkEntry[]): string {
  let out = '';
  let at = 0;
  for (const entry of entries) {
    out += xml.slice(at, entry.start);
    at = entry.end;
  }
  out += xml.slice(at);
  return out.replace(/>\s+</g, '><').trim();
}

// The model's entries by the key the scan gives an entry, so one lookup per changed entry.
function modelEntries(model: any): Map<string, any[]> {
  const map = new Map<string, any[]>();
  for (const section of (model?.children ?? []) as any[]) {
    for (const entry of (section?.children ?? []) as any[]) {
      const uuid = entry?.metadata?.uuid;
      const key = entryKey(entry?.name, typeof uuid === 'string' ? uuid : null);
      const list = map.get(key);
      if (list) list.push(entry);
      else map.set(key, [entry]);
    }
  }
  return map;
}

// Whether core's check can hold this entry node to the bytes it was read from: an armed check
// reports the empty text, which keeps nothing. See the header, WHAT AN EMPTY ANSWER MEANS.
function checkIsArmed(entry: any): boolean {
  try {
    return keptPartsViolations(entry, '').length > 0;
  } catch {
    return false;
  }
}

/**
 * The entries of `model` an edit has just changed (`changed`, by entryKey) that the check cannot
 * be held to, each as every key it goes by across the edit, for the document to record (see the
 * header, ASKED WHEN THE EDIT IS MADE). `keyBefore` maps the row id that an entry the edit
 * rebuilt in its slot has after it to the key it had before it, which a rename of an entry with
 * no UUID changes. Null when the edit stated no ops: then all the keys it changed go together,
 * since nothing says which of them was such an entry's before.
 */
export function uncheckableEntries(
  model: any,
  changed: ReadonlySet<string>,
  keyBefore: ReadonlyMap<string, string> | null,
): string[][] {
  // EVERY_ENTRY: a chunk the scan cannot read, which saves only unchanged anyway.
  if (!model || changed.size === 0 || changed.has(EVERY_ENTRY)) return [];
  const groups: string[][] = [];
  for (const section of (model.children ?? []) as any[]) {
    for (const entry of (section?.children ?? []) as any[]) {
      const uuid = entry?.metadata?.uuid;
      const key = entryKey(entry?.name, typeof uuid === 'string' ? uuid : null);
      if (!changed.has(key) || checkIsArmed(entry)) continue;
      if (keyBefore === null) return [[...changed]];
      const before = keyBefore.get(entry.id);
      groups.push(before !== undefined && before !== key ? [key, before] : [key]);
    }
  }
  return groups;
}

const label = (entry: ChunkEntry) => (entry.name === null ? '(an entry with no name)' : `"${decodeXmlText(entry.name)}"`);

const REFUSE = 'Refusing to save: ';

const cannotBeChecked = (name: string) =>
  REFUSE +
  `the edit to entry ${name} cannot be checked: the file spells that entry in a way the check cannot read ` +
  '(a processing instruction inside it, for example), so it cannot confirm that the rest of the entry stays as ' +
  `the file has it. Undo the edit to ${name} to save the rest, or make it in MATLAB.`;

/**
 * Why `chunk` may not be saved over the file `saved` was read from or written as, or null when
 * it may. `edited` holds the keys of the entries the edits since then have changed; `model` is
 * the dictionary node they were made on (null when none is registered). `unchecked` maps the key
 * of each entry those edits changed while the check could not be held to it to every key that
 * entry has gone by (uncheckableEntries).
 */
export function savedChunkRefusal(
  saved: SavedChunk,
  chunk: string,
  edited: ReadonlySet<string>,
  model: any,
  unchecked: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): string | null {
  if (chunk === saved.xml) return null;
  const was = saved.scan;
  const now = scanChunkEntries(chunk);
  if (!was.clean || !now.clean) {
    return (
      REFUSE +
      'the check that a save keeps what no edit changed cannot read this dictionary’s data part entry by entry, ' +
      'so it compared the whole of it with the file as last opened or saved, and they differ. ' +
      'Undo the edits or revert the file, and make the change in MATLAB.'
    );
  }
  const everything = edited.has(EVERY_ENTRY);
  const isEdited = (key: string) => everything || edited.has(key);
  const wasByKey = byKey(was.entries);
  const nowByKey = byKey(now.entries);
  let nodes: Map<string, any[]> | undefined;

  for (const [key, list] of nowByKey) {
    const before = wasByKey.get(key) ?? [];
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      const prior = before[i];
      const text = chunk.slice(entry.start, entry.end);
      if (prior && text === saved.xml.slice(prior.start, prior.end)) continue;
      const name = label(entry);
      if (!isEdited(key)) {
        return (
          REFUSE +
          (prior
            ? `entry ${name} would be written with bytes other than the file’s, though no edit changed it. `
            : `entry ${name} would be added, though no edit added it. `) +
          'This is a fault in the editor, not in your edits: undo them or revert the file, and report it.'
        );
      }
      // Recorded when the edit was made, so whatever has rebuilt its node since, and whatever
      // key a rename has given it: see the header, ASKED WHEN THE EDIT IS MADE.
      const aliases = unchecked.get(key);
      if (aliases && [...aliases].some((alias) => wasByKey.has(alias))) return cannotBeChecked(name);
      nodes ??= modelEntries(model);
      const decoded = entry.name === null ? null : decodeXmlText(entry.name);
      const candidates = (nodes.get(key) ?? []).filter((n) => n.name === decoded);
      if (candidates.length !== 1) {
        return (
          REFUSE +
          `entry ${name} in the text to be saved ` +
          (candidates.length === 0 ? 'is not in the dictionary the edits were made to' : 'matches more than one entry of the dictionary') +
          ', so the check cannot tell what the edits changed in it. Undo the edits to it to save the rest.'
        );
      }
      const node = candidates[0];
      const changed = keptPartsViolations(node, text);
      if (changed.length > 0) {
        const parts = changed.slice(0, 5).join('; ') + (changed.length > 5 ? `; and ${changed.length - 5} more` : '');
        return (
          REFUSE +
          `the edit to entry ${name} would also change parts of it the edit did not touch (${parts}). ` +
          `Undo the edit to ${name} to save the rest.`
        );
      }
      // [] is a pass only from a check that would have reported something: see the header.
      if (prior && keptPartsViolations(node, '').length === 0) return cannotBeChecked(name);
    }
  }
  for (const [key, list] of wasByKey) {
    const after = nowByKey.get(key) ?? [];
    if (list.length > after.length && !isEdited(key)) {
      return (
        REFUSE +
        `entry ${label(list[after.length])} would be dropped from the file, though no edit removed it. ` +
        'This is a fault in the editor, not in your edits: undo them or revert the file, and report it.'
      );
    }
  }
  if (outsideEntries(saved.xml, was.entries) !== outsideEntries(chunk, now.entries)) {
    return (
      REFUSE +
      'the parts of the data part outside its entries (the dictionary’s own settings and references) would change, ' +
      'though no edit changes them. This is a fault in the editor, not in your edits: undo them or revert the file, ' +
      'and report it.'
    );
  }
  return null;
}
