<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.VariantBank — data-object fidelity

**Node class:** `VariantBankNode` (`src/dex/datamodel/node/data/VariantBankNode.ts`)
**MATLAB class:** `Simulink.VariantBank`
**Editable in our UI:** no (Value column exposed via text editor but no fixture to round-trip)
**Verified against:** not probed (no params.sldd fixture instantiates this class)

## Overview

A Simulink.VariantBank stores variant bank configuration data. The node exposes
PropName, PropValue, and PropDataType in its property table, and its Value editor
is technically `text` (inherited from DataNode). However, no fixture in the test
suite (`params.sldd`) contains a VariantBank entry, so round-trip fidelity cannot
be validated without generating new MATLAB fixtures (out of scope for this phase).

The node has a `createDefault` static that produces a minimal in-memory instance
with an empty-string Value. It serializes through `_serializeSimulinkObject`.

## Property table

| Property   | Editor | Serialized key           | Notes                         |
|------------|--------|--------------------------|-------------------------------|
| Name       | text   | entry name               | MATLAB identifier             |
| Value      | text   | Value (in _properties)   | Exposed but no fixture to validate round-trip |
| DataType   | label  | (className display)      | Read-only label               |

## Read-only / no-fixture status

- The node does NOT explicitly override `valueEditable` to false; it inherits the
  BaseNode default (true unless displayValue is a `<...>` string). With an empty
  Value, `displayValue` returns `''`, so `valueEditable` would be true in theory.
- However, no `params.sldd` test fixture instantiates a `Simulink.VariantBank`,
  so we have no round-trip path to validate edits against MATLAB.
- **Contract-lock**: pin the className and property shape via `createDefault` in
  `test/parity/fidelity/hostnodes.fidelity.test.ts`. If a future phase adds a
  fixture, a full fidelity doc and round-trip test should be written.

## Open questions / deferred

- **Fixture generation**: creating a `Simulink.VariantBank` entry in MATLAB and
  exporting it to a test `.sldd` would enable full round-trip testing. Deferred.
- **Value semantics**: the exact MATLAB constraints on VariantBank.Value are
  undocumented here (no probe was run). Conservative: do not add editing validation
  until probed.
