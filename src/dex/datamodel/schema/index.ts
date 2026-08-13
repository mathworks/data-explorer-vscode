// Copyright 2026 The MathWorks, Inc.

// Loader + resolver for the language-neutral class property schema.
// NO import of node classes or src/dex runtime — this module is the seed of a
// future standalone `dex-schema` package; dependencies point INTO it only.

import type { RawProp, ClassRef, ResolvedProp } from './types.js';
import core from './props/core.json';
import dataObject from './props/dataObject.json';
import codeGen from './props/codeGen.json';
import parameter from './classes/parameter.json';
import signal from './classes/signal.json';

const REGISTRY: Record<string, RawProp> = {
    ...(core as Record<string, RawProp>),
    ...(dataObject as Record<string, RawProp>),
    ...(codeGen as Record<string, RawProp>),
};

const CLASS_REFS: Record<string, ClassRef[]> = {
    ...(parameter as Record<string, ClassRef[]>),
    ...(signal as Record<string, ClassRef[]>),
};

const cache = new Map<string, ResolvedProp[] | undefined>();

function resolveRef(ref: ClassRef): ResolvedProp | null {
    const key = typeof ref === 'string' ? ref : ref.$ref;
    const base = REGISTRY[key];
    if (!base) {
        return null;
    }
    const override = typeof ref === 'string' ? {} : ref;
    // base ⊕ override; drop the $ref marker. Never mutate the registry entry.
    const merged = { ...base, ...override } as RawProp & { $ref?: string };
    delete merged.$ref;
    return { key, ...merged };
}

// Returns the ordered, resolved property descriptors for a className, or
// undefined if the class has no schema (caller falls back to legacy behavior).
export function getSchema(className: string): ResolvedProp[] | undefined {
    if (cache.has(className)) {
        return cache.get(className);
    }
    const refs = CLASS_REFS[className];
    const resolved = refs ? refs.map(resolveRef).filter((p): p is ResolvedProp => p !== null) : undefined;
    cache.set(className, resolved);
    return resolved;
}

// Given a container object and the next path segment, return the object that
// directly holds that key. Model sub-objects nest their fields one of two ways:
//   flat MCOS:      { _object_class, _properties: { key: ... } }
//   MATLABArray:    { _array_class, _mw_element_type: 'MATLABArray', _elements: [ { _properties: { key: ... } } ] }
// so if the key is not already at the top level, descend into whichever inner
// bag actually carries it. Returns the container unchanged when nothing matches
// (so `container[key]` then yields undefined).
function propertyBag(container: Record<string, unknown>, key: string): Record<string, unknown> {
    if (key in container) {
        return container;
    }
    const inner = container._properties;
    if (inner && typeof inner === 'object' && key in (inner as Record<string, unknown>)) {
        return inner as Record<string, unknown>;
    }
    const elements = container._elements;
    if (Array.isArray(elements) && elements[0] && typeof elements[0] === 'object') {
        const elemProps = (elements[0] as Record<string, unknown>)._properties;
        if (elemProps && typeof elemProps === 'object') {
            return elemProps as Record<string, unknown>;
        }
    }
    return container;
}

// Unwrap a typed-scalar leaf `{ _type, _value }` (e.g. an int32 stored as
// { _type:'int32', _value:'-1' }) to a primitive. Numeric MATLAB types coerce to
// Number; everything else returns the raw `_value`. Plain values pass through.
function unwrapScalar(value: unknown): unknown {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const o = value as Record<string, unknown>;
        if ('_type' in o && '_value' in o) {
            const t = String(o._type);
            if (/^u?int|^double$|^single$/.test(t)) {
                const n = Number(o._value);
                return Number.isNaN(n) ? o._value : n;
            }
            return o._value;
        }
    }
    return value;
}

// Walk a dotted sourcePath against a `_properties` bag. Non-terminal hops descend
// through nested sub-objects (flat `_properties` OR MATLABArray-wrapped
// `_elements[0]._properties`). Returns undefined if any hop is absent — the caller
// then substitutes the descriptor's default. Typed-scalar leaves are unwrapped.
export function resolveSourcePath(properties: Record<string, unknown> | undefined, path: string): unknown {
    if (!properties) {
        return undefined;
    }
    const parts = path.split('.');
    let current: unknown = properties;
    for (let i = 0; i < parts.length; i++) {
        if (current === null || current === undefined || typeof current !== 'object') {
            return undefined;
        }
        const bag = propertyBag(current as Record<string, unknown>, parts[i]);
        current = bag[parts[i]];
    }
    return unwrapScalar(current);
}

// Read a property's value from a `_properties` bag for DISPLAY, substituting the
// descriptor's declared default when the value is absent. This is display-only:
// it never writes back to the bag, so serialization stays minimal (defaults are
// not persisted). Returns the raw value; the caller/app formats by `prop.type`.
export function hydrate(properties: Record<string, unknown> | undefined, prop: ResolvedProp): unknown {
    const raw = resolveSourcePath(properties, prop.sourcePath);
    return raw === undefined ? prop.default : raw;
}
