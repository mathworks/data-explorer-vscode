// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The Property Inspector's Variable Editor, driven through the listener that ships.
//
// variableEditorPopover.test.ts pins installMatrixOpen on a bare <div>, and nothing there
// imports pi-main.ts — so the one listener that decides what the inspector does with a
// host message went untested. That listener closed the editor on EVERY message, which was
// right while cells were stamped onto the row and the inspector only ever received
// `showProps`/`empty`. Since the cells became a fetch on open, the host's `matrixCells`
// answer is a message too, and it closed the panel it was sent to fill: the editor opened
// on the click, flashed "Loading…", and closed. The table never had the defect because
// table-main.ts closes per branch.
//
// Same import route as tableMainChildRows.test.ts (see the memory
// `table-main-is-importable`): two stubs — acquireVsCodeApi and the shell's body — in place
// before the dynamic import, once per file.
// The data is the host's own: the real node, the real groups, the real answer.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
// `join(import.meta.dirname, …)`, not `fileURLToPath(import.meta.url)`: under happy-dom
// `import.meta.url` is an http URL, which fileURLToPath rejects.
import { join } from 'node:path';
import { getModelFromBytes, invalidate } from '../src/host/SlddModel.js';
import { buildPropertyGroups } from '../src/host/piBuilder.js';
import { matrixCellsMessage } from '../src/host/matrixRequest.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const read = (p: string) => readFileSync(join(import.meta.dirname, '..', p), 'utf8');

// The REAL inspector body, read out of the provider that ships it. pi.html is only
// vite's dev entry; a hand-written copy here would agree with neither.
const PI_BODY = /body: `([\s\S]*?)`,/.exec(read('src/host/PropertiesViewProvider.ts'))![1];

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

function descend(node: any): any[] {
  return [node, ...(node.children ?? []).flatMap(descend)];
}

const posted: any[] = [];
let pi: any;
let editor: any;
// `ParamMat`: an object whose 2x3 matrix is on its Value child — the inspector's case,
// since piBuilder hands matrixDescriptor the node rather than its Value.
let paramMat: any;
let groups: any[];

/** Hand the inspector a message exactly as the host's `postMessage` does. */
function send(data: any): void {
  window.dispatchEvent(new MessageEvent('message', { data }));
}

async function settle(): Promise<void> {
  await editor.updateComplete;
  await editor.updateComplete;
}

/** Click the Value row's glyph, the way the user does. */
async function openFromValueRow(): Promise<void> {
  const glyph = pi.shadowRoot.querySelector('dex-matrix-open');
  expect(glyph, 'the Value row carries no Variable Editor glyph').not.toBeNull();
  await glyph.updateComplete;
  glyph.shadowRoot.querySelector('a').click();
  await frame();
  await settle();
}

const isOpen = () => editor.hasAttribute('open');
const gridCells = () => editor.shadowRoot.querySelector('dex-matrix-grid')?.matrix?.cells;
const statusText = () => editor.shadowRoot.querySelector('.status')?.textContent?.trim();

beforeAll(async () => {
  const uri = 'pi://all.sldd';
  invalidate(uri);
  const b = readFileSync(join(import.meta.dirname, 'fixtures', 'mcos', 'all.sldd'));
  const model = getModelFromBytes(uri, 'all.sldd', b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  paramMat = descend(model).find((n) => n.name === 'ParamMat');
  groups = buildPropertyGroups(paramMat);

  (globalThis as any).acquireVsCodeApi = () => ({ postMessage: (m: any) => posted.push(m) });
  document.body.innerHTML = PI_BODY;
  await import('../src/webview/pi-main.js');
  pi = document.querySelector('dex-property-inspector');
  editor = document.querySelector('dex-variable-editor');
});

beforeEach(async () => {
  // A selection, as the host sends one. It also closes whatever the last test left open.
  send({ type: 'showProps', groups });
  await pi.updateComplete;
  await settle();
  posted.length = 0;
});

describe('the inspector opens the Variable Editor on its Value row', () => {
  it('asks the host for the cells of the node on display', async () => {
    await openFromValueRow();
    expect(isOpen()).toBe(true);
    expect(posted).toEqual([{ type: 'requestMatrix', nodeId: paramMat.id }]);
  });

  it('stays open when the host answers, and shows the cells', async () => {
    // The regression: this answer used to close the panel it filled.
    await openFromValueRow();
    // Open going in, so a failure below is the answer's doing and not the opening's.
    expect(isOpen()).toBe(true);
    send(matrixCellsMessage(paramMat.id, paramMat));
    await settle();
    expect(isOpen()).toBe(true);
    expect(gridCells()).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('stays open on a refusal too, and says why', async () => {
    // The other branch of the same envelope: the refusal the host sends when it has no
    // cells to give. A reason the user can read, not a panel that vanishes.
    const refusal = matrixCellsMessage(paramMat.id, null);
    // A reason, so the match below cannot be undefined against undefined.
    expect(refusal.message).toBeTruthy();
    await openFromValueRow();
    expect(isOpen()).toBe(true);
    send(refusal);
    await settle();
    expect(isOpen()).toBe(true);
    expect(statusText()).toBe(refusal.message);
  });
});

describe('a new selection still closes it', () => {
  // The rule the unconditional close existed for: either message replaces every row the
  // grid was anchored to. Narrowing the close to those two must not lose it.
  it('closes on showProps', async () => {
    await openFromValueRow();
    send(matrixCellsMessage(paramMat.id, paramMat));
    await settle();
    // Open going in, or a close that already happened would pass this for free.
    expect(isOpen()).toBe(true);
    send({ type: 'showProps', groups });
    await settle();
    expect(isOpen()).toBe(false);
  });

  it('closes on empty', async () => {
    await openFromValueRow();
    send(matrixCellsMessage(paramMat.id, paramMat));
    await settle();
    expect(isOpen()).toBe(true);
    send({ type: 'empty' });
    await settle();
    expect(isOpen()).toBe(false);
  });
});
