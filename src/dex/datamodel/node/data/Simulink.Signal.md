<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.Signal — data-object fidelity

**Node class:** `SignalNode` (`src/dex/datamodel/node/data/SignalNode.ts`)
**MATLAB class:** `Simulink.Signal`
**Editable in our UI:** yes (Min, Max only; Description via text area; schema
columns StorageClass/Alignment via schemaBridge)
**Verified against:** MATLAB R2027a (probe_class('Simulink.Signal'))

## Overview

A `Simulink.Signal` data object defines attributes of a signal (data type,
dimensions, sampling mode, etc.) that a Simulink model can reference. Unlike
`Simulink.Parameter`, a Signal has **no scalar Value** — `displayValue` is `''`
and `valueEditable` is `false`.

The only directly-editable numeric properties surfaced in our UI are **Min** and
**Max** (validated by `_setMinMax` on `DataNode`). All other properties are either
read-only labels or delegated to the schema bridge (Code Generation columns).

## Property table

| Property | MATLAB type | SetAccess | Editable here | Serialized key | Editor | Constraint |
|----------|-------------|-----------|---------------|----------------|--------|------------|
| Name | char | — | yes | (entry name) | text | valid MATLAB identifier, unique in namespace |
| DataType | char | public | no | DataType | label | free-form char (MATLAB validates at model compile, not at assignment) |
| Min | double/[] | public | yes | Min | text | finite real double scalar; `[]` clears |
| Max | double/[] | public | yes | Max | text | finite real double scalar; `[]` clears |
| Unit | char | public | no | DocUnits or Unit | label | unit expression (parser too complex to mirror) |
| Description | char | public | yes | Description | textArea | any string |
| Dimensions | double/char | public | no | — | — | not an editable column (complex multi-type acceptance) |
| DimensionsMode | char (enum) | public | no | — | — | enum {Fixed, Variable, auto}; not surfaced as editable column |
| Complexity | char (enum) | public | no | — | — | enum {real, complex, auto}; not surfaced as editable column |
| SampleTime | double | public | no | — | — | not surfaced |
| SamplingMode | char (enum) | public | no | — | — | enum {auto}; not surfaced |
| InitialValue | char | public | no | — | — | free-form char; not surfaced as editable column |
| CoderInfo | Simulink.CoderInfo | protected | via schema | CoderInfo.* | select/text | schemaBridge owns StorageClass + Alignment |
| LoggingInfo | Simulink.LoggingInfo | protected | no | LoggingInfo | — | not exposed |
| HasCoderInfo | logical | protected | no | — | — | dependent, hidden |
| RTWInfo | Simulink.CoderInfo | protected | no | — | — | hidden alias for CoderInfo |
| Units | — | protected | no | — | — | hidden, unreadable |

## Non-obvious behavior

### Min / Max — finite real double scalar

MATLAB rejects any value that is not a single, finite, real, double scalar:

- `Min = [1 2 3]` → **"Minimum must be a finite real double scalar value"**
- `Min = Inf` → **"Minimum must be a finite real double scalar value"**
- `Min = -Inf` → **"Minimum must be a finite real double scalar value."**
- `Min = NaN` → **"Minimum must be a finite real double scalar value"**
- `Min = 5+2i` → **"Minimum must be a finite real double scalar value"**
- `Min = 'text'` → **"Minimum must be a finite real double scalar value"**
- `Min = true` → **"Minimum must be a finite real double scalar value"**
- `Min = []` → **OK** (clears to empty/default)
- `Max` follows the same rules with "Maximum" in the message.

Note: MATLAB does NOT enforce `Min <= Max`. Setting `Min=5, Max=1` is accepted.
The code mirrors this: no cross-check is applied.

### No scalar Value

A Signal has no Value field (unlike Parameter). `displayValue` is always `''`
and `valueEditable` is `false`. The setProperty path for Value is never reached.

### DataType / Unit / Description / InitialValue — char-only

These MATLAB properties reject numeric assignment with "Value must be a character
vector or a string scalar." Our UI always passes strings, so that rejection is
**unreachable** from the string editor. No dead validation code is added.

- **DataType** is `editor: 'label'` (read-only in our UI) because MATLAB accepts
  arbitrary free-form strings as data type specs, validated only at model compile.
- **Unit** is `editor: 'label'` because it goes through a unit-expression parser
  we cannot faithfully replicate.
- **Description** is `editor: 'textArea'` — any string is accepted by MATLAB at
  assignment time, so no validation is needed.
- **InitialValue** is not surfaced as an editable column.

### Enum properties (DimensionsMode, Complexity, SamplingMode)

These accept only specific tokens (case-insensitive on first char for some):
- **DimensionsMode**: `Fixed`, `Variable`, `auto` (also accepts `Auto` → stores
  `auto`). Out-of-set → "There is no enumerated value named 'X'."
- **Complexity**: `real`, `complex`, `auto`. Same error pattern.
- **SamplingMode**: `auto` only. Same error pattern.

These are NOT editable columns in our UI — they are either non-projected or
read-only. Validation not mirrored.

### Dimensions — complex multi-type

Dimensions accepts positive integer scalars, row vectors `[2 3]`, symbolic char
identifiers `'varName'`, and the inherit token `-1`. It rejects `0`, negative
(except `-1`), non-integer, NaN, complex, matrices, empty, and logical. The
detailed error:

> "Invalid 'Dimensions' property specified. This property must be a double vector
> consisting of either positive elements such that their cumulative product is less
> than or equal to 2147483647, or elements with value of -1..."

Dimensions is NOT an editable column in our UI (not projected), so this complex
validation is not mirrored.

## Validation mirrored in code

- `SignalNode.setProperty('Min'|'Max', ...)` delegates to `DataNode._setMinMax`
  which enforces the finite-real-double-scalar rule. Returns
  `{error, reason: "<Label> must be a finite real double scalar value"}`.
  Test: `test/parity/fidelity/signal.fidelity.test.ts`.
- Read-only props (DataType, Unit, Dimensions, DimensionsMode, Complexity,
  SamplingMode, InitialValue): not editable in our UI; editor is `'label'` or
  column not projected. No dead validation needed.
- Description: free-form char, any string accepted — no validation needed.
- Schema columns (StorageClass, Alignment): owned by `schemaBridge.ts`.

## Round-trip coverage

- JSON sldd: parse → edit Min/Max → serialize → re-parse → values preserved.
  Test: `test/parity/fidelity/signal.fidelity.test.ts` (format 'json').
- Binary sldd: same. Test: same file (format 'binary').
- MATLAB re-open value-equality gate: set Min=-5, Max=10 → MATLAB reads them
  back. Test: same file (gated on DEX_MATLAB_CMD).

## Open questions / deferred

- **SampleTime**: accepts `0`, positive scalars, `Inf`, `-1` (inherit); rejects
  negative (except -1), arrays, NaN, complex, strings. Not surfaced as a column
  — deferred. Error message is generic "Invalid SampleTime specified".
- **Dimensions/DimensionsMode**: complex mixed-type acceptance makes it unsafe to
  expose as editable without a purpose-built parser. Safe as read-only.
