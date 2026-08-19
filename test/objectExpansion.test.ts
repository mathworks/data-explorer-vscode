// Copyright 2026 The MathWorks, Inc.
// Issue #3: MATLAB class objects saved to an .sldd "Other Data" section must be
// expandable in the tree like structs, recursing into nested object properties
// and nested structs.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel, getModelFromBytes, findNode, invalidate } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';
import '../src/dex/datamodel/node/NodeClassMap.js';
import MatNode from '../src/dex/datamodel/node/container/MatNode.js';
import { parseMat } from '../src/dex/datamodel/parser/MatParser.js';
import { buildMatRows } from '../src/host/matRowBuilder.js';

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
}

function fixtureBytes(name: string): ArrayBuffer {
  const b = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

// A row is expandable in the tree iff some other row names it as its parent
// (dex-tree-table derives the expand toggle purely from parent linkage).
function expandableIds(rows: any[]): Set<string> {
  return new Set(rows.map((r) => r.parent).filter(Boolean));
}
function rowById(rows: any[], id: string): any {
  return rows.find((r) => r.ID === id);
}

describe('issue#3 object expansion — text .sldd', () => {
  const sldd = getModel('test://object_props_text', 'object_props_text.sldd', fixture('object_props_text.sldd'));
  const rows = buildRows(sldd);
  const expandable = expandableIds(rows);
  const base = 'test://object_props_text/other';

  it('makes a value object (Vehicle) expandable', () => {
    expect(rowById(rows, `${base}/vehicleObject`)).toBeDefined();
    expect(expandable.has(`${base}/vehicleObject`)).toBe(true);
  });

  it('surfaces every serialized property of the object as a child row', () => {
    const propNames = rows
      .filter((r) => r.parent === `${base}/vehicleObject`)
      .map((r) => (typeof r.Name === 'object' ? r.Name.label : r.Name))
      .sort();
    expect(propNames).toEqual(['Engine', 'Name', 'Specs', 'Tags', 'Wheels']);
  });

  it('shows a scalar property value on its child row', () => {
    const wheels = rowById(rows, `${base}/vehicleObject/Wheels`);
    expect(wheels).toBeDefined();
    expect(String(wheels.Value)).toBe('6');
  });

  it('recurses into a nested object property (Engine), which is itself expandable', () => {
    const engine = rowById(rows, `${base}/vehicleObject/Engine`);
    expect(engine).toBeDefined();
    expect(engine.Class).toBe('Engine');
    expect(expandable.has(`${base}/vehicleObject/Engine`)).toBe(true);
    const cyl = rowById(rows, `${base}/vehicleObject/Engine/Cylinders`);
    expect(cyl).toBeDefined();
    expect(String(cyl.Value)).toBe('8');
  });

  it('recurses into a nested struct property (Specs)', () => {
    expect(expandable.has(`${base}/vehicleObject/Specs`)).toBe(true);
    const mass = rowById(rows, `${base}/vehicleObject/Specs/mass`);
    expect(mass).toBeDefined();
    expect(String(mass.Value)).toBe('2200');
  });

  it('expands a handle object (Fleet) with a nested handle-object property (Lead=Garage)', () => {
    expect(expandable.has(`${base}/fleetObject`)).toBe(true);
    const lead = rowById(rows, `${base}/fleetObject/Lead`);
    expect(lead).toBeDefined();
    expect(lead.Class).toBe('Garage');
    expect(expandable.has(`${base}/fleetObject/Lead`)).toBe(true);
    const cap = rowById(rows, `${base}/fleetObject/Lead/Capacity`);
    expect(cap).toBeDefined();
    expect(String(cap.Value)).toBe('25');
  });
});

// A class property NAME is fixed by the class definition — it cannot be renamed the
// way a struct field can. So every direct child of an object node (whatever its own
// node type: scalar variable, nested object, struct, or cell) must have a
// NON-editable Name cell. Struct fields, by contrast, stay renameable.
describe('issue#3 object property names are read-only (class-fixed), struct fields are not', () => {
  const uri = 'test://object_props_name_edit';
  invalidate(uri);
  const sldd = getModel(uri, 'object_props_text.sldd', fixture('object_props_text.sldd'));
  buildRows(sldd);
  const base = `${uri}/other`;
  const nameEditableOf = (id: string) => findNode(uri, id)?.nameEditable;

  it('makes an object scalar property name read-only (Vehicle.Wheels)', () => {
    expect(nameEditableOf(`${base}/vehicleObject/Wheels`)).toBe(false);
  });

  it('makes a nested-object property name read-only (Vehicle.Engine)', () => {
    expect(nameEditableOf(`${base}/vehicleObject/Engine`)).toBe(false);
  });

  it('makes a struct-typed property name read-only (Vehicle.Specs)', () => {
    expect(nameEditableOf(`${base}/vehicleObject/Specs`)).toBe(false);
  });

  it('makes a cell-typed property name read-only (Vehicle.Tags)', () => {
    expect(nameEditableOf(`${base}/vehicleObject/Tags`)).toBe(false);
  });

  it('makes a nested-object scalar property name read-only (Engine.Cylinders)', () => {
    expect(nameEditableOf(`${base}/vehicleObject/Engine/Cylinders`)).toBe(false);
  });

  it('KEEPS a struct field name editable (Vehicle.Specs.mass) — struct fields can be renamed', () => {
    expect(nameEditableOf(`${base}/vehicleObject/Specs/mass`)).toBe(true);
  });
});

// Editing an object property in an .sldd must WRITE BACK: the object's serialized
// value (JSON for text .sldd, XML for the entry text splice) must reflect the edit,
// not the stale value the file was loaded with. The object serializes from its live
// child nodes, exactly like a struct does.
describe('issue#3 object property edit write-back — text .sldd', () => {
  const uri = 'test://object_props_text_edit';
  function freshModel() {
    // The model is cached by URI, so each edit test must start from a clean parse —
    // otherwise a prior test's mutation leaks in.
    invalidate(uri);
    const model = getModel(uri, 'object_props_text.sldd', fixture('object_props_text.sldd'));
    buildRows(model); // register nodes so findNode resolves child rows
    return model;
  }
  const base = `${uri}/other`;
  // The top-level entry node whose serialize() feeds the write-back splice.
  function entryOf(node: any) {
    let e = node;
    while (e && !e.isEntry) e = e.parent;
    return e;
  }

  it('reflects a scalar property edit (Wheels 6 -> 4) in the object JSON', () => {
    freshModel();
    const wheels = findNode(uri, `${base}/vehicleObject/Wheels`);
    expect(wheels).not.toBeNull();
    expect(wheels.setProperty('Value', '4')).toBe(true);
    const entry = entryOf(wheels);
    const json = JSON.stringify(entry.serialize());
    expect(json).toContain('"Wheels":4');
    expect(json).not.toContain('"Wheels":6');
  });

  it('reflects a nested-object property edit (Engine.Cylinders 8 -> 12) in the object JSON', () => {
    freshModel();
    const cyl = findNode(uri, `${base}/vehicleObject/Engine/Cylinders`);
    expect(cyl).not.toBeNull();
    expect(cyl.setProperty('Value', '12')).toBe(true);
    const entry = entryOf(cyl);
    const json = JSON.stringify(entry.serialize());
    expect(json).toContain('"Cylinders":12');
    expect(json).not.toContain('"Cylinders":8');
  });

  it('reflects a scalar property edit (Wheels 6 -> 4) in the object XML', () => {
    freshModel();
    const wheels = findNode(uri, `${base}/vehicleObject/Wheels`);
    expect(wheels.setProperty('Value', '4')).toBe(true);
    const entry = entryOf(wheels);
    const xml = entry.serializeXml('Entry', { Name: entry.name }, 0);
    expect(xml).toMatch(/Name="Wheels"[^>]*>4\.0</);
    expect(xml).not.toMatch(/Name="Wheels"[^>]*>6\.0</);
  });

  it('round-trips an UNEDITED object byte-for-byte (rebuild from children is lossless)', () => {
    // Rebuilding _properties from live children must reproduce the loaded value
    // exactly — preserving nested _id keys, struct/cell shapes, and property order —
    // so merely opening a file and saving it never perturbs an untouched object.
    freshModel();
    const vehicle = findNode(uri, `${base}/vehicleObject`);
    const loaded = JSON.parse(fixture('object_props_text.sldd'))['__MW_TEXT_PARTS__'][
      '__MW_TEXT_PART__/data/chunk0'
    ]['__MW_TEXT_content'].entries.find((e: any) => e.name === 'vehicleObject').value;
    expect(vehicle.serializeValue()).toEqual(loaded);
  });
});

describe('issue#3 object expansion — binary .sldd', () => {
  const sldd = getModelFromBytes('test://object_props_binary', 'object_props_binary.sldd', fixtureBytes('object_props_binary.sldd'));
  const rows = buildRows(sldd);
  const expandable = expandableIds(rows);
  const base = 'test://object_props_binary/other';

  it('makes a value object (Vehicle) expandable', () => {
    expect(rowById(rows, `${base}/vehicleObject`)).toBeDefined();
    expect(expandable.has(`${base}/vehicleObject`)).toBe(true);
  });

  it('surfaces every serialized property of the object as a child row', () => {
    const propNames = rows
      .filter((r) => r.parent === `${base}/vehicleObject`)
      .map((r) => (typeof r.Name === 'object' ? r.Name.label : r.Name))
      .sort();
    expect(propNames).toEqual(['Engine', 'Name', 'Specs', 'Tags', 'Wheels']);
  });

  it('recurses into a nested object property (Engine)', () => {
    expect(expandable.has(`${base}/vehicleObject/Engine`)).toBe(true);
    const cyl = rowById(rows, `${base}/vehicleObject/Engine/Cylinders`);
    expect(cyl).toBeDefined();
    expect(String(cyl.Value)).toBe('8');
  });

  it('decodes a nested MATLAB string property to its text value (not an empty envelope)', () => {
    // The MCOS/XML nested-string shape must resolve to "Model-X", NOT expand into
    // a bogus string -> "undefined" -> <1x1 char> envelope with the text lost.
    const name = rowById(rows, `${base}/vehicleObject/Name`);
    expect(name).toBeDefined();
    expect(String(name.Value)).toContain('Model-X');
    expect(rowById(rows, `${base}/vehicleObject/Name/undefined`)).toBeUndefined();
  });

  it('recurses into a nested struct property (Specs)', () => {
    expect(expandable.has(`${base}/vehicleObject/Specs`)).toBe(true);
    const mass = rowById(rows, `${base}/vehicleObject/Specs/mass`);
    expect(mass).toBeDefined();
    expect(String(mass.Value)).toBe('2200');
  });

  it('decodes a nested cell property (Tags) to its elements', () => {
    // Tags = {'suv','electric'} must resolve to a 1x2 cell, not an object array
    // of empty _properties bags.
    const tags = rowById(rows, `${base}/vehicleObject/Tags`);
    expect(tags).toBeDefined();
    expect(expandable.has(`${base}/vehicleObject/Tags`)).toBe(true);
    const elemVals = rows
      .filter((r) => r.parent === `${base}/vehicleObject/Tags`)
      .map((r) => String(r.Value));
    expect(elemVals).toEqual(["'suv'", "'electric'"]);
  });
});

// .mat is read-only and its MCOS binary encoding cannot reliably recover the value
// of a MATLAB `string`-typed property (see docs), so a custom class object saved to
// a .mat is expanded as fully as possible: every property NAME is surfaced, every
// non-string value is correct, and an unrecoverable `string` value shows the honest
// sentinel "<not available>" rather than corrupted text. Known Simulink classes
// keep their schema-driven typed presentation and are untouched by this path.
describe('issue#3 object expansion — .mat (custom class, best-effort)', () => {
  function matRows() {
    const buf = fixtureBytes('mcos/object_props.mat');
    const parsed = parseMat(buf);
    const node = MatNode.fromParsed(parsed as any, 'object_props.mat');
    return buildMatRows(node);
  }
  const rows = matRows();
  const expandable = expandableIds(rows);

  function idOf(rows: any[], name: string, parentId: string | null): string | undefined {
    const r = rows.find(
      (row) => (typeof row.Name === 'object' ? row.Name.label : row.Name) === name && row.parent === parentId,
    );
    return r?.ID;
  }

  it('makes a custom value-class object (Vehicle) expandable', () => {
    const vId = idOf(rows, 'v', null);
    expect(vId).toBeDefined();
    expect(expandable.has(vId!)).toBe(true);
  });

  it('surfaces every property name of the object as a child row', () => {
    const vId = idOf(rows, 'v', null)!;
    const propNames = rows
      .filter((r) => r.parent === vId)
      .map((r) => (typeof r.Name === 'object' ? r.Name.label : r.Name))
      .sort();
    expect(propNames).toEqual(['Engine', 'Name', 'Specs', 'Tags', 'Wheels']);
  });

  it('shows the correct value for a numeric property', () => {
    const vId = idOf(rows, 'v', null)!;
    const wheels = rows.find((r) => r.parent === vId && (typeof r.Name === 'object' ? r.Name.label : r.Name) === 'Wheels');
    expect(String(wheels.Value)).toBe('6');
  });

  it('recurses into a nested object property (Engine) with correct scalar values', () => {
    const vId = idOf(rows, 'v', null)!;
    const engineId = idOf(rows, 'Engine', vId);
    expect(engineId).toBeDefined();
    expect(expandable.has(engineId!)).toBe(true);
    const cyl = rows.find((r) => r.parent === engineId && (typeof r.Name === 'object' ? r.Name.label : r.Name) === 'Cylinders');
    expect(String(cyl.Value)).toBe('8');
  });

  it('recurses into a nested struct property (Specs)', () => {
    const vId = idOf(rows, 'v', null)!;
    const specsId = idOf(rows, 'Specs', vId);
    expect(specsId).toBeDefined();
    expect(expandable.has(specsId!)).toBe(true);
    const mass = rows.find((r) => r.parent === specsId && (typeof r.Name === 'object' ? r.Name.label : r.Name) === 'mass');
    expect(String(mass.Value)).toBe('2200');
  });

  it('decodes a nested cell property (Tags) to its char elements', () => {
    const vId = idOf(rows, 'v', null)!;
    const tagsId = idOf(rows, 'Tags', vId);
    expect(tagsId).toBeDefined();
    expect(expandable.has(tagsId!)).toBe(true);
    const elemVals = rows.filter((r) => r.parent === tagsId).map((r) => String(r.Value));
    expect(elemVals).toEqual(["'suv'", "'electric'"]);
  });

  it('shows "<not available>" for an unrecoverable MATLAB string property value', () => {
    const vId = idOf(rows, 'v', null)!;
    const name = rows.find((r) => r.parent === vId && (typeof r.Name === 'object' ? r.Name.label : r.Name) === 'Name');
    expect(String(name.Value)).toContain('<not available>');
  });

  it('renders the "<not available>" sentinel as a non-editable placeholder, not a quoted string', () => {
    // It must follow the `<1x1 class_name>` presentation: bare angle-bracket text
    // (which the table styles gray/italic and gives no editor), NOT the quoted
    // char form `'<not available>'` that would look and behave like an editable
    // string literal.
    const vId = idOf(rows, 'v', null)!;
    const name = rows.find((r) => r.parent === vId && (typeof r.Name === 'object' ? r.Name.label : r.Name) === 'Name');
    expect(String(name.Value)).toBe('<not available>');
    expect(name._valueEditable).toBe(false);
  });

  it('surfaces a property left at its class default (Fleet.Notes) that lives outside the instance block', () => {
    const fId = idOf(rows, 'f', null)!;
    const notesId = idOf(rows, 'Notes', fId);
    expect(notesId).toBeDefined();
    expect(expandable.has(notesId!)).toBe(true);
  });

  it('expands a handle object (Fleet) with a nested handle-object property (Lead=Garage)', () => {
    const fId = idOf(rows, 'f', null)!;
    expect(expandable.has(fId)).toBe(true);
    const leadId = idOf(rows, 'Lead', fId);
    expect(leadId).toBeDefined();
    const lead = rows.find((r) => r.ID === leadId);
    expect(lead.Class).toBe('Garage');
    expect(expandable.has(leadId!)).toBe(true);
    const cap = rows.find((r) => r.parent === leadId && (typeof r.Name === 'object' ? r.Name.label : r.Name) === 'Capacity');
    expect(String(cap.Value)).toBe('25');
  });
});

// deep_objs.mat holds a multi-level, acyclic object graph with NO known schema:
//   a = Level1{ Tag, Count, Child=Level2{ Tag, Count,
//        Child=Level3{ Tag, Count, Depth=301 },
//        Sibling={ Level3{ Tag, Count=33, Depth=302 } } } }
// It exercises two things the single-level fixtures do not: an object -> object ->
// object CHAIN (must recurse all the way down), and an object nested INSIDE a cell
// (a.Sibling = {obj}), which must still expand as an object rather than collapse to
// an opaque "[object Object]" leaf.
describe('issue#3 object expansion — .mat deep acyclic object graph', () => {
  function matRows() {
    const buf = fixtureBytes('mcos/deep_objs.mat');
    const parsed = parseMat(buf);
    const node = MatNode.fromParsed(parsed as any, 'deep_objs.mat');
    return buildMatRows(node);
  }
  const rows = matRows();
  const expandable = expandableIds(rows);
  const label = (r: any) => (typeof r.Name === 'object' ? r.Name.label : r.Name);
  function childId(parentId: string | null, name: string): string | undefined {
    return rows.find((r) => r.parent === parentId && label(r) === name)?.ID;
  }

  it('recurses an object->object->object chain, each level expandable with correct values', () => {
    const aId = childId(null, 'a')!;
    expect(expandable.has(aId)).toBe(true);
    const l2 = childId(aId, 'Child');
    expect(l2).toBeDefined();
    expect(rows.find((r) => r.ID === l2)!.Class).toBe('Level2');
    expect(expandable.has(l2!)).toBe(true);
    const l3 = childId(l2!, 'Child');
    expect(l3).toBeDefined();
    expect(rows.find((r) => r.ID === l3)!.Class).toBe('Level3');
    expect(expandable.has(l3!)).toBe(true);
    const depth = rows.find((r) => r.parent === l3 && label(r) === 'Depth');
    expect(String(depth.Value)).toBe('301');
  });

  it('expands an object nested inside a cell property (a.Child.Sibling = {Level3})', () => {
    const aId = childId(null, 'a')!;
    const l2 = childId(aId, 'Child')!;
    const siblingId = childId(l2, 'Sibling');
    expect(siblingId).toBeDefined();
    expect(expandable.has(siblingId!)).toBe(true);
    // The single cell element is itself a Level3 object, expandable, with values.
    const elem = rows.find((r) => r.parent === siblingId);
    expect(elem).toBeDefined();
    expect(elem.Class).toBe('Level3');
    expect(expandable.has(elem.ID)).toBe(true);
    const depth = rows.find((r) => r.parent === elem.ID && label(r) === 'Depth');
    expect(String(depth.Value)).toBe('302');
    const count = rows.find((r) => r.parent === elem.ID && label(r) === 'Count');
    expect(String(count.Value)).toBe('33');
  });
});

// An MCOS object ARRAY (not a scalar) must expand as an array of N elements, and
// each element must then expand into its own class-property rows — matching how
// MATLAB shows a `20x1 Simulink.VariableUsage`. Previously the decoder read only
// the first object id from the object handle and hard-coded `[1,1]`, so a 20x1
// array collapsed to a single `<1x1 Simulink.VariableUsage>` leaf. The fixture is
// the real `Simulink.findVars('f14',...)` result (20 usages) saved to a .mat.
describe('MCOS object array expansion — .mat (20x1 Simulink.VariableUsage)', () => {
  function matRows() {
    const buf = fixtureBytes('mcos/variableUsageArray.mat');
    const parsed = parseMat(buf);
    const node = MatNode.fromParsed(parsed as any, 'variableUsageArray.mat');
    return buildMatRows(node);
  }
  const rows = matRows();
  const expandable = expandableIds(rows);
  const label = (r: any) => (typeof r.Name === 'object' ? r.Name.label : r.Name);
  const topId = 'variableUsageArray.mat/variables';

  it('shows the array dimensions and class on the top row, and makes it expandable', () => {
    const top = rows.find((r) => r.ID === topId)!;
    expect(top).toBeDefined();
    expect(label(top)).toBe('variables');
    expect(top.Class).toBe('Simulink.VariableUsage');
    expect(String(top.Value)).toBe('<20x1 Simulink.VariableUsage>');
    expect(expandable.has(topId)).toBe(true);
  });

  it('expands into exactly 20 element rows, labeled variables(1)..variables(20)', () => {
    const elems = rows.filter((r) => r.parent === topId);
    expect(elems).toHaveLength(20);
    expect(elems.map(label)).toEqual(Array.from({ length: 20 }, (_, i) => `variables(${i + 1})`));
  });

  it('each element is itself an expandable scalar object with its class properties', () => {
    const elems = rows.filter((r) => r.parent === topId);
    for (const elem of elems) {
      expect(String(elem.Value)).toBe('<1x1 Simulink.VariableUsage>');
      expect(expandable.has(elem.ID)).toBe(true);
      const propNames = rows.filter((r) => r.parent === elem.ID).map(label).sort();
      expect(propNames).toEqual(['Name', 'Source', 'SourceType', 'Users']);
    }
  });

  it("decodes the first element's Name/Source/SourceType to the findVars values", () => {
    const first = rows.find((r) => r.parent === topId)!;
    const propVal = (name: string) =>
      String(rows.find((r) => r.parent === first.ID && label(r) === name)!.Value);
    expect(propVal('Name')).toBe("'Ka'");
    expect(propVal('Source')).toBe("'f14'");
    expect(propVal('SourceType')).toBe("'model workspace'");
  });

  it('surfaces all 20 variable names across the array (matches Simulink.findVars)', () => {
    const elems = rows.filter((r) => r.parent === topId);
    const names = elems
      .map((elem) => rows.find((r) => r.parent === elem.ID && label(r) === 'Name')!.Value)
      .map((v) => String(v).replace(/'/g, ''));
    expect(names.sort()).toEqual(
      ['Ka', 'Kf', 'Ki', 'Kq', 'Md', 'Mq', 'Mw', 'Swg', 'Ta', 'Tal', 'Ts', 'Uo', 'Vto', 'W1', 'W2', 'Zd', 'Zw', 'a', 'b', 'g'].sort(),
    );
  });
});

// An object array of a KNOWN class must expand two levels AND resolve each element
// to its typed node with the element's real value. paramArray.mat is authentic
// MATLAB output built exactly as a user would:
//   arr = [Simulink.Parameter(5), Simulink.Parameter([1 2 3]), ...
//          Simulink.Parameter(struct('a', 1))];   % a 1x3 heterogeneous array
// This exercises the three shapes a Parameter Value can take across one array —
// scalar, numeric vector, and struct — each decoded into its own ParameterNode.
// (MATLAB refuses a Simulink.Parameter array in a dictionary OR a model workspace —
// verified R2027a — so a .mat is the ONLY container this shape can occur in.)
describe('MCOS object array expansion — .mat (1x3 Simulink.Parameter, heterogeneous)', () => {
  function matRows() {
    const buf = fixtureBytes('mcos/paramArray.mat');
    const parsed = parseMat(buf);
    const node = MatNode.fromParsed(parsed as any, 'paramArray.mat');
    return buildMatRows(node);
  }
  const rows = matRows();
  const expandable = expandableIds(rows);
  const label = (r: any) => (typeof r.Name === 'object' ? r.Name.label : r.Name);
  const topId = 'paramArray.mat/arr';

  it('shows <1x3 Simulink.Parameter> on the top row and makes it expandable', () => {
    const top = rows.find((r) => r.ID === topId)!;
    expect(top).toBeDefined();
    expect(top.Class).toBe('Simulink.Parameter');
    expect(String(top.Value)).toBe('<1x3 Simulink.Parameter>');
    expect(expandable.has(topId)).toBe(true);
  });

  it('expands into 3 element rows arr(1)..arr(3), each a scalar Simulink.Parameter', () => {
    const elems = rows.filter((r) => r.parent === topId);
    expect(elems.map(label)).toEqual(['arr(1)', 'arr(2)', 'arr(3)']);
    elems.forEach((e) => expect(e.Class).toBe('Simulink.Parameter'));
  });

  it('decodes each element Value in its own shape: scalar, numeric vector, struct', () => {
    // Proves the decoder walks every object id in the handle (not just the first)
    // and resolves each element's distinct Value type through the typed node.
    const elems = rows.filter((r) => r.parent === topId);
    expect(String(elems[0].Value)).toBe('5'); // Simulink.Parameter(5)
    expect(String(elems[1].Value)).toBe('[1 2 3]'); // Simulink.Parameter([1 2 3])
    expect(String(elems[2].Value)).toBe('<1x1 struct>'); // Simulink.Parameter(struct('a',1))
  });

  it('lets a struct-valued element expand further into its struct fields', () => {
    const elems = rows.filter((r) => r.parent === topId);
    const structElem = elems[2];
    expect(expandable.has(structElem.ID)).toBe(true);
    // arr(3).Value is the struct; drill into it to reach field `a` = 1.
    const valueRow = rows.find((r) => r.parent === structElem.ID && label(r) === 'Value')!;
    expect(valueRow).toBeDefined();
    expect(expandable.has(valueRow.ID)).toBe(true);
    const fieldA = rows.find((r) => r.parent === valueRow.ID && label(r) === 'a');
    expect(fieldA).toBeDefined();
    expect(String(fieldA!.Value)).toBe('1');
  });
});

// An object array whose elements THEMSELVES contain a nested object ARRAY property
// must keep every element at BOTH levels. busArray.mat is authentic MATLAB output:
//   buses = [b1 b2 b3]  where b1/b2/b3 are Simulink.Bus with 1 / 2 / 3
//   Simulink.BusElement children respectively.
// This guards a second, deeper truncation the top-level array fix did NOT cover: a
// Bus's Elements_internal is itself an object-array-valued PROPERTY, decoded by the
// MCOS resolveValue object-handle path, which previously read only the first
// element id — so buses(2) lost 'y' and buses(3) lost 'q','r'.
describe('MCOS object array expansion — .mat (1x3 Simulink.Bus, each a different element count)', () => {
  function matRows() {
    const buf = fixtureBytes('mcos/busArray.mat');
    const parsed = parseMat(buf);
    const node = MatNode.fromParsed(parsed as any, 'busArray.mat');
    return buildMatRows(node);
  }
  const rows = matRows();
  const expandable = expandableIds(rows);
  const label = (r: any) => (typeof r.Name === 'object' ? r.Name.label : r.Name);
  const topId = 'busArray.mat/buses';

  it('shows <1x3 Simulink.Bus> on the top row and makes it expandable', () => {
    const top = rows.find((r) => r.ID === topId)!;
    expect(top).toBeDefined();
    expect(top.Class).toBe('Simulink.Bus');
    expect(String(top.Value)).toBe('<1x3 Simulink.Bus>');
    expect(expandable.has(topId)).toBe(true);
  });

  it('expands into 3 Bus element rows buses(1)..buses(3), each itself expandable', () => {
    const elems = rows.filter((r) => r.parent === topId);
    expect(elems.map(label)).toEqual(['buses(1)', 'buses(2)', 'buses(3)']);
    elems.forEach((e) => {
      expect(e.Class).toBe('Simulink.Bus');
      expect(expandable.has(e.ID)).toBe(true);
    });
  });

  it('keeps EACH bus’s full, distinct set of BusElements (1, 2, and 3 elements)', () => {
    const elems = rows.filter((r) => r.parent === topId);
    const elemNamesOf = (busRow: any) =>
      rows.filter((r) => r.parent === busRow.ID).map(label);
    expect(elemNamesOf(elems[0])).toEqual(['a']);
    expect(elemNamesOf(elems[1])).toEqual(['x', 'y']);
    expect(elemNamesOf(elems[2])).toEqual(['p', 'q', 'r']);
  });

  it('decodes each BusElement’s DataType through the typed BusElement node', () => {
    const elems = rows.filter((r) => r.parent === topId);
    const dtOf = (busRow: any, name: string) =>
      String(rows.find((r) => r.parent === busRow.ID && label(r) === name)!.DataType);
    expect(dtOf(elems[0], 'a')).toBe('double');
    expect(dtOf(elems[1], 'x')).toBe('single');
    expect(dtOf(elems[1], 'y')).toBe('int32');
    expect(dtOf(elems[2], 'p')).toBe('uint8');
    expect(dtOf(elems[2], 'q')).toBe('boolean');
    expect(dtOf(elems[2], 'r')).toBe('double');
  });
});
