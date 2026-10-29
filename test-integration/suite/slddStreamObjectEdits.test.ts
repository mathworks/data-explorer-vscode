// Copyright 2026 The MathWorks, Inc.
// An edit of a Simulink.Parameter's or a Simulink.Signal's property INSIDE a dictionary value that
// is a MAT stream, through the real editors, saved.
//
// A binary dictionary holds an entry's whole Value as hex, `<P Name="Value" … Encoding="hex"
// EncodedLength="n">`, when the value also holds something its XML cannot spell (here a sparse
// array beside the objects), and a text dictionary holds the same stream as cdata once core has
// pasted such an entry into one. Core takes an edit of an allow-listed property of an object in
// such a stream (Value, Description, Min, Max, …) and writes it by swapping that object's cells in
// the stream's subsystem, EncodedLength the exact byte count; everything else in the stream stays
// read-only.
//
// Neither editor saves through core's serializeSource. The binary one splices each edited entry
// into the chunk it keeps as text (core's spliceEntryObject) and its save gate compares that chunk
// with the file's, entry by entry (core's binarySaveGate); the text one writes each edited entry's
// serialize() into the TextDocument. So this asks each editor, through the messages the table
// sends (tools/hostHarness fakePanel): does the table offer the cells core takes and no others,
// does the edit reach the saved bytes, does the gate let it through, does every other entry stay
// the bytes it was, and do undo and redo hold.
//
// The fixtures are core's (test/fixtures/sldd-stream-objects, copied from core's fixtures of the
// same name, which MATLAB wrote): nine entries MATLAB wrote as hex, each a struct, a cell or
// a Parameter holding objects beside a sparse array, and two it wrote as XML. The text dictionary
// with streams in it is made here as core's own tests make it: the fixture's text dictionary with
// every hex entry of the binary one pasted in. What a save holds is cut from it with string slicing
// and a walk of the stream's element tags, never read with the code under test; what it reads as is
// asked of a fresh core session; and the stream each editor writes is held to the one core's own
// save writes for the same edits.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { unzipSync } from 'fflate';
import { DataModel, createSession, ingest } from 'data-explorer-core';
import { BinarySlddEditorProvider } from '../../src/host/BinarySlddEditorProvider';
import { SlddTextEditorProvider } from '../../src/host/SlddTextEditorProvider';
import { ctx, fakePanel, token, waitFor, ws } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

const enc = (text: string) => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

const BINARY_FIXTURE = 'stream_objects_binary.sldd';
const TEXT_FIXTURE = 'stream_objects_text.sldd';
const CHUNK_XML = 'data/chunk0.xml';

/** Sourced from `test/fixtures`, where the vitest suite can reach the same files. */
const fixtureUri = (name: string) =>
  vscode.Uri.joinPath(ws(), '..', '..', '..', 'test', 'fixtures', 'sldd-stream-objects', name);

/** Written OUTSIDE the workspace folder, whose exact file set two other suites assert. */
const workingUri = (name: string) => vscode.Uri.joinPath(ws(), '..', name);

/** The entries MATLAB wrote as hex: each one's whole Value is a stream. */
const STREAMS = ['arr', 'cPh', 'nested', 'pSp', 'pStruct', 'sPh', 'sTh', 'shared', 'sigH'];

/**
 * What core takes an edit of, node by node, in every entry of the binary fixture: the stream
 * entries' objects, by the property the stream stores a value for and a rule writes, the parts of
 * the value that are no object (a field's name, an element's value), and the two XML entries, as
 * they always edited. Every node not listed takes none. Core's own test of the same
 * fixture (test/slddStreamObjects.test.ts there) holds getPropInfo to this.
 */
const OFFERED: Record<string, string[]> = {
  'arr': ['Name'],
  'arr.ps': ['Name'],
  'arr.ps(1)': ['Value', 'Description'],
  'arr.ps(2)': ['Value', 'Description'],
  'arr.sp': ['Name'],
  'arr.sp(1,2)': ['Value'],
  'cPh': ['Name'],
  'cPh{1}': ['Value', 'Description'],
  'cPh{1}.Value': ['Value'],
  'cPh{1}.Value(1)': ['Value'],
  'cPh{1}.Value(2)': ['Value'],
  'cPh{1}.Value(3)': ['Value'],
  'cPh{2}(1,2)': ['Value'],
  'nested': ['Name'],
  'nested.inner': ['Name'],
  'nested.inner.p': ['Name', 'Value', 'Description'],
  'nested.sp': ['Name'],
  'nested.sp(1,2)': ['Value'],
  'pSp': ['Name', 'Min', 'Max', 'Description'],
  'pStruct': ['Name'],
  'pStruct.p': ['Name'],
  'pStruct.p.Value.a': ['Name', 'Value'],
  'pStruct.p.Value.b': ['Name', 'Value'],
  'pStruct.p.Value.b(1)': ['Value'],
  'pStruct.p.Value.b(2)': ['Value'],
  'pStruct.sp': ['Name'],
  'pStruct.sp(1,2)': ['Value'],
  'sPh': ['Name'],
  // And a Unit, which the stream writes as a dictionary writes one of an object outside one (a
  // Signal's DataType too, which core offers and the table edits in no cell).
  'sPh.p': ['Name', 'Value', 'Min', 'Max', 'Unit', 'Description'],
  'sPh.q': ['Name', 'Value'],
  'sPh.sp': ['Name'],
  'sPh.sp(1,2)': ['Value'],
  'sTh': ['Name'],
  'sTh.t': ['Name', 'Value', 'Max'],
  'sTh.sp': ['Name'],
  'sTh.sp(1,2)': ['Value'],
  'shared': ['Name'],
  'shared.a': ['Name', 'Value', 'Description'],
  'shared.b': ['Name', 'Value', 'Description'],
  'shared.sp': ['Name'],
  'shared.sp(1,2)': ['Value'],
  'sigH': ['Name'],
  'sigH.sig': ['Name', 'Min', 'Max', 'Unit', 'Description'],
  'sigH.sp': ['Name'],
  'sigH.sp(1,2)': ['Value'],
  'plainP': ['Name', 'Value', 'Min', 'Max', 'Unit', 'Description', 'storageClass'],
  'plainS': ['Name'],
  'plainS.x': ['Name', 'Value'],
};

