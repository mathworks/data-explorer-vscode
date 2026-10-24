// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel, invalidate, parseDetached } from '../src/host/SlddModel.js';
import {
  baselineOwed,
  captureBaseline,
  computeModified,
  clearBaseline,
  diskBaselineUsable,
  sameDiskStamp,
} from '../src/host/slddBaseline.js';

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

// When a text-backed document's repaint takes a new baseline. The baseline is the file ON DISK;
// it used to be taken once, from whatever the document said the first time it painted, and
// replaced only by a save — so a reload, a revert and a document opened already dirty were all
// marked against the wrong text. The end-to-end cases are in
// test-integration/suite/jsonBaselineFollowsDisk.test.ts; this pins the decision.
describe('baselineOwed — a repaint captures the baseline only from a text known to be the file', () => {
  const none = { captured: false, pending: false, version: -1, cleanAt: -1 };

  it('captures the first repaint of a document opened clean', () => {
    expect(baselineOwed({ ...none, cleanAt: 3 }, 3)).toBe(true);
  });

  it('captures from the text when there is no baseline and none is coming from the disk', () => {
    // A document opened dirty whose file could not be read: the old behaviour, its own text.
    expect(baselineOwed(none, 5)).toBe(true);
  });

  it('does not capture a dirty text while the disk read for a dirty open is on its way', () => {
    // The dirty text is exactly what the marks have to be measured against.
    expect(baselineOwed({ ...none, pending: true }, 5)).toBe(false);
    expect(baselineOwed({ ...none, pending: true, cleanAt: 4 }, 5)).toBe(false);
  });

  it('captures a SAVED text even while that read is on its way, which then lands too late to count', () => {
    // A save made while the file is being read: the text is the file now, and the bytes the read
    // returns may be from before the save.
    expect(baselineOwed({ ...none, pending: true, cleanAt: 5 }, 5)).toBe(true);
  });

  it('captures again at a version known to read what the file says — a reload, a revert, a save', () => {
    expect(baselineOwed({ captured: true, pending: false, version: 3, cleanAt: 9 }, 9)).toBe(true);
  });

  it('does not capture a version not known to be the file, nor one it already holds', () => {
    // An edit after a clean point: the text is what is being compared, not what it is compared to.
    expect(baselineOwed({ captured: true, pending: false, version: 3, cleanAt: 3 }, 4)).toBe(false);
    // A second repaint of the same clean version, or a second tab's.
    expect(baselineOwed({ captured: true, pending: false, version: 9, cleanAt: 9 }, 9)).toBe(false);
    // A baseline read from the disk, while the document has not been clean since.
    expect(baselineOwed({ captured: true, pending: false, version: -1, cleanAt: -1 }, 7)).toBe(false);
  });
});

describe('a baseline from the file on disk marks what a dirty document changed', () => {
  it('is the same baseline the document would give, entry for entry, where the two agree', () => {
    const uri = 'test://baseline-detached.sldd';
    const text = fixtureText();
    // The disk's tree, parsed where no session or editor can see it.
    captureBaseline(uri, parseDetached('data.sldd', text));
    expect([...computeModified(uri, freshModel(uri))]).toEqual([]);
    const live = freshModel(uri);
    expect(findEntry(live, 'Number').setProperty('Value', '42')).toBe(true);
    expect([...computeModified(uri, live)]).toEqual(['Number']);
    clearBaseline(uri);
  });
});

describe('diskBaselineUsable — the bytes of a dirty open count only if nothing newer is known', () => {
  const pending = { captured: false, pending: true, version: -1, cleanAt: -1 };

  it('counts when nothing became clean while the file was being read', () => {
    expect(diskBaselineUsable({ ...pending, pending: false }, -1)).toBe(true);
  });

  it('does not count once a save has been baselined while it was read', () => {
    expect(diskBaselineUsable({ captured: true, pending: false, version: 6, cleanAt: 6 }, -1)).toBe(false);
  });

  it('does not count once the document turned clean while it was read, baselined or not', () => {
    // The bytes may be from before that save; the file now holds what the document did then.
    expect(diskBaselineUsable({ ...pending, pending: false, cleanAt: 6 }, -1)).toBe(false);
  });
});

describe('sameDiskStamp — a file not changed since the document matched it was not reloaded', () => {
  it('is the same file when its size and modification time are', () => {
    expect(sameDiskStamp({ mtime: 1000, size: 15507 }, { mtime: 1000, size: 15507 })).toBe(true);
  });

  it('may have changed when either moved', () => {
    expect(sameDiskStamp({ mtime: 1000, size: 15507 }, { mtime: 1001, size: 15507 })).toBe(false);
    expect(sameDiskStamp({ mtime: 1000, size: 15507 }, { mtime: 1000, size: 15508 })).toBe(false);
  });

  it('proves nothing before a stamp has been taken', () => {
    expect(sameDiskStamp(null, { mtime: 1000, size: 15507 })).toBe(false);
  });
});
