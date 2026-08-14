<!-- Copyright 2026 The MathWorks, Inc. -->

# Structural Editing — add/remove round-trip behavior

**Verified against:** MATLAB R2027a (params.sldd fixture, both JSON and binary formats)
**Test:** `test/parity/fidelity/structural.fidelity.test.ts`

This document covers the structural mutation surface (add/remove a child element or
field) for Bus, ConnectionBus, ServiceBus, and Struct nodes. Property-level edits
on individual elements (Name, Min, Max, DataType, etc.) are covered in their
respective node docs.

---

## Simulink.Bus / Simulink.ConnectionBus

**Node class:** `BaseBusNode` → `BusNode` / `ConnectionBusNode`
**Element class:** `BusElementNode` / `ConnectionBusElementNode`

### canAddChild / canRemoveChild

Both bus types always allow structural editing:
- `canAddChild()` → `true` (unconditionally)
- `canRemoveChild()` → `true` when `children.length > 0`

### addChildNode — element creation

Creates a new element named `'a'` (or `'a1'`, `'a2'`, ... for uniqueness). Each
new element gets a fresh entry-scoped `_id` via `_nextElementId()`.

The element's serial data is minimal: `{ _rawElem: { _id: "<N>", _properties: { Name: "<name>" } }, _properties: { Name: "<name>" } }`. The element class (BusElement
vs ConnectionElement) is determined by `_createElementNode()` in the concrete
subclass.

### Element ID allocation

All elements (and their nested sub-objects like Arguments) share one entry-scoped
numbering sequence. The bus wrapper typically has `_id: "1"`, elements start at
`"2"`, etc.

- `_maxElementId()` walks all children's raw elements recursively (including nested
  ids like a ServiceBus function element's Arguments) to find the highest id
  currently in use.
- `_nextElementId()` returns `String(_maxElementId() + 1)`.

This guarantees a new element never collides with any existing id, even if elements
were previously removed (ids are never reused, only monotonically increasing).

### Dimension re-derivation on serialize

`_getSerializedProperties()` re-derives `Elements_internal` from the live children
on every serialize call:

```
Elements_internal = {
  _array_class: "<element class name>",
  _dimensions: [N, 1],      // column vector: [childCount, 1]
  _elements: [...],          // each child's serializeValue()
  _mw_element_type: "MATLABArray"
}
```

This keeps `_dimensions` in sync with the actual child count after add/remove. The
column-vector convention `[N, 1]` matches MATLAB's internal representation.

When all children are removed (`N = 0`), `Elements_internal` is set to `[]` (empty
array). In the binary XML format this serializes as
`<P Name="Elements_internal" Class="double" Dimension="0*0"/>`, which MATLAB
interprets as "no elements" — equivalent to a freshly-created bus.

### Single-object to array-form conversion

Some fixtures store `Elements_internal` in a single-object form (when there was
originally one element): `{ _id: "2", _object_class: "Simulink.ConnectionElement",
_properties: {...} }`. On the first structural modification (add or remove), the
serializer converts this to the canonical array form with `_array_class`. This is a
one-way conversion — the array form is always used after any structural edit.

### removeChildNode / restoreChildNode

- `removeChildNode(child)` splices the child from the children array and marks
  modified.
- `restoreChildNode(child, index)` reinserts at the original index position for
  undo.
- `execRemoveChild(child)` returns `{ undo, redo }` closures.

### Binary XML round-trip: phantom element fix

When the binary XML serializer emits an empty elements property as a self-closing
`<Element Class="..."/>` tag, the XML parser would re-interpret it as having one
element with empty properties. The parser guards against this: elements with both
empty name AND empty properties are skipped as phantom entries.

---

## Simulink.ServiceBus

**Node class:** `ServiceBusNode` (extends `BaseBusNode`)
**Element class:** `FunctionElementNode`

### canAddChild / canRemoveChild

Inherited from BaseBusNode: `canAddChild()` → `true`, `canRemoveChild()` →
`children.length > 0`.

### addChildNode — function element creation