/** The words core refuses a part of a stream with that no rule writes, as an encoded value always had them. */
const ENCODED_REASON = /is stored as an encoded MATLAB value that this editor can show but not write, so it is read-only\.$/;

/** One edit: at the node with MATLAB path `path`, the property `prop` set to `text`. */
type Edit = [path: string, prop: string, text: string];

// --- reading a dictionary, without the editors -------------------------------------------

const subtree = (n: any): any[] => [n, ...((n.children ?? []) as any[]).flatMap(subtree)];

/** The node at MATLAB path `path`, among the entries of a dictionary's Design Data. */
function nodeAt(root: any, path: string): any {
  for (const entry of root.getSection('design').children as any[]) {
    for (const node of subtree(entry)) if (node.matlabPath === path) return node;
  }
  assert.fail(`the dictionary holds a node at ${path}`);
}

/** A dictionary as a fresh core session reads it: what reopening the file shows. */
function reopened(bytes: Uint8Array, filename: string): any {
  return ingest(createSession(), bytes, { filename });
}

/** What a reopen shows of a node: its value and the properties an edit in a stream writes. */
function shown(node: any): string {
  return JSON.stringify([node.displayValue, node.Description, node.Min, node.Max, node.Unit, node.DataType]);
}

/** That each of `names` reads back from a save, row for row, as the editor showed it before the save. */
function assertReadsAsEdited(back: any, model: any, names: string[]): void {
  const rows = (root: any, name: string) => subtree(nodeAt(root, name)).map((n) => `${n.matlabPath} ${shown(n)}`);
  for (const name of names) assert.deepStrictEqual(rows(back, name), rows(model, name), `${name} reads back as the editor showed it`);
}

/** Core's own save of `bytes` after `edits`, made as a host makes them (setActive, then editProperty). */
function coreSaved(bytes: Uint8Array, filename: string, edits: Edit[]): Uint8Array {
  const session = createSession();
  const root: any = ingest(session, bytes, { filename });
  session.setActiveContext(root);
  for (const [path, prop, text] of edits) {
    const node = nodeAt(root, path);
    session.setActive(root, node);
    assert.strictEqual(session.editProperty(node.id, prop, text), true, `core takes ${path} ${prop} = ${text}`);
  }
  const out: any = session.serializeSource(root.name);
  return out.kind === 'binary' ? out.bytes : enc(out.text);
}

/** Core's refusal of one edit, on a fresh read of `bytes`. */
function coreRefusal(bytes: Uint8Array, filename: string, [path, prop, text]: Edit): string {
  const session = createSession();
  const root: any = ingest(session, bytes, { filename });
  session.setActiveContext(root);
  const node = nodeAt(root, path);
  session.setActive(root, node);
  const result: any = session.editProperty(node.id, prop, text);
  assert.ok(result && result.error, `core refuses ${path} ${prop} = ${text}`);
  return String(result.reason);
}

/** What the table offers an editor for in a row, as the webview decides it (dex-tree-table _cellEditTarget). */
function offeredBy(row: any): string[] {
  const keys: string[] = [];
  if (row.Name?.editable) keys.push('Name');
  if (row.Value && typeof row.Value === 'object' ? row.Value.editable : row._valueEditable) keys.push('Value');
  for (const [key, cell] of Object.entries(row)) {
    if (key !== 'Name' && key !== 'Value' && cell && typeof cell === 'object' && (cell as any).editable === true) keys.push(key);
  }
  if (row._descriptionEditable !== false) keys.push('Description');
  return keys.sort();
}

/** The newest row the table was sent for `nodeId`. */
function rowOf(posts: any[], nodeId: string): any {
  for (let i = posts.length - 1; i >= 0; i--) {
    const msg = posts[i];
    if (msg.type !== 'setRows' && msg.type !== 'updateEntryRows' && msg.type !== 'insertEntryRows') continue;
    const row = (msg.rows as any[]).find((r) => r.ID === nodeId);
    if (row) return row;
  }
  assert.fail(`the table was sent a row for ${nodeId}`);
}

const problemsIn = (posts: any[]) => posts.filter((m) => m.type === 'error' || m.type === 'validationError' || m.type === 'refused');

/** Every node of `root`'s stream entries and controls, each with what its newest row offers. */
function offeredInTable(root: any, posts: any[]): Record<string, string[]> {
  const got: Record<string, string[]> = {};
  for (const entry of root.getSection('design').children as any[]) {
    for (const node of subtree(entry)) {
      const keys = offeredBy(rowOf(posts, node.id));
      if (keys.length > 0) got[node.matlabPath] = keys;
    }
  }
  return got;
}

const sorted = (offered: Record<string, string[]>) =>
  Object.fromEntries(Object.entries(offered).map(([k, v]) => [k, [...v].sort()]));

// --- a MAT stream, read by hand ----------------------------------------------------------

/**
 * Where each element of a stream ends: an 8-byte preamble, then each element's 8-byte tag (its
 * type, then its byte count) and its data padded to 8 bytes — getByteStreamFromArray's layout, as
 * MATLAB writes it into a dictionary. A stream an edit can be written into is two elements: the
 * value, then the subsystem its objects ride in.
 */
function elementEnds(bytes: Uint8Array, count: number): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ends: number[] = [];
  let at = 8;
  while (ends.length < count && at + 8 <= bytes.length) {
    at += 8 + Math.ceil(view.getUint32(at + 4, true) / 8) * 8;
    ends.push(at);
  }
  return ends;
}

/** A text dictionary's cdata as bytes: six bits a character, offset by 0x20, a trailing part byte dropped. */
function sixBit(text: string): Uint8Array {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < text.length; i++) {
    acc = ((acc << 6) | ((text.charCodeAt(i) - 0x20) & 0x3f)) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

// --- a binary dictionary's chunk, cut by hand ---------------------------------------------

/** A chunk cut before each entry: the text before the first, and each entry's text up to the next, by name. */
function chunkEntries(xml: string): { head: string; entries: Map<string, string> } {
  const [head, ...parts] = xml.split(/(?=<Object Class="DD\.ENTRY">)/);
  const entries = new Map<string, string>();
  for (const part of parts) {
    const name = /<P Name="Name" Class="char">([^<]*)<\/P>/.exec(part);
    assert.ok(name, 'each entry of the chunk spells its name');
    entries.set(name![1], part);
  }
  return { head, entries };
}

const HEX_VALUE = /<P Name="Value" Class="([^"]*)" Encoding="hex" EncodedLength="(\d+)">([^<]*)<\/P>/;
const LASTMOD = /<P Name="LastMod" Class="char">[^<]*<\/P>/;

