<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.data.dictionary.EnumTypeDefinition — data-object fidelity

**Node class:** `EnumTypeNode` (`src/dex/datamodel/node/data/EnumTypeNode.ts`)
**MATLAB class:** `Simulink.data.dictionary.EnumTypeDefinition`
**Editable in our UI:** yes
**Verified against:** MATLAB R2027a (probe_enumdef on params.sldd fixture)

## Overview

A Simulink.data.dictionary.EnumTypeDefinition defines a custom enumeration type
within a data dictionary. In our UI the enum surfaces as an editable entry whose
Value column shows the DefaultValue (or the first enumeral's name when no default is
set). Its Property Inspector exposes Name, Value (select editor), DataType (label),
and Description. The child tree shows individual enumeral rows, each with
Name/Value/Description.

## Property table

| Property      | MATLAB type          | SetAccess | Editable here | Serialized key (JSON / binary) | Editor   | Allowed values / constraint |
|---------------|---------------------|-----------|---------------|--------------------------------|----------|-----------------------------|
| Name          | char                | (entry)   | yes           | name / name                    | text     | Valid MATLAB identifier, unique in namespace |
| DefaultValue  | char                | public    | yes           | DefaultValue / DefaultValue    | select   | Must be empty or match an existing enumeral Name |
| DataType      | char                | public    | no (label)    | (not serialized as top-level)  | label    | Any string (free-form) |
| Description   | char                | public    | yes           | Description / Description      | text     | Any string |
| DataScope     | char (enum)         | public    | no            | DataScope / DataScope          | —        | 'Auto', 'Exported', 'Imported' |
| HeaderFile    | char                | public    | no            | HeaderFile / HeaderFile        | —        | Any string |
| StorageType   | char                | public    | no            | StorageType / StorageType      | —        | Any string |
| AddClassNameToEnumNames | logical  | public    | no            | AddClassNameToEnumNames        | —        | true/false |

## Non-obvious behavior (the reason this doc exists)

### DefaultValue (the select editor)

- **Options come from the live child enumeral names.** `PropEnumValue.readOptions()`
  returns `node.children.map(c => c.name)` — the dropdown always reflects the
  current set of enumerals, including freshly-added ones and excluding removed ones.

- **Selecting a value writes to `node.DefaultValue`.** PropEnumValue has
  `nodeProperty = 'DefaultValue'`, so `setProperty('Value', 'Red')` resolves to
  writing `this.DefaultValue = 'Red'`.

- **displayValue falls back to the first enumeral.** When `DefaultValue === ''`,
  `displayValue` returns `this.children[0].name`. The same enumeral gets the
  "current" icon in the child tree. This mirrors MATLAB's behavior: an enum with
  an empty DefaultValue implicitly defaults to the first enumeral.

- **MATLAB rejects non-existent enumeral names:**
  `v.DefaultValue = 'Bogus'` → "Default value does not match any of the enumeration
  names." However, this rejection is **unreachable** from our string editor because
  the select dropdown only offers existing enumeral names — the user cannot type a
  free-form string. Type-guarded by the select editor.

- **Empty string clears the default:** `v.DefaultValue = ''` is valid in MATLAB,
  reverting to the implicit "first enumeral" behavior. Our code supports this (an
  empty string assignment to a string property succeeds).

### Enumeral child values

- Enumeral `Value` is stored as a **string** (e.g. `"0"`, `"1"`, `"42"`), not a
  number. This matches the JSON/binary source format where the struct array stores
  Value as a character field. MATLAB's `v.Enumerals(i).Value` is numeric (int32),
  but the serialized representation is the string form.

- When a new enumeral is added via `addChildNode()`, its Value is set to
  `String(children.length)` — the next sequential integer as a string.

### Non-string assignment

- Non-string assignment (`5`, `[1 2]`, `true`, etc.) to DefaultValue or Description
  → **"Value must be a character vector or a string scalar."**
  This rejection is **unreachable** from our UI (the select editor and text editor
  always deliver strings). Type-guarded by the string editor.

## Structural editing (add/remove enumerals)

### canAddChild / canRemoveChild

- `canAddChild()` → `true` (unconditionally; any enum can grow its enumeral set)
- `canRemoveChild()` → `true` when `children.length > 0`

### addChildNode — enumeral creation

Creates a new enumeral named `'enumN'` (N starts at 1, incremented until unique
among siblings). The new enumeral's Value is `String(children.length)` — the next
ordinal. Description defaults to empty string.

### Dimension re-derivation on serialize

`_getSerializedProperties()` rebuilds the `Enumerals` wrapper on every serialize
call, keeping `_dimensions` in sync:

```
Enumerals = {
  ...preservedKeys,
  _elements: [child.serializeValue() for each child],
  _dimensions: [1, enumerals.length]   // row-vector struct array
}
```

This ensures add/remove stays consistent in the serialized format.

### removeChildNode / restoreChildNode

- `removeChildNode(child)` splices the child from children and marks modified.
- `restoreChildNode(child, index)` reinserts at the original position for undo.
- `execRemoveChild(child)` returns `{ undo, redo }` closures.

### Undo/Redo contract

| Operation | undo() | redo() |
|-----------|--------|--------|
| Add child | `removeChildNode(child)` | `restoreChildNode(child, index)` |
| Remove child | `restoreChildNode(child, index)` | `removeChildNode(child)` |

## Validation mirrored in code

- `setProperty('Value', <name>)` writes `DefaultValue = name` unconditionally
  (string-to-string). No validation is needed in code because the select editor
  only offers valid options (existing enumeral names). The MATLAB-side rejection
  ("Default value does not match any of the enumeration names") is unreachable.
  Test: `test/parity/fidelity/enumtype.fidelity.test.ts`.

## Round-trip coverage

- JSON sldd: parse → edit DefaultValue → serialize → re-parse → value preserved.
  Test: `test/parity/fidelity/enumtype.fidelity.test.ts` (json format loop).
- Binary sldd: same.
  Test: `test/parity/fidelity/enumtype.fidelity.test.ts` (binary format loop).
- MATLAB re-open value-equality gate:
  - `DefaultValue='Red'` → MATLAB reads `'Red'`. PASS.
  - Structural add → MATLAB opens file, `__class__` matches. PASS.
  - Structural remove → MATLAB opens file, `__class__` matches. PASS.
  Test: `test/parity/fidelity/enumtype.fidelity.test.ts` (gated on DEX_MATLAB_CMD).

## MATLAB round-trip gate limitations

- **Enumeral count**: `verify_roundtrip.m`'s `__count__` special key reads
  `numel(v.Elements)`, which is bus-specific. For enums the count is
  `numel(v.Enumerals)`, but we must NOT modify verify_roundtrip.m. Structural
  add/remove tests use `__class__` only (proving MATLAB opens the mutated file)
  and assert exact child counts in-process. This is a known gate limitation.

## Open questions / deferred

- **Enumeral Name editing**: Individual enumeral names can be renamed via the
  tree. If an enumeral is renamed to match the current DefaultValue, no update is
  needed. If the DefaultValue's enumeral is renamed, the DefaultValue becomes
  stale (MATLAB would reject it). Our UI does not yet cascade a rename into the
  parent's DefaultValue — deferred until enumeral name editing is surfaced.

- **DataScope / HeaderFile / StorageType / AddClassNameToEnumNames**: These
  properties exist in MATLAB but are not surfaced in our UI editor. Deferred.
