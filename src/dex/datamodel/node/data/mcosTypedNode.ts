// Copyright 2026 The MathWorks, Inc.

import * as NodeRegistry from '../NodeRegistry';
import type BaseNode from '../BaseNode';
import type DataNode from '../DataNode';

// Bridges the binary (MCOS) decode path to the same typed data-model nodes the
// SLDD (JSON) path builds, so a Simulink object resolves to the SAME node class
// with the SAME property values regardless of source format — one class per entry
// type, one presentation.
//
// The MCOS decoder (McosParser.decodeMcosBlob) now reconstructs each object's
// `_properties` bag in the exact shape the SLDD path produces (scalars as-is,
// matrices as Matrix(r,c) value objects, nested objects as { _object_class,
// _properties }). So both paths converge on a single call to
// NodeRegistry.parseValue with an identical `_array_class` value object — the
// binary path is no longer a special case.
//
// When no decoded properties are available (the decoder could not confidently
// resolve the object — e.g. it isn't in the blob, or its class didn't match), we
// fall back to an EMPTY SHELL: correct class and icon, empty columns, no children.
// That is honest — a wrong value is worse than an absent one — and still unifies
// the node class across formats.

// Generic class keys in the registry that are NOT concrete Simulink object
// classes — an opaque MCOS variable never carries these as its className, and
// routing to them would be wrong. Excluded from unification.
const GENERIC_KEYS = new Set(['MatlabVariable', 'MatlabStruct', 'CustomObject']);

// Returns a typed DataNode for any Simulink class the data model knows, populated
// from `properties` when supplied (SLDD-shaped) or as an empty shell otherwise, or
// null to signal the caller to fall back to the opaque representation.
export function buildTypedNodeFromMcos(
  className: string,
  name: string,
  parent: BaseNode | null,
  properties?: Record<string, unknown> | null,
): DataNode | null {
  if (!className || GENERIC_KEYS.has(className)) {
    return null;
  }
  // A class the data model KNOWS (Simulink.Parameter, …) routes to its own typed
  // node. A class it does NOT know is a customer-defined object: expand it as the
  // generic ObjectNode the SLDD path uses so its properties surface as child rows
  // (issue #3) — but ONLY when the decoder actually recovered properties, since an
  // empty bag has nothing to show and should stay an opaque shell.
  const isKnown = !!NodeRegistry.getClass(className);
  if (!isKnown && (!properties || Object.keys(properties).length === 0)) {
    return null;
  }
  // The value object mirrors the SLDD `entry.value`: one element whose _properties
  // is the decoded bag (or empty for a known-class shell). NodeRegistry.parseValue
  // dispatches on _array_class — known class -> its typed node, unknown class ->
  // ObjectNode — so both converge on the same recursion the SLDD paths use. Every
  // typed node's parse() tolerates an empty _properties (no children, defaults).
  const rawVal = {
    _array_class: className,
    _array_type: 'MATLABArray',
    _dimensions: [1, 1],
    _mw_element_type: 'MATLABArray',
    _elements: [{ _properties: properties || {} }],
  };
  try {
    return NodeRegistry.parseValue(rawVal, name, parent);
  } catch {
    // Any class whose parse() unexpectedly rejects the value degrades to the
    // opaque node rather than breaking the whole file.
    return null;
  }
}