/** An entry's hex Value: its tag's Class and EncodedLength, its text, and the bytes its digits spell. */
function hexValue(entry: string): { tag: string; cls: string; encodedLength: number; digits: number; bytes: Uint8Array } {
  const m = HEX_VALUE.exec(entry);
  assert.ok(m, `the entry holds a hex Value (${entry.slice(0, 160)})`);
  const digits = m![3].replace(/\s+/g, '');
  const bytes = new Uint8Array(digits.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(digits.substr(2 * i, 2), 16);
  return { tag: m![0], cls: m![1], encodedLength: Number(m![2]), digits: digits.length, bytes };
}

/**
 * That `saved`'s chunk is `original`'s with only the Value and the LastMod of the entries in
 * `edited` changed, each still a stream of a value and its subsystem whose EncodedLength is its
 * byte count, the value's bytes as they were; and that its other members are the file's.
 */
function assertOnlyStreamsChanged(original: Record<string, Uint8Array>, saved: Record<string, Uint8Array>, edited: string[]): void {
  assert.deepStrictEqual(Object.keys(saved).sort(), Object.keys(original).sort(), 'the package holds the members it held');
  for (const member of Object.keys(original)) {
    if (member !== CHUNK_XML) assert.ok(sameBytes(saved[member], original[member]), `${member} is the bytes it was`);
  }
  const was = chunkEntries(dec(original[CHUNK_XML]));
  const now = chunkEntries(dec(saved[CHUNK_XML]));
  assert.strictEqual(now.head, was.head, 'the text before the first entry is as it was');
  assert.deepStrictEqual([...now.entries.keys()], [...was.entries.keys()], 'the entries are the ones there were, in their order');
  for (const [name, text] of was.entries) {
    const after = now.entries.get(name)!;
    if (!edited.includes(name)) {
      assert.strictEqual(after, text, `${name}, which no edit touched, is the bytes MATLAB wrote`);
      continue;
    }
    assert.notStrictEqual(after, text, `${name} was written`);
    const before = hexValue(text);
    const hex = hexValue(after);
    const mask = (entry: string, tag: string) => entry.replace(tag, '<VALUE/>').replace(LASTMOD, '<LASTMOD/>');
    assert.strictEqual(mask(after, hex.tag), mask(text, before.tag), `${name} changes in its Value and its LastMod alone`);
    assert.strictEqual(hex.cls, before.cls, `${name}'s Value keeps its Class`);
    assert.strictEqual(hex.digits, 2 * hex.bytes.length, `${name}'s hex is whole bytes`);
    assert.strictEqual(hex.encodedLength, hex.bytes.length, `${name}'s EncodedLength is the byte count its hex spells`);
    const ends = elementEnds(hex.bytes, 3);
    assert.deepStrictEqual(ends.slice(1), [hex.bytes.length], `${name}'s stream is a value and its subsystem, and nothing more`);
    const valueEnd = elementEnds(before.bytes, 1)[0];
    assert.strictEqual(ends[0], valueEnd, `${name}'s value element is as long as it was`);
    assert.ok(sameBytes(hex.bytes.subarray(0, valueEnd), before.bytes.subarray(0, valueEnd)), `${name}'s value element is the bytes it was`);
  }
}

// --- the binary editor -------------------------------------------------------------------

/** A working copy of the binary fixture, open in the real provider and painted through a stand-in panel. */
async function openBinary(copyName: string) {
  const bytes = await vscode.workspace.fs.readFile(fixtureUri(BINARY_FIXTURE));
  const original = unzipSync(bytes);
  const uri = workingUri(copyName);
  await vscode.workspace.fs.writeFile(uri, bytes);
  const provider = new BinarySlddEditorProvider(ctx());
  const edits: vscode.CustomDocumentEditEvent<vscode.CustomDocument>[] = [];
  const sub = provider.onDidChangeCustomDocument((e) => edits.push(e));
  const doc: any = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
  const view = fakePanel();
  await provider.resolveCustomEditor(doc, view.panel, token());
  // No waits in here: this provider answers `ready`, `edit` and `addChild` synchronously.
  view.send({ type: 'ready' });
  assert.ok(view.posts.some((m) => m.type === 'setRows'), 'the first paint sent the whole table');
  const model = () => DataModel.getDataSource(doc.srcId) as any;

  /** One cell edit, as the table sends it; the posts it caused. */
  const edit = ([path, prop, text]: Edit): any[] => {
    const node = nodeAt(model(), path);
    const mark = view.posts.length;
    view.send({ type: 'edit', rowId: node.id, columnId: prop, oldValue: '', newValue: text });
    return view.posts.slice(mark);
  };

  /** Save, and read back the members the file now holds. */
  const save = async (): Promise<Record<string, Uint8Array>> => {
    await provider.saveCustomDocument(doc, token());
    return unzipSync(await vscode.workspace.fs.readFile(uri));
  };

  const close = async () => {
    view.close();
    sub.dispose();
    doc.dispose();
    await vscode.workspace.fs.delete(uri);
  };
  return { uri, bytes, original, doc, view, edits, model, edit, save, close };
}

/** The Value tag core's own save writes for `name` after `edits` of the binary fixture. */
function coreValueTag(bytes: Uint8Array, edits: Edit[], name: string): string {
  const saved = unzipSync(coreSaved(bytes, BINARY_FIXTURE, edits));
  return hexValue(chunkEntries(dec(saved[CHUNK_XML])).entries.get(name)!).tag;
}

suite('An object inside a binary .sldd value stream, edited in the binary editor', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  test('the table offers an editor for each property core takes in a stream, and for nothing else there', async () => {
    const b = await openBinary('stream_bin_offered.sldd');
    try {
      assert.deepStrictEqual(sorted(offeredInTable(b.model(), b.view.posts)), sorted(OFFERED));
    } finally {
      await b.close();
    }
  });

  test('a Value and a Description edited in hex save as that stream, its EncodedLength exact, every other entry as MATLAB wrote it', async () => {
    const EDITS: Edit[] = [
      ['sPh.p', 'Value', '7'],
      ['sPh.p', 'Description', 'new description'],
      ['pSp', 'Description', 'sparse described'],
      ['cPh{1}.Value(2)', 'Value', '20'],
    ];
    const b = await openBinary('stream_bin_edit.sldd');
    try {
      for (const e of EDITS) assert.deepStrictEqual(problemsIn(b.edit(e)), [], `${e.join(' ')} was taken`);
      assert.strictEqual(b.edits.length, EDITS.length, 'one undo step an edit');
      // Painted from the edited model, before any save.
      assert.strictEqual(rowOf(b.view.posts, nodeAt(b.model(), 'sPh.p').id).Value, '7');
      assert.strictEqual(rowOf(b.view.posts, nodeAt(b.model(), 'sPh.p').id).Description, 'new description');
      assert.strictEqual(rowOf(b.view.posts, nodeAt(b.model(), 'cPh{1}.Value(2)').id).Value, '20');

      const saved = await b.save();
      assertOnlyStreamsChanged(b.original, saved, ['sPh', 'pSp', 'cPh']);
      const now = chunkEntries(dec(saved[CHUNK_XML])).entries;
      for (const name of ['sPh', 'pSp', 'cPh']) {
        assert.strictEqual(hexValue(now.get(name)!).tag, coreValueTag(b.bytes, EDITS, name), `${name}'s stream is the one core's own save writes`);
      }

      const back = reopened(await vscode.workspace.fs.readFile(b.uri), BINARY_FIXTURE);
      assert.strictEqual(nodeAt(back, 'sPh.p').displayValue, '7');
      assert.strictEqual(nodeAt(back, 'sPh.p').Description, 'new description');
      assert.strictEqual(nodeAt(back, 'pSp').Description, 'sparse described');
      assert.strictEqual(nodeAt(back, 'cPh{1}.Value').displayValue, '[1 20 3]');
      assertReadsAsEdited(back, b.model(), ['sPh', 'pSp', 'cPh']);
    } finally {
      await b.close();
    }
  });

  test('undone, the save writes the stream MATLAB wrote; redone, the edit, and the entry takes the next one', async () => {
    const b = await openBinary('stream_bin_undo.sldd');
    try {
      const original: string = b.doc.chunkXml;
      assert.deepStrictEqual(problemsIn(b.edit(['sPh.p', 'Value', '7'])), [], 'the edit was taken');
      const edited: string = b.doc.chunkXml;
      assert.notStrictEqual(edited, original, 'and reached the document');
      const step = b.edits[b.edits.length - 1];

      step.undo();
      assert.strictEqual(b.doc.chunkXml, original, 'undo restored the chunk');
      assert.strictEqual(nodeAt(b.model(), 'sPh.p').displayValue, '5', 'and the model');
      assert.strictEqual(rowOf(b.view.posts, nodeAt(b.model(), 'sPh.p').id).Value, '5', 'and the row');
      let saved = await b.save();
      assert.strictEqual(dec(saved[CHUNK_XML]), dec(b.original[CHUNK_XML]), 'saved undone, the chunk is the bytes MATLAB wrote');

      step.redo();
      assert.strictEqual(b.doc.chunkXml, edited, 'redo restored the edited chunk');
      assert.strictEqual(nodeAt(b.model(), 'sPh.p').displayValue, '7', 'and the model');
      assert.strictEqual(rowOf(b.view.posts, nodeAt(b.model(), 'sPh.p').id).Value, '7', 'and the row');
      // The entry redo rebuilt from the chunk it restored still holds its stream, and takes an edit into it.
      assert.deepStrictEqual(problemsIn(b.edit(['sPh.p', 'Description', 'after redo'])), [], 'the edit after the redo was taken');
      saved = await b.save();
      assertOnlyStreamsChanged(b.original, saved, ['sPh']);
      const both: Edit[] = [['sPh.p', 'Value', '7'], ['sPh.p', 'Description', 'after redo']];
      assert.strictEqual(
        hexValue(chunkEntries(dec(saved[CHUNK_XML])).entries.get('sPh')!).tag,
        coreValueTag(b.bytes, both, 'sPh'),
        "the stream is the one core's own save writes for both edits",
      );
      const back = reopened(await vscode.workspace.fs.readFile(b.uri), BINARY_FIXTURE);
      assert.deepStrictEqual([nodeAt(back, 'sPh.p').displayValue, nodeAt(back, 'sPh.p').Description], ['7', 'after redo']);
    } finally {
      await b.close();
    }
  });

  test("what core refuses in a stream is refused by the table in core's words, and nothing is written", async () => {
    const REFUSED: [Edit, RegExp][] = [
      // No rule writes a Parameter's DataType; the stream's whole value is a struct, edited a field
      // at a time, so it takes no Value typed over it; and a string beside the objects is one the
      // value written anew could not hold.
      [['sPh.p', 'DataType', 'single'], ENCODED_REASON],
      [['sPh', 'Value', '1'], /^Cannot edit the Value of "sPh": it is a struct, whose fields are edited one at a time\.$/],
      [['sPh.q', 'Value', '"abc"'], /^Cannot edit "sPh": sPh\.q would hold a string, which a save does not write into its MAT stream\.$/],
      // An allow-listed property the stream holds no value for, and one the rules refuse.
      [['sTh.t', 'Description', 'x'], /^Cannot edit "sTh": sTh\.t\.Description is at its class default/],
      [['sPh.p', 'Min', '20'], /^Cannot edit "sPh": sPh\.p\.Min \(20\) would be greater than its Max \(10\)/],
      [['pSp', 'Value', '[1 2]'], /^Cannot edit "pSp": pSp\.Value is a sparse double/],
    ];
    const b = await openBinary('stream_bin_refused.sldd');
    try {
      const original: string = b.doc.chunkXml;
      for (const [e, words] of REFUSED) {
        const posts = b.edit(e);
        const refusals = posts.filter((m) => m.type === 'validationError');
        assert.strictEqual(refusals.length, 1, `${e.join(' ')}: one refusal (${JSON.stringify(posts.map((m) => m.type))})`);
        assert.match(refusals[0].reason, words, `${e.join(' ')}: in the words for it`);
        assert.strictEqual(refusals[0].reason, coreRefusal(b.bytes, BINARY_FIXTURE, e), `${e.join(' ')}: core's own`);
        assert.strictEqual(b.doc.chunkXml, original, `${e.join(' ')}: the chunk is as it was`);
      }
      assert.strictEqual(b.edits.length, 0, 'no edit was pushed');
      assert.strictEqual(nodeAt(b.model(), 'sPh.p').displayValue, '5', 'the model is as read');
      const saved = await b.save();
      assert.strictEqual(dec(saved[CHUNK_XML]), dec(b.original[CHUNK_XML]), 'and a save writes the bytes MATLAB wrote');
    } finally {
      await b.close();
    }
  });

  test('a handle two fields share is edited through one, shown by both, written once; the other takes no edit of its own', async () => {
    const b = await openBinary('stream_bin_shared.sldd');
    try {
      assert.deepStrictEqual(problemsIn(b.edit(['shared.a', 'Value', '40'])), [], 'the edit was taken');
      assert.strictEqual(rowOf(b.view.posts, nodeAt(b.model(), 'shared.b').id).Value, '40', 'the other field shows it at once');
      assert.strictEqual(rowOf(b.view.posts, nodeAt(b.model(), 'shared.b').id)._valueEditable, false, 'and offers no editor of its own');
      const posts = b.edit(['shared.b', 'Value', '41']);
      assert.match(
        posts.find((m) => m.type === 'validationError')?.reason ?? '',
        /^Cannot edit "shared": shared\.b is one object with shared\.a \(one handle\)/,
        'an edit through it is refused',
      );
      const saved = await b.save();
      assertOnlyStreamsChanged(b.original, saved, ['shared']);
      assert.strictEqual(
        hexValue(chunkEntries(dec(saved[CHUNK_XML])).entries.get('shared')!).tag,
        coreValueTag(b.bytes, [['shared.a', 'Value', '40']], 'shared'),
        "the stream is the one core's own save writes",
      );
      const back = reopened(await vscode.workspace.fs.readFile(b.uri), BINARY_FIXTURE);
      assert.deepStrictEqual([nodeAt(back, 'shared.a').displayValue, nodeAt(back, 'shared.b').displayValue], ['40', '40']);
    } finally {
      await b.close();
    }
  });

  test('an element added to a Value in a stream, and an edit after the entry is renamed, save as core saves them', async () => {
    const b = await openBinary('stream_bin_structural.sldd');
    try {
      // An element added to a Parameter's array Value, as the table's Add Child sends it.
      const mark = b.view.posts.length;
      b.view.send({ type: 'addChild', rowId: nodeAt(b.model(), 'cPh{1}.Value').id });
      assert.deepStrictEqual(problemsIn(b.view.posts.slice(mark)), [], 'the element was added');
      assert.strictEqual(nodeAt(b.model(), 'cPh{1}.Value').displayValue, '[1 2 3 0]');
      // The entry holding a stream keeps its rename, and the stream takes an edit after it.
      assert.deepStrictEqual(problemsIn(b.edit(['sPh', 'Name', 'sPhRenamed'])), [], 'the rename was taken');
      assert.deepStrictEqual(problemsIn(b.edit(['sPhRenamed.p', 'Value', '7'])), [], 'the edit after it was taken');

      const saved = await b.save();
      const now = chunkEntries(dec(saved[CHUNK_XML])).entries;
      assert.ok(!now.has('sPh') && now.has('sPhRenamed'), 'the entry is saved under its new name');
      const sPh = chunkEntries(dec(b.original[CHUNK_XML])).entries.get('sPh')!;
      const renamed = now.get('sPhRenamed')!;
      const hex = hexValue(renamed);
      assert.strictEqual(hex.encodedLength, hex.bytes.length, "the renamed entry's EncodedLength is its byte count");
      assert.strictEqual(hex.tag, coreValueTag(b.bytes, [['sPh.p', 'Value', '7']], 'sPh'), 'its stream is the one the edit writes without the rename');
      assert.strictEqual(
        renamed.replace(hex.tag, '').replace(LASTMOD, '').replace('>sPhRenamed<', '>sPh<'),
        sPh.replace(hexValue(sPh).tag, '').replace(LASTMOD, ''),
        'and the rest of it is the bytes it was, but for its name',
      );
      // The element added: core's own save of the same gesture.
      const session = createSession();
      const root: any = ingest(session, b.bytes, { filename: BINARY_FIXTURE });
      session.setActiveContext(root);
      session.setActive(root, nodeAt(root, 'cPh{1}.Value'));
      assert.ok(session.addChildTo(nodeAt(root, 'cPh{1}.Value').id), 'core adds the element too');
      const core = unzipSync((session.serializeSource(root.name) as any).bytes);
      assert.strictEqual(hexValue(now.get('cPh')!).tag, hexValue(chunkEntries(dec(core[CHUNK_XML])).entries.get('cPh')!).tag, "cPh's stream is the one core's own save writes");

      const back = reopened(await vscode.workspace.fs.readFile(b.uri), BINARY_FIXTURE);
      assert.strictEqual(nodeAt(back, 'cPh{1}.Value').displayValue, '[1 2 3 0]');
      assert.strictEqual(nodeAt(back, 'sPhRenamed.p').displayValue, '7');
    } finally {
      await b.close();
    }
  });
});

