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
