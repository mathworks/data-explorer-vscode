<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.ConnectionElement — data-object fidelity

**Node class:** `ConnectionBusElementNode` (`src/dex/datamodel/node/data/ConnectionBusNode.ts`)
**MATLAB class:** `Simulink.ConnectionElement`
**Editable in our UI:** yes (Name, Description)
**Verified against:** MATLAB R2027a (probe_class('Simulink.ConnectionElement'))

## Overview

A `Simulink.ConnectionElement` defines one physical-domain port element within a
`Simulink.ConnectionBus`. It carries a connection type (domain) and a description.
In our UI each connection element appears as a child row under its parent
ConnectionBus entry. The Property Inspector exposes Name, DataType (which shows
the connection Type), and Description — only Name and Description are editable.

## Property table

| Property | MATLAB type | SetAccess | Editable here | Serialized key | Editor | Constraint |
|----------|-------------|-----------|---------------|----------------|--------|------------|
| Name | char | public | yes | Name | text | Valid MATLAB identifier; unique among siblings; must not be empty or start with `sl_padding` |
| Type | char | public (Dependent) | no | Type_internal / Type | label | free-form connection domain string |
| Description | char | public | yes | Description | textArea | any string |

Hidden/private properties not surfaced: Type_internal.

## Non-obvious behavior

### Name — MATLAB identifier

- `elem.Name = ''` → **"Name '' must start with an alphabetic or '' character,
  followed by alphanumeric or '' characters. Name must not start with
  'sl_padding'."**
- Any non-empty valid identifier → OK.

Our `validateMatlabName` in `DataNode.setProperty` enforces the same rule. The
element sibling-uniqueness check is also applied (though a ConnectionBus
typically has few elements).

### Description — free-form char

MATLAB accepts any string for Description. Non-char assignment →
**"Value must be a character vector or a string scalar."** — unreachable from
our string editor. No validation needed.

### Type — read-only

The connection Type (domain) is surfaced with `editor: 'label'`. It cannot be
edited in our UI. MATLAB's own set.Type validation is irrelevant here.
Default: `'Connection: <domain name>'`.

## Validation mirrored in code

- `DataNode.setProperty` (resolved='name') validates via `validateMatlabName`:
  rejects empty, non-identifier chars, keywords, >63 chars. Also checks sibling
  uniqueness.
  Test: `test/parity/fidelity/element.fidelity.test.ts`.

- Description: no validation needed (any string accepted).
  Test: round-trip in `test/parity/fidelity/element.fidelity.test.ts`.

## Round-trip coverage

- JSON sldd: parse MyConnBus → edit element Name/Description → serialize →
  re-parse → values preserved.
  Test: `test/parity/fidelity/element.fidelity.test.ts` (format 'json').
- Binary sldd: same.
  Test: same file (format 'binary').
- MATLAB re-open value-equality gate (gated on DEX_MATLAB_CMD):
  - `Elements(1).Name='port1'` → MATLAB reads 'port1'. PASS.
  - `Elements(1).Description='Hydraulic port'` → MATLAB reads it. PASS.
  Test: same file.

## Open questions / deferred

- **No Min/Max/Dimensions/Complexity**: unlike BusElement, ConnectionElement has
  none of these properties. This is correct — physical-domain elements carry only
  a Type and Description.