// --- the text editor ---------------------------------------------------------------------

/** The text dictionary's name, as core's tests name the one they make (probe_sldd_stream_objects). */
const PASTED_TEXT = 'orig_text.sldd';

/**
 * The text fixture with every hex entry of the binary one pasted in, as a host pastes one (the
 * entry's serialize(), deep-copied, read into Design Data) and as core then saves it: each one's
 * value the cdata of the stream the binary dictionary holds.
 */
function pastedText(binary: Uint8Array, text: Uint8Array): string {
  const session = createSession();
  const bin: any = ingest(session, binary, { filename: BINARY_FIXTURE });
  const txt: any = ingest(session, text, { filename: PASTED_TEXT });
  for (const entry of bin.getSection('design').children as any[]) {
    const record = entry.serialize();
    if (record?.value?._type === 'encoded') txt.getSection('design').parseEntry(JSON.parse(JSON.stringify(record)));
  }
  return (session.serializeSource(txt.name) as any).text;
}

/** The `{…}` span of the element of `entries` named `name`: the braces walked, those in strings skipped. */
function entrySpan(text: string, name: string): { start: number; end: number } {
  const at = text.indexOf(`"name": ${JSON.stringify(name)},`);
  assert.ok(at >= 0, `the document spells the entry "${name}"`);
  assert.strictEqual(text.indexOf(`"name": ${JSON.stringify(name)},`, at + 1), -1, `and spells it once`);
  const start = text.lastIndexOf('{', at);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return { start, end: i + 1 };
  }
  assert.fail(`the entry "${name}" closes`);
}

