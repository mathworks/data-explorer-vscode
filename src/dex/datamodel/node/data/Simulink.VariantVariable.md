<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.VariantVariable — data-object fidelity

**Node class:** `VariantVariableNode` (`src/dex/datamodel/node/data/VariantVariableNode.ts`)
**MATLAB class:** `Simulink.VariantVariable`
**Editable in our UI:** yes (Specification property)
**Verified against:** MATLAB R2027a (probe_class('Simulink.VariantVariable'))

## Overview

A Simulink.VariantVariable defines a named variant variable whose Specification
property stores a string referencing a MATLAB workspace variable or expression. The
Specification accepts **any string** — MATLAB does not validate the content on
assignment, only at model-update time. In our UI the VariantVariable surfaces as an
editable entry whose Value column shows the Specification string.

The object also carries a complex read-only `Choices` sub-structure
(simulink.variant.Choice array) that defines the set of valid choice values. This
sub-structure is read-only in MATLAB (SetAccess=private) and is preserved verbatim
through serialization — we do not expose it for editing.

## Property table

| Property      | MATLAB type              | SetAccess | Editable here | Serialized key (JSON / binary) | Editor   | Allowed values / constraint |
|---------------|--------------------------|-----------|---------------|--------------------------------|----------|-----------------------------|
| Name          | char                     | (entry)   | yes           | name / name                    | text     | Valid MATLAB identifier, unique in namespace |
| Specification | char                     | public    | yes           | Specification / Specification  | text     | Any string |
| Bank          | char                     | public    | no            | Bank / Bank                    | —        | Any string (not surfaced in UI) |
| Choices       | simulink.variant.Choice  | private   | no            | Choices / Choices              | —        | Read-only sub-object, preserved verbatim |
| DataType      | char                     | public    | no (label)    | DataType / DataType            | label    | Display-only |

## Non-obvious behavior (the reason this doc exists)

### Specification — accepts any string

MATLAB accepts ANY character-vector/string-scalar assignment to Specification:
- Meaningful references: `'myWorkspaceVar'`, `'A + B'`
- Bogus strings: `'bogus'`, `'double'`, `'int32'`, `''`

All are stored verbatim. Validation happens only when the model references the
variable at update time. This means our editor needs NO validation.

### Choices — private, read-only

The Choices property is SetAccess=private and cannot be assigned. Our code preserves
it verbatim through `_getSerializedProperties()` (the serial._properties object
carries it through). The probe reports it as unreadable from MATLAB's set-path;
we cannot round-trip-verify Choices via value-equality — only verify the class and
that Specification survives.

### Non-string assignment — unreachable

Assigning a non-string value (number, logical, array, struct, cell) produces:
> "Error setting property 'Specification' of class 'VariantVariable': Value must be a character vector or a string scalar."

This rejection is **unreachable** from our string editor (the UI always delivers a
string). No code is added for it.

### Bank — not surfaced

Bank is a public char property that also accepts any string. It is not surfaced in
our UI editor, so no validation is needed. It is preserved verbatim in serialization.

## Allowed values

| Input         | Accepted | Reason |
|---------------|----------|--------|
| `'myVar'`    | yes      | any string accepted |
| `'bogus'`   | yes      | any string accepted |
| `''`         | yes      | empty string |
| `5` (number) | no       | "Value must be a character vector..." — unreachable from UI |

## Validation mirrored in code

No validation code is needed for Specification edits. The generic
`DataNode.setProperty` string path is sufficient, because Specification is typed as
`string` and the editor always delivers a string.

Test: `test/parity/fidelity/variant.fidelity.test.ts`

## Round-trip coverage

- JSON sldd: parse -> edit Specification to "myNewVar" -> serialize -> re-parse -> Specification preserved.
  Test: `test/parity/fidelity/variant.fidelity.test.ts` (json format loop).
- Binary sldd: same.
  Test: `test/parity/fidelity/variant.fidelity.test.ts` (binary format loop).
- MATLAB re-open value-equality gate:
  - `Specification='myNewVar'` -> MATLAB reads 'myNewVar'. PASS.
  Test: `test/parity/fidelity/variant.fidelity.test.ts` (gated on DEX_MATLAB_CMD).

## Open questions / deferred

- **Choices round-trip verification**: The Choices sub-object is preserved in serial
  form but cannot be verified via MATLAB value-equality (it is SetAccess=private
  and not directly readable via a simple get). A future probe could use
  `getChoices()` or similar API if one exists. For now, class-gate only.

- **Bank property editing**: Bank is a valid editable char property, but our UI
  does not surface it. If surfaced in the future, it follows the same any-string
  acceptance rule as Specification — no validation needed.
