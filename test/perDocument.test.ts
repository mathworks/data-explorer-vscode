// Copyright 2026 The MathWorks, Inc.
//
// One object per open document, shared by its tables (perDocument.ts): the JSON editor's engine,
// made by a document's first table and disposed with its last, so the next table to open makes a
// fresh one, as the editor's module-level document state was forgotten with its last tab. Across
// provider instances too, since the map is the module's and not a provider's.
import { describe, it, expect } from 'vitest';
import { PerDocument } from '../src/host/perDocument.js';

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