/** `text` with each entry of `names` cut out: what an edit of only those entries leaves alone. */
function outside(text: string, names: string[]): string {
  const spans = names.map((name) => ({ name, ...entrySpan(text, name) })).sort((a, b) => a.start - b.start);
  let out = '';
  let at = 0;
  for (const s of spans) {
    out += text.slice(at, s.start) + `<${s.name}>`;
    at = s.end;
  }
  return out + text.slice(at);
}

const entryOf = (text: string, name: string) => {
  const { start, end } = entrySpan(text, name);
  return JSON.parse(text.slice(start, end));
};

/** The stream a cdata value spells, checked to be a value and its subsystem, its text nothing more but MATLAB's NUL padding. */
function cdataStream(value: any, name: string): Uint8Array {
  assert.deepStrictEqual(Object.keys(value), ['_type', '_value'], `${name}'s value is cdata and nothing else`);
  assert.strictEqual(value._type, 'cdata');
  const bytes = sixBit(value._value);
  const ends = elementEnds(bytes, 2);
  assert.strictEqual(ends.length, 2, `${name}'s stream holds a value and its subsystem`);
  const stream = bytes.subarray(0, ends[1]);
  const body = value._value.replace(/\u0000+$/, '');
  assert.strictEqual(body.length, Math.ceil((stream.length * 8) / 6), `${name}'s text spells its stream and nothing more`);
  return stream;
}

