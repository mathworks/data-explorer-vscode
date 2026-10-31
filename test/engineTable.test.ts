// Copyright 2026 The MathWorks, Inc.
//
// One panel's end of a table of view's MAT-file engine (engineTable.ts), as the MAT-file editor
// posts it: a whole paint's rows through postOrReport, what follows them only once that post has
// settled, then the host's after-paint work; and everything else the engine says at once, so a
// gesture's rows made while a paint's rows are on their way go out ahead of that paint's trailer,
// as the editor's own `post()` let them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSession } from 'data-explorer-core';
import { createRegisters } from 'data-explorer-view/model';
import { BinaryEngine, EditStack, EditStackIndex, JsonEngine, MatEngine, defaultRegistry } from 'data-explorer-view/host';
import { binaryRows, engineTable, jsonRows, matRows } from '../src/host/engineTable.js';
import { textDocumentStore } from '../src/host/textDocumentStore.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const CASES = new Uint8Array(readFileSync(join(import.meta.dirname, '..', 'test-integration', 'fixtures', 'mat', 'cases.mat')));
const bytes = () => CASES.buffer.slice(CASES.byteOffset, CASES.byteOffset + CASES.byteLength) as ArrayBuffer;

/** A panel whose posts are recorded, and whose setRows posts settle only when `deliver()` is called. */
function heldPanel(rejectRows = false) {
  const posted: any[] = [];
  const waiting: (() => void)[] = [];
  return {
    posted,
    types: () => posted.map((m) => m.type),
    deliver: () => waiting.shift()?.(),
    postMessage(message: any): Promise<boolean> {
      if (message.type !== 'setRows') {
        posted.push(message);
        return Promise.resolve(true);
      }
      return new Promise<boolean>((resolve, reject) => {
        waiting.push(() => {
          if (rejectRows) return reject(new Error('the payload is too large to post'));
          posted.push(message);
          resolve(true);
        });
      });
    },
  };
}

function document() {
  const stack = new EditStack();
  return new MatEngine({
    session: createSession(),
    uri: 'file:///work/cases.mat',
    name: 'cases.mat',
    bytes: bytes(),
    sink: { push: (e) => stack.push(e), undo: () => stack.undo(), redo: () => stack.redo() },
    index: new EditStackIndex(),
    registers: createRegisters(),
    trailerAfterDelivery: true,
  });
}

const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

describe("the MAT-file editor's panel of the engine's table", () => {
  it("posts a paint as the editor's post() did: the rows, then what follows them once delivered, then the drain", async () => {
    const engine = document();
    const panel = heldPanel();
    const said: string[] = [];
    const table = engine.view();
    const relay = engineTable(table, panel, {
      name: 'cases.mat',
      setRows: matRows,
      onRows: (view) => said.push(`rows ${view.editable}`),
      afterPaint: () => said.push(`drained after ${panel.types().join(',')}`),
    });
    relay.ready();
    await settle();
    expect(said).toEqual(['rows true']);
    expect(panel.types()).toEqual([]);
    panel.deliver();
    await settle();
    expect(panel.types()).toEqual(['setRows', 'sectionRules', 'clipboardState']);
    expect(said).toEqual(['rows true', 'drained after setRows,sectionRules,clipboardState']);
    // Spelled as the editor spelled it: its keys in its order, the undefined ones present.
    expect(Object.keys(panel.posted[0])).toEqual(['type', 'docUri', 'rows', 'columns', 'columnLabels', 'columnGroups', 'editable', 'notice', 'add', 'warnings']);
    relay.dispose();
  });

  it("posts a gesture made while a paint's rows are on their way at once, ahead of that paint's trailer", async () => {
    const engine = document();
    const first = heldPanel();
    const second = heldPanel();
    const one = engine.view();
    const two = engine.view();
    engineTable(one, first, { name: 'cases.mat', setRows: matRows }).ready();
    engineTable(two, second, { name: 'cases.mat', setRows: matRows }).ready();
    await settle();
    first.deliver();
    second.deliver();
    await settle();
    first.posted.length = 0;
    // A repaint of the first panel, its rows on their way, and an edit in the second meanwhile.
    void one.repaintAll();
    await settle();
    const row = second.posted.find((m) => m.type === 'setRows').rows.find((r: any) => r.parent == null && r.Name?.label === 'scalarD');
    two.edit({ rowId: row.ID, columnId: 'Value', oldValue: '', newValue: '42' });
    expect(first.types()).toEqual(['updateEntryRows']);
    first.deliver();
    await settle();
    expect(first.types()).toEqual(['updateEntryRows', 'setRows', 'sectionRules', 'clipboardState']);
  });

  it('says rows it cannot deliver failed to show, and sends what follows them all the same', async () => {
    const engine = document();
    const panel = heldPanel(true);
    engineTable(engine.view(), panel, { name: 'cases.mat', setRows: matRows }).ready();
    await settle();
    panel.deliver();
    await settle();
    expect(panel.types()).toEqual(['error', 'sectionRules', 'clipboardState']);
    expect(panel.posted[0].message).toMatch(/^Failed to show cases\.mat: /);
  });

  it('answers a fetch of the rows under a row as the editor did, and says rows it cannot deliver failed to show', async () => {
    const engine = document();
    const posted: any[] = [];
    let refuse = false;
    const panel = {
      postMessage: async (m: any) => {
        if (refuse && m.type === 'childRows') throw new Error('the payload is too large to post');
        posted.push(m);
        return true;
      },
    };
    const relay = engineTable(engine.view(), panel, { name: 'cases.mat', setRows: matRows });
    relay.ready();
    await settle();
    const rows = posted.find((m) => m.type === 'setRows').rows as any[];
    const parent = rows.find((r) => rows.some((c) => c.parent === r.ID));
    relay.children(parent.ID);
    await settle();
    const answer = posted.at(-1);
    expect(Object.keys(answer)).toEqual(['type', 'nodeId', 'rows', 'truncated']);
    expect([answer.type, answer.nodeId, answer.rows.length > 0]).toEqual(['childRows', parent.ID, true]);
    refuse = true;
    relay.children(parent.ID);
    await settle();
    expect(posted.at(-1)).toEqual({ type: 'error', message: expect.stringMatching(/^Failed to show cases\.mat: /) });
  });

  it('posts nothing more once disposed, and a paint waiting on it is let go', async () => {
    const engine = document();
    const panel = heldPanel();
    const table = engine.view();
    const relay = engineTable(table, panel, { name: 'cases.mat', setRows: matRows });
    relay.ready();
    await settle();
    relay.dispose();
    table.dispose();
    panel.deliver();
    await settle();
    expect(panel.types()).toEqual(['setRows']);
  });
});

