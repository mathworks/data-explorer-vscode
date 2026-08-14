<!-- Copyright 2026 The MathWorks, Inc. -->

# Code Generation schema columns — fidelity

**Source:** `src/dex/datamodel/schema/props/codeGen.json`
**Bridge:** `src/dex/datamodel/node/schemaBridge.ts`
**Applies to:** `Simulink.Parameter`, `Simulink.Signal` (via class refs)
**Verified against:** MATLAB R2027a (probe_enum via CoderInfo.StorageClass path)

## Overview

The Code Generation group contributes three schema-projected columns to the
Property Inspector and data table: **Storage Class** (editable dropdown),
**Header File** (read-only label), and **Alignment** (read-only label). These
are properties of the `Simulink.CoderInfo` sub-object nested at
`_properties.CoderInfo._properties.*` in the serialized entry.

Only **Storage Class** is editable in the UI. Edits flow through
`trySetSchemaProperty` in `schemaBridge.ts`, which validates the value against
the schema's `options` list and then writes directly to
`CoderInfo._properties.StorageClass` via `writeSourcePath`.

## Property table

| Column key | Label | sourcePath | type | editor | Editable | Group |
|------------|-------|------------|------|--------|----------|-------|
| storageClass | Storage Class | CoderInfo.StorageClass | string | select | **yes** | Code Generation |
| headerFile | Header File | CoderInfo.CustomAttributes.HeaderFile | string | label | no | Code Generation |
| alignment | Alignment | CoderInfo.Alignment | int | label | no | Code Generation |

## StorageClass — allowed values (via CoderInfo.StorageClass path)

Our schema writes to the `CoderInfo.StorageClass` property directly (not the
top-level `obj.StorageClass` shortcut). The CoderInfo.StorageClass property is
a true enum with a fixed allowed set. Tested on both `Simulink.Parameter` and
`Simulink.Signal` — the CoderInfo enum is identical for both:

| Value | Accepted | Stored as | Notes |
|-------|----------|-----------|-------|
| Auto | yes | Auto | Default |
| SimulinkGlobal | yes | Model default | Legacy alias; MATLAB normalizes on read |
| ExportedGlobal | yes | ExportedGlobal | |
| ImportedExtern | yes | ImportedExtern | |
| ImportedExternPointer | yes | ImportedExternPointer | |
| Custom | yes | Custom | Requires CustomStorageClass to be set separately |
| Model default | yes | Model default | Alternative spelling of SimulinkGlobal |

### Values NOT valid on CoderInfo.StorageClass

The top-level `obj.StorageClass` shortcut also accepts CSC (Custom Storage
Class) names like `BitField`, `Struct`, `GetSet`, `Volatile`, `Define`,
`Localizable`, `Reusable` — these work only through the shortcut (which
internally sets `StorageClass='Custom'` + `CustomStorageClass=<name>`). They
are **rejected** on `CoderInfo.StorageClass` directly:

> Error setting property 'StorageClass' of class 'CoderInfo':
> There is no enumerated value named 'BitField'.

Since our write path is `CoderInfo.StorageClass`, these CSC values are correctly
**excluded** from our dropdown.

### Our schema options vs MATLAB truth

Schema options: `["Auto", "SimulinkGlobal", "ExportedGlobal", "ImportedExtern", "ImportedExternPointer", "Custom"]`

All 6 values are accepted by MATLAB at our write path (`CoderInfo.StorageClass`).
There is **no fidelity gap**: we do not accept anything MATLAB rejects, and
MATLAB does not reject anything in our options list. The `trySetSchemaProperty`
validation matches MATLAB exactly for this write path.

### Rejection message (invalid token)

When the user types a token not in the options list, `trySetSchemaProperty`
returns:

```
{ error: true, reason: "Invalid value for Storage Class", invalidValue: "<input>" }
```

MATLAB's verbatim rejection (via `CoderInfo.StorageClass`):

> Error setting property 'StorageClass' of class 'CoderInfo':
> There is no enumerated value named '<input>'.

## headerFile — why read-only

`CoderInfo.CustomAttributes.HeaderFile` is a free-form char property. It is only
meaningful when StorageClass is 'Custom' and a CSC that uses a header file is
selected. Because:
1. Editing it without the matching CSC context would produce an inconsistent state.
2. The valid value depends on the active CustomStorageClass (not something we can
   validate in isolation).

It is rendered with `editor: 'label'` — `trySetSchemaProperty` returns `null`
(not a writable schema prop), so the edit path is never reached.

## alignment — why read-only

`CoderInfo.Alignment` is typed `int` in the schema but rendered with
`editor: 'label'`. MATLAB accepts `-1` (inherit/default) and positive powers of
2 (1, 2, 4, 8, ..., up to platform limit). The rejection:

> "Invalid setting for property 'Alignment'. Must be a positive integer that is a
> power of 2, or -1."

Because of the power-of-2 constraint (which requires non-trivial validation) and
the `-1` sentinel, it is kept read-only. The `trySetSchemaProperty` code path for
`editor: 'label'` returns `null` immediately.

## Validation mirrored in code

- `schemaBridge.ts: trySetSchemaProperty` → for `storageClass` (editor 'select'):
  validates `stringValue` is in `prop.options`; rejects with
  `"Invalid value for Storage Class"`. Test:
  `test/parity/fidelity/schemaColumns.fidelity.test.ts`.
- `headerFile` and `alignment` (editor 'label'): `trySetSchemaProperty` returns
  `null` (not writable), so `DataNode.setProperty` falls through to field-based
  logic which also does not handle them → effectively read-only. No dead
  validation code.

## Round-trip coverage

- JSON sldd: set storageClass → serialize → re-parse → value preserved.
  Test: `test/parity/fidelity/schemaColumns.fidelity.test.ts` (format 'json').
- Binary sldd: same. Test: same file (format 'binary').
- MATLAB re-open value-equality gate: set CoderInfo.StorageClass to
  'ExportedGlobal' → MATLAB reads it back as 'ExportedGlobal'. Set to 'Auto' →
  reads back 'Auto'. Test: same file (gated on DEX_MATLAB_CMD).

## Open questions / deferred

- **SimulinkGlobal normalization**: MATLAB normalizes 'SimulinkGlobal' to
  'Model default' on read-back. Our serializer writes the literal string
  'SimulinkGlobal' into the sldd. MATLAB will accept this and normalize it, so
  the MATLAB gate for 'SimulinkGlobal' should assert the read-back value is
  'Model default'. This is a display-only nuance, not a data-loss risk.
- **Custom + CustomStorageClass**: Setting StorageClass to 'Custom' is valid but
  incomplete without also setting CustomStorageClass. The schema does not yet
  expose CustomStorageClass as editable. A file that already has Custom will
  display correctly; setting it TO Custom from the dropdown is technically valid
  but leaves CSC attributes unchanged. Acceptable for Phase 2.
