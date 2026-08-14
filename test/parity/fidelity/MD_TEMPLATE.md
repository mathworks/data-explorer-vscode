<!-- Copyright 2026 The MathWorks, Inc. -->
<!--
FIDELITY DOC TEMPLATE — copy this to src/dex/datamodel/node/data/Simulink.<X>.md

RULES (these docs are COMMITTED to the public tree):
- Content is MATLAB behavior ONLY: property semantics, verbatim error strings,
  allowedValues, serialized key names. NEVER include internal paths, release job
  identifiers, sandbox paths, host names, or the MATLAB launch command.
- Every claim is grounded in a probe: cite the probe (probe_class / probe_enum /
  a gen_*_fixture) so it's reproducible.
- The "Validation mirrored in code" section links the doc to the exact
  setProperty branch + test that enforces the rule.
-->

# Simulink.\<X\> — data-object fidelity

**Node class:** `\<XNode\>` (`src/dex/datamodel/node/data/\<XNode\>.ts`)
**MATLAB class:** `Simulink.\<X\>`
**Editable in our UI:** yes / no
**Verified against:** MATLAB R2027a (probe_class('Simulink.\<X\>'))

## Overview
One paragraph: what the object is, which properties we surface as columns, and
which are editable vs read-only (and why).

## Property table
| Property | MATLAB type | SetAccess | Editable here | Serialized key (JSON / binary) | Editor | Allowed values / constraint |
|----------|-------------|-----------|---------------|--------------------------------|--------|-----------------------------|
| Name     | char        | public    | yes           | name / name                    | text   | valid MATLAB identifier, unique in namespace |
| ...      |             |           |               |                                |        |                             |

## Non-obvious behavior (the reason this doc exists)
Capture every surprising rule with the VERBATIM MATLAB error, e.g.:
- `Value = struct('a',[])` → **"A valid structure must be numeric"**; cause
  **"Leaf element at '(1).a' is null or empty."** A struct Value must be a
  numeric struct with no empty leaves.
- `Min = Inf` → **"Minimum must be a finite real double scalar value"** (Inf/NaN/
  arrays/complex all rejected; `[]` clears).
- `DataType = 5` → **"Value must be a character vector or a string scalar."**
- Enum `X`: the full accepted set is {...}; anything else →
  **"There is no enumerated value named 'X'."** (or the class-specific message).
- Note any Dependent/Hidden props, any *_internal serialized-key remapping, and
  any property whose accepted-on-set value differs from what serializes.

## Allowed values (enums / comboboxes)
For each enum prop: the COMPLETE set (from probe_enum), and the exact
out-of-set error string.

## Validation mirrored in code
- `<XNode>.setProperty('<prop>', ...)` enforces `<rule>` → returns
  `{error, reason}` with the same message class. Test: `test/<file>.test.ts`.
- Read-only props: listed here with the reason they are NOT editable
  (constraint too underspecified to mirror safely / context-dependent).

## Round-trip coverage
- JSON sldd: parse → edit → serialize → re-parse → value preserved. Test: ...
- binary sldd: same. Test: ...
- MATLAB re-open value-equality gate (representative cases): set X → MATLAB
  reads X. Test: ... (gated on DEX_MATLAB_CMD).

## Open questions / deferred
Anything the sweep left ambiguous, and why it's safe (conservative fallback).
