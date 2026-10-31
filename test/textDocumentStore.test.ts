// Copyright 2026 The MathWorks, Inc.
//
// A JSON dictionary's TextDocument as the JSON engine's text (textDocumentStore.ts): the editor's
// own calls, one for one. An edit is ONE WorkspaceEdit holding every patch, in order, its ranges
// taken against the text as it stood when asked, and its answer is the apply's, a rejection
// included. Every listener is a subscription of its own, filtered by uri; a change is the event's
// replacements as listed, with undo and redo said. The text, its version and its dirty flag are the
// document's, read when asked. Over a fake document and workspace, so the VS Code calls are the
// ones recorded.
import { describe, it, expect } from 'vitest';
import { textDocumentStore, type TextDocumentApi, type TextDocumentChangeLike } from '../src/host/textDocumentStore.js';

const URI = 'file:///work/params.sldd';
const UNDO = 2;
const REDO = 3;

/** A document whose text, version and dirty flag a case sets, and whose positions are their offsets, tagged. */
function fakeDocument(text = '{"a": 1, "b": 2}') {
  return {
    uri: { toString: () => URI },
    version: 1,
    isDirty: false,
    text,
    getText() {
      return this.text;
    },
    positionAt: (offset: number) => `@${offset}`,
  };
}

/** A workspace that records each WorkspaceEdit and its subscriptions, and answers an edit as told. */
function fakeApi(answer: () => PromiseLike<boolean> = () => Promise.resolve(true)) {
  const edits: { start: string; end: string; text: string }[][] = [];
  const changeListeners: ((e: TextDocumentChangeLike) => void)[] = [];
  const saveListeners: ((d: { uri: { toString(): string } }) => void)[] = [];
  const commands: string[] = [];
  let disposed = 0;
  const api: TextDocumentApi<string> = {
    applyEdit: (replacements) => {
      edits.push(replacements.map((r) => ({ ...r })));
      return answer();
    },
    onDidChangeTextDocument: (listener) => {
      changeListeners.push(listener);
      return { dispose: () => void (disposed++, changeListeners.splice(changeListeners.indexOf(listener), 1)) };
    },
    onDidSaveTextDocument: (listener) => {
      saveListeners.push(listener);
      return { dispose: () => void (disposed++, saveListeners.splice(saveListeners.indexOf(listener), 1)) };
    },
    undo: () => void commands.push('undo'),
    redo: () => void commands.push('redo'),
    reasons: { undo: UNDO, redo: REDO },
  };
  const change = (e: Partial<TextDocumentChangeLike> & { uri?: string }) => {
    const event: TextDocumentChangeLike = {
      document: { uri: { toString: () => e.uri ?? URI } },
      contentChanges: e.contentChanges ?? [],
      ...(e.reason === undefined ? {} : { reason: e.reason }),
    };
    for (const l of [...changeListeners]) l(event);
  };
  const save = (uri = URI) => {
    for (const l of [...saveListeners]) l({ uri: { toString: () => uri } });
  };
  return { api, edits, change, save, commands, changeListeners, saveListeners, disposed: () => disposed };
}

