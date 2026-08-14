<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.VariantExpression — data-object fidelity

**Node class:** `VariantExpressionNode` (`src/dex/datamodel/node/data/VariantExpressionNode.ts`)
**MATLAB class:** `Simulink.VariantExpression`
**Editable in our UI:** yes (Condition property)
**Verified against:** MATLAB R2027a (probe_class('Simulink.VariantExpression'))

## Overview

A Simulink.VariantExpression stores a variant-condition expression as a character
string (e.g. `'A == 1'`). The Condition property accepts **any string** — MATLAB
does not validate the expression syntax on assignment, only at model-update time.
In our UI the VariantExpression surfaces as an editable entry whose Value column
shows the Condition string.

## Property table

| Property      | MATLAB type | SetAccess | Editable here | Serialized key (JSON / binary) | Editor   | Allowed values / constraint |
|---------------|-------------|-----------|---------------|--------------------------------|----------|-----------------------------|
| Name          | char        | (entry)   | yes           | name / name                    | text     | Valid MATLAB identifier, unique in namespace |
| Condition     | char        | public    | yes           | Condition / Condition          | text     | Any string (validated downstream at model update) |
| DataType      | char        | public    | no (label)    | DataType / DataType            | label    | Display-only |

## Non-obvious behavior (the reason this doc exists)

### Condition — accepts any string

MATLAB accepts ANY character-vector/string-scalar assignment to Condition:
- Valid expressions: `'A == 1'`, `'V > 3 && B < 2'`
- Invalid/bogus strings: `'bogus'`, `'double'`, `'int32'`, `''`

All are stored verbatim. Validation happens only when the model is updated, not on
assignment. This means our editor needs NO validation beyond the type guard that
the UI always delivers a string.

### Non-string assignment — unreachable

Assigning a non-string value (number, logical, array, struct, cell) produces:
> "Error setting property 'Condition' of class 'VariantExpression': Value must be a character vector or a string scalar."

This rejection is **unreachable** from our string editor (the UI always delivers a
string). No code is added for it.

## Allowed values

| Input         | Accepted | Reason |
|---------------|----------|--------|
| `'A == 1'`   | yes      | valid expression (char) |
| `'bogus'`    | yes      | any string accepted |
| `''`         | yes      | empty string |
| `'double'`   | yes      | any string accepted |
| `5` (number) | no       | "Value must be a character vector..." — unreachable from UI |

## Validation mirrored in code

No validation code is needed for Condition edits. The generic `DataNode.setProperty`
string path (`typeof current !== 'number'` → stores verbatim) is sufficient, because
Condition is typed as `string` and the editor always delivers a string.

Test: `test/parity/fidelity/variant.fidelity.test.ts`

## Round-trip coverage

- JSON sldd: parse -> edit Condition to "A == 2" -> serialize -> re-parse -> Condition preserved.
  Test: `test/parity/fidelity/variant.fidelity.test.ts` (json format loop).
- Binary sldd: same.
  Test: `test/parity/fidelity/variant.fidelity.test.ts` (binary format loop).
- MATLAB re-open value-equality gate:
  - `Condition='A == 2'` -> MATLAB reads 'A == 2'. PASS.
  Test: `test/parity/fidelity/variant.fidelity.test.ts` (gated on DEX_MATLAB_CMD).

## Open questions / deferred

- **Expression syntax validation**: MATLAB validates expressions at model-update
  time, not at assignment. A future enhancement could add a soft warning for
  obviously-invalid expressions, but this is not required for fidelity and would
  be a UX decision (not a correctness bug).
