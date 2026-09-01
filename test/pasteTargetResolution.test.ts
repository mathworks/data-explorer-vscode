// Copyright 2026 The MathWorks, Inc.
//
// Regression: pasting into a section must work whether the user right-clicks
//   (a) an existing entry/child in that section, OR
//   (b) the section HEADER row (the only place to click when the section is
//       empty — e.g. an empty Design Data / Architectural Data section).
// The header row id is `section:<name>`, which is NOT a resolvable model node
// id, so the paste target must be resolved from the row id + model directly.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel, findNode, invalidate } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';
import { resolveSectionForPaste } from '../src/host/structuralEdit.js';

const archText = readFileSync(fileURLToPath(new URL('./fixtures/arch.sldd', import.meta.url)), 'utf8');

function model(uri: string) {
  invalidate(uri);
  return getModel(uri, 'arch.sldd', archText);
}
function entryNode(uri: string, m: any, name: string) {
  const id = buildRows(m).find(
    (r: any) => r.Name?.label === name && !String(r.ID).startsWith('section:'),
  ).ID;
  return findNode(uri, id);
}

describe('resolveSectionForPaste', () => {
  it('resolves the section from a section-header row id (empty design section)', () => {
    const uri = 'test://resolve-section-header.sldd';
    const m = model(uri);
    // The header row the webview sends when the user right-clicks "Design Data".
    const section = resolveSectionForPaste(m, findNode(uri, 'section:design'), 'section:design');
    expect(section).toBeTruthy();
    expect(section.name).toBe('design');
  });

  it('resolves the arch section from its header row id', () => {
    const uri = 'test://resolve-arch-header.sldd';
    const m = model(uri);
    const section = resolveSectionForPaste(m, findNode(uri, 'section:arch'), 'section:arch');
    expect(section).toBeTruthy();
    expect(section.name).toBe('arch');
  });

  it('resolves the owning section when the row is an existing entry', () => {
    const uri = 'test://resolve-entry.sldd';
    const m = model(uri);
    const entry = entryNode(uri, m, 'DataInterface');
    const section = resolveSectionForPaste(m, entry, entry.id);
    expect(section).toBeTruthy();
    expect(section.name).toBe('arch');
  });

  it('returns null for an unknown section header', () => {
    const uri = 'test://resolve-unknown.sldd';
    const m = model(uri);
    expect(resolveSectionForPaste(m, null, 'section:nope')).toBeNull();
  });

  it('returns null for a header row when there is no model to look the section up in', () => {
    // Both table providers call this with the model they just built. A parse that
    // produced no sections (an emptied or externally-truncated file re-read while
    // the tab is open) must make the paste report "could not resolve the target
    // section" — the callers' own error path — rather than throw out of the message
    // handler, which in the extension host is an unhandled rejection the user only
    // sees as a paste that did nothing.
    for (const m of [null, undefined, {}, { children: null }] as any[]) {
      expect(resolveSectionForPaste(m, null, 'section:design')).toBeNull();
    }
  });
});
