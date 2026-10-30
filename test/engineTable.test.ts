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
import { EditStack, EditStackIndex, MatEngine } from 'data-explorer-view/host';
import { engineTable } from '../src/host/engineTable.js';

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
    engineTable(one, first, { name: 'cases.mat' }).ready();
    engineTable(two, second, { name: 'cases.mat' }).ready();
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
    engineTable(engine.view(), panel, { name: 'cases.mat' }).ready();
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
    const relay = engineTable(engine.view(), panel, { name: 'cases.mat' });
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
    const relay = engineTable(table, panel, { name: 'cases.mat' });
    relay.ready();
    await settle();
    relay.dispose();
    table.dispose();
    panel.deliver();
    await settle();
    expect(panel.types()).toEqual(['setRows']);
  });
});
