<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.BusElement — data-object fidelity

**Node class:** `BusElementNode` (`src/dex/datamodel/node/data/BusNode.ts`)
**MATLAB class:** `Simulink.BusElement`
**Editable in our UI:** yes (Name, Min, Max, Description)
**Verified against:** MATLAB R2027a (probe_class('Simulink.BusElement'))

## Overview

A `Simulink.BusElement` defines one signal element within a `Simulink.Bus`
object. It carries per-element data type, dimensions, complexity, min/max bounds,
units, and a description. In our UI each bus element appears as a child row under
its parent bus entry. The Property Inspector exposes Name, DataType, Dimensions,
Complexity, DimensionsMode, Min, Max, Unit, and Description — but only Name, Min,
Max, and Description are editable.

## Property table

| Property | MATLAB type | SetAccess | Editable here | Serialized key | Editor | Constraint |
|----------|-------------|-----------|---------------|----------------|--------|------------|
| Name | char | public | yes | Name | text | Valid MATLAB identifier; unique among siblings; must not be empty or start with `sl_padding` |
| DataType | char | public (Dependent) | no | DataType_internal / DataType | label | free-form char |
| Dimensions | double/char | public | no | Dimensions | label | positive double vector or symbolic char |
| Complexity | char (enum) | public | no | Complexity | label | 'real' or 'complex' |
| DimensionsMode | char (enum) | public | no | DimensionsMode | label | 'Fixed' or 'Variable' |
| Min | double/[] | public (Dependent) | yes | Min_internal / Min | text | finite real double scalar; `[]` clears |
| Max | double/[] | public (Dependent) | yes | Max_internal / Max | text | finite real double scalar; `[]` clears |
| Unit | char | public (Dependent) | no | DocUnits / Unit | label | unit expression (read-only) |
| Description | char | public | yes | Description | textArea | any string |

Hidden/private properties not surfaced: Min_internal, Max_internal,
DataType_internal, Type, DocUnits, SamplingMode, SampleTime, TargetUserData.

## Non-obvious behavior

### Min / Max — finite real double scalar

The MATLAB error on a bus element is element-scoped:

- `elem.Min = Inf` / `[1 2 3]` / `NaN` / `5+2i` / `'text'` / `true` / `struct` / `{1,2}` →
  **"Minimum on element 'x' must be a finite real double scalar value"**
- `elem.Max = Inf` → **"Maximum on element 'x' must be a finite real double scalar value"**
- `elem.Min = []` → **OK** (clears to default empty)
- MATLAB does NOT enforce Min <= Max. We match this: no cross-check.

The element-scoped wording ("on element 'x'") differs from the top-level
Parameter/Signal message. Our `_setMinMax` helper uses the generic wording
("Minimum must be a finite real double scalar value") which is functionally
equivalent — the constraint and the accept/reject boundary are identical.

### Name — MATLAB identifier

- `elem.Name = ''` → **"Name '' must start with an alphabetic or '' character,
  followed by alphanumeric or '' characters. Name must not start with
  'sl_padding'."**
- Any non-empty valid identifier → OK.

Our `validateMatlabName` in `DataNode.setProperty` enforces the same rule
(starts with letter, alphanumeric + underscore, max 63 chars, not a keyword).
The element sibling-uniqueness check is also applied.

### Description — free-form char

MATLAB accepts any string for Description; rejects non-char types ("Value must
be a character vector or a string scalar"). Since our UI always passes a string,
the non-char rejection is **unreachable** — type-guarded by the string editor.
No validation needed for Description.

### Read-only properties (DataType, Dimensions, Complexity, DimensionsMode, Unit)

All of these are surfaced with `editor: 'label'` — they display but cannot be
edited. Their MATLAB validation (enum constraints for Complexity/DimensionsMode,
positive-vector for Dimensions, unit-expression parser for Unit) is therefore
**unreachable** in our UI. No dead validation code is added.

Specific MATLAB rejections (for reference, not mirrored):
- Complexity: only 'real'/'complex'; others → "There is no enumerated value named 'X'."
- DimensionsMode: only 'Fixed'/'Variable'; others → "There is no enumerated value named 'X'."
- Dimensions: must be positive double vector; negative/zero/NaN/matrix → "'Dimensions' must be a double vector consisting of positive elements..."
- Unit/DocUnits: free-form char accepted; only non-char type → "Value must be a character vector..."

All of the above are type-guarded (unreachable from a label editor).

## Validation mirrored in code

- `BusElementNode.setProperty('Min'|'Max', ...)` routes through `_setMinMax`
  (override in BusNode.ts) which enforces the finite-real-double-scalar rule.
  Returns `{error, reason: "<Label> must be a finite real double scalar value"}`.
  Test: `test/parity/fidelity/element.fidelity.test.ts`.

- `DataNode.setProperty` (resolved='name') validates via `validateMatlabName`:
  rejects empty, non-identifier chars, keywords, >63 chars. Also checks sibling
  uniqueness.
  Test: `test/parity/fidelity/element.fidelity.test.ts`.

- Description: no validation needed (any string accepted).
  Test: round-trip in `test/parity/fidelity/element.fidelity.test.ts`.

## Round-trip coverage

- JSON sldd: parse MyBus → edit element Min/Max/Name/Description → serialize →
  re-parse → values preserved.
  Test: `test/parity/fidelity/element.fidelity.test.ts` (format 'json').
- Binary sldd: same.
  Test: same file (format 'binary').
- MATLAB re-open value-equality gate (gated on DEX_MATLAB_CMD):
  - `Elements(1).Min=5, Elements(1).Max=99` → MATLAB reads 5 and 99. PASS.
  - `Elements(1).Name='speed'` → MATLAB reads 'speed'. PASS.
  - `Elements(1).Description='Speed signal in m/s'` → MATLAB reads it. PASS.
  Test: same file.

## Open questions / deferred

- **Element-scoped error wording**: our generic `_setMinMax` says "Minimum must
  be a finite real double scalar value" without the element name. MATLAB says
  "Minimum on element 'x' must be...". The reject boundary is identical; only
  the wording differs. Accepted as cosmetic.

- **SamplingMode / SampleTime**: hidden properties on BusElement. Not surfaced,
  not editable. Deferred.
