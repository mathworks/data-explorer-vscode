// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel, getModelFromBytes } from '../src/host/SlddModel.js';
import { buildRows, buildEntryRows } from '../src/host/rowBuilder.js';

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

describe('buildRows host-side tree construction', () => {
  it('builds a valid section/entry tree from the sample dictionary', () => {
    const path = fixturePath('numeric_json.sldd');
    const text = readFileSync(path, 'utf8');
    const sldd = getModel('test://numeric_json.sldd', 'numeric_json.sldd', text);
    const rows = buildRows(sldd);

    // (a) the design section row exists
    const designRow = rows.find((r) => r.ID === 'section:design');
    expect(designRow).toBeDefined();
    expect(designRow.parent).toBeNull();

    // (b) at least 20 entry rows nested under the design section
    const designChildren = rows.filter((r) => r.parent === 'section:design');
    expect(designChildren.length).toBeGreaterThanOrEqual(20);

    // (c) every row's parent is null or matches some row's ID (valid tree)
    const ids = new Set(rows.map((r) => r.ID));
    for (const r of rows) {
      if (r.parent != null) {
        expect(ids.has(r.parent)).toBe(true);
      }
    }
  });

  it('marks only the named entry rows as Modified when modifiedNames is passed', () => {
    const path = fixturePath('numeric_json.sldd');
    const text = readFileSync(path, 'utf8');
    const sldd = getModel('test://numeric_json-modified.sldd', 'numeric_json.sldd', text);
    const rows = buildRows(sldd, new Set(['Number']));

    const numberRow = rows.find((r) => r.Name && r.Name.label === 'Number');
    expect(numberRow).toBeDefined();
    expect(numberRow.Status).toBe('Modified');

    // Some other entry row is not marked.
    const otherRow = rows.find(
      (r) => r.parent && String(r.parent).startsWith('section:') && r.Name && r.Name.label !== 'Number',
    );
    expect(otherRow).toBeDefined();
    expect(otherRow.Status).toBeFalsy();
  });
});

describe('clipboard affordance — stamps Name.clipboardMode on the cut/copied source row', () => {
  it('marks the named entry in its section as "cut" when a clipMark cut is passed', () => {
    const path = fixturePath('numeric_json.sldd');
    const text = readFileSync(path, 'utf8');
    const sldd = getModel('test://numeric_json-cut.sldd', 'numeric_json.sldd', text);
    const rows = buildRows(sldd, undefined, { name: 'Number', section: 'design', mode: 'cut' });

    const numberRow = rows.find((r) => r.Name && r.Name.label === 'Number');
    expect(numberRow.Name.clipboardMode).toBe('cut');

    // No other entry row carries the mark.
    const others = rows.filter(
      (r) => r.Name && typeof r.Name === 'object' && r.Name.label !== 'Number' && !String(r.ID).startsWith('section:'),
    );
    for (const r of others) expect(r.Name.clipboardMode).toBeUndefined();
  });

  it('marks the named entry as "copied" for a copy clipMark', () => {
    const path = fixturePath('numeric_json.sldd');
    const text = readFileSync(path, 'utf8');
    const sldd = getModel('test://numeric_json-copy.sldd', 'numeric_json.sldd', text);
    const rows = buildRows(sldd, undefined, { name: 'Number', section: 'design', mode: 'copy' });
    const numberRow = rows.find((r) => r.Name && r.Name.label === 'Number');
    expect(numberRow.Name.clipboardMode).toBe('copy');
  });

  it('does not stamp when the clipMark section does not match the entry’s section', () => {
    const path = fixturePath('numeric_json.sldd');
    const text = readFileSync(path, 'utf8');
    const sldd = getModel('test://numeric_json-nomatch.sldd', 'numeric_json.sldd', text);
    // "Number" lives in design, not in some other section.
    const rows = buildRows(sldd, undefined, { name: 'Number', section: 'references', mode: 'cut' });
    const numberRow = rows.find((r) => r.Name && r.Name.label === 'Number');
    expect(numberRow.Name.clipboardMode).toBeUndefined();
  });

  it('stamps nothing when no clipMark is given (default behavior unchanged)', () => {
    const path = fixturePath('numeric_json.sldd');
    const text = readFileSync(path, 'utf8');
    const sldd = getModel('test://numeric_json-none.sldd', 'numeric_json.sldd', text);
    const rows = buildRows(sldd);
    for (const r of rows) {
      if (r.Name && typeof r.Name === 'object') expect(r.Name.clipboardMode).toBeUndefined();
    }
  });
});

