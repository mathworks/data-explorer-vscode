// Copyright 2026 The MathWorks, Inc.
//
// A multi-entry paste into a JSON .sldd is ONE narrow write when it can be (structuralEdit.ts,
// foldPasteEntries / composeInsertions): N appends at one place fold into one insertion. The
// fold is checked rather than trusted, and the one invariant every answer must keep is that a
// patch it hands back, applied to the text before, IS the text after: the provider writes the
// patch and nothing else, so a patch that disagreed with `newText` would put an element in the
// file twice, or not at all. When the steps do not chain it must hand back no patch, which is
// the caller's cue to write the whole text.
//
// Pinned on the real JSON paste (fixtures/params.sldd) for 1–3 entries, and on a fake single
// paste for each way a step can fail to chain. Also the refusals the shared allow-check gives
// for a section shaped other than core's sections, which both .sldd formats route through.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel, invalidate, findNode } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';
import {
  applyTextPatch,
  assertTypeAllowed,
  createEntry,
  foldPasteEntries,
  pasteEntries,
  removeChildrenFromModel,
  type StructuralResult,
} from '../src/host/structuralEdit.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const paramsText = readFileSync(fileURLToPath(new URL('./fixtures/params.sldd', import.meta.url)), 'utf8');

function openParams(uri: string) {
  invalidate(uri);
  const model: any = getModel(uri, 'params.sldd', paramsText);
  const payloadOf = (name: string): Record<string, unknown> => {
    const row = buildRows(model).find((r: any) => r.Name?.label === name && !String(r.ID).startsWith('section:'));
    if (!row) throw new Error(`no entry row for "${name}"`);
    return findNode(uri, row.ID).serialize() as Record<string, unknown>;
  };
  const design = (model.children as any[]).find((s) => s.name === 'design');
  return { model, design, payloadOf };
}

describe('the folded patch is the edit', () => {
  for (const count of [1, 2, 3]) {
    it(`pasting ${count} entr${count === 1 ? 'y' : 'ies'}: the patch applied to the text before is the text after`, () => {
      const d = openParams(`test://fold-${count}.sldd`);
      const names = (d.design.children as any[]).slice(0, count).map((e) => e.name);
      const payloads = names.map(d.payloadOf);
      const before = d.design.children.length;
      const { newText, selectIds, patch } = pasteEntries(paramsText, d.design, payloads);
      expect(selectIds).toHaveLength(count);
      expect(patch, 'appends at one place fold into one insertion').toBeDefined();
      expect(patch!.length).toBe(0);
      expect(applyTextPatch(paramsText, patch!)).toBe(newText);
      // Every pasted entry is in the text, under the unique name the model gave it.
      const added = (d.design.children as any[]).slice(before).map((e) => e.name);
      expect(added).toHaveLength(count);
      for (const name of added) {
        expect(names).not.toContain(name);
        expect(patch!.text).toContain(`"${name}"`);
      }
      expect(() => JSON.parse(newText)).not.toThrow();
    });
  }
});

describe('steps that do not chain fold to no patch, and the text is still every step’s', () => {
  // A single paste that inserts `text` at `at` (or reports `patch` as given).
  const step =
    (at: (text: string) => number, insert: string, override?: (offset: number) => StructuralResult['patch']) =>
    (text: string): StructuralResult => {
      const offset = at(text);
      const patch = override ? override(offset) : { offset, length: 0, text: insert };
      return { newText: text.slice(0, offset) + insert + text.slice(offset), selectId: `id-${insert}`, patch };
    };
  const run = (steps: ((text: string) => StructuralResult)[]) => {
    let i = 0;
    const payloads = steps.map(() => ({ name: 'p' }));
    const section = { allowsType: () => true, name: 'design' };
    return foldPasteEntries('0123456789', section, payloads, (text) => steps[i++](text));
  };

  it('(control) appends at the end of the one before fold into one', () => {
    const out = run([step(() => 5, 'A'), step(() => 6, 'B'), step(() => 7, 'C')]);
    expect(out.newText).toBe('01234ABC56789');
    expect(out.patch).toEqual({ offset: 5, length: 0, text: 'ABC' });
    expect(out.selectIds).toEqual(['id-A', 'id-B', 'id-C']);
  });

  it('a step that lands somewhere else', () => {
    const out = run([step(() => 5, 'A'), step(() => 0, 'B')]);
    expect(out.newText).toBe('B01234A56789');
    expect(out.patch).toBeUndefined();
  });

  it('a step that replaces rather than inserts', () => {
    const out = run([step(() => 5, 'A'), step(() => 6, 'B', (offset) => ({ offset, length: 1, text: 'B' }))]);
    expect(out.patch).toBeUndefined();
  });

  it('a step that reports no patch (the XML paste), first or later', () => {
    expect(run([step(() => 5, 'A', () => undefined), step(() => 6, 'B')]).patch).toBeUndefined();
    expect(run([step(() => 5, 'A'), step(() => 6, 'B', () => undefined)]).patch).toBeUndefined();
  });

  it('and once it cannot fold, a later step that would chain does not revive it', () => {
    const out = run([step(() => 5, 'A'), step(() => 0, 'B'), step(() => 1, 'C')]);
    expect(out.patch).toBeUndefined();
    expect(out.newText).toBe('BC01234A56789');
  });

  it('nothing to paste is no patch and no selection', () => {
    const out = run([]);
    expect(out).toEqual({ newText: '0123456789', selectIds: [], patch: undefined });
  });
});

describe('the shared refusals, for sections shaped other than core’s', () => {
  it('a section with no allow-list takes anything', () => {
    expect(() => assertTypeAllowed({ name: 'design' }, { name: 'x', value: { _array_class: 'Anything' } })).not.toThrow();
  });

  it('names a section by its display name, or by its name when it has none', () => {
    const refusing = { allowsType: () => false, name: 'design' };
    expect(() => assertTypeAllowed(refusing, { name: 'b', value: { _array_class: 'Simulink.Bus' } })).toThrow(
      'A "Simulink.Bus" entry is not allowed in design.',
    );
    expect(() => assertTypeAllowed({ ...refusing, displayName: 'Design Data' }, { name: 'v', value: 1 })).toThrow(
      'A MATLAB variable is not allowed in Design Data.',
    );
  });

  it('a section that refuses to add a class says so, by display name or name', () => {
    const refusing = { addEntry: () => null, name: 'arch', displayName: '' };
    expect(() => createEntry(refusing, 'Simulink.Bus')).toThrow('Simulink.Bus cannot be added to arch.');
    expect(() => createEntry({ ...refusing, displayName: 'Architectural Data' }, 'Simulink.Bus')).toThrow(
      'Simulink.Bus cannot be added to Architectural Data.',
    );
  });

  it('a delete of no children is refused, not a no-op splice', () => {
    expect(() => removeChildrenFromModel([])).toThrow('Nothing to delete.');
  });
});
