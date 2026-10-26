// Copyright 2026 The MathWorks, Inc.
//
// The messages every table view answers alike, dispatched once (src/host/tableDispatch.ts): each
// to the handler its type names, with the checks every provider used to spell out on its own — a
// selection that is not an array is an empty one, a link target that is not a string is not
// followed — and what the table leaves out left to the provider's own chain.
import { describe, it, expect } from 'vitest';
import { dispatchCommon, type CommonHandlers } from '../src/host/tableDispatch.js';

/** A table that records every call, with the optional handlers present unless `without` names them. */
function recording(without: (keyof CommonHandlers)[] = []) {
  const calls: unknown[][] = [];
  const all: CommonHandlers = {
    ready: () => void calls.push(['ready']),
    select: (rowIds) => void calls.push(['select', rowIds]),
    navigate: (target) => void calls.push(['navigate', target]),
    requestMatrix: (nodeId) => void calls.push(['requestMatrix', nodeId]),
    requestChildren: (nodeId) => void calls.push(['requestChildren', nodeId]),
    requestEditText: (rowId) => void calls.push(['requestEditText', rowId]),
    undo: () => void calls.push(['undo']),
    redo: () => void calls.push(['redo']),
  };
  for (const key of without) delete (all as any)[key];
  return { calls, handlers: all };
}

describe('dispatchCommon', () => {
  it('hands each message to the handler of its type, and says it answered', () => {
    const { calls, handlers } = recording();
    const messages = [
      { type: 'ready' },
      { type: 'select', rowIds: ['a', 'b'] },
      { type: 'navigate', target: 'gains.mat:kp' },
      { type: 'requestMatrix', nodeId: 'n1' },
      { type: 'requestChildren', nodeId: 'n2' },
      { type: 'requestEditText', rowId: 'r1' },
      { type: 'undo' },
      { type: 'redo' },
    ];
    for (const msg of messages) expect(dispatchCommon(msg, handlers), msg.type).toBe(true);
    expect(calls).toEqual([
      ['ready'],
      ['select', ['a', 'b']],
      ['navigate', 'gains.mat:kp'],
      ['requestMatrix', 'n1'],
      ['requestChildren', 'n2'],
      ['requestEditText', 'r1'],
      ['undo'],
      ['redo'],
    ]);
  });

  it('reads a selection that is not an array as an empty one', () => {
    const { calls, handlers } = recording();
    for (const rowIds of [undefined, null, 'a', 7, { 0: 'a' }]) dispatchCommon({ type: 'select', rowIds }, handlers);
    expect(calls).toEqual(Array.from({ length: 5 }, () => ['select', []]));
  });

  it('follows only a string link target, and still answers the message', () => {
    const { calls, handlers } = recording();
    for (const target of [undefined, 42, { file: 'x' }]) expect(dispatchCommon({ type: 'navigate', target }, handlers)).toBe(true);
    expect(calls).toEqual([]);
  });

  it('leaves to the provider what its table leaves out: a fetch, an undo, a redo', () => {
    const { calls, handlers } = recording(['requestChildren', 'requestEditText', 'undo', 'redo']);
    for (const type of ['requestChildren', 'requestEditText', 'undo', 'redo']) {
      expect(dispatchCommon({ type, nodeId: 'n', rowId: 'n' }, handlers), type).toBe(false);
    }
    expect(calls).toEqual([]);
  });

  it('answers no other message, and nothing that is not one', () => {
    const { calls, handlers } = recording();
    for (const msg of [{ type: 'edit' }, { type: 'paste', rowId: '' }, { type: 'openFile', path: 'a' }, {}, null, undefined, 'ready', 3]) {
      expect(dispatchCommon(msg, handlers), JSON.stringify(msg)).toBe(false);
    }
    expect(calls).toEqual([]);
  });

  it('calls an undo or redo handler on its table, so a method may read the table', () => {
    let seen: unknown;
    const handlers: CommonHandlers = {
      ready() {},
      select() {},
      navigate() {},
      requestMatrix() {},
      undo() {
        seen = this;
      },
    };
    dispatchCommon({ type: 'undo' }, handlers);
    expect(seen).toBe(handlers);
  });
});

describe('requestEditText', () => {
  it('asks for the text of a row named by a string, and still answers a message that names none', () => {
    const { calls, handlers } = recording();
    for (const rowId of [undefined, null, 7, ['r']]) expect(dispatchCommon({ type: 'requestEditText', rowId }, handlers)).toBe(true);
    expect(calls).toEqual([]);
    dispatchCommon({ type: 'requestEditText', rowId: 'm/v' }, handlers);
    expect(calls).toEqual([['requestEditText', 'm/v']]);
  });
});
