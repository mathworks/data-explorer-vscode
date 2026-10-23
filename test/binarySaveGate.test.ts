// Copyright 2026 The MathWorks, Inc.
//
// The binary .sldd save gate (src/host/binarySaveGate.ts), driven the way
// BinarySlddEditorProvider drives it: a real dictionary read with readSlddParts and registered
// in DataModel, an edit made on the model through entryOps.mutateEntry and spliced into the
// chunk by core's spliceEntryObject (or one of xmlStructuralEdit's structural edits), the keys
// the edit records, and then the gate asked about the chunk the save would write.
//
// The provider imports `vscode` and cannot run here, so its bookkeeping is reproduced from what
// it calls: pushEdit records `changedEntryKeys` (or the patch's keys) in `edited` and the answer
// of `uncheckableEntries` in `unchecked` (markUnchecked: every key of a group maps to the group),
// and writeTo hands the gate `saved`, the chunk, `edited`, the registered model and `unchecked`.
//
// What is pinned is the D12 rule in both directions — what no edit changed must be its bytes, and
// an edited entry must keep what its edit did not touch — and the invariants between the paths
// that feed the gate: what an edit records is what the gate pairs by, and what the edit-time
// question (uncheckableEntries) finds is refused at the save even after the node it asked about
// has been rebuilt from the text the edit wrote, which is what makes the save-time question pass.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { DataModel, DATA_PART_XML, entrySelectorOf, spliceEntryObject } from 'data-explorer-core';
import {
  changedEntryKeys,
  EVERY_ENTRY,
  savedChunkRefusal,
  SavedChunk,
  uncheckableEntries,
} from '../src/host/binarySaveGate.js';
import { chunkEntryKey, entryKey, scanChunkEntries } from '../src/host/chunkEntries.js';
import { mutateEntry } from '../src/host/entryOps.js';
import { readSlddParts } from '../src/host/slddContent.js';
import { addNewEntryXml, deleteEntryXml } from '../src/host/xmlStructuralEdit.js';

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

/** The text of the entry `name` in `chunk`, and a way to replace it. */
function entryText(chunk: string, name: string) {
  const e = scanChunkEntries(chunk).entries.find((x) => x.name === name)!;
  expect(e, `"${name}" is in the chunk`).toBeTruthy();
  const text = chunk.slice(e.start, e.end);
  return { text, key: chunkEntryKey(e), with: (next: string) => chunk.slice(0, e.start) + next + chunk.slice(e.end) };
}

/** An entry whose bytes hold a processing instruction, which core's kept-parts scan cannot read. */
const withInstruction = (xml: string, marker: string) => {
  expect(xml.includes(marker)).toBe(true);
  return xml.replace(marker, marker + '<?keep me?>');
};

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

describe('SavedChunk', () => {
  it('scans the chunk once, when the gate first asks', () => {
    const saved = new SavedChunk(PARAMS.xml);
    const scan = saved.scan;
    expect(scan.clean).toBe(true);
    expect(scan.entries.length).toBe(40);
    expect(saved.scan).toBe(scan);
  });
});

