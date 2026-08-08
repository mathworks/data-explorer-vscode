// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel } from '../src/host/SlddModel.js';
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

// The vendored table grays a Name cell purely from Name.editable === false. That
// flag is meant to mark DERIVED names (indexed array children, enum values, bus
// elements — which also carry disabled: true), NOT read-only-ness. For read-only
// documents (.slx/.mat/.prj, binary .sldd) editing is blocked document-wide in
// the webview, so there Name.editable is cosmetic only and buildRows recolors it
// to follow the true derived signal: editable = !disabled. Editable JSON .sldd is
// left untouched so its per-cell name-editor gating stays exact.
//
// An entry node whose Name says {disabled:false, editable:false} — as the .slx
// section nodes (DataSourceNode/ModelReferenceNode/ConfigSetNode) and
// ProjectItemNode all do — is a real entry that must render in the NORMAL color.
function nameEntry(id: string, disabled: boolean, editable: boolean, nested: any[] = []) {
  return {
    id,
    flatten() { return [this, ...nested]; },
    toRow() {
      return { ID: id, parent: null, Name: { label: id, iconId: 'x', disabled, editable } };
    },
  };
}

describe('buildRows read-only Name coloring', () => {
  it('un-grays a real entry (disabled:false) that reports editable:false', () => {
    // Mirrors a .slx section node: real entry, nameEditable false.
    const rows = buildRows({ children: [section('references', [nameEntry('m_ref', false, false)])] }, undefined, true);
    const row = rows.find((r) => r.ID === 'm_ref');
    expect(row.Name.editable).toBe(true); // normal color
    expect(row.Name.disabled).toBe(false);
  });

  it('keeps a derived child (disabled:true) grayed in read-only mode', () => {
    // Mirrors an indexed array child / enum value / bus element.
    const rows = buildRows({ children: [section('design', [nameEntry('Var(1)', true, false)])] }, undefined, true);
    const row = rows.find((r) => r.ID === 'Var(1)');
    expect(row.Name.editable).toBe(false); // stays grayed
    expect(row.Name.disabled).toBe(true);
  });

  it('recolors every read-only row so editable === !disabled', () => {
    const entryRow = nameEntry('entry', false, false, [
      { toRow: () => ({ ID: 'entry.child', parent: 'entry', Name: { label: 'child', iconId: 'x', disabled: true, editable: false } }) },
    ]);
    const rows = buildRows({ children: [section('design', [entryRow])] }, undefined, true);
    const dataRows = rows.filter((r) => r.Name && typeof r.Name === 'object' && !String(r.ID).startsWith('section:'));
    expect(dataRows.length).toBe(2);
    for (const r of dataRows) {
      expect(r.Name.editable).toBe(!r.Name.disabled);
    }
  });

  it('leaves the section row untouched in read-only mode', () => {
    const rows = buildRows({ children: [section('references', [nameEntry('m_ref', false, false)])] }, undefined, true);
    const sec = rows.find((r) => r.ID === 'section:references');
    // Section rows are non-editable, non-derived containers: always disabled:false, editable:false.
    expect(sec.Name.editable).toBe(false);
    expect(sec.Name.disabled).toBe(false);
  });

  it('does NOT recolor when readOnly is false (editable JSON .sldd path)', () => {
    // Default (editable) path must preserve the node-reported flag verbatim so
    // the per-cell name editor stays gated exactly as the node intends.
    const rows = buildRows({ children: [section('design', [nameEntry('locked', false, false)])] });
    const row = rows.find((r) => r.ID === 'locked');
    expect(row.Name.editable).toBe(false); // untouched
    expect(row.Name.disabled).toBe(false);
  });

  it('buildEntryRows honors the readOnly flag directly', () => {
    const [normal] = buildEntryRows(nameEntry('e', false, false), 'references', undefined, true);
    expect(normal.Name.editable).toBe(true);
    const [derived] = buildEntryRows(nameEntry('e2', true, false), 'design', undefined, true);
    expect(derived.Name.editable).toBe(false);
    const [untouched] = buildEntryRows(nameEntry('e3', false, false), 'design');
    expect(untouched.Name.editable).toBe(false);
  });
});
