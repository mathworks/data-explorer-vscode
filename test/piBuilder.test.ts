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

  it('emits plain text rows (no links) for a dictionary entry', () => {
    // The webview turns type:'link' into a clickable anchor and expects a
    // navigable target; a textual .sldd has none, so a stray link would be a
    // dead click.
    const root = load('test://pi_text.sldd', 'mcos/all.sldd');
    const all = descend(root).flatMap((n) => buildPropertyGroups(n).flatMap((g) => g.properties));
    expect(all.every((p) => p.type === 'text' && p.linkTarget === undefined)).toBe(true);
  });
});
