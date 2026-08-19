// Copyright 2026 The MathWorks, Inc.

// Builds the Property Inspector "Other" catch-all: every raw `_properties` key a
// node carries that its curated/schema layout did NOT already surface. This lets
// the PI show ALL of a node's properties, not just the modeled ones.
//
// Dependency-free (reads only a plain `_properties` bag, no node/schema imports)
// so it stays inside the extractable data-model layer. Behavior:
//   - Nested MATLAB objects ({ _object_class, _properties }) are flattened ONE
//     level: `CoderInfo.StorageClass`, `CoderInfo.CSCPackageName`, …
//   - Typed scalars ({ _type, _value }) are unwrapped to their value.
//   - Objects nested DEEPER than one level render as their `[ClassName]`.
//   - Arrays render as `[a, b, c]`.
// Values are read-only display strings; the bag is never mutated.

export interface OtherRow {
    // The dotted display path, e.g. 'DataScope' or 'CoderInfo.CSCPackageName'.
    name: string;
    // The formatted, read-only display value.
    value: string;
}

// Internal serialization-envelope keys — structural, never user properties.
const ENVELOPE_KEYS = new Set([
    '_id', '_object_class', '_array_class', '_array_type', '_dimensions',
    '_mw_element_type', '_type', '_value', '_properties', '_rawVal',
    '_elements', '_fields',
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// A typed scalar envelope { _type, _value } → its stringified value (only when
// the value is itself a scalar, not a nested structure).
function asTypedScalar(v: Record<string, unknown>): string | null {
    if ('_value' in v && !isPlainObject(v._value) && !Array.isArray(v._value)) {
        return String(v._value);
    }
    return null;
}

// A nested MATLAB object { _object_class, _properties } → its class + prop bag.
function asNestedObject(v: Record<string, unknown>): { className: string; props: Record<string, unknown> } | null {
    if (isPlainObject(v._properties)) {
        return { className: String(v._object_class ?? ''), props: v._properties as Record<string, unknown> };
    }
    return null;
}

// Format a leaf value (primitive / array / deeper object) for display. A deeper
// object collapses to its `[ClassName]` rather than recursing (one-level rule).
function formatOther(v: unknown): string {
    if (v === undefined || v === null) {
        return '';
    }
    if (Array.isArray(v)) {
        return '[' + v.join(', ') + ']';
    }
    if (isPlainObject(v)) {
        const scalar = asTypedScalar(v);
        if (scalar !== null) {
            return scalar;
        }
        const obj = asNestedObject(v);
        if (obj) {
            return obj.className ? '[' + obj.className + ']' : '[object]';
        }
        return '';
    }
    return String(v);
}

// Build the "Other" rows for a node's raw `_properties` bag, skipping any
// top-level key already surfaced by the curated/schema layout (`shownKeys`) and
// the structural envelope keys.
export function buildOtherRows(properties: unknown, shownKeys: Set<string>): OtherRow[] {
    if (!isPlainObject(properties)) {
        return [];
    }
    const rows: OtherRow[] = [];
    for (const key of Object.keys(properties)) {
        if (shownKeys.has(key) || ENVELOPE_KEYS.has(key)) {
            continue;
        }
        const value = properties[key];
        if (isPlainObject(value)) {
            // Unwrap a typed scalar in place.
            const scalar = asTypedScalar(value);
            if (scalar !== null) {
                rows.push({ name: key, value: scalar });
                continue;
            }
            // Flatten a nested object ONE level: emit each of its sub-properties.
            const obj = asNestedObject(value);
            if (obj) {
                const subKeys = Object.keys(obj.props).filter((k) => !ENVELOPE_KEYS.has(k));
                if (subKeys.length === 0) {
                    // No sub-properties to flatten — keep the object visible by its class.
                    rows.push({ name: key, value: obj.className ? '[' + obj.className + ']' : '[object]' });
                } else {
                    for (const subKey of subKeys) {
                        rows.push({ name: key + '.' + subKey, value: formatOther(obj.props[subKey]) });
                    }
                }
                continue;
            }
            // A plain object with no recognized envelope — render compactly.
            rows.push({ name: key, value: formatOther(value) });
            continue;
        }
        rows.push({ name: key, value: formatOther(value) });
    }
    return rows;
}
