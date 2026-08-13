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

import { getSchema, getSchemaClasses, hydrate } from '../schema/index';
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

// Adapt one ResolvedProp to a PropClass. `column` controls the surface:
//   null  → PI-only (toRow skips column===null)
//   <key> → a table column emitted by toRow as row[key]
// readValue reads the node's serial._properties bag — display-only, never mutating serial.
function toPropClass(prop: ResolvedProp, column: string | null): PropClass {
    return {
        key: prop.key,
        displayName: prop.label,
        column,
        editor: prop.editor,
        readValue: (node: BaseNode): string => {
            const props = (node as unknown as { serial?: { _properties?: Record<string, unknown> } }).serial?._properties;
            return formatSchemaValue(hydrate(props, prop));
        },
        format: (value: unknown): string => formatSchemaValue(value),
    };
}

// The schema props eligible for UI projection: read-only (editor 'label') and
// grouped. Shared by the PI (grouped) and table-column (flat) bridges. Empty when
// the class has no schema.
function eligibleProps(className: string): ResolvedProp[] {
    const resolved = getSchema(className);
    if (!resolved) {
        return [];
    }
    return resolved.filter((p) => p.editor === 'label' && p.group !== undefined);
}

// The PI groups contributed by the schema for a className, in first-seen group
// order. Each item is a PI-only PropClass (column:null).
export function schemaPILayout(className: string): PIGroupDef[] {
    const order: string[] = [];
    const byGroup = new Map<string, PropClass[]>();
    for (const prop of eligibleProps(className)) {
        const group = prop.group as string;
        if (!byGroup.has(group)) {
            byGroup.set(group, []);
            order.push(group);
        }
        byGroup.get(group)!.push(toPropClass(prop, null));
    }
    return order.map((group) => ({ group, items: byGroup.get(group)! }));
}

// The table columns contributed by the schema for a className. Each is a
// read-only PropClass whose `column` equals its key, so toRow emits row[key].
export function schemaColumns(className: string): PropClass[] {
    return eligibleProps(className).map((prop) => toPropClass(prop, prop.key));
}

// Column-key → group-name for every schema-driven read-only column, unioned
// across all schema classes. Each key's group is defined once in the shared
// prop registry (via $ref), so the union is unambiguous. Used by the host to
// tell the column picker which group header each column sits under.
export function schemaColumnGroups(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const className of getSchemaClasses()) {
        for (const prop of eligibleProps(className)) {
            if (prop.group !== undefined) {
                map[prop.key] = prop.group;
            }
        }
    }
    return map;
}

// Column-key → display label for every schema-driven read-only column, unioned
// across all schema classes. The label lives once in the shared prop registry,
// so the host merges this over its base-column labels instead of hand-copying
// the schema labels (single source of truth).
export function schemaColumnLabels(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const className of getSchemaClasses()) {
        for (const prop of eligibleProps(className)) {
            map[prop.key] = prop.label;
        }
    }
    return map;
}
