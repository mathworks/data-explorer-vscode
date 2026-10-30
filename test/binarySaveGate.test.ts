// Copyright 2026 The MathWorks, Inc.
//
// Core's binary .sldd save gate (`savedChunkRefusal` and the keys it pairs by), driven the way
// BinarySlddEditorProvider drives it, for the edits only this host makes: an entry added or
// removed by xmlStructuralEdit's structural edits, on a real dictionary read with readSlddParts
// and registered in DataModel, with value edits made through entryOps.mutateEntry and spliced by
// core's spliceEntryObject. The gate's own rules are core's and pinned there
// (test/binarySaveGate.test.ts in data-explorer-core), the same add and delete cases included,
// made there with core's fragment helpers; these pin that this host's structural edits are ones
// the gate pairs as the edit recorded them.
//
// The provider imports `vscode` and cannot run here, so its bookkeeping is reproduced from what
// it calls: pushEdit records `changedEntryKeys` (or the patch's keys) in `edited` and the answer
// of `uncheckableEntries` in `unchecked` (markUnchecked: every key of a group maps to the group),
// and writeTo hands the gate `saved`, the chunk, `edited`, the registered model and `unchecked`.
//
// One refusal is the save's own, not the gate's: a chunk that does not read back. The save is view's
// binary engine's (BinaryEngine.beginSave), whose words and order are pinned here (read, gate, zip,
// in one synchronous call), and the provider calls it before the save's first await.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import {
  createSession,
  DataModel,
  DATA_PART_XML,
  changedEntryKeys,
  entryKey,
  entrySelectorOf,
  savedChunkRefusal,
  SavedChunk,
  scanChunkEntries,
  spliceEntryObject,
} from 'data-explorer-core';
import { mutateEntry } from '../src/host/entryOps.js';
import { createRegisters, readSlddParts } from 'data-explorer-view/model';
import { BinaryEngine, EditStackIndex } from 'data-explorer-view/host';
import { addNewEntryXml, deleteEntryXml } from '../src/host/xmlStructuralEdit.js';
import { blankCommentsAndKeepLines } from './tools/moduleGraph.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const repo = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));

function loadChunk(file: string): { xml: string; meta: Record<string, Uint8Array> } {
  const zip = unzipSync(new Uint8Array(readFileSync(repo(file))));
  const xml = new TextDecoder().decode(zip[DATA_PART_XML]);
  const meta: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(zip)) if (k !== DATA_PART_XML) meta[k] = v;
  return { xml, meta };
}

const PARAMS = loadChunk('test/parity/artifacts/binary/params.sldd');
// One entry, no UUID, every tag on one line: an entry keyed by its name, which a rename changes.
const NO_UUID = loadChunk('test/fixtures/compressed.sldd');

const registered: string[] = [];
let opened = 0;

/** An open binary document: its chunk, the model registered for it, and its last-saved chunk. */
function open(xml: string, meta: Record<string, Uint8Array> = PARAMS.meta) {
  const srcId = `binedit:test://saveGate-${opened++}.sldd`;
  registered.push(srcId);
  const model: any = DataModel.addDataSource(srcId, readSlddParts(xml, meta, []), { path: 'params.sldd' });
  const entries = () => (model.children as any[]).flatMap((s: any) => s.children as any[]);
  const entry = (name: string) => entries().find((e: any) => e.name === name);
  return { xml, model, saved: new SavedChunk(xml), entries, entry };
}

const keyOf = (node: any) => entryKey(node.name, typeof node.metadata?.uuid === 'string' ? node.metadata.uuid : null);

/** A cell edit as the provider makes it: mutate the model, splice the entry by its old selector. */
function edit(chunk: string, node: any, mutate: () => unknown): string {
  const selector = entrySelectorOf(node);
  mutateEntry(node, mutate);
  const after = spliceEntryObject(chunk, node, selector);
  expect(after, `core splices "${selector.name}"`).not.toBeNull();
  return after!;
}

/** BinarySlddDocument.markUnchecked, on a fresh map. */
function markUnchecked(groups: string[][]): Map<string, ReadonlySet<string>> {
  const unchecked = new Map<string, ReadonlySet<string>>();
  for (const group of groups) {
    const keys = new Set<string>(group);
    for (const key of [...keys]) for (const alias of unchecked.get(key) ?? []) keys.add(alias);
    for (const key of keys) unchecked.set(key, keys);
  }
  return unchecked;
}

afterEach(() => {
  for (const srcId of registered.splice(0)) DataModel.removeDataSource(srcId);
});

describe('changedEntryKeys — what an edit that stated no ops changed', () => {
  it('is an entry only one side holds, removed or added', () => {
    const d = open(PARAMS.xml);
    const node = d.entry('u8Scalar');
    const { newText } = deleteEntryXml(PARAMS.xml, node);
    expect(changedEntryKeys(PARAMS.xml, newText)).toEqual(new Set([keyOf(node)]));
    expect(changedEntryKeys(newText, PARAMS.xml)).toEqual(new Set([keyOf(node)]));
  });

  it('is exactly what the gate needs: recorded as edited, the same edits save', () => {
    // The invariant between the two halves: keysOfEdit falls back to changedEntryKeys for an
    // edit with no patch, and the gate must then find every changed entry among them.
    const d = open(PARAMS.xml);
    const struct = d.entry('myStruct');
    let chunk = edit(PARAMS.xml, struct, () => struct.children[0].setProperty('Value', '9'));
    const gravity = d.entry('gravity');
    chunk = edit(chunk, gravity, () => gravity.setProperty('Description', 'g'));
    chunk = deleteEntryXml(chunk, d.entry('u8Scalar')).newText;
    const section = d.model.children.find((s: any) => s.name === 'design');
    chunk = addNewEntryXml(chunk, section, 'Simulink.Parameter').newText;
    const edited = changedEntryKeys(PARAMS.xml, chunk);
    expect(edited.size).toBe(4);
    expect(savedChunkRefusal(d.saved, chunk, edited, d.model)).toBeNull();
  });
});

