<!-- Copyright 2026 The MathWorks, Inc. -->

# mcosTypedNode — data-object fidelity

**Node class:** factory function `buildTypedNodeFromMcos` (`src/dex/datamodel/node/data/mcosTypedNode.ts`)
**MATLAB class:** n/a — this is a routing factory, not a node class
**Editable in our UI:** n/a (routes to other nodes; no own UI)
**Verified against:** n/a — host factory, not a MATLAB data object

## Overview

`mcosTypedNode.ts` exports a single factory function, `buildTypedNodeFromMcos`,
that bridges the binary (MCOS) decode path to the same typed data-model nodes the
SLDD (JSON) path builds. It ensures that a Simulink object resolves to the SAME
node class with the SAME property values regardless of source format.

The function takes a `className`, `name`, `parent`, and optional `properties` bag.
It constructs a synthetic `rawVal` in the SLDD shape and routes it through
`NodeRegistry.parseValue`. If the class is unrecognized or in the GENERIC_KEYS
exclusion set (`MatlabVariable`, `MatlabStruct`, `CustomObject`), it returns `null`
to signal the caller to fall back to the opaque representation.

When no decoded properties are supplied, it builds an EMPTY SHELL (correct class
and icon, empty columns, no children) rather than guessing values.

## Host / factory status

- This is NOT a node class — it is a routing utility.
- It delegates all node construction to the NodeRegistry; it owns no state.
- **Existing test coverage**: `test/mcosTypedNode.test.ts` comprehensively tests
  routing for Parameter, Signal, Bus, LookupTable, NumericType, Breakpoint,
  VariantControl, empty shells, decoded properties, and GENERIC_KEYS exclusion.
- **Contract-lock**: no additional pinning needed — the existing test already
  covers the factory's contract exhaustively. Referenced from
  `test/parity/fidelity/hostnodes.fidelity.test.ts` as existing coverage (SKIP).

## Open questions / deferred

- None. The factory is stable and comprehensively tested.