const PARAMS_BINARY = new Uint8Array(readFileSync(join(import.meta.dirname, '..', 'test', 'parity', 'artifacts', 'binary', 'params.sldd')));

function dictionary() {
  const stack = new EditStack();
  return new BinaryEngine({
    session: createSession(),
    uri: 'file:///work/params.sldd',
    name: 'params.sldd',
    bytes: PARAMS_BINARY,
    sink: { push: (e) => stack.push(e), undo: () => stack.undo(), redo: () => stack.redo() },
    index: new EditStackIndex(),
    registers: createRegisters(),
    trailerAfterDelivery: true,
  });
}

describe("the compressed dictionary editor's panel of the engine's table (rows not awaited)", () => {
  it("posts a paint as the editor's post() did: the rows, then in the same run what follows them, then the drain", async () => {
    const engine = dictionary();
    const posted: any[] = [];
    const said: string[] = [];
    const panel = { postMessage: async (m: any) => (posted.push(m), true) };
    const relay = engineTable(engine.view(), panel, {
      name: 'params.sldd',
      awaitRows: false,
      readyOpens: false,
      setRows: binaryRows,
      afterPaint: () => said.push(`drained after ${posted.map((m) => m.type).join(',')}`),
    });
    relay.ready();
    await settle();
    expect(posted.map((m) => m.type)).toEqual(['setRows', 'sectionRules', 'clipboardState']);
    expect(Object.keys(posted[0])).toEqual(['type', 'docUri', 'rows', 'columns', 'columnLabels', 'columnGroups', 'editable', 'warnings']);
    // A repaint the engine starts: all of it in the run that said it.
    posted.length = 0;
    said.length = 0;
    engine.repaintAll();
    expect(posted.map((m) => m.type)).toEqual(['setRows', 'sectionRules', 'clipboardState']);
    expect(said).toEqual(['drained after setRows,sectionRules,clipboardState']);
    relay.dispose();
  });

  it('says rows it cannot deliver failed to show, after what follows them, as the unawaited post did', async () => {
    const engine = dictionary();
    const posted: any[] = [];
    const panel = {
      postMessage: async (m: any) => {
        if (m.type === 'setRows') throw new Error('the payload is too large to post');
        posted.push(m);
        return true;
      },
    };
    engineTable(engine.view(), panel, { name: 'params.sldd', awaitRows: false, readyOpens: false, setRows: binaryRows }).ready();
    await settle();
    expect(posted.map((m) => m.type)).toEqual(['sectionRules', 'clipboardState', 'error']);
    expect(posted.at(-1).message).toMatch(/^Failed to show params\.sldd: /);
  });
});

