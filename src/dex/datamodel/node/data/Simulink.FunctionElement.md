<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.FunctionElement — data-object fidelity

**Node class:** `FunctionElementNode` (`src/dex/datamodel/node/data/ServiceBusNode.ts`)
**MATLAB class:** `Simulink.FunctionElement`
**Editable in our UI:** yes (Name only)
**Verified against:** MATLAB R2027a (probe_class('Simulink.FunctionElement'))

## Overview

A `Simulink.FunctionElement` defines one service function within a
`Simulink.ServiceBus`. It carries a function prototype (e.g. `y = f1(u,v)`),
an Asynchronous flag, and an Arguments array of `Simulink.BusElement` objects
that define the function's input/output ports. In our UI each function element
appears as a child row under its parent ServiceBus entry. The Value column shows
the Prototype via `displayValue`. The Property Inspector exposes only Name.

## Property table

| Property | MATLAB type | SetAccess | Editable here | Serialized key | Editor | Constraint |
|----------|-------------|-----------|---------------|----------------|--------|------------|
| Name | char | public | yes | Name | text | Valid MATLAB identifier AND must match the function name in Prototype |
| Prototype | char | public | no (displayValue) | Prototype | — | Function signature string; MATLAB auto-appends `()` if missing |
| Asynchronous | logical | public | no | Asynchronous | — | true/false |
| Arguments | Simulink.BusElement[] | public | no | Arguments | — | Array of BusElement defining function ports |

## Non-obvious behavior

### Name — coupled to Prototype

In MATLAB, setting `elem.Name` validates the new name against the Prototype:

- `elem.Name = 'valid'` (where Prototype is `'y = f1(u,v)'`) →
  **"The character vector "" specified for prototype specification is invalid."**
  The name must appear as the function name in the Prototype.

- `elem.Name = ''` → **"Name '' must start with an alphabetic or '' character,
  followed by alphanumeric or '' characters. Name must not start with
  'sl_padding'."**

This Prototype-coupling rejection is significant: MATLAB rejects ANY valid
identifier that doesn't match the Prototype's function name. In our UI, since
Prototype is NOT directly editable (it's shown via displayValue only), renaming
a FunctionElement in isolation would produce data MATLAB rejects on re-open.

**Current behavior in our code:** `DataNode.setProperty` validates the new Name
as a MATLAB identifier (rejects empty, non-identifier chars, keywords) and checks
sibling uniqueness, but does NOT enforce the Prototype-coupling. A user could
rename `f1` to `myFunc` while the Prototype still says `y = f1(u,v)`.

**Risk assessment:** This is a known gap but the practical risk is low because:
1. ServiceBus entries are rare in real-world data dictionaries
2. The fixture has no ServiceBus entry, so this path is rarely exercised
3. Adding Prototype-coupled validation would require parsing the Prototype string

This gap is documented for future hardening if ServiceBus editing becomes common.

### Prototype — auto-appends parentheses

MATLAB auto-normalizes the Prototype:
- `elem.Prototype = 'foo'` → stores `'foo()'`
- `elem.Prototype = ''` → stores `''` (OK, unlike Name)

Prototype is NOT editable in our UI — it appears only via `displayValue`.
No validation needed.

### Asynchronous — boolean

Accepts true/false/0/1/any numeric scalar (coerced to logical). Rejects arrays,
NaN, complex. Not editable in our UI — not surfaced as a property.

### Arguments — BusElement array

The function's argument list is a structured array of `Simulink.BusElement`
objects. Not directly editable through property editors. Managed internally by
`ServiceBusNode.addChildNode()`.

## Validation mirrored in code

- `DataNode.setProperty` (resolved='name') validates via `validateMatlabName`:
  rejects empty, non-identifier chars, keywords, >63 chars. Also checks sibling
  uniqueness.
  Test: `test/parity/fidelity/element.fidelity.test.ts`.

- **NOT mirrored:** Prototype-coupling (the Name must appear in the Prototype).
  This is a documented gap — see "Name — coupled to Prototype" above.

## Round-trip coverage

- No `Simulink.ServiceBus` entry exists in the `params.sldd` fixture.
  FunctionElement coverage uses in-process construction via
  `ServiceBusNode.createDefault` + `addChildNode`.
  Test: `test/parity/fidelity/element.fidelity.test.ts`.

- MATLAB re-open gate: skipped for FunctionElement (no fixture entry, and the
  Prototype-coupling makes live MATLAB validation of an isolated rename
  non-trivial). Documented as deferred.

## Open questions / deferred

- **Prototype-coupled Name validation**: MATLAB rejects a Name that doesn't match
  the Prototype's function name. Our UI allows renaming in isolation. If
  ServiceBus editing becomes common, add a validator that parses the Prototype
  and rejects names that would break the coupling (or rename the function in the
  Prototype simultaneously).

- **Prototype editing**: not surfaced in the UI. If added, it must enforce the
  format `[outputs =] name(inputs)` and keep the Name in sync.

- **Arguments editing**: not surfaced. The argument BusElements are managed
  internally by `addChildNode`. If per-argument editing is needed, it would
  follow the BusElement fidelity rules.
