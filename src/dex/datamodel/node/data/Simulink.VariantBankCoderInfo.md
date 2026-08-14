<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.VariantBankCoderInfo — data-object fidelity

**Node class:** `VariantBankCoderInfoNode` (`src/dex/datamodel/node/data/VariantBankCoderInfoNode.ts`)
**MATLAB class:** `Simulink.VariantBankCoderInfo`
**Editable in our UI:** no (Value column exposed via text editor but no fixture to round-trip)
**Verified against:** not probed (no params.sldd fixture instantiates this class)

## Overview

A Simulink.VariantBankCoderInfo stores code-generation settings for variant banks.
The node exposes PropName, PropValue, and PropDataType, with a text editor on Value
(inherited from DataNode). Like VariantBank, no fixture in the test suite
(`params.sldd`) contains a VariantBankCoderInfo entry, so round-trip fidelity
cannot be validated without generating new MATLAB fixtures (out of scope).

The node has a `createDefault` static that produces a minimal in-memory instance
with an empty-string Value. It serializes through `_serializeSimulinkObject`.

## Property table

| Property   | Editor | Serialized key           | Notes                         |
|------------|--------|--------------------------|-------------------------------|
| Name       | text   | entry name               | MATLAB identifier             |
| Value      | text   | Value (in _properties)   | Exposed but no fixture to validate round-trip |
| DataType   | label  | (className display)      | Read-only label               |

## Read-only / no-fixture status

- The node does NOT explicitly override `valueEditable` to false; BaseNode default
  applies (true unless displayValue is `<...>`). With an empty Value, the editor
  would be available.
- However, no `params.sldd` test fixture instantiates this class, so there is no
  round-trip validation path.
- **Contract-lock**: pin the className and property shape via `createDefault` in
  `test/parity/fidelity/hostnodes.fidelity.test.ts`.

## Open questions / deferred

- **Fixture generation**: needs a MATLAB-created `.sldd` with a VariantBankCoderInfo
  entry. Deferred.
- **Value semantics**: undocumented; no MATLAB probe was run.