describe('savedChunkRefusal — what no edit changed must be its bytes', () => {
  it('refuses an entry that appears with no edit adding it', () => {
    const d = open(PARAMS.xml);
    const section = d.model.children.find((s: any) => s.name === 'design');
    const { newText } = addNewEntryXml(PARAMS.xml, section, 'Simulink.Parameter');
    const added = [...changedEntryKeys(PARAMS.xml, newText)];
    expect(added).toHaveLength(1);
    expect(savedChunkRefusal(d.saved, newText, new Set(), d.model)).toMatch(
      /^Refusing to save: entry "[^"]+" would be added, though no edit added it\./,
    );
    // And once the add is recorded, the new entry has nothing to keep: it saves.
    expect(savedChunkRefusal(d.saved, newText, new Set(added), d.model)).toBeNull();
  });

  it('refuses an entry that disappears with no edit removing it, and saves a recorded delete', () => {
    const d = open(PARAMS.xml);
    const node = d.entry('u8Scalar');
    const { newText } = deleteEntryXml(PARAMS.xml, node);
    expect(savedChunkRefusal(d.saved, newText, new Set(), d.model)).toMatch(
      /^Refusing to save: entry "u8Scalar" would be dropped from the file, though no edit removed it\./,
    );
    expect(savedChunkRefusal(d.saved, newText, new Set([keyOf(node)]), d.model)).toBeNull();
  });

  it('removing the last entry joins the layout around it, which is not a change outside the entries', () => {
    const d = open(NO_UUID.xml, NO_UUID.meta);
    const { newText } = deleteEntryXml(NO_UUID.xml, d.entry('Kp'));
    expect(scanChunkEntries(newText).entries).toHaveLength(0);
    expect(savedChunkRefusal(d.saved, newText, new Set(['name:Kp']), d.model)).toBeNull();
  });
});

describe('the edit-time answer holds at the save, whatever has rebuilt the node since', () => {
  it('a recorded entry the last-saved chunk does not hold under any of its keys has nothing to keep', () => {
    const d = open(PARAMS.xml);
    const node = d.entry('scalarD');
    const after = edit(PARAMS.xml, node, () => node.setProperty('Value', '42'));
    const unchecked = markUnchecked([['uuid:not-in-the-file', 'name:nor-this']]);
    expect(savedChunkRefusal(d.saved, after, new Set([keyOf(node)]), d.model, unchecked)).toBeNull();
    // Recorded under the edited entry's key, but every alias is new to the file: still saves.
    const fresh = markUnchecked([[keyOf(node)]]);
    expect(savedChunkRefusal(new SavedChunk(deleteEntryXml(PARAMS.xml, node).newText), after, new Set([keyOf(node)]), d.model, fresh)).toBeNull();
  });
});

describe("the save's own half of the gate: the engine's beginSave, before the save's first await", () => {
  // The provider's save is view's binary engine's (BinaryEngine.beginSave): the gate's read, the
  // gate and the zip. The engine runs here; the provider imports `vscode`, so where it calls the
  // engine is read from its source, with the comments blanked so that only code is matched.
  const engine = () =>
    new BinaryEngine({
      session: createSession(),
      uri: 'file:///work/params.sldd',
      name: 'params.sldd',
      bytes: new Uint8Array(readFileSync(repo('test/parity/artifacts/binary/params.sldd'))),
      sink: { push: () => {}, undo: () => {}, redo: () => {} },
      index: new EditStackIndex(),
      registers: createRegisters(),
    });

  it('refuses a chunk that does not read back, in the words the user is shown', () => {
    const e = engine();
    e.forTests.setChunk('<Root><unterminated');
    expect(() => e.beginSave()).toThrow(/^Refusing to save: the document did not re-parse \(.+\)\.$/);
  });

  it('reads the chunk, gates it and zips it with no await between, so the text gated is the text written', () => {
    // One synchronous call: what it hands back is the bytes, not a promise of them.
    const save = engine().beginSave();
    expect(save.bytes).toBeInstanceOf(Uint8Array);
    // And the save calls it before its first await, so an edit landing on the awaits that follow
    // is the next save's, as its text is.
    const src = blankCommentsAndKeepLines(readFileSync(repo('src/host/BinarySlddEditorProvider.ts'), 'utf8'));
    const start = src.indexOf('  private async writeDocument(');
    expect(start, 'the provider still has writeDocument').toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\n  }\n', start));
    const begin = body.indexOf('document.engine.beginSave()');
    expect(begin).toBeGreaterThan(-1);
    expect(body.slice(0, begin)).not.toMatch(/\bawait\b/);
  });
});
