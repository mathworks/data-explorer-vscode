<!-- Copyright 2026 The MathWorks, Inc. -->

# MATLAB Variable — data-object fidelity

**Node class:** `MatlabVariableNode` (`src/dex/datamodel/node/data/MatlabVariableNode.ts`)
**MATLAB class:** (none — a plain MATLAB value: double, array, cell, struct, string, complex, logical, typed-int)
**Editable in our UI:** yes (Value column editable for all shapes except struct and opaque)
**Verified against:** MATLAB R2027a (params.sldd fixture round-trip)

## Overview

A MATLAB Variable is a raw MATLAB value stored in Design Data. Unlike
`Simulink.Parameter` or `Simulink.Signal`, there is no wrapper MATLAB class — the
dictionary entry value IS the variable (a scalar, vector, matrix, cell, struct,
string, logical, complex, or typed integer).

In Architectural Data (metadata.isderived = '1'), a plain variable that is scalar
and numeric is classified as a **Constant** and rendered via `ConstantNode` (see
`Simulink.Constant.md`). The fork is purely metadata-driven; on disk they are
byte-identical.

### Columns surfaced
| Column    | Source                       | Editable |
|-----------|------------------------------|----------|
| Name      | entry name                   | yes      |
| Value     | the variable itself          | yes (except struct, opaque) |
| DataType  | className (double, int16...) | no       |
| Description | metadata.description       | yes      |

## Value shapes and their internal representation

| Shape         | `_kind`   | `_scalarType`      | Example displayValue    |
|---------------|-----------|--------------------|-------------------------|
| scalar double | `scalar`  | `double`           | `3.14`                  |
| scalar logical| `scalar`  | `logical`          | `true`                  |
| scalar char   | `scalar`  | `char`             | `'hello'`               |
| scalar string | `string`  | `string`           | `"world"`               |
| scalar complex| `scalar`  | `complex`          | `3+4i`                  |
| typed int     | `scalar`  | `int8`/`int16`/... | `-1234`                 |
| vector/matrix | `array`   | `double`/`logical`/...| `[1 2; 3 4]`        |
| cell array    | `cell`    | `double`           | `{1, 'two', [3 4]}`    |
| string array  | `string`  | `string`           | `["a" "bb" "ccc"]`     |
| struct        | `scalar`  | `struct`           | `<1x1 struct>`          |
| empty         | `array`   | `double`           | `[]`                    |

## Non-obvious behavior

### Editing a typed integer loses the type
`MatlabValueParser.parse('500')` produces `{ type: 'double', value: 500 }` — there
is no `int16(500)` syntax in the parser. After a user edits a typed-int entry, the
stored value becomes `double`. This is a known limitation documented here; the
numeric value is preserved exactly.

### Constrained children (array elements and string elements)
When editing a child of an array or string-array:
- **Array element:** `setProperty('Value', ...)` rejects anything that is not a
  scalar number. Error: **"Array elements must be scalar numbers"**
- **String element:** rejects anything that is not a char or string value. Error:
  **"String elements must be character or string values"**

### Structs are not directly editable
A struct (`_kind='scalar', _scalarType='struct'`) has `valueEditable = false`. Its
fields are editable as individual children.

### Opaque objects are read-only
An opaque MCOS object (e.g. a `Simulink.Parameter` stored as a raw variable rather
than as a recognized catalog entry) has `valueEditable = false` and
`canAddChild() = false`.

### Complex values use cdata serialization
Complex scalars and arrays are stored in the JSON format as `{ _type: "cdata",
_value: <encoded> }`. The encoding may be a text representation
(`"1+2i"` / `"1+2i 3+4i"` with column-major ordering) or a binary-encoded string.
Both are supported by the parser.

## Validation mirrored in code

| Rule | Code path | Error message |
|------|-----------|---------------|
| Array child must be scalar number | `MatlabVariableNode._setConstrainedValue` | "Array elements must be scalar numbers" |
| String child must be char/string | `MatlabVariableNode._setConstrainedValue` | "String elements must be character or string values" |
| Unparseable expression | `MatlabVariableNode.setProperty` | "Invalid MATLAB expression" |

Test: `test/parity/fidelity/variable.fidelity.test.ts`

## Round-trip coverage

- **JSON sldd:** parse -> edit -> serialize -> re-parse -> value preserved. Shapes
  tested: scalarD, negD, colVec, rowVec, mat2x2, boolFlag, i16Scalar, strScalar,
  charStr, cplxScalar, emptyD, myCell, strArray, boolVec.
- **Binary sldd:** same set of shapes.
- **MATLAB re-open value-equality gate** (gated on `DEX_MATLAB_CMD`): scalarD,
  negD, colVec, rowVec, mat2x2, boolFlag, i16Scalar confirmed via `__value__` and
  `__class__` assertions.

### Shapes tested only in-process (not through the MATLAB gate)
| Shape | Reason |
|-------|--------|
| complex (cplxScalar) | cdata binary encoding; verify_roundtrip scalar path cannot compare |
| string (strScalar) | string saveobj/loadobj path requires special MATLAB comparison |
| char (charStr) | char class match works but value quoting needs special handling |
| cell (myCell) | heterogeneous cell; no scalar path |
| string-array (strArray) | same as cell |
| struct (myStruct) | top-level struct parses as StructNode, not MatlabVariableNode |

## Open questions / deferred

- **Type-preserving edits for typed integers**: the parser has no `int16(...)` cast
  syntax. A future enhancement could detect when the edited entry was originally
  typed (from `_type` in the serial) and re-wrap the new value in the same type
  container. Tracked as a known limitation for now.
- **Complex array editing**: editing individual elements of a complex array is not
  supported through the constrained-child path (they are read-only). This is safe
  because the complex array's cdata serial is preserved unmodified until the parent
  value is re-edited as a whole expression.