describe('buildEntryRows capability flags (for the context menu)', () => {
  // Duck-typed nodes exercising the capability branches. capabilityFlags reads
  // isEntry, canAddChild(), and parent.canRemoveChild() defensively.
  function node(id: string, opts: { isEntry?: boolean; canAddChild?: boolean; parent?: any } = {}) {
    return {
      id,
      isEntry: !!opts.isEntry,
      parent: opts.parent,
      canAddChild: opts.canAddChild === undefined ? undefined : () => opts.canAddChild,
      flatten() { return [this]; },
      toRow() { return { ID: id, parent: null, Name: { label: id } }; },
    };
  }

  it('marks a plain entry as an entry: copyable + deletable, not add-child', () => {
    const entry = node('e', { isEntry: true });
    const [row] = buildEntryRows(entry, 'design');
    expect(row._isEntry).toBe(true);
    expect(row._canCopy).toBe(true);
    expect(row._canDelete).toBe(true);   // entries are always removable from a section
    expect(row._canAddChild).toBe(false); // canAddChild undefined -> false
  });

  it('marks a struct/bus entry (canAddChild true) as add-child capable', () => {
    const entry = node('bus', { isEntry: true, canAddChild: true });
    const [row] = buildEntryRows(entry, 'design');
    expect(row._canAddChild).toBe(true);
  });

  it('a nested child is deletable only when its parent permits canRemoveChild', () => {
    const removableParent = { canRemoveChild: () => true };
    const lockedParent = { canRemoveChild: () => false };
    const bareParent = {}; // no canRemoveChild method

    const [removable] = buildEntryRows(
      { flatten: () => [node('c1', { parent: removableParent })], },
      'design',
    );
    const [locked] = buildEntryRows(
      { flatten: () => [node('c2', { parent: lockedParent })] },
      'design',
    );
    const [bare] = buildEntryRows(
      { flatten: () => [node('c3', { parent: bareParent })] },
      'design',
    );

    expect(removable._canDelete).toBe(true);
    expect(locked._canDelete).toBe(false);
    expect(bare._canDelete).toBe(false); // missing method -> not deletable
  });
});

// buildRows only needs a duck-typed shape: a container with `children` sections,
// each section having `name`/`displayName`/`icon` and `children` entries, and
// each entry exposing `flatten()` and `toRow()`. Build synthetic nodes to drive
// the branches a real dictionary doesn't easily exercise.
function entry(id: string, opts: { row?: any; throws?: boolean; nested?: any[] } = {}) {
  return {
    id,
    flatten() {
      return [this, ...(opts.nested ?? [])];
    },
    toRow() {
      if (opts.throws) throw new Error('bad row');
      return opts.row === undefined ? { ID: id, parent: null, Name: id } : opts.row;
    },
  };
}
function section(name: string, entries: any[], extra: Record<string, any> = {}) {
  return { name, displayName: extra.displayName, icon: extra.icon, children: entries };
}