const PARAMS_JSON = readFileSync(join(import.meta.dirname, '..', 'test-integration', 'fixtures', 'workspace', 'params.sldd'), 'utf8');

/** A JSON dictionary over a TextDocument that holds still (textDocumentStore.ts, a fake document and workspace). */
function jsonDictionary(uri: string) {
  const document = { uri: { toString: () => uri }, version: 1, isDirty: false, getText: () => PARAMS_JSON, positionAt: (o: number) => o };
  const text = textDocumentStore(document, {
    applyEdit: async () => false,
    onDidChangeTextDocument: () => ({ dispose: () => {} }),
    onDidSaveTextDocument: () => ({ dispose: () => {} }),
    undo: () => {},
    redo: () => {},
    reasons: { undo: 2, redo: 3 },
  });
  return new JsonEngine({
    registry: defaultRegistry,
    uri,
    name: 'params.sldd',
    text,
    registers: createRegisters(),
    disk: { stat: async () => null, read: async () => null },
    trailerAfterDelivery: true,
  });
}

/** Turns until `ok`, for a paint that waits on its Usage column. */
async function until(ok: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !ok(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(ok()).toBe(true);
}

describe("the JSON dictionary editor's panel of the engine's table (ready opens, rows not awaited)", () => {
  it("posts a paint as the editor's post() did: the rows, then in the same run what follows them, then the drain", async () => {
    const engine = jsonDictionary('file:///work/relay-json-order.sldd');
    const table = engine.view();
    const posted: any[] = [];
    const said: string[] = [];
    const panel = { postMessage: async (m: any) => (posted.push(m), true) };
    const relay = engineTable(table, panel, {
      name: 'params.sldd',
      awaitRows: false,
      setRows: jsonRows,
      afterPaint: () => said.push(`drained after ${posted.map((m) => m.type).join(',')}`),
    });
    relay.ready();
    await until(() => said.length > 0);
    expect(posted.map((m) => m.type)).toEqual(['setRows', 'sectionRules', 'clipboardState']);
    expect(said).toEqual(['drained after setRows,sectionRules,clipboardState']);
    expect(Object.keys(posted[0])).toEqual(['type', 'docUri', 'rows', 'columns', 'columnLabels', 'columnGroups', 'editable', 'hasTextView', 'warnings']);
    expect(posted[0].hasTextView).toBe(true);
    // A repaint the engine starts: its rows, what follows them, then the drain, in that order.
    posted.length = 0;
    said.length = 0;
    await table.repaintAll();
    expect(posted.map((m) => m.type)).toEqual(['setRows', 'sectionRules', 'clipboardState']);
    expect(said).toEqual(['drained after setRows,sectionRules,clipboardState']);
    relay.dispose();
    table.dispose();
    engine.dispose();
  });

  it('answers two readys before the first paint lands with one paint, as the newest repaint was the one that landed', async () => {
    const engine = jsonDictionary('file:///work/relay-json-twice.sldd');
    const table = engine.view();
    const posted: any[] = [];
    let drained = 0;
    const panel = { postMessage: async (m: any) => (posted.push(m), true) };
    const relay = engineTable(table, panel, { name: 'params.sldd', awaitRows: false, setRows: jsonRows, afterPaint: () => void drained++ });
    relay.ready();
    relay.ready();
    await until(() => drained > 0);
    await new Promise((r) => setTimeout(r, 10));
    expect(posted.map((m) => m.type)).toEqual(['setRows', 'sectionRules', 'clipboardState']);
    expect(drained).toBe(1);
    relay.dispose();
    table.dispose();
    engine.dispose();
  });

  it('says rows it cannot deliver failed to show, after what follows them, as the unawaited post did', async () => {
    const engine = jsonDictionary('file:///work/relay-json-refused.sldd');
    const table = engine.view();
    const posted: any[] = [];
    const panel = {
      postMessage: async (m: any) => {
        if (m.type === 'setRows') throw new Error('the payload is too large to post');
        posted.push(m);
        return true;
      },
    };
    const relay = engineTable(table, panel, { name: 'params.sldd', awaitRows: false, setRows: jsonRows });
    relay.ready();
    await until(() => posted.some((m) => m.type === 'error'));
    expect(posted.map((m) => m.type)).toEqual(['sectionRules', 'clipboardState', 'error']);
    expect(posted.at(-1).message).toMatch(/^Failed to show params\.sldd: /);
    relay.dispose();
    table.dispose();
    engine.dispose();
  });
});