/** A working copy of `original`, open in the real text provider and painted through a stand-in panel. */
async function openText(copyName: string, original: string) {
  const uri = workingUri(copyName);
  await vscode.workspace.fs.writeFile(uri, enc(original));
  const doc = await vscode.workspace.openTextDocument(uri);
  const changes: vscode.TextDocumentChangeEvent[] = [];
  const sub = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document.uri.toString() === uri.toString() && e.contentChanges.length > 0) changes.push(e);
  });
  const view = fakePanel();
  await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, view.panel, token());
  view.send({ type: 'ready' });
  await waitFor('the first paint', () => view.posts.some((m) => m.type === 'setRows'));
  const model = () => DataModel.getDataSource(uri.toString()) as any;
  const paints = (from: number) => view.posts.slice(from).filter((m) => m.type === 'setRows' || m.type === 'updateEntryRows').length;

  /** One cell edit, as the table sends it, waited for until it is written and its echo painted, or refused; the posts it caused. */
  const edit = async ([path, prop, text]: Edit): Promise<any[]> => {
    const node = nodeAt(model(), path);
    const mark = view.posts.length;
    const version = doc.version;
    view.send({ type: 'edit', rowId: node.id, columnId: prop, oldValue: '', newValue: text });
    await waitFor(
      `${path} ${prop} = ${text} to be written or refused`,
      () => doc.version > version || problemsIn(view.posts.slice(mark)).length > 0,
    );
    // A write paints the entry before it is made, and again from its own change event; a refusal paints it back, once.
    await waitFor(`the repaint after ${path} ${prop} = ${text}`, () => paints(mark) >= (doc.version > version ? 2 : 1));
    return view.posts.slice(mark);
  };

  /** Apply `edit` to the document as VS Code's undo or redo would, and wait for the table to repaint from it. */
  const apply = async (what: string, change: vscode.WorkspaceEdit) => {
    const mark = view.posts.length;
    const count = changes.length;
    assert.ok(await vscode.workspace.applyEdit(change), `the ${what} applied`);
    await waitFor(`the ${what} to land`, () => changes.length > count);
    await waitFor(`the repaint after the ${what}`, () => paints(mark) >= 1);
  };

  /** Save, and read back what the file now holds. */
  const save = async (): Promise<string> => {
    assert.ok(await doc.save(), 'the document saved');
    return dec(await vscode.workspace.fs.readFile(uri));
  };

  const close = async () => {
    view.close();
    sub.dispose();
    await vscode.workspace.fs.delete(uri);
  };
  return { uri, doc, view, changes, model, edit, apply, save, close };
}

