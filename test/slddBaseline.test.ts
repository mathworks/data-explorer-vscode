// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel, invalidate } from '../src/host/SlddModel.js';
import { captureBaseline, computeModified, clearBaseline } from '../src/host/slddBaseline.js';

function fixtureText(): string {
  const path = fileURLToPath(new URL('../test-integration/fixtures/workspace/data.sldd', import.meta.url));
  return readFileSync(path, 'utf8');
}

// setProperty mutates the cached model in place, so each test uses a distinct
// URI and invalidates first to avoid model-cache bleed between tests.
function freshModel(uri: string): any {
  invalidate(uri);
  return getModel(uri, 'data.sldd', fixtureText());
}

function findEntry(model: any, name: string): any {
  let e: any;
  for (const s of model.children) {
    for (const c of s.children) {
      if (c.name === name) e = c;
    }
  }
  return e;
}

describe('slddBaseline', () => {
  it('reports nothing modified immediately after capture', () => {
    const uri = 'test://baseline-nochange.sldd';
    const model = freshModel(uri);
    captureBaseline(uri, model);
    expect(computeModified(uri, model)).toEqual(new Set());
    clearBaseline(uri);
  });

  it('reports exactly the edited entry after a value change', () => {
    const uri = 'test://baseline-value.sldd';
    const model = freshModel(uri);
    captureBaseline(uri, model);
    const e = findEntry(model, 'Number');
    expect(e).toBeDefined();
    e.setProperty('Value', '42');
    const modified = computeModified(uri, model);
    expect(modified.has('Number')).toBe(true);
    expect(modified.size).toBe(1);
    clearBaseline(uri);
  });

  it('reports the new name as added after a rename', () => {
    const uri = 'test://baseline-rename.sldd';
    const model = freshModel(uri);
    captureBaseline(uri, model);
    const e = findEntry(model, 'Number');
    e.setProperty('Name', 'NumberX');
    const modified = computeModified(uri, model);
    expect(modified.has('NumberX')).toBe(true);
    expect(modified.size).toBe(1);
    clearBaseline(uri);
  });

  it('reports nothing modified after re-capturing (save)', () => {
    const uri = 'test://baseline-recapture.sldd';
    const model = freshModel(uri);
    captureBaseline(uri, model);
    const e = findEntry(model, 'Number');
    e.setProperty('Value', '42');
    expect(computeModified(uri, model).size).toBe(1);
    // Simulate a save: re-capture the current state as the new baseline.
    captureBaseline(uri, model);
    expect(computeModified(uri, model)).toEqual(new Set());
    clearBaseline(uri);
  });

  it('reports nothing when no baseline was ever captured', () => {
    const uri = 'test://baseline-never.sldd';
    const model = freshModel(uri);
    expect(computeModified(uri, model)).toEqual(new Set());
    clearBaseline(uri);
  });

  it('clearBaseline makes a later diff report nothing again', () => {
    // The editor calls it on dispose. If the map entry survived, reopening the
    // same file would diff against a baseline captured before the last save and
    // show stale modified dots on entries the user never touched this session.
    const uri = 'test://baseline-cleared.sldd';
    const model = freshModel(uri);
    captureBaseline(uri, model);
    findEntry(model, 'Number').setProperty('Value', '42');
    expect(computeModified(uri, model).size).toBe(1);
    clearBaseline(uri);
    expect(computeModified(uri, model)).toEqual(new Set());
  });

  it('keeps baselines per URI, so editing one file does not mark another modified', () => {
    // Two dictionaries are commonly open at once and the store is a single module
    // -level map; a shared or overwritten baseline would put modified dots in the
    // wrong editor.
    const a = 'test://baseline-a.sldd';
    const b = 'test://baseline-b.sldd';
    const modelA = freshModel(a);
    const modelB = freshModel(b);
    captureBaseline(a, modelA);
    captureBaseline(b, modelB);
    findEntry(modelA, 'Number').setProperty('Value', '42');
    expect(computeModified(a, modelA).size).toBe(1);
    expect(computeModified(b, modelB)).toEqual(new Set());
    clearBaseline(a);
    clearBaseline(b);
  });
});

// The diff walks model.children -> section.children, so it runs against whatever
// shape the model layer hands it — and that layer is the separately versioned
// data-explorer-core package. A serialize/diff pass is only there to decide
// whether to draw a modified dot, so it must never be the thing that stops an
// editor from opening: a missing sections array, a section with no children, or
// an entry whose serialize() throws all have to degrade to a usable answer.
describe('slddBaseline survives a model it cannot walk', () => {
  const entry = (name: string, value: unknown) => ({ name, serialize: () => value });
  const model = (sections: unknown) => ({ children: sections });

  it('treats a model with no sections as having no entries', () => {
    for (const m of [null, undefined, {}, model(null), model([])]) {
      const uri = 'test://baseline-shape.sldd';
      captureBaseline(uri, m);
      expect(computeModified(uri, m)).toEqual(new Set());
      clearBaseline(uri);
    }
  });

  it('skips a section that carries no children array', () => {
    const uri = 'test://baseline-nokids.sldd';
    const m = model([{ name: 'design' }, { children: [entry('Keep', { v: 1 })] }]);
    captureBaseline(uri, m);
    expect(computeModified(uri, m)).toEqual(new Set());
    clearBaseline(uri);
  });

  it('an entry that fails to serialize does not throw and does not report modified', () => {
    // A cyclic or BigInt-bearing value makes JSON.stringify throw. Both passes
    // then store the same sentinel, so the entry compares equal to itself and
    // reads as clean — the diff cannot tell whether it changed, and a missing dot
    // is the safe answer. What matters is that neither capture nor compare throws:
    // both run while opening the editor.
    const uri = 'test://baseline-badserialize.sldd';
    const cyclic: any = {};
    cyclic.self = cyclic;
    const m = model([{ children: [entry('Bad', cyclic), entry('Good', { v: 1 })] }]);
    expect(() => captureBaseline(uri, m)).not.toThrow();
    expect(computeModified(uri, m)).toEqual(new Set());
    clearBaseline(uri);
  });

  it('an entry that STARTS failing to serialize reads as modified', () => {
    // The asymmetric case is the one the sentinel exists for: real JSON at capture
    // versus the sentinel now differ, so the entry is reported rather than
    // silently skipped.
    const uri = 'test://baseline-becamebad.sldd';
    let value: unknown = { v: 1 };
    const m = model([{ children: [{ name: 'Turns', serialize: () => value }] }]);
    captureBaseline(uri, m);
    const cyclic: any = {};
    cyclic.self = cyclic;
    value = cyclic;
    expect(computeModified(uri, m)).toEqual(new Set(['Turns']));
    clearBaseline(uri);
  });

  it('a serialize() that throws outright is caught, not just an unstringifiable value', () => {
    const uri = 'test://baseline-throws.sldd';
    const m = model([
      {
        children: [
          {
            name: 'Boom',
            serialize: () => {
              throw new Error('boom');
            },
          },
        ],
      },
    ]);
    expect(() => captureBaseline(uri, m)).not.toThrow();
    expect(() => computeModified(uri, m)).not.toThrow();
    clearBaseline(uri);
  });
});