describe('changedEntryKeys — what an edit that stated no ops changed', () => {
  it('is nothing for the same chunk', () => {
    expect(changedEntryKeys(PARAMS.xml, PARAMS.xml)).toEqual(new Set());
  });

  it('is the entry whose text changed, by the key the gate pairs it by', () => {
    const d = open(PARAMS.xml);
    const node = d.entry('scalarD');
    const after = edit(PARAMS.xml, node, () => node.setProperty('Value', '42'));
    expect(changedEntryKeys(PARAMS.xml, after)).toEqual(new Set([keyOf(node)]));
  });

  it('is an entry only one side holds, removed or added', () => {
    const d = open(PARAMS.xml);
    const node = d.entry('u8Scalar');
    const { newText } = deleteEntryXml(PARAMS.xml, node);
    expect(changedEntryKeys(PARAMS.xml, newText)).toEqual(new Set([keyOf(node)]));
    expect(changedEntryKeys(newText, PARAMS.xml)).toEqual(new Set([keyOf(node)]));
  });

  it('is a key held by more entries on one side than the other', () => {
    const { text } = entryText(PARAMS.xml, 'MyAlias');
    const twice = PARAMS.xml.replace(text, text + '\n    ' + text);
    expect(changedEntryKeys(PARAMS.xml, twice)).toEqual(new Set([entryText(PARAMS.xml, 'MyAlias').key]));
  });

  it('ignores layout between entries, which is not any entry’s text', () => {
    const relaid = PARAMS.xml.replace('</Object>\n    <Object', '</Object>\n\n\t<Object');
    expect(relaid).not.toBe(PARAMS.xml);
    expect(changedEntryKeys(PARAMS.xml, relaid)).toEqual(new Set());
  });

  it('is every entry when either chunk does not scan', () => {
    const broken = PARAMS.xml.replace('<DataSource', '<!DOCTYPE x><DataSource');
    expect(changedEntryKeys(PARAMS.xml, broken)).toEqual(new Set([EVERY_ENTRY]));
    expect(changedEntryKeys(broken, PARAMS.xml)).toEqual(new Set([EVERY_ENTRY]));
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
  it('saves an unchanged chunk whatever is recorded, even with no model', () => {
    const saved = new SavedChunk(PARAMS.xml);
    expect(savedChunkRefusal(saved, PARAMS.xml, new Set(), null)).toBeNull();
    expect(savedChunkRefusal(saved, PARAMS.xml, new Set([EVERY_ENTRY]), null)).toBeNull();
  });

  it('saves a value edit core spliced, when the edit recorded its entry', () => {
    const d = open(PARAMS.xml);
    const node = d.entry('scalarD');
    const after = edit(PARAMS.xml, node, () => node.setProperty('Value', '42'));
    expect(savedChunkRefusal(d.saved, after, new Set([keyOf(node)]), d.model)).toBeNull();
  });

  it('refuses the same chunk when no edit recorded the entry, naming it', () => {
    const d = open(PARAMS.xml);
    const node = d.entry('scalarD');
    const after = edit(PARAMS.xml, node, () => node.setProperty('Value', '42'));
    const refusal = savedChunkRefusal(d.saved, after, new Set([keyOf(d.entry('gravity'))]), d.model);
    expect(refusal).toMatch(/^Refusing to save: entry "scalarD" would be written with bytes other than the file’s, though no edit changed it\./);
    expect(refusal).toContain('a fault in the editor');
  });

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

  it('refuses one of two same-keyed entries dropped, unless the key was edited', () => {
    const { text, key } = entryText(PARAMS.xml, 'MyAlias');
    const twice = PARAMS.xml.replace(text, text + '\n    ' + text);
    const saved = new SavedChunk(twice);
    expect(savedChunkRefusal(saved, PARAMS.xml, new Set(), null)).toMatch(/entry "MyAlias" would be dropped/);
    expect(savedChunkRefusal(saved, PARAMS.xml, new Set([key]), null)).toBeNull();
  });

  it('removing the last entry joins the layout around it, which is not a change outside the entries', () => {
    const d = open(NO_UUID.xml, NO_UUID.meta);
    const { newText } = deleteEntryXml(NO_UUID.xml, d.entry('Kp'));
    expect(scanChunkEntries(newText).entries).toHaveLength(0);
    expect(savedChunkRefusal(d.saved, newText, new Set(['name:Kp']), d.model)).toBeNull();
  });

  it('treats EVERY_ENTRY as every entry edited, so each changed one still meets the model check', () => {
    const d = open(PARAMS.xml);
    const node = d.entry('scalarD');
    const after = edit(PARAMS.xml, node, () => node.setProperty('Value', '42'));
    expect(savedChunkRefusal(d.saved, after, new Set([EVERY_ENTRY]), d.model)).toBeNull();
    const forged = entryText(after, 'scalarD');
    // The gate holds an edited entry to what its edit did NOT touch; whether the touched part
    // is right is the writers' job (the provider's header). The text says 43, the model 42.
    const valueOff = forged.with(forged.text.replace('42.0', '43.0'));
    expect(savedChunkRefusal(d.saved, valueOff, new Set([EVERY_ENTRY]), d.model)).toBeNull();
    // A line the edit did not touch, changed: refused.
    expect(forged.text).toContain('>dacaf35e-55a5-454d-a7c1-93db038a210e<');
    const namespaceOff = forged.with(forged.text.replace('>dacaf35e-', '>00000000-'));
    expect(savedChunkRefusal(d.saved, namespaceOff, new Set([EVERY_ENTRY]), d.model)).toMatch(
      /^Refusing to save: the edit to entry "scalarD" would also change parts of it the edit did not touch/,
    );
  });

  it('refuses a change outside the entries, whatever the edits say', () => {
    const d = open(PARAMS.xml);
    const settings = PARAMS.xml.replace(
      '<P Name="AccessBaseWorkspace" Class="logical">0</P>',
      '<P Name="AccessBaseWorkspace" Class="logical">1</P>',
    );
    expect(settings).not.toBe(PARAMS.xml);
    expect(savedChunkRefusal(d.saved, settings, new Set([EVERY_ENTRY]), d.model)).toMatch(
      /^Refusing to save: the parts of the data part outside its entries .* would change/,
    );
    const prolog = PARAMS.xml.replace('MinRelease="R2014a"', 'MinRelease="R2020a"');
    expect(savedChunkRefusal(d.saved, prolog, new Set([EVERY_ENTRY]), d.model)).toMatch(/outside its entries/);
  });

  it('lets layout between tags outside the entries change', () => {
    const d = open(PARAMS.xml);
    const relaid = PARAMS.xml.replace(
      '<Object Class="DD.Dictionary">\n        <P',
      '<Object Class="DD.Dictionary">\n\t\t<P',
    );
    expect(relaid).not.toBe(PARAMS.xml);
    expect(savedChunkRefusal(d.saved, relaid, new Set(), d.model)).toBeNull();
  });

  it('compares a chunk it cannot scan whole: it saves only unchanged', () => {
    const broken = PARAMS.xml.replace('<DataSource', '<!DOCTYPE x><DataSource');
    const refusal = /^Refusing to save: the check that a save keeps what no edit changed cannot read this dictionary’s data part entry by entry/;
    expect(savedChunkRefusal(new SavedChunk(broken), broken, new Set(), null)).toBeNull();
    expect(savedChunkRefusal(new SavedChunk(broken), PARAMS.xml, new Set([EVERY_ENTRY]), null)).toMatch(refusal);
    expect(savedChunkRefusal(new SavedChunk(PARAMS.xml), broken, new Set([EVERY_ENTRY]), null)).toMatch(refusal);
  });
});

describe('savedChunkRefusal — an edited entry keeps what the edit did not touch', () => {
  it('refuses a writer that also changed an untouched part, naming where', () => {
    const d = open(PARAMS.xml);
    const struct = d.entry('myStruct');
    const after = edit(PARAMS.xml, struct, () => struct.children[0].setProperty('Value', '9'));
    expect(savedChunkRefusal(d.saved, after, new Set([keyOf(struct)]), d.model)).toBeNull();
    const e = entryText(after, 'myStruct');
    expect(e.text).toContain('<P Name="c" Class="char">txt</P>');
    const lossy = e.with(e.text.replace('<P Name="c" Class="char">txt</P>', '<P Name="c" Class="char">TXT</P>'));
    const refusal = savedChunkRefusal(d.saved, lossy, new Set([keyOf(struct)]), d.model);
    expect(refusal).toMatch(/^Refusing to save: the edit to entry "myStruct" would also change parts of it the edit did not touch \(.*c.*\)\./);
    expect(refusal).toContain('Undo the edit to "myStruct" to save the rest.');
  });

  it('names at most five of the parts, and counts the rest', () => {
    const d = open(PARAMS.xml);
    const gravity = d.entry('gravity');
    const after = edit(PARAMS.xml, gravity, () => gravity.setProperty('Description', 'g'));
    const e = entryText(after, 'gravity');
    let text = e.text;
    for (const [from, to] of [
      ['>9.81<', '>9.8<'],
      ['>real<', '>complex<'],
      ['>1.0 1.0<', '>1.0 2.0<'],
      ['>double<', '>single<'],
      ['>0.0<', '>1.0<'],
      ['>100.0<', '>99.0<'],
      ['>m/s^2<', '>ft/s^2<'],
    ]) {
      expect(text.includes(from), from).toBe(true);
      text = text.replace(from, to);
    }
    const refusal = savedChunkRefusal(d.saved, e.with(text), new Set([keyOf(gravity)]), d.model)!;
    expect(refusal).toMatch(/\(([^;()]+; ){4}[^;()]+; and 2 more\)/);
  });

  it('refuses an edited entry the model it was made on does not hold', () => {
    // A rename in the text that no model mutation made: the UUID pairs it with "scalarD", whose
    // node is not named "renamed".
    const d = open(PARAMS.xml);
    const e = entryText(PARAMS.xml, 'scalarD');
    const renamed = e.with(e.text.replace('>scalarD<', '>renamed<'));
    expect(savedChunkRefusal(d.saved, renamed, new Set([e.key]), d.model)).toMatch(
      /^Refusing to save: entry "renamed" in the text to be saved is not in the dictionary the edits were made to/,
    );
  });

  it('refuses an edited entry when no model is registered', () => {
    const d = open(PARAMS.xml);
    const node = d.entry('scalarD');
    const after = edit(PARAMS.xml, node, () => node.setProperty('Value', '42'));
    expect(savedChunkRefusal(d.saved, after, new Set([keyOf(node)]), null)).toMatch(
      /entry "scalarD" in the text to be saved is not in the dictionary the edits were made to/,
    );
  });

  it('refuses an edited entry that pairs with more than one node', () => {
    const { text, key } = entryText(PARAMS.xml, 'MyAlias');
    const twice = PARAMS.xml.replace(text, text + '\n    ' + text);
    const d = open(twice);
    expect(d.entries().filter((n: any) => n.name === 'MyAlias')).toHaveLength(2);
    // The second copy, edited in the text: the gate cannot tell which node it is.
    const second = scanChunkEntries(twice).entries.filter((x) => x.name === 'MyAlias')[1];
    const edited = twice.slice(0, second.start) + text.replace('>int32<', '>int16<') + twice.slice(second.end);
    expect(savedChunkRefusal(d.saved, edited, new Set([key]), d.model)).toMatch(
      /entry "MyAlias" in the text to be saved matches more than one entry of the dictionary/,
    );
  });

  it('refuses an edited entry whose bytes the check cannot read, rather than passing it unchecked', () => {
    const xml = withInstruction(PARAMS.xml, '<P Name="Value" Class="uint8">200</P>');
    const d = open(xml);
    const node = d.entry('u8Scalar');
    const after = edit(xml, node, () => node.setProperty('Value', '7'));
    const refusal = savedChunkRefusal(d.saved, after, new Set([keyOf(node)]), d.model);
    expect(refusal).toMatch(/^Refusing to save: the edit to entry "u8Scalar" cannot be checked/);
    expect(refusal).toContain('Undo the edit to "u8Scalar" to save the rest, or make it in MATLAB.');
    // The rest of the file is not held hostage by that entry's spelling: an edit to another
    // entry saves.
    const other = open(xml);
    const scalar = other.entry('scalarD');
    const fine = edit(xml, scalar, () => scalar.setProperty('Value', '42'));
    expect(savedChunkRefusal(other.saved, fine, new Set([keyOf(scalar)]), other.model)).toBeNull();
  });
});

describe('uncheckableEntries — asked when the edit is made', () => {
  it('finds nothing without a model, without changes, or for a chunk it cannot scan', () => {
    const d = open(PARAMS.xml);
    expect(uncheckableEntries(null, new Set(['uuid:x']), new Map())).toEqual([]);
    expect(uncheckableEntries(d.model, new Set(), new Map())).toEqual([]);
    expect(uncheckableEntries(d.model, new Set([EVERY_ENTRY]), null)).toEqual([]);
  });

  it('finds nothing for entries read from bytes the check can read, edited or not', () => {
    const d = open(PARAMS.xml);
    const node = d.entry('scalarD');
    edit(PARAMS.xml, node, () => node.setProperty('Value', '42'));
    const every = new Set(d.entries().map(keyOf));
    expect(uncheckableEntries(d.model, every, new Map())).toEqual([]);
  });

  it('finds the edited entry whose bytes the check cannot read, and only when it is one the edit changed', () => {
    const xml = withInstruction(PARAMS.xml, '<P Name="Value" Class="uint8">200</P>');
    const d = open(xml);
    const node = d.entry('u8Scalar');
    edit(xml, node, () => node.setProperty('Value', '7'));
    expect(uncheckableEntries(d.model, new Set([keyOf(node)]), new Map())).toEqual([[keyOf(node)]]);
    expect(uncheckableEntries(d.model, new Set([keyOf(d.entry('scalarD'))]), new Map())).toEqual([]);
  });

  it('without ops, groups every changed key, since nothing says which was the entry before', () => {
    const xml = withInstruction(PARAMS.xml, '<P Name="Value" Class="uint8">200</P>');
    const d = open(xml);
    const node = d.entry('u8Scalar');
    edit(xml, node, () => node.setProperty('Value', '7'));
    const changed = new Set([keyOf(node), 'name:somethingElse']);
    expect(uncheckableEntries(d.model, changed, null)).toEqual([[...changed]]);
  });

  it('carries the key a rename of an entry with no UUID left behind', () => {
    const xml = withInstruction(NO_UUID.xml, '<P Name="Name">Kp</P>');
    const d = open(xml, NO_UUID.meta);
    const node = d.entry('Kp');
    edit(xml, node, () => node.setProperty('Name', 'Kq'));
    expect(keyOf(node)).toBe('name:Kq');
    // keysBeforeEdit: the row id the entry has after the edit, to the key it had before.
    const groups = uncheckableEntries(d.model, new Set(['name:Kp', 'name:Kq']), new Map([[node.id, 'name:Kp']]));
    expect(groups).toEqual([['name:Kq', 'name:Kp']]);
    // A key before that is the key after adds nothing.
    expect(uncheckableEntries(d.model, new Set(['name:Kq']), new Map([[node.id, 'name:Kq']]))).toEqual([['name:Kq']]);
  });
});

describe('the edit-time answer holds at the save, whatever has rebuilt the node since', () => {
  it('an uncheckable value edit is refused after a re-read made its node checkable', () => {
    const xml = withInstruction(PARAMS.xml, '<P Name="Value" Class="uint8">200</P>');
    const d = open(xml);
    const node = d.entry('u8Scalar');
    const after = edit(xml, node, () => node.setProperty('Value', '7'));
    const edited = changedEntryKeys(xml, after);
    const unchecked = markUnchecked(uncheckableEntries(d.model, edited, new Map()));
    expect([...unchecked.keys()]).toEqual([keyOf(node)]);

    // A wide repaint re-reads the chunk: the node now holds the edit's bytes, which the check
    // reads and finds kept. Asked only now, the gate would pass the entry.
    const reread = open(after);
    expect(savedChunkRefusal(d.saved, after, edited, reread.model)).toBeNull();
    // The record made when the edit was is what refuses it.
    expect(savedChunkRefusal(d.saved, after, edited, reread.model, unchecked)).toMatch(
      /^Refusing to save: the edit to entry "u8Scalar" cannot be checked/,
    );
  });

  it('an uncheckable rename of an entry with no UUID is refused under the key it had', () => {
    const xml = withInstruction(NO_UUID.xml, '<P Name="Name">Kp</P>');
    const d = open(xml, NO_UUID.meta);
    const node = d.entry('Kp');
    const after = edit(xml, node, () => node.setProperty('Name', 'Kq'));
    const edited = changedEntryKeys(xml, after);
    expect(edited).toEqual(new Set(['name:Kp', 'name:Kq']));

    // Unpaired, the renamed entry reads as a new one, which has nothing to keep, and the old
    // key's entry as removed by an edit: without the record the gate passes it.
    expect(savedChunkRefusal(d.saved, after, edited, d.model)).toBeNull();
    const unchecked = markUnchecked(uncheckableEntries(d.model, edited, new Map([[node.id, 'name:Kp']])));
    expect(savedChunkRefusal(d.saved, after, edited, d.model, unchecked)).toMatch(
      /^Refusing to save: the edit to entry "Kq" cannot be checked/,
    );
  });

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
