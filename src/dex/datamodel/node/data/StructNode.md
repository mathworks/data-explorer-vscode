<!-- Copyright 2026 The MathWorks, Inc. -->

# Struct (MATLAB struct variable) — data-object fidelity

**Node class:** `StructNode` (`src/dex/datamodel/node/data/StructNode.ts`)
**MATLAB class:** (none — a plain MATLAB struct stored as a dictionary entry)
**Editable in our UI:** structural add/remove of fields (1x1 structs only)
**Verified against:** MATLAB R2027a (params.sldd fixture round-trip)

## Overview

A **struct** is a MATLAB struct variable stored in a data dictionary. In the JSON
format it is represented as:

```json
{
  "_array_type": "Struct",
  "_dimensions": [1, 1],
  "_fields": ["a", "b", "c"],
  "_elements": [{"a": 1, "b": [2, 3], "c": "txt"}],
  "_mw_element_type": "MATLABArray"
}
```

StructNode handles both scalar structs (1x1) and struct arrays (e.g. 1x2, 2x3).
Struct arrays have multiple `_elements`, each sharing the same `_fields` list. Each
element is parsed as a child `StructNode` with `_isElementNode = true`.

### Columns surfaced
| Column    | Source              | Editable |
|-----------|---------------------|----------|
| Name      | entry/field name    | yes      |
| Value     | displayValue        | no (shows `<1x1 struct>`) |
| DataType  | 'struct'            | no       |
| Description | metadata.description | yes   |

## Structural editing: canAddChild / canRemoveChild

A struct supports add/remove of fields ONLY when:
- Dimensions are exactly `[1, 1]` (scalar struct)
- The node is NOT an element node (`_isElementNode !== true`)

A **struct array** (e.g. `structArray` with dimensions `[1, 2]`) returns
`canAddChild() = false` and `canRemoveChild() = false`. This matches MATLAB
behavior: adding a field to a struct array requires setting the value for that
field across ALL elements simultaneously, which our UI does not support.

### addChildNode()

Creates a new field named `'field'` (or `'field1'`, `'field2'`, ... for
uniqueness). The new field's value defaults to `0` (via `NodeRegistry.parseValue`).
The field name is appended to `serial._fields` to keep the field list in sync with
the children array.

### removeChildNode(child)

Removes the specified child and splices its name from `serial._fields`. The
remaining children and fields stay in their original order.

### execAddChild / execRemoveChild

Return undo/redo closures that call `removeChildNode`/`restoreChildNode` for
rollback. `restoreChildNode` reinserts the child at its original index position in
both the children array and `_fields`.

## Serialized shape

`serializeValue()` produces the canonical struct JSON:

```json
{
  "_array_type": "Struct",
  "_dimensions": [1, 1],
  "_fields": ["a", "b", "c", "field"],
  "_elements": [{"a": 1, "b": [2, 3], "c": "txt", "field": 0}],
  "_mw_element_type": "MATLABArray"
}
```

The `_fields` array is re-derived from the live children on every serialize, so
add/remove keeps the field list in sync. For struct arrays, each element node
serializes independently via `serializeElement()`.

## Non-obvious behavior

### Empty-leaf rule
A struct field cannot be null or empty for a Simulink.Parameter — MATLAB rejects
`[]` as a field value when the entry is a Parameter-wrapped struct. Our default of
`0` is safe. (Cross-reference: Simulink.Parameter.md)

### Struct array is read-only structurally
A struct with `_dimensions != [1,1]` renders as a tree of element children
(`name(1)`, `name(2)`, ...) but cannot have fields added or removed. This is
enforced by `canAddChild()` and `canRemoveChild()` checking dimensions.

### Element node serialization
When `_isElementNode` is true, `serializeValue()` delegates to `serializeElement()`
which produces a plain object of field-value pairs (no metadata wrapper).

## Structural round-trip coverage

- **In-process:** Load `myStruct`/`nestedStruct`/`structArray` from params.sldd in
  both JSON and binary formats. Add a field, serialize, re-parse, verify child
  count increased and the new field name is present with value `0`. Remove a field,
  verify it's gone and siblings are intact.
- **Struct array guard:** Verify `structArray` (dims `[1,2]`) returns
  `canAddChild() = false`.
- **Undo/redo:** Verify `execAddChild().undo()` restores original field count;
  `redo()` re-adds the same field at the same position.
- **MATLAB gate:** After add, assert the new field's value is `0` in MATLAB. After
  remove, assert a surviving char field reads back correctly.

Test: `test/parity/fidelity/structural.fidelity.test.ts`
