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
});
