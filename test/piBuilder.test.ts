// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel, getModelFromBytes, invalidate } from '../src/host/SlddModel.js';
import { buildPropertyGroups } from '../src/host/piBuilder.js';

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

function bytes(name: string): ArrayBuffer {
  const b = readFileSync(fixturePath(name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

// The model a provider hands to PropertiesViewProvider.showNode, loaded fresh.
// `relpath` is the fixture location; the model is named by its basename, as the
// real host does.
function load(uri: string, relpath: string): any {
  invalidate(uri);
  return getModelFromBytes(uri, relpath.split('/').pop()!, bytes(relpath));
}

function descend(node: any): any[] {
  return [node, ...(node.children ?? []).flatMap(descend)];
}

function firstOfClass(root: any, ctorName: string): any {
  const found = descend(root).find((n) => n.constructor.name === ctorName);
  expect(found, `no ${ctorName} in the fixture`).toBeTruthy();
  return found;
}

describe('buildPropertyGroups', () => {
  it('returns [] for a node without toPIObject', () => {
    expect(buildPropertyGroups(null)).toEqual([]);
    expect(buildPropertyGroups({})).toEqual([]);
  });

  it('builds property groups for an entry node from the fixture', () => {
    const path = fixturePath('numeric_json.sldd');
    const text = readFileSync(path, 'utf8');
    const sldd = getModel('test://pi_numeric_json.sldd', 'numeric_json.sldd', text);

    const flat: any[] = typeof sldd.flatten === 'function' ? sldd.flatten() : [];
    const candidates = flat.filter((n) => typeof n?.toPIObject === 'function');
    expect(candidates.length).toBeGreaterThan(0);

    // Every candidate must transform to a valid (possibly empty) array with the
    // correct shape (defensive: container nodes may yield []).
    let sawProps = false;
    for (const entry of candidates) {
      const groups = buildPropertyGroups(entry);
      expect(Array.isArray(groups)).toBe(true);
      for (const g of groups) {
        expect(typeof g.title).toBe('string');
        expect(Array.isArray(g.properties)).toBe(true);
        for (const p of g.properties) {
          sawProps = true;
          expect(typeof p.name).toBe('string');
          expect(typeof p.value).toBe('string');
          expect(['text', 'link']).toContain(p.type);
          expect(p.editable).toBe(false);
        }
      }
    }

    // The fixture has at least one leaf entry with real properties.
    expect(sawProps).toBe(true);
  });

  it('returns [] for a section header, which the PI shows as an empty panel', () => {
    // Selecting a section row in the table calls showNode with the SectionNode;
    // its toPIObject is null (no PI layout), and anything other than [] here would
    // leave the previously selected entry's properties on screen.
    const root = load('test://pi_section.sldd', 'arch.sldd');
    const section = root.children.find((c: any) => c.name === 'design');
    expect(section.toPIObject()).toBeNull();
    expect(buildPropertyGroups(section)).toEqual([]);
  });

  it('describes the dictionary itself when the file root is selected', () => {
    // Clicking the .sldd in the Sections tree selects the root; this is the only
    // place the user sees the file's release and format.
    const root = load('test://pi_root.sldd', 'arch.sldd');
    const groups = buildPropertyGroups(root);
    expect(groups.map((g) => g.title)).toEqual(['General']);
    const names = groups[0].properties.map((p) => p.name);
    expect(names).toContain('Release');
    expect(names).toContain('File Format');
  });

  it('keeps the schema group order and titles each group by its display name', () => {
    // The titles come from the schema layout, not the internal group ids
    // ('GeneralGroup'); showing those ids would surface implementation names in
    // the panel, and reordering would break the expected reading order.
    const bus = firstOfClass(load('test://pi_bus.sldd', 'arch.sldd'), 'BusNode');
    expect(buildPropertyGroups(bus).map((g) => g.title)).toEqual([
      'General',
      'Value Properties',
      'Code Generation',
      'Other',
    ]);
  });

  it('shows each property under its human display name, not its schema key', () => {
    // The keys are camelCase schema ids ('dataScope'); the panel must read as
    // MATLAB property names.
    const bus = firstOfClass(load('test://pi_names.sldd', 'arch.sldd'), 'BusNode');
    const codeGen = buildPropertyGroups(bus).find((g) => g.title === 'Code Generation')!;
    expect(codeGen.properties.map((p) => p.name)).toEqual([
      'Data Scope',
      'Header File',
      'Alignment',
      'Preserve Element Dimensions',
    ]);
  });

  it('stringifies non-string property values so the panel never renders a raw object', () => {
    // Alignment is numeric and PreserveElementDimensions boolean in the file; the
    // webview binds `value` as text, so a non-string would show as "[object Object]"
    // or blank.
    const bus = firstOfClass(load('test://pi_types.sldd', 'arch.sldd'), 'BusNode');
    const codeGen = buildPropertyGroups(bus).find((g) => g.title === 'Code Generation')!;
    const byName = new Map(codeGen.properties.map((p) => [p.name, p.value]));
    expect(byName.get('Alignment')).toBe('-1');
    expect(byName.get('Preserve Element Dimensions')).toBe('false');
    for (const p of codeGen.properties) expect(typeof p.value).toBe('string');
  });

  it('renders an unset property as an empty string rather than "undefined"', () => {
    // An empty HeaderFile is the common case; String(undefined) would print the
    // literal text "undefined" into the panel.
    const bus = firstOfClass(load('test://pi_unset.sldd', 'arch.sldd'), 'BusNode');
    const codeGen = buildPropertyGroups(bus).find((g) => g.title === 'Code Generation')!;
    expect(codeGen.properties.find((p) => p.name === 'Header File')!.value).toBe('');
  });

  it('carries the "Other" catch-all group through with its dotted nested names', () => {
    // "Other" is how the user sees raw properties the schema does not model
    // (CoderInfo.*, Breakpoints.*). Dropping the group, or flattening the dotted
    // path, would hide which nested object a value came from.
    const bp = firstOfClass(load('test://pi_other.sldd', 'mcos/all.sldd'), 'BreakpointNode');
    const other = buildPropertyGroups(bp).find((g) => g.title === 'Other');
    expect(other, 'the Breakpoint carries unmodeled raw properties').toBeTruthy();
    const names = other!.properties.map((p) => p.name);
    expect(names).toContain('CoderInfo.StorageClass');
    expect(names).toContain('Breakpoints.FieldName');
  });

  it('marks every property read-only because V1 cannot write back from the panel', () => {
    // editable:true would make the webview render a text input, inviting an edit
    // that no host handler applies — the value would silently snap back.
    const root = load('test://pi_readonly.sldd', 'mcos/all.sldd');
    const all = descend(root).flatMap((n) => buildPropertyGroups(n).flatMap((g) => g.properties));
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((p) => p.editable === false)).toBe(true);
  });

  it('places a block in the model, which is what tells two `Gain` rows apart', () => {
    // The selection's own answer to "which Gain is this?". The table qualifies a block
    // row's Name with its enclosing systems and hovers the whole path; the panel is
    // where the path is readable without hovering, and it comes from the same field
    // (core's PropBlockPath over `ModelBlockNode.blockPath`) rather than a second join.
    //
    // sid_blocks.slx: `Gain` in the root system, `Gain` in the `Inner` subsystem, and
    // the block whose name the file leaves blank beside it. Two of the three rows read
    // `Gain`, so without this the panel repeated the label and said nothing more.
    const root = load('test://pi_sid_blocks.slx', 'sid_blocks.slx');
    const blocks = descend(root).filter((n) => n.constructor.name === 'ModelBlockNode');
    expect(blocks.length).toBe(3);
    const pathOf = (node: any): string | undefined =>
      buildPropertyGroups(node)
        .flatMap((g) => g.properties)
        .find((p) => p.name === 'Block Path')?.value;
    expect(blocks.map(pathOf)).toEqual(['Gain', 'Inner/Gain', 'Inner/<SID: 65>']);
  });

  it('emits plain text rows (no links) for a dictionary entry', () => {
    // The webview turns type:'link' into a clickable anchor and expects a
    // navigable target; a textual .sldd has none, so a stray link would be a
    // dead click.
    const root = load('test://pi_text.sldd', 'mcos/all.sldd');
    const all = descend(root).flatMap((n) => buildPropertyGroups(n).flatMap((g) => g.properties));
    expect(all.every((p) => p.type === 'text' && p.linkTarget === undefined)).toBe(true);
  });
});

// buildPropertyGroups consumes a plain object graph, not a typed one: the node
// classes that produce it live upstream in data-explorer-core and evolve
// independently, and their input is a parsed file. A missing groups/items/objects
// array or a group item naming a property that was never declared is therefore
// reachable without any bug here — and this runs in the EXTENSION HOST, where a
// throw is an unhandled rejection rather than a broken panel. Every one of these
// shapes must degrade to fewer rows, never to an exception.
//
// A hand-built stub is the only way to reach these: a real node always emits a
// complete, self-consistent sheet.
describe('buildPropertyGroups tolerates a malformed property sheet', () => {
  function stub(raw: unknown): any {
    return { toPIObject: () => raw };
  }

  it('returns [] when there is no sheet at all', () => {
    expect(buildPropertyGroups(stub(null))).toEqual([]);
    expect(buildPropertyGroups(stub({}))).toEqual([]);
  });

  it('returns [] for a sheet with no groups', () => {
    expect(buildPropertyGroups(stub({ propertySheet: {} }))).toEqual([]);
  });

  it('yields an empty group when its items are missing', () => {
    // The group still renders — as a titled, empty section — rather than the
    // panel losing every group after it.
    const groups = buildPropertyGroups(
      stub({ propertySheet: { groups: [{ name: 'GeneralGroup', displayName: 'General' }] } }),
    );
    expect(groups).toEqual([{ title: 'General', properties: [] }]);
  });

  it('titles a group by its name when it has no display name', () => {
    const groups = buildPropertyGroups(stub({ propertySheet: { groups: [{ name: 'OtherGroup', items: [] }] } }));
    expect(groups[0].title).toBe('OtherGroup');
  });

  it('skips a non-property item, such as a nested group', () => {
    const groups = buildPropertyGroups(
      stub({
        propertySheet: {
          groups: [{ displayName: 'G', items: [{ name: 'sub', type: 'group' }, { name: 'p', type: 'property' }] }],
          properties: [{ name: 'p', displayName: 'P' }],
        },
        objects: [{ p: 'v' }],
      }),
    );
    expect(groups[0].properties.map((r) => r.name)).toEqual(['P']);
  });

  it('skips an item whose property was never declared', () => {
    // The item/property lists are cross-referenced by name; a dangling reference
    // must drop that one row, not abort the group.
    const groups = buildPropertyGroups(
      stub({
        propertySheet: {
          groups: [{ displayName: 'G', items: [{ name: 'ghost', type: 'property' }, { name: 'p', type: 'property' }] }],
          properties: [{ name: 'p', displayName: 'P' }],
        },
        objects: [{ p: 'v' }],
      }),
    );
    expect(groups[0].properties.map((r) => r.name)).toEqual(['P']);
  });

  it('drops every row when the properties list is missing entirely', () => {
    const groups = buildPropertyGroups(
      stub({ propertySheet: { groups: [{ displayName: 'G', items: [{ name: 'p', type: 'property' }] }] } }),
    );
    expect(groups).toEqual([{ title: 'G', properties: [] }]);
  });

  it('falls back to the property name when it declares no display name', () => {
    const groups = buildPropertyGroups(
      stub({
        propertySheet: { groups: [{ displayName: 'G', items: [{ name: 'p', type: 'property' }] }], properties: [{ name: 'p' }] },
        objects: [{ p: 'v' }],
      }),
    );
    expect(groups[0].properties[0]).toMatchObject({ name: 'p', value: 'v' });
  });

  it('renders empty values when the object bag is missing or empty', () => {
    // No `objects` array at all: the sheet still describes which rows exist, so
    // the panel shows the property names with blank values rather than nothing.
    for (const raw of [
      { propertySheet: { groups: [{ displayName: 'G', items: [{ name: 'p', type: 'property' }] }], properties: [{ name: 'p', displayName: 'P' }] } },
      { propertySheet: { groups: [{ displayName: 'G', items: [{ name: 'p', type: 'property' }] }], properties: [{ name: 'p', displayName: 'P' }] }, objects: [] },
    ]) {
      const groups = buildPropertyGroups(stub(raw));
      expect(groups[0].properties).toEqual([{ name: 'P', value: '', editable: false, type: 'text', linkTarget: undefined }]);
    }
  });

  it('carries a link target through as a link row', () => {
    // No .sldd node emits `link` today, but the row type and the webview's anchor
    // rendering exist for it; this pins the mapping so a future linking node does
    // not have to rediscover it.
    const groups = buildPropertyGroups(
      stub({
        propertySheet: {
          groups: [{ displayName: 'G', items: [{ name: 'p', type: 'property' }] }],
          properties: [{ name: 'p', displayName: 'P', link: 'entry:Other' }],
        },
        objects: [{ p: 'Other' }],
      }),
    );
    expect(groups[0].properties[0]).toEqual({
      name: 'P',
      value: 'Other',
      editable: false,
      type: 'link',
      linkTarget: 'entry:Other',
    });
  });
});

describe('the Value property row carries the matrix payload', () => {
  it('attaches the payload to Value and to no other property', () => {
    const root = load('pi://all.sldd', 'mcos/all.sldd');
    const paramMat = descend(root).find((n) => n.name === 'ParamMat');
    const rows = buildPropertyGroups(paramMat).flatMap((g) => g.properties);
    const withMatrix = rows.filter((r) => r.matrix);
    expect(withMatrix.map((r) => r.name)).toEqual(['Value']);
    // Qualified, exactly as the table row's payload is: the popover title has to
    // say WHICH property it is showing, not just "Value".
    expect(withMatrix[0].matrix!.name).toBe('ParamMat.Value');
    expect(withMatrix[0].matrix!.dims).toEqual([2, 3]);
    expect(withMatrix[0].matrix!.cells).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('leaves the Value row’s own text exactly as it was', () => {
    // The PI still reads as the literal; the glyph is an addition, not a swap.
    const root = load('pi://all2.sldd', 'mcos/all.sldd');
    const paramMat = descend(root).find((n) => n.name === 'ParamMat');
    const value = buildPropertyGroups(paramMat)
      .flatMap((g) => g.properties)
      .find((r) => r.name === 'Value')!;
    expect(value.value).toBe('[1 2 3; 4 5 6]');
    expect(value.editable).toBe(false);
    expect(value.type).toBe('text');
  });

  it('attaches nothing when the Value is a scalar', () => {
    // A minimal node rather than a fixture hunt: the only thing under test is
    // that a non-griddable Value gets no payload.
    const scalar = {
      children: [
        { name: 'Value', className: 'double', dims: [1, 1], displayName: 'Value', displayValue: '7', children: [] },
      ],
      toPIObject: () => ({
        propertySheet: {
          groups: [{ name: 'Attributes', items: [{ type: 'property', name: 'Value' }] }],
          properties: [{ name: 'Value', displayName: 'Value' }],
        },
        objects: [{ Value: '7' }],
      }),
    };
    const rows = buildPropertyGroups(scalar).flatMap((g) => g.properties);
    expect(rows.map((r) => r.name)).toEqual(['Value']);
    expect(rows.filter((r) => r.matrix)).toEqual([]);
  });
});
