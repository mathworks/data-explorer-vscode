<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink Constant — data-object fidelity

**Node class:** `ConstantNode` (`src/dex/datamodel/node/data/ConstantNode.ts`)
**MATLAB class:** (none — a plain MATLAB variable with metadata.isderived = '1')
**Editable in our UI:** yes (Value only, subject to scalar-numeric gate)
**Verified against:** MATLAB R2027a (params.sldd fixture round-trip)

## Overview

A **Constant** is an Architectural Data entry. On disk it is byte-identical to a
plain (derived) MATLAB variable — the only distinction is `metadata.isderived`.
Simulink's rule is:

> The value for constant 'X' must be scalar and numeric.

`ConstantNode` is a subclass of `MatlabVariableNode` that enforces this rule on
every edit. It shares all of MatlabVariableNode's parse and serialize machinery, so
a Constant round-trips identically to the plain variable it is.

### Columns surfaced
| Column    | Source              | Editable |
|-----------|---------------------|----------|
| Name      | entry name          | yes      |
| Value     | the variable itself | yes (gated: scalar-numeric only) |
| DataType  | className           | no       |
| Description | metadata.description | yes   |

## The scalar-numeric rule

A value is **scalar-numeric** when:
- It is a single number (double literal like `5`, `3.14`, `-2`)
- It is a logical (`true` / `false`)
- It is a complex scalar (`1+2i`)
- It is a 1-element numeric array (`[5]`)

A value is **NOT** scalar-numeric when it is:
- A multi-element array (`[1 2 3]`, `[1 2; 3 4]`)
- A cell array (`{1, 2}`)
- A char vector (`'hello'`)
- A string (`"world"`)
- A struct
- An empty array (`[]`)

This rule is checked by `parsedIsScalarNumeric()` in `MatlabValueParser.ts` and by
`MatlabVariableNode.isScalarNumeric` (the live-node counterpart).

## Non-obvious behavior

### Defensive read-only for corrupt files
If a `.sldd` file on disk carries a derived entry whose value is NOT scalar-numeric
(invalid in MATLAB, but possible in a hand-edited file), `ConstantNode` renders it
**read-only** (`valueEditable = false`) rather than letting it be edited into a
still-invalid state.

### No children, ever
A Constant is a scalar leaf. `canAddChild()` always returns `false`, regardless of
what value it holds.

### Design <-> Arch conversion
- A Constant pasted into Design Data becomes a plain `MatlabVariableNode` (its
  `isderived` metadata flips to `'0'`).
- A plain MATLAB Variable pasted into Architectural Data becomes a Constant
  (`isderived` flips to `'1'`) — but ONLY if the value is scalar-numeric. A
  non-scalar-numeric variable is rejected with the exact error message.

### fromVariable (prototype swap)
`ConstantNode.fromVariable(node)` reclasses an already-parsed MatlabVariableNode
into a ConstantNode by swapping its prototype. This preserves identity, children,
parent pointers, metadata, and serial state. Used by `SectionNode.parseEntry` to
turn a derived variable into a Constant without field-by-field copy.

## Validation mirrored in code

| Rule | Code path | Error message |
|------|-----------|---------------|
| Value must be scalar-numeric | `ConstantNode.setProperty('Value', ...)` | "The value for constant '\<name\>' must be scalar and numeric." |
| Unparseable expression | `ConstantNode.setProperty('Value', ...)` | "Invalid MATLAB expression" |
| Paste gate (host side) | `structuralEdit.pasteEntry` | "must be scalar and numeric" |

Test: `test/parity/fidelity/variable.fidelity.test.ts`, `test/constantNode.test.ts`

## Allowed values

The Constant's Value accepts any MATLAB expression that `MatlabValueParser.parse`
recognizes AND that `parsedIsScalarNumeric` admits. The full truth table:

| Input | Accepted | Reason |
|-------|----------|--------|
| `5`   | yes | scalar double |
| `3.14`| yes | scalar double |
| `-2`  | yes | scalar double |
| `true`| yes | logical |
| `false`| yes | logical |
| `1+2i`| yes | complex scalar |
| `[5]` | yes | 1-element array (scalar) |
| `[1 2 3]` | no | multi-element array |
| `[1 2; 3 4]` | no | matrix |
| `{1, 2}` | no | cell |
| `'hello'` | no | char |
| `"world"` | no | string |
| `int8(5)` | rejected as unparseable | parser has no cast syntax |

## Round-trip coverage

- **In-process:** create ConstantNode, edit Value to scalar-numeric, serialize,
  re-parse via MatlabVariableNode.parse, reclass via fromVariable, verify
  displayValue and isScalarNumeric are preserved.
- **MATLAB gate:** scalar double edits confirmed via the MatlabVariable round-trip
  suite (scalarD, negD use the same serialization path).

## Open questions / deferred

- **Typed-integer Constants**: editing a Constant that was originally stored as
  `int16` will produce a `double` after edit (same limitation as MatlabVariable).
  The scalar-numeric gate still passes because double scalars are valid Constants.
- **Inf/NaN as Constant values**: `MatlabValueParser.parse('Inf')` returns `null`
  (unparseable), so Inf/NaN cannot be entered via the UI editor. MATLAB accepts
  `Inf` as a valid Constant value. This is a conservative restriction — users
  cannot accidentally set a Constant to Inf. If needed, the parser can be extended.