describe("a TextDocument's text, as the JSON engine reads and writes it", () => {
  it('makes one edit ONE WorkspaceEdit, a replacement per patch in the order given, its ranges from the text as it stands', async () => {
    const doc = fakeDocument();
    const ws = fakeApi();
    const store = textDocumentStore(doc, ws.api);
    const written = store.apply([
      { offset: 6, length: 1, text: '10' },
      { offset: 14, length: 1, text: '20' },
    ]);
    // Built before anything is awaited: the edit is with the workspace already.
    expect(ws.edits).toEqual([
      [
        { start: '@6', end: '@7', text: '10' },
        { start: '@14', end: '@15', text: '20' },
      ],
    ]);
    expect(await written).toBe(true);
    // An entry's span and a catalog's ranges, one undo step: still one edit, in the caller's order.
    void store.apply([
      { offset: 14, length: 1, text: 'x' },
      { offset: 6, length: 0, text: 'y' },
    ]);
    expect(ws.edits[1].map((r) => r.start)).toEqual(['@14', '@6']);
  });

  it("answers what the workspace's apply answers: true, false, or its rejection", async () => {
    const doc = fakeDocument();
    let answer: () => PromiseLike<boolean> = () => Promise.resolve(false);
    const ws = fakeApi(() => answer());
    const store = textDocumentStore(doc, ws.api);
    expect(await store.apply([{ offset: 0, length: 0, text: ' ' }])).toBe(false);
    answer = () => Promise.reject(new Error('Overlapping ranges are not allowed!'));
    await expect(store.apply([{ offset: 0, length: 1, text: 'a' }, { offset: 0, length: 1, text: 'b' }])).rejects.toThrow(
      'Overlapping ranges are not allowed!',
    );
  });

  it("reads the document's text, version and dirty flag when asked, never a copy", () => {
    const doc = fakeDocument('{}');
    const store = textDocumentStore(doc, fakeApi().api);
    expect([store.text, store.version, store.dirty]).toEqual(['{}', 1, false]);
    doc.text = '{"a": 1}';
    doc.version = 2;
    doc.isDirty = true;
    expect([store.text, store.version, store.dirty]).toEqual(['{"a": 1}', 2, true]);
  });

  it("hears this document's changes as their replacements, in the event's order, with an undo or a redo said", () => {
    const ws = fakeApi();
    const store = textDocumentStore(fakeDocument(), ws.api);
    const heard: unknown[] = [];
    store.onChange((c) => void heard.push(c));
    ws.change({ contentChanges: [{ rangeOffset: 14, rangeLength: 1, text: '3' }, { rangeOffset: 6, rangeLength: 1, text: '9' }] });
    ws.change({ contentChanges: [{ rangeOffset: 6, rangeLength: 1, text: '1' }], reason: UNDO });
    ws.change({ contentChanges: [{ rangeOffset: 6, rangeLength: 1, text: '9' }], reason: REDO });
    ws.change({ contentChanges: [] });
    ws.change({ uri: 'file:///work/other.sldd', contentChanges: [{ rangeOffset: 0, rangeLength: 0, text: 'x' }] });
    expect(heard).toEqual([
      {
        changes: [
          { rangeOffset: 14, rangeLength: 1, text: '3' },
          { rangeOffset: 6, rangeLength: 1, text: '9' },
        ],
      },
      { changes: [{ rangeOffset: 6, rangeLength: 1, text: '1' }], reason: 'undo' },
      { changes: [{ rangeOffset: 6, rangeLength: 1, text: '9' }], reason: 'redo' },
      { changes: [] },
    ]);
    // No reason key at all where VS Code gives none (a typed change, a reload, the dirty flip).
    expect(Object.keys(heard[0] as object)).toEqual(['changes']);
  });

  it('gives every listener a subscription of its own, in the order they listen, each ended on its own', () => {
    const ws = fakeApi();
    const store = textDocumentStore(fakeDocument(), ws.api);
    const order: string[] = [];
    const stopFirst = store.onChange(() => void order.push('first'));
    store.onChange(() => void order.push('second'));
    expect(ws.changeListeners).toHaveLength(2);
    ws.change({ contentChanges: [{ rangeOffset: 0, rangeLength: 0, text: ' ' }] });
    expect(order).toEqual(['first', 'second']);
    stopFirst();
    expect(ws.changeListeners).toHaveLength(1);
    expect(ws.disposed()).toBe(1);
  });

  it("hears this document's saves, and no other's", () => {
    const ws = fakeApi();
    const store = textDocumentStore(fakeDocument(), ws.api);
    let saves = 0;
    const stop = store.onSave(() => void saves++);
    ws.save();
    ws.save('file:///work/other.sldd');
    expect(saves).toBe(1);
    stop();
    ws.save();
    expect(saves).toBe(1);
  });

  it("undoes and redoes through VS Code's commands", () => {
    const ws = fakeApi();
    const store = textDocumentStore(fakeDocument(), ws.api);
    store.undo();
    store.redo();
    expect(ws.commands).toEqual(['undo', 'redo']);
  });
});