describe('buildRows branch coverage', () => {
  it('returns [] for a dictionary with no sections', () => {
    expect(buildRows({ children: [] })).toEqual([]);
    expect(buildRows({})).toEqual([]);
  });

  it('emits the section row for an empty section (with no entry rows)', () => {
    const rows = buildRows({ children: [section('design', [])] });
    expect(rows).toHaveLength(1);
    expect(rows[0].ID).toBe('section:design');
    expect(rows[0].parent).toBeNull();
  });

  it('emits a section row then its entry rows, reparenting top-level entries', () => {
    const rows = buildRows({ children: [section('design', [entry('e1')], { displayName: 'Design Data', icon: 'databaseFolderDesign' })] });
    const sec = rows.find((r) => r.ID === 'section:design');
    expect(sec).toBeDefined();
    expect(sec.parent).toBeNull();
    expect(sec.Name.label).toBe('Design Data');
    expect(sec.Name.iconId).toBe('databaseFolderDesign');
    const e = rows.find((r) => r.ID === 'e1');
    expect(e.parent).toBe('section:design'); // reparented under the section
  });

  it('falls back to section.name when displayName is absent', () => {
    const rows = buildRows({ children: [section('other', [entry('x')])] });
    expect(rows.find((r) => r.ID === 'section:other').Name.label).toBe('other');
  });

  it('skips an entry whose toRow throws, keeping the rest', () => {
    const rows = buildRows({ children: [section('design', [entry('good'), entry('bad', { throws: true })])] });
    const ids = rows.map((r) => r.ID);
    expect(ids).toContain('good');
    expect(ids).not.toContain('bad');
  });

  it('skips an entry whose toRow returns null/undefined', () => {
    const rows = buildRows({ children: [section('design', [entry('nullish', { row: null })])] });
    expect(rows.filter((r) => r.ID !== 'section:design')).toEqual([]);
  });

  it('keeps nested child rows’ own parent (does not reparent non-top-level rows)', () => {
    // A struct entry whose flatten yields the entry plus a nested field row that
    // already declares its parent as the entry id.
    const nestedRow = { ID: 'e1.field', parent: 'e1', Name: 'field' };
    const structEntry = {
      id: 'e1',
      flatten() {
        return [this, { toRow: () => nestedRow }];
      },
      toRow() {
        return { ID: 'e1', parent: null, Name: 'e1' };
      },
    };
    const rows = buildRows({ children: [section('design', [structEntry])] });
    const top = rows.find((r) => r.ID === 'e1');
    const child = rows.find((r) => r.ID === 'e1.field');
    expect(top.parent).toBe('section:design'); // top-level reparented
    expect(child.parent).toBe('e1');            // nested left as-is
  });

  it('handles an entry without flatten() by treating it as a single node', () => {
    const plain = { id: 'p', toRow: () => ({ ID: 'p', parent: null, Name: 'p' }) };
    const rows = buildRows({ children: [section('design', [plain])] });
    expect(rows.find((r) => r.ID === 'p')).toBeDefined();
  });
});

// Name-cell graying is driven SOLELY by the structural `Name.element` flag: true
// only for positional array/cell/string indices (and struct-array elements),
// which carry a synthetic subscript for a name rather than a real identifier.
// It is format-independent — buildRows does NOT recolor based on read-only-ness,
// so a binary .sldd and an editable JSON .sldd produce identical `element` flags.
// `Name.editable` (whether the inline name-editor may open) is a separate concern
// and must never affect coloring. Real entries and struct FIELDS are never
// elements: they render in the normal color regardless of file format.
describe('Name.element coloring is structural and format-independent', () => {
  // The vendored table grays a Name only when Name.element === true.
  function allDataRows(rows: any[]) {
    return rows.filter((r) => r.Name && typeof r.Name === 'object' && !String(r.ID).startsWith('section:'));
  }

  it('never grays a section row', () => {
    const rows = buildRows({ children: [section('references', [entry('m_ref')])] });
    const sec = rows.find((r) => r.ID === 'section:references');
    expect(sec.Name.element).toBe(false);
  });

  it('grays only positional element children, not entries or struct fields', () => {
    // Array/CellArray entries in the fixture expand into positional index
    // children; the entries themselves and any struct fields must stay normal.
    const path = fixturePath('numeric_json.sldd');
    const text = readFileSync(path, 'utf8');
    const sldd = getModel('test://numeric_json.sldd', 'numeric_json.sldd', text);
    const rows = buildRows(sldd);

    const entryRows = rows.filter((r) => r.parent && String(r.parent).startsWith('section:'));
    // Every top-level entry renders normally.
    for (const r of entryRows) {
      expect(r.Name.element).toBe(false);
    }

    // The Array entry's index children are positional elements → grayed.
    const arrayRow = entryRows.find((r) => r.Name.label === 'Array');
    expect(arrayRow).toBeDefined();
    const arrayChildren = rows.filter((r) => r.parent === arrayRow.ID);
    expect(arrayChildren.length).toBeGreaterThan(0);
    for (const c of arrayChildren) {
      expect(c.Name.element).toBe(true); // positional index → grayed
    }
  });

  it('produces identical element flags for a binary .sldd and its text form', () => {
    // The bug: binary/zip .sldd grayed entry names that the text path left
    // normal. Both forms must now agree entry-for-entry on the element flag.
    const bytes = readFileSync(fixturePath('compressed.sldd'));
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const bin = getModelFromBytes('test://compressed.sldd', 'compressed.sldd', ab);
    const binRows = allDataRows(buildRows(bin));

    // compressed.sldd holds a single plain entry (Kp) — a real identifier that
    // must NOT be grayed, exactly as the text path would render it.
    expect(binRows.length).toBeGreaterThan(0);
    for (const r of binRows) {
      expect(r.Name.element).toBe(false);
    }
  });
});
