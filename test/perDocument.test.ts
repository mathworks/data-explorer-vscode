// Copyright 2026 The MathWorks, Inc.
//
// One object per open document, shared by its tables (perDocument.ts): the JSON editor's engine,
// made by a document's first table and disposed with its last, so the next table to open makes a
// fresh one, as the editor's module-level document state was forgotten with its last tab. Across
// provider instances too, since the map is the module's and not a provider's.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PerDocument, closingOnThrow, sameOpenDocument } from '../src/host/perDocument.js';

const A = 'file:///work/a.sldd';
const B = 'file:///work/b.sldd';

function made() {
  const log: string[] = [];
  let n = 0;
  const make = (uri: string) => () => {
    const id = `${uri.slice(-6)}#${++n}`;
    log.push(`make ${id}`);
    return { id, dispose: () => void log.push(`dispose ${id}`) };
  };
  return { log, make };
}

describe("one object per document, its tables'", () => {
  it('is made by the first table, shared by the next, and disposed with the last', () => {
    const docs = new PerDocument<{ id: string; dispose(): void }>();
    const { log, make } = made();
    const first = docs.open(A, make(A));
    const second = docs.open(A, make(A));
    expect(second.value).toBe(first.value);
    expect(log).toEqual(['make a.sldd#1']);
    first.close();
    expect(log, 'a split panel closing leaves it to the one still showing it').toEqual(['make a.sldd#1']);
    expect(docs.peek(A)).toBe(second.value);
    second.close();
    expect(log).toEqual(['make a.sldd#1', 'dispose a.sldd#1']);
    expect(docs.peek(A)).toBeUndefined();
  });

  it('makes a fresh one for a table that opens after the last closed, and keeps each document its own', () => {
    const docs = new PerDocument<{ id: string; dispose(): void }>();
    const { log, make } = made();
    const a = docs.open(A, make(A));
    const b = docs.open(B, make(B));
    expect(b.value).not.toBe(a.value);
    a.close();
    const again = docs.open(A, make(A));
    expect(again.value).not.toBe(a.value);
    expect(log).toEqual(['make a.sldd#1', 'make b.sldd#2', 'dispose a.sldd#1', 'make a.sldd#3']);
    b.close();
    again.close();
  });

  it('counts a table closing once, however often it is told to', () => {
    const docs = new PerDocument<{ id: string; dispose(): void }>();
    const { log, make } = made();
    const first = docs.open(A, make(A));
    const second = docs.open(A, make(A));
    first.close();
    first.close();
    expect(docs.peek(A), 'a second close of one table does not spend the other table’s hold').toBe(second.value);
    second.close();
    expect(log.filter((l) => l.startsWith('dispose'))).toEqual(['dispose a.sldd#1']);
  });
});

/** A TextDocument as the fit asks of it: its identity, and whether VS Code has closed it. */
const textDocument = () => ({ isClosed: false });

/** An engine as the JSON editor holds one: made for one document, disposed once. */
function heldFor(log: string[]) {
  let n = 0;
  return (document: { isClosed: boolean }) => () => {
    const id = `engine#${++n}`;
    log.push(`make ${id}`);
    return { id, document, dispose: () => void log.push(`dispose ${id}`) };
  };
}

describe("a held engine is only the document's while it is that TextDocument, open", () => {
  it('disposes an engine held for another TextDocument of the uri, and makes this table a fresh one, which the stale table’s close leaves alone', () => {
    const docs = new PerDocument<{ id: string; document: { isClosed: boolean }; dispose(): void }>();
    const log: string[] = [];
    const make = heldFor(log);
    const first = textDocument();
    const second = textDocument();
    // A table that was never closed (its resolve threw before its dispose was wired) holds the first.
    const stale = docs.open(A, make(first), (h) => sameOpenDocument(h, first));
    const fresh = docs.open(A, make(second), (h) => sameOpenDocument(h, second));
    expect(fresh.value).not.toBe(stale.value);
    expect(fresh.value.document).toBe(second);
    expect(log).toEqual(['make engine#1', 'dispose engine#1', 'make engine#2']);
    stale.close();
    expect(docs.peek(A), 'a close of the stale table does not take the fresh engine').toBe(fresh.value);
    expect(log).toEqual(['make engine#1', 'dispose engine#1', 'make engine#2']);
    fresh.close();
    expect(log.at(-1)).toBe('dispose engine#2');
  });

  it('disposes an engine whose TextDocument VS Code has closed since, and makes a fresh one even for that same object', () => {
    const docs = new PerDocument<{ id: string; document: { isClosed: boolean }; dispose(): void }>();
    const log: string[] = [];
    const make = heldFor(log);
    const document = textDocument();
    const first = docs.open(A, make(document), (h) => sameOpenDocument(h, document));
    const same = docs.open(A, make(document), (h) => sameOpenDocument(h, document));
    expect(same.value, 'the same open document: one engine').toBe(first.value);
    document.isClosed = true;
    const after = docs.open(A, make(document), (h) => sameOpenDocument(h, document));
    expect(after.value).not.toBe(first.value);
    expect(log).toEqual(['make engine#1', 'dispose engine#1', 'make engine#2']);
    first.close();
    same.close();
    after.close();
  });
});

describe('a table opened by a resolve that throws', () => {
  it('is closed before the throw goes on, and leaves no engine held for a later tab', () => {
    const docs = new PerDocument<{ id: string; dispose(): void }>();
    const { log, make } = made();
    expect(() =>
      closingOnThrow(docs.open(A, make(A)), () => {
        throw new Error('the webview refused its options');
      }),
    ).toThrow('the webview refused its options');
    expect(docs.peek(A)).toBeUndefined();
    expect(log).toEqual(['make a.sldd#1', 'dispose a.sldd#1']);
  });

  it('stays open when nothing throws, and answers what the rest answered', () => {
    const docs = new PerDocument<{ id: string; dispose(): void }>();
    const { log, make } = made();
    const opened = docs.open(A, make(A));
    expect(closingOnThrow(opened, (o) => o.value.id)).toBe('a.sldd#1');
    expect(docs.peek(A)).toBe(opened.value);
    expect(log).toEqual(['make a.sldd#1']);
    opened.close();
  });

  it('is how the JSON editor opens each tab’s table, and how its document keeps an engine to its own TextDocument', () => {
    // SlddTextEditorProvider imports vscode, so where it opens the table is read from its source.
    const read = (f: string) => readFileSync(fileURLToPath(new URL(`../src/host/${f}`, import.meta.url)), 'utf8');
    const provider = read('SlddTextEditorProvider.ts');
    expect(provider).toMatch(/closingOnThrow\(openJsonTable\(document, name, /);
    expect(provider.match(/\bopenJsonTable\(/g)).toHaveLength(1);
    // And the panel's dispose is wired inside it, after which the table's close is the panel's.
    const wrapped = provider.slice(provider.indexOf('closingOnThrow(openJsonTable('));
    expect(wrapped).toContain('webviewPanel.onDidDispose(');
    expect(read('jsonDocument.ts')).toMatch(/\(h\) => sameOpenDocument\(h, document\)/);
  });
});