suite('An object inside a text .sldd value stream (pasted cdata), edited in the text editor', () => {
  let binary: Uint8Array;
  let original: string;

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
    binary = await vscode.workspace.fs.readFile(fixtureUri(BINARY_FIXTURE));
    original = pastedText(binary, await vscode.workspace.fs.readFile(fixtureUri(TEXT_FIXTURE)));
    // What these tests need of it: each stream entry the cdata of the stream the binary one holds.
    const hex = chunkEntries(dec(unzipSync(binary)[CHUNK_XML])).entries;
    for (const name of STREAMS) {
      assert.ok(sameBytes(cdataStream(entryOf(original, name).value, name), hexValue(hex.get(name)!).bytes), `${name} is pasted as its stream`);
    }
  });

  /** Core's own save of the text dictionary after `edits`, as text. */
  const coreText = (edits: Edit[]) => dec(coreSaved(enc(original), PASTED_TEXT, edits));

  /** The stream core's own save writes for `name` after `edits` of the binary dictionary. */
  const coreBinaryStream = (edits: Edit[], name: string) =>
    hexValue(chunkEntries(dec(unzipSync(coreSaved(binary, BINARY_FIXTURE, edits))[CHUNK_XML])).entries.get(name)!).bytes;

  /** That `saved` is `original` with only `names` written, each its cdata alone, the stream the same edits write into the binary dictionary. */
  function assertOnlyCdataChanged(saved: string, edits: Edit[], names: string[]): void {
    assert.strictEqual(outside(saved, names), outside(original, names), 'every byte outside the edited entries is as it was');
    const core = coreText(edits);
    for (const name of names) {
      const was = entryOf(original, name);
      const now = entryOf(saved, name);
      assert.notStrictEqual(now.value._value, was.value._value, `${name} was written`);
      assert.strictEqual(now.name, was.name);
      const { lastmod: _a, ...meta } = now.metadata;
      const { lastmod: _b, ...metaWas } = was.metadata;
      assert.deepStrictEqual(meta, metaWas, `${name}'s metadata is as it was, but for its lastmod`);
      const stream = cdataStream(now.value, name);
      assert.ok(sameBytes(stream, coreBinaryStream(edits, name)), `${name}'s stream is the one the same edits write into the binary dictionary`);
      assert.deepStrictEqual(now.value, entryOf(core, name).value, `${name}'s cdata is the one core's own save writes`);
    }
  }

  test('the table offers an editor for each property core takes in a stream, and for nothing else there', async () => {
    const t = await openText('stream_txt_offered.sldd', original);
    try {
      // The stream entries only: the text fixture's own two entries are not the binary one's.
      const inStreams = (offered: Record<string, string[]>) =>
        Object.fromEntries(Object.entries(offered).filter(([path]) => STREAMS.includes(/^[A-Za-z]\w*/.exec(path)![0])));
      assert.deepStrictEqual(inStreams(sorted(offeredInTable(t.model(), t.view.posts))), inStreams(sorted(OFFERED)));
    } finally {
      await t.close();
    }
  });

  test('a Value and a Description edited in cdata save as that cdata alone, the stream the binary dictionary would hold', async () => {
    const EDITS: Edit[] = [
      ['sPh.p', 'Value', '7'],
      ['sPh.p', 'Description', 'new description'],
      ['pSp', 'Description', 'sparse described'],
      ['shared.a', 'Value', '40'],
    ];
    const t = await openText('stream_txt_edit.sldd', original);
    try {
      for (const e of EDITS) assert.deepStrictEqual(problemsIn(await t.edit(e)), [], `${e.join(' ')} was taken`);
      assert.strictEqual(t.changes.length, EDITS.length, 'one write an edit');
      assert.strictEqual(rowOf(t.view.posts, nodeAt(t.model(), 'sPh.p').id).Value, '7');
      assert.strictEqual(rowOf(t.view.posts, nodeAt(t.model(), 'shared.b').id).Value, '40', 'the other field of the shared handle shows it');

      const saved = await t.save();
      assertOnlyCdataChanged(saved, EDITS, ['sPh', 'pSp', 'shared']);
      const back = reopened(enc(saved), PASTED_TEXT);
      assert.deepStrictEqual([nodeAt(back, 'sPh.p').displayValue, nodeAt(back, 'sPh.p').Description], ['7', 'new description']);
      assert.strictEqual(nodeAt(back, 'pSp').Description, 'sparse described');
      assert.deepStrictEqual([nodeAt(back, 'shared.a').displayValue, nodeAt(back, 'shared.b').displayValue], ['40', '40']);
      assertReadsAsEdited(back, t.model(), ['sPh', 'pSp', 'shared']);
    } finally {
      await t.close();
    }
  });

  test('undone, the document is the bytes it opened with; redone, the edit, and the entry takes the next one', async () => {
    const t = await openText('stream_txt_undo.sldd', original);
    try {
      assert.deepStrictEqual(problemsIn(await t.edit(['sPh.p', 'Value', '7'])), [], 'the edit was taken');
      assert.strictEqual(t.changes.length, 1, 'in one write');
      assert.strictEqual(t.changes[0].contentChanges.length, 1, 'of one span');
      const written = t.changes[0].contentChanges[0];
      const edited = t.doc.getText();

      // VS Code's undo of that write: what it replaced, written back over it.
      const undo = new vscode.WorkspaceEdit();
      undo.replace(
        t.uri,
        new vscode.Range(t.doc.positionAt(written.rangeOffset), t.doc.positionAt(written.rangeOffset + written.text.length)),
        original.slice(written.rangeOffset, written.rangeOffset + written.rangeLength),
      );
      await t.apply('undo', undo);
      assert.strictEqual(t.doc.getText(), original, 'the document is the bytes it opened with');
      assert.strictEqual(nodeAt(t.model(), 'sPh.p').displayValue, '5', 'the model is as read');
      assert.strictEqual(rowOf(t.view.posts, nodeAt(t.model(), 'sPh.p').id).Value, '5', 'and so is the row');

      // And its redo.
      const redo = new vscode.WorkspaceEdit();
      redo.replace(
        t.uri,
        new vscode.Range(t.doc.positionAt(written.rangeOffset), t.doc.positionAt(written.rangeOffset + written.rangeLength)),
        written.text,
      );
      await t.apply('redo', redo);
      assert.strictEqual(t.doc.getText(), edited, 'the document is the edited bytes');
      assert.strictEqual(nodeAt(t.model(), 'sPh.p').displayValue, '7', 'the model holds the edit');
      assert.strictEqual(rowOf(t.view.posts, nodeAt(t.model(), 'sPh.p').id).Value, '7', 'and so does the row');

      // The entry the redo was read back into still holds its stream, and takes an edit into it.
      assert.deepStrictEqual(problemsIn(await t.edit(['sPh.p', 'Description', 'after redo'])), [], 'the edit after the redo was taken');
      const saved = await t.save();
      assertOnlyCdataChanged(saved, [['sPh.p', 'Value', '7'], ['sPh.p', 'Description', 'after redo']], ['sPh']);
      const back = reopened(enc(saved), PASTED_TEXT);
      assert.deepStrictEqual([nodeAt(back, 'sPh.p').displayValue, nodeAt(back, 'sPh.p').Description], ['7', 'after redo']);
    } finally {
      await t.close();
    }
  });

  test("what core refuses in a stream is refused by the table in core's words, and nothing is written", async () => {
    const REFUSED: [Edit, RegExp][] = [
      [['sPh.p', 'DataType', 'single'], ENCODED_REASON],
      [['sPh.q', 'Value', '"abc"'], /^Cannot edit "sPh": sPh\.q would hold a string, which a save does not write into its MAT stream\.$/],
      [['sTh.t', 'Description', 'x'], /^Cannot edit "sTh": sTh\.t\.Description is at its class default/],
      [['sPh.p', 'Min', '20'], /^Cannot edit "sPh": sPh\.p\.Min \(20\) would be greater than its Max \(10\)/],
    ];
    const t = await openText('stream_txt_refused.sldd', original);
    try {
      for (const [e, words] of REFUSED) {
        const posts = await t.edit(e);
        const refusals = posts.filter((m) => m.type === 'validationError');
        assert.strictEqual(refusals.length, 1, `${e.join(' ')}: one refusal (${JSON.stringify(posts.map((m) => m.type))})`);
        assert.match(refusals[0].reason, words, `${e.join(' ')}: in the words for it`);
        assert.strictEqual(refusals[0].reason, coreRefusal(enc(original), PASTED_TEXT, e), `${e.join(' ')}: core's own`);
      }
      assert.strictEqual(t.changes.length, 0, 'no write');
      assert.strictEqual(t.doc.getText(), original);
      assert.strictEqual(t.doc.isDirty, false);
    } finally {
      await t.close();
    }
  });
});