Unlike Bus/ConnectionBus, a ServiceBus element is a `Simulink.FunctionElement`
which carries richer structure:

- **Name:** `'f0'`, `'f1'`, ... (auto-incrementing function name)
- **Prototype:** `'y = f0(u,v)'` — the function signature
- **Arguments:** A `Simulink.BusElement` array of 3 elements: `[u, v, y]`
- **Asynchronous:** `false`

Each function element AND each of its 3 arguments gets a unique `_id` allocated
via `_maxElementId()`. For a newly added function element, the ids are:
- Function element: `_maxElementId() + 1`
- Argument 'u': `_maxElementId() + 2`
- Argument 'v': `_maxElementId() + 3`
- Argument 'y': `_maxElementId() + 4`

So adding one function element consumes 4 id slots. This ensures nested argument
ids never collide with sibling function elements or their arguments.

### Serialized shape

After adding one function element to an empty ServiceBus, `serializeValue()`
produces:

```json
{
  "_array_class": "Simulink.ServiceBus",
  ...
  "_elements": [{
    "_properties": {
      "Elements_internal": {
        "_array_class": "Simulink.FunctionElement",
        "_dimensions": [1, 1],
        "_elements": [{
          "_id": "2",
          "_properties": {
            "Name": "f0",
            "Prototype": "y = f0(u,v)",
            "Asynchronous": false,
            "Arguments": {
              "_array_class": "Simulink.BusElement",
              "_dimensions": [3, 1],
              "_elements": [
                {"_id": "3", "_properties": {"Name": "u", ...}},
                {"_id": "4", "_properties": {"Name": "v", ...}},
                {"_id": "5", "_properties": {"Name": "y", ...}}
              ]
            }
          }
        }]
      }
    }
  }]
}
```

### Test coverage

ServiceBus is tested in-process only (no ServiceBus entry exists in the params.sldd
fixture). Tests verify:
- Function element has correct name, Prototype, and 3 Arguments
- Multiple adds produce unique names and non-colliding ids
- Remove reduces child count
- Serialize round-trip preserves the function element structure

---

## Struct

See `StructNode.md` for full documentation. Key structural differences from buses:

- **Gated on dimensions:** `canAddChild()` requires `[1, 1]` dimensions and
  `_isElementNode !== true`. Struct arrays are NOT structurally editable.
- **Field names:** New fields are named `'field'`, `'field1'`, ... (not `'a'`).
- **Default value:** New fields default to `0` (via `NodeRegistry.parseValue`).
- **No element IDs:** Struct fields don't have `_id` — they're identified by name
  in the `_fields` array.
- **_fields sync:** `addChildNode()`/`removeChildNode()` maintain `serial._fields`
  in addition to the children array.

---

## Undo/Redo contract

All structural operations return undo/redo closures via `execAddChild()` and
`execRemoveChild()`:

| Operation | undo() | redo() |
|-----------|--------|--------|
| Add child | `removeChildNode(child)` | `restoreChildNode(child, index)` |
| Remove child | `restoreChildNode(child, index)` | `removeChildNode(child)` |

The `index` captures the child's position at the time of the operation, ensuring
undo restores it to the exact same position in the children array (and `_fields`
for structs).

**Idempotence:** `execAddChild()` followed by `execRemoveChild(addedChild)` returns
the node to its original state (same child count, same names, same order).

---

## MATLAB round-trip verification

The live MATLAB gate (`verify_roundtrip.m`) confirms that after our UI serializes a
structural change, MATLAB can:
1. Open the dictionary without error
2. Report the correct element/field count via `numel(v.Elements)` (for buses) or
   field-path access (for structs)
3. Read back the values of added/surviving elements

Tested assertions:
- Bus add: `__count__: N+1`, `__class__: 'Simulink.Bus'`
- Bus remove: `__count__: N-1`
- ConnectionBus add: `__count__: N+1`, `__class__: 'Simulink.ConnectionBus'`
- ConnectionBus remove: `__count__: N-1`
- Struct add: `{fieldName: 0}` (the new field's default value)
- Struct remove: `{survivingField: expectedValue}` (a surviving field reads back)
