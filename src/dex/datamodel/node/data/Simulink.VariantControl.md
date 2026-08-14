<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.VariantControl — data-object fidelity

**Node class:** `VariantControlNode` (`src/dex/datamodel/node/data/VariantControlNode.ts`)
**MATLAB class:** `Simulink.VariantControl`
**Editable in our UI:** yes (Value property)
**Verified against:** MATLAB R2027a (probe_class('Simulink.VariantControl'))

## Overview

A Simulink.VariantControl stores a variant-condition value used to select active
variants at model update time. The Value must be an **integer-valued real scalar**,
a **logical** (true/false), or **empty** (''/'[]'). In our UI the VariantControl
surfaces as an editable entry whose Value column shows the formatted value and whose
Property Inspector exposes Name, Value, and DataType.

## Property table

| Property      | MATLAB type          | SetAccess | Editable here | Serialized key (JSON / binary) | Editor   | Allowed values / constraint |
|---------------|---------------------|-----------|---------------|--------------------------------|----------|-----------------------------|
| Name          | char                | (entry)   | yes           | name / name                    | text     | Valid MATLAB identifier, unique in namespace |
| Value         | int/logical/enum    | public    | yes           | Value / Value                  | text     | Integer scalar, logical, empty ('', []) |
| ValueType     | char (enum)         | public    | no (hidden)   | ValueType / ValueType          | —        | 'Numeric' (fixed; not user-settable in this context) |
| ActivationTime| char (enum)         | public    | no            | ActivationTime / ActivationTime| —        | 'update diagram' etc. (enum; not surfaced) |
| DataType      | char                | public    | no (label)    | DataType / DataType            | label    | Display-only |

## Non-obvious behavior (the reason this doc exists)

### Value — integer-scalar rule

MATLAB enforces a strict type constraint on Simulink.VariantControl.Value:

- **Accepts:** integer-valued real scalars (5, -3, 0), logical (true, false), empty
  char (''), empty array ([]).
- **Rejects non-integers** (1.5, Inf, -Inf, NaN, complex 5+2i, structs) with:
  > "Simulink.VariantControl value must be an integer, logical, an enumeration, or a Simulink.Parameter with value of type integer, logical or enumeration."
- **Rejects non-scalars** (arrays [1 2 3], matrices [1 2;3 4], char 'text', cells
  {1,2}) with:
  > "Simulink.VariantControl value must be a scalar or a Simulink.Parameter with scalar value."

Our editor always delivers a string. The `setProperty('Value', ...)` override on
VariantControlNode mirrors the accept/reject decision:
- Numeric parse → reject if NaN (→ scalar message), Inf (→ integer message), or
  non-integer (→ integer message).
- Accept `true`/`false` as logical, `''`/`[]` as empty.

### ValueType — hidden, not user-settable

ValueType is `'Numeric'` and effectively read-only in this context. Setting it to
an invalid value produces a different, longer error. Since our UI does not surface
ValueType editing, this rejection is **unreachable** and no code is added.

### ActivationTime — enum, not surfaced

ActivationTime is an enum property ('update diagram', etc.). Our UI does not expose
it for editing, so its enum rejections are **unreachable** — no code added.

### Non-string type assignment — unreachable

Assigning a non-string MATLAB value to a char property (e.g. `obj.ValueType = 5`)
produces: "Value must be a character vector or a string scalar." This rejection is
**unreachable** from our string editor (the UI always delivers a string).

## Allowed values

| Input     | Accepted | Reason / rejection message |
|-----------|----------|---------------------------|
| `5`       | yes      | integer scalar |
| `-3`      | yes      | integer scalar |
| `0`       | yes      | integer scalar |
| `true`    | yes      | logical |
| `false`   | yes      | logical |
| `''`      | yes      | empty char (MATLAB OK) |
| `[]`      | yes      | empty array (MATLAB OK) |
| `1.5`     | no       | integer message |
| `Inf`     | no       | integer message |
| `-Inf`    | no       | integer message |
| `NaN`     | no       | integer message (caught as non-numeric text → scalar msg) |
| `5+2i`    | no       | non-numeric text → scalar message |
| `[1 2 3]` | no       | non-numeric text → scalar message |
| `text`    | no       | non-numeric text → scalar message |

## Validation mirrored in code

| Rule | Code path | Error message |
|------|-----------|---------------|
| Non-integer real (1.5, Inf, -Inf) | `VariantControlNode.setProperty('Value', ...)` | "Simulink.VariantControl value must be an integer, logical, an enumeration, or a Simulink.Parameter with value of type integer, logical or enumeration." |
| Non-scalar / non-numeric text | `VariantControlNode.setProperty('Value', ...)` | "Simulink.VariantControl value must be a scalar or a Simulink.Parameter with scalar value." |

Test: `test/parity/fidelity/variant.fidelity.test.ts`

## Round-trip coverage

- JSON sldd: parse -> edit Value to integer "7" -> serialize -> re-parse -> value preserved.
  Test: `test/parity/fidelity/variant.fidelity.test.ts` (json format loop).
- Binary sldd: same.
  Test: `test/parity/fidelity/variant.fidelity.test.ts` (binary format loop).
- MATLAB re-open value-equality gate:
  - `Value=7` -> MATLAB reads 7. PASS.
  Test: `test/parity/fidelity/variant.fidelity.test.ts` (gated on DEX_MATLAB_CMD).

## Open questions / deferred

- **Enumeration-typed Value**: MATLAB also accepts enumeration values as
  VariantControl.Value. Our UI does not surface enumeration-literal entry (the
  editor is a plain text field), and there is no enumeration parser in the
  codebase. Deferred until enumeration-aware editing is designed.

- **Simulink.Parameter Value**: MATLAB accepts a Simulink.Parameter object whose
  own Value is integer/logical/enum. This is a reference-typed assignment not
  reachable from the scalar text editor. Deferred.
