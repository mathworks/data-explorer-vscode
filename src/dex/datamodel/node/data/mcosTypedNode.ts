// Copyright 2026 The MathWorks, Inc.

import * as NodeRegistry from '../NodeRegistry';
import type BaseNode from '../BaseNode';
import type DataNode from '../DataNode';

// Bridges the binary (MCOS) decode path to the same typed data-model nodes the
// SLDD (JSON) path builds, so a Simulink object resolves to the SAME node class
// regardless of source format — one class per entry type, consistent icon and
// presentation.
//
// IMPORTANT — class only, not properties (yet). The MCOS decoder reliably tells
// us an opaque variable's *class* (e.g. Simulink.LookupTable), but its extraction
// of the object's scalar properties is currently unreliable: verified against a
// real model.slx it mis-assigns fields (a Signal came back with Max="Table") and
// misses others (a Parameter's Value came back empty). Surfacing that bag would
// show WRONG data. So we deliberately build each typed node as an EMPTY SHELL:
// correct class, correct icon, empty Value / Data Type / Min / Max / … and no
// children. That is honest and consistent with the SLDD twin's columns (which are
// themselves empty for most of these types); real property extraction is a
// separate, deeper fix to McosParser.
//
// The gate is simply "does the data model have a typed node for this class?" —
// any class NodeRegistry knows is unified; anything else (e.g. Simulink.DataStore,
// which has no typed node) returns null so the caller keeps the opaque fallback.
//
// Note the class name comes from the variable's own metadata, NOT from a
// successful MCOS decode — so this works even for objects the decoder cannot
// locate an anchor for (verified against model.slx, where the decoder recovered
// only some of the opaque objects). Class-only unification does not depend on
// property decoding at all.

// Generic class keys in the registry that are NOT concrete Simulink object
// classes — an opaque MCOS variable never carries these as its className, and
// routing to them would be wrong. Excluded from unification.
const GENERIC_KEYS = new Set(['MatlabVariable', 'MatlabStruct', 'CustomObject']);

// Returns a typed DataNode (empty shell) for any Simulink class the data model
// knows, or null to signal the caller to fall back to the opaque representation.
export function buildTypedNodeFromMcos(className: string, name: string, parent: BaseNode | null): DataNode | null {
  if (!className || GENERIC_KEYS.has(className)) {
    return null;
  }
  if (!NodeRegistry.getClass(className)) {
    return null;
  }
  // Minimal rawVal: correct class, one element with an empty property bag. Every
  // typed node's parse() tolerates an empty _properties (no children, defaulted
  // fields), which is exactly the empty-shell presentation we want here.
  const rawVal = {
    _array_class: className,
    _array_type: 'MATLABArray',
    _dimensions: [1, 1],
    _mw_element_type: 'MATLABArray',
    _elements: [{ _properties: {} }],
  };
  try {
    return NodeRegistry.parseValue(rawVal, name, parent);
  } catch {
    // Any class whose parse() unexpectedly rejects an empty shell degrades to the
    // opaque node rather than breaking the whole file.
    return null;
  }
}
