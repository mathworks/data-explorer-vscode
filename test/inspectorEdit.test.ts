// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The Property Inspector's edit channel, which a MAT-file's editor gives it (the dictionary and
// model views' panels stay read-only):
//
//  - piBuilder makes a row editable exactly where core's toPIObject says, and gives it the key
//    core's editProperty takes, only when the host has an edit channel; without one, nothing;
//  - the inspector reports an edit by that key, and shows a refusal until the next node;
//  - pi-main.ts, as it ships, sends the edit with the node the panel shows, and shows the
//    reason the host sends back.
//
// The rows are the real ones: core's MAT-file nodes, created as the Add gallery creates them.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataModel } from 'data-explorer-core';
import { buildPropertyGroups } from '../src/host/piBuilder.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const read = (p: string) => readFileSync(join(import.meta.dirname, '..', p), 'utf8');
const PI_BODY = /body: `([\s\S]*?)`,/.exec(read('src/host/PropertiesViewProvider.ts'))![1];

/** A fresh MAT-file with one new variable of `className`, as the gallery creates it. */
function created(className: string): any {
  const b = readFileSync(join(import.meta.dirname, '..', 'test-integration', 'fixtures', 'mat', 'pv_basic.mat'));
  const srcId = `inspector-edit:${className}:${Math.random()}`;
  const mat: any = DataModel.addMatSource(srcId, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, { path: 'pv.mat' });
  DataModel.setActiveContext(mat);
  return DataModel.addEntry('', className);
}

const rows = (node: any, editable: boolean) => buildPropertyGroups(node, { editable }).flatMap((g) => g.properties);

describe('piBuilder, given an edit channel', () => {
  it('makes a row editable where core says it is, with the key core takes', () => {
    const nt = created('Simulink.NumericType');
    const pi = nt.toPIObject();
    const coreEditable = pi.propertySheet.properties.filter((p: any) => p.editable).map((p: any) => p.name);
    const editable = rows(nt, true).filter((r) => r.editable);
    expect(editable.map((r) => r.key).sort()).toEqual([...coreEditable].sort());
    expect(editable.find((r) => r.key === 'dataTypeMode')).toMatchObject({ editable: true, value: 'Double' });
    // A word length is derived while the mode is Double: core offers no edit of it.
    expect(rows(nt, true).find((r) => r.name.replace(/\s/g, '').toLowerCase() === 'wordlength')?.editable).toBe(false);
  });

  it('follows core as an edit changes what is editable: a fixed-point mode makes the word length editable', () => {
    const nt = created('Simulink.NumericType');
    DataModel.editProperty(nt.id, 'dataTypeMode', 'Fixed-point: binary point scaling', 'Double');
    const word = rows(nt, true).find((r) => r.key === 'wordLength');
    expect(word).toMatchObject({ editable: true, value: '16' });
  });

  it('makes nothing editable without one, and gives no row a key', () => {
    for (const cls of ['Simulink.NumericType', 'Simulink.Signal', 'Simulink.Bus', 'Simulink.Parameter']) {
      expect(rows(created(cls), false).every((r) => r.editable === false && r.key === undefined), cls).toBe(true);
    }
  });
});

describe('the inspector webview, as it ships', () => {
  const posted: any[] = [];
  let pi: any;

  const send = (data: any) => window.dispatchEvent(new MessageEvent('message', { data }));

  beforeAll(async () => {
    (globalThis as any).acquireVsCodeApi = () => ({ postMessage: (m: any) => posted.push(m) });
    document.body.innerHTML = PI_BODY;
    await import('../src/webview/pi-main.js');
    pi = document.querySelector('dex-property-inspector');
  }, 60_000);

  beforeEach(() => {
    posted.length = 0;
  });

  const inputOf = async (label: string): Promise<HTMLInputElement> => {
    await pi.updateComplete;
    const row = [...pi.shadowRoot.querySelectorAll('.prop-row')].find((r: any) => r.querySelector('.prop-name')?.textContent === label) as HTMLElement;
    expect(row, `a row labelled ${label}`).toBeTruthy();
    return row.querySelector('input') as HTMLInputElement;
  };

  it('sends an edit of an editable row by its key, with the node the panel shows', async () => {
    const nt = created('Simulink.NumericType');
    const groups = buildPropertyGroups(nt, { editable: true });
    send({ type: 'showProps', groups, nodeId: nt.id });
    const label = groups.flatMap((g) => g.properties).find((r) => r.key === 'dataTypeMode')!.name;
    const input = await inputOf(label);
    input.value = 'Single';
    input.dispatchEvent(new Event('change'));
    expect(posted).toEqual([{ type: 'editProperty', nodeId: nt.id, propName: 'dataTypeMode', newValue: 'Single', oldValue: 'Double' }]);
  });

  it('shows the reason an edit was refused, until the next node is shown', async () => {
    const p = created('Simulink.Parameter');
    send({ type: 'showProps', groups: buildPropertyGroups(p, { editable: true }), nodeId: p.id });
    send({ type: 'propertyRefused', propName: 'identifier', reason: 'Cannot edit "Param": no identifier under Auto.' });
    await pi.updateComplete;
    const alert = pi.shadowRoot.querySelector('.prop-refusal');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toBe('Cannot edit "Param": no identifier under Auto.');
    send({ type: 'showProps', groups: buildPropertyGroups(p, { editable: true }), nodeId: p.id });
    await pi.updateComplete;
    expect(pi.shadowRoot.querySelector('.prop-refusal')).toBeNull();
  });

  it('sends nothing for a panel shown without a node, or emptied', async () => {
    send({ type: 'showProps', groups: [{ title: 'G', properties: [{ name: 'Value', value: '1', editable: true, key: 'Value' }] }] });
    const input = await inputOf('Value');
    input.value = '2';
    input.dispatchEvent(new Event('change'));
    send({ type: 'empty' });
    expect(posted).toEqual([]);
  });
});
