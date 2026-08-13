// Copyright 2026 The MathWorks, Inc.

// Bridges the language-neutral `schema/` descriptors into the existing PropClass
// render contract. Lives OUTSIDE schema/ (it depends on both the schema and node
// types) so the schema module stays a self-contained, extractable package.
//
// Phase 2 scope: contribute ONLY read-only, grouped object properties (editor
// 'label' with a `group`) to the Property Inspector — Dimensions, Complexity
// (Data Object) and Storage Class, Alignment (Code Generation). The editable /
// ungrouped props (Value, Data Type, Description, Min, Max, Unit) remain owned by
// the node as live fields; the schema does not duplicate them here.

import { getSchema, hydrate } from '../schema/index';
import type { ResolvedProp } from '../schema/types';
import type { PropClass, PIGroupDef } from './BaseNode';
import type BaseNode from './BaseNode';

// Format a hydrated raw value for display. Arrays render as `[a, b]`; absent
// values as ''; everything else via String(). (Type-specific formatting can be
// enriched later; this covers the current Phase 2 props.)
function formatSchemaValue(value: unknown): string {
    if (value === undefined || value === null) {
        return '';
    }
    if (Array.isArray(value)) {
        return '[' + value.join(', ') + ']';
    }
    return String(value);
}

// Adapt one ResolvedProp to a PropClass. column:null keeps it PI-only (toRow
// skips column===null); readValue reads the node's serial._properties bag —
// display-only, never mutating serial.
function toPropClass(prop: ResolvedProp): PropClass {
    return {
        key: prop.key,
        displayName: prop.label,
        column: null,
        editor: prop.editor,
        readValue: (node: BaseNode): string => {
            const props = (node as unknown as { serial?: { _properties?: Record<string, unknown> } }).serial?._properties;
            return formatSchemaValue(hydrate(props, prop));
        },
        format: (value: unknown): string => formatSchemaValue(value),
    };
}

// The PI groups contributed by the schema for a className, in first-seen group
// order. Empty when the class has no schema.
export function schemaPILayout(className: string): PIGroupDef[] {
    const resolved = getSchema(className);
    if (!resolved) {
        return [];
    }
    const eligible = resolved.filter((p) => p.editor === 'label' && p.group !== undefined);
    const order: string[] = [];
    const byGroup = new Map<string, PropClass[]>();
    for (const prop of eligible) {
        const group = prop.group as string;
        if (!byGroup.has(group)) {
            byGroup.set(group, []);
            order.push(group);
        }
        byGroup.get(group)!.push(toPropClass(prop));
    }
    return order.map((group) => ({ group, items: byGroup.get(group)! }));
}