// --- between the editors -----------------------------------------------------------------

suite('An entry holding a value stream, copied between the editors, keeps its stream and takes edits there', () => {
  let binary: Uint8Array;
  let text: string;

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
    binary = await vscode.workspace.fs.readFile(fixtureUri(BINARY_FIXTURE));
    text = dec(await vscode.workspace.fs.readFile(fixtureUri(TEXT_FIXTURE)));
  });

  test('edited in the binary editor, pasted into the text editor and edited again: the cdata of the stream both edits write', async () => {
    const b = await openBinary('stream_carry_bin.sldd');
    const t = await openText('stream_carry_txt.sldd', text);
    try {
      assert.deepStrictEqual(problemsIn(b.edit(['sPh.p', 'Description', 'carried'])), [], 'the edit in the binary editor was taken');
      b.view.send({ type: 'copy', rowIds: [nodeAt(b.model(), 'sPh').id] });
      const mark = t.view.posts.length;
      t.view.send({ type: 'paste', rowId: 'section:design' });
      await waitFor('the paste to be written or refused', () => t.changes.length > 0 || problemsIn(t.view.posts.slice(mark)).length > 0);
      assert.deepStrictEqual(problemsIn(t.view.posts.slice(mark)), [], 'the paste was taken');
      await waitFor('the pasted entry in the model', () => (t.model().getSection('design').children as any[]).some((e) => e.name === 'sPh'));

      const pasted = entryOf(t.doc.getText(), 'sPh');
      const edited = hexValue(chunkEntries(b.doc.chunkXml).entries.get('sPh')!).bytes;
      assert.ok(sameBytes(cdataStream(pasted.value, 'sPh'), edited), 'pasted, its cdata is the stream the binary editor holds, edit and all');
      assert.strictEqual(rowOf(t.view.posts, nodeAt(t.model(), 'sPh.p').id)._valueEditable, true, 'and its Parameter offers its Value');

      assert.deepStrictEqual(problemsIn(await t.edit(['sPh.p', 'Value', '7'])), [], 'the edit in the text editor was taken');
      const saved = await t.save();
      const both: Edit[] = [['sPh.p', 'Description', 'carried'], ['sPh.p', 'Value', '7']];
      const twin = hexValue(chunkEntries(dec(unzipSync(coreSaved(binary, BINARY_FIXTURE, both))[CHUNK_XML])).entries.get('sPh')!).bytes;
      assert.ok(sameBytes(cdataStream(entryOf(saved, 'sPh').value, 'sPh'), twin), 'saved, the stream both edits write into the binary dictionary');
      const back = reopened(enc(saved), PASTED_TEXT);
      assert.deepStrictEqual([nodeAt(back, 'sPh.p').displayValue, nodeAt(back, 'sPh.p').Description], ['7', 'carried']);
      assert.strictEqual(outside(saved, ['sPh']).replace(/,\s*<sPh>/, ''), text, 'and the rest of the text dictionary is as it was');
    } finally {
      await t.close();
      await b.close();
    }
  });

  test('pasted from the text editor into the binary editor and edited: hex of the stream the edit writes, its EncodedLength exact', async () => {
    const t = await openText('stream_carry_back_txt.sldd', pastedText(binary, enc(text)));
    const b = await openBinary('stream_carry_back_bin.sldd');
    try {
      // Into a binary dictionary that holds no sPh: the fixture's own, its sPh deleted.
      b.view.send({ type: 'delete', rowIds: [nodeAt(b.model(), 'sPh').id] });
      assert.ok(!chunkEntries(b.doc.chunkXml).entries.has('sPh'), 'the delete reached the document');
      t.view.send({ type: 'copy', rowIds: [nodeAt(t.model(), 'sPh').id] });
      const before: string = b.doc.chunkXml;
      const mark = b.view.posts.length;
      b.view.send({ type: 'paste', rowId: 'section:design' });
      await waitFor('the paste to be written or refused', () => b.doc.chunkXml !== before || problemsIn(b.view.posts.slice(mark)).length > 0);
      assert.deepStrictEqual(problemsIn(b.view.posts.slice(mark)), [], 'the paste was taken');
      const pasted = hexValue(chunkEntries(b.doc.chunkXml).entries.get('sPh')!);
      const matlab = hexValue(chunkEntries(dec(b.original[CHUNK_XML])).entries.get('sPh')!);
      assert.strictEqual(pasted.tag, matlab.tag, 'pasted, its Value is the hex MATLAB wrote for it');

      assert.deepStrictEqual(problemsIn(b.edit(['sPh.p', 'Value', '7'])), [], 'the edit was taken');
      const saved = await b.save();
      const hex = hexValue(chunkEntries(dec(saved[CHUNK_XML])).entries.get('sPh')!);
      assert.strictEqual(hex.encodedLength, hex.bytes.length, 'its EncodedLength is the byte count its hex spells');
      assert.strictEqual(hex.tag, coreValueTag(binary, [['sPh.p', 'Value', '7']], 'sPh'), "its stream is the one core's own save writes");
      const back = reopened(await vscode.workspace.fs.readFile(b.uri), BINARY_FIXTURE);
      assert.strictEqual(nodeAt(back, 'sPh.p').displayValue, '7');
    } finally {
      await b.close();
      await t.close();
    }
  });
});
