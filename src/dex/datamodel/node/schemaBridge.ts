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

import { getSchema, getSchemaClasses, hydrate, writeSourcePath } from '../schema/index';
import type { ResolvedProp } from '../schema/types';
import type { PropClass, PIGroupDef } from './BaseNode';
import type BaseNode from './BaseNode';
import type { SetPropertyResult } from './DataNode';

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
// `editorOverride` forces the editor (e.g. 'label' to keep the PI read-only even
// for a prop the table renders editable). readValue reads the node's
// serial._properties bag — display-only, never mutating serial. A 'select' prop
// with an options list contributes readOptions so the cell can render a dropdown.
function toPropClass(prop: ResolvedProp, column: string | null, editorOverride?: string): PropClass {
    const pc: PropClass = {
        key: prop.key,
        displayName: prop.label,
        column,
        editor: editorOverride ?? prop.editor,
        readValue: (node: BaseNode): string => {
            const props = (node as unknown as { serial?: { _properties?: Record<string, unknown> } }).serial?._properties;
            return formatSchemaValue(hydrate(props, prop));
        },
        format: (value: unknown): string => formatSchemaValue(value),
    };
    if (prop.options) {
        const opts = prop.options;
        pc.readOptions = (): string[] => opts;
    }
    return pc;
}

// The schema props the schema itself surfaces into the UI (PI groups + table
// columns) — marked `projected` in the registry. This is exactly the 4 object
// properties (dimensions, complexity, storageClass, alignment); the min/max/unit
// props are authored for reference but owned by the node, so they are excluded.
// Shared by the PI, table-column, group, and label bridges. Empty when the class
// has no schema.
function eligibleProps(className: string): ResolvedProp[] {
    const resolved = getSchema(className);
    if (!resolved) {
        return [];
    }
    return resolved.filter((p) => p.projected === true);
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
        // The Property Inspector has no edit channel, so its schema props render
        // read-only regardless of their editor — force 'label' here. (The table
        // surface, via schemaColumns, keeps the real editor and is editable.)
        byGroup.get(group)!.push(toPropClass(prop, null, 'label'));
    }
    return order.map((group) => ({ group, items: byGroup.get(group)! }));
}

// The table columns contributed by the schema for a className. Each PropClass's
// `column` equals its key, so toRow emits row[key]; its editor comes from the
// schema, so editable props (storageClass select, alignment text) render editable
// cells while label props stay read-only.
export function schemaColumns(className: string): PropClass[] {
    return eligibleProps(className).map((prop) => toPropClass(prop, prop.key));
}

// The built-in set of enumerated StorageClass values (raw CoderInfo.StorageClass
// tokens). Sourced from codeGen.json so it stays single-source with the dropdown.
function storageClassOptions(): string[] {
    const resolved = getSchema('Simulink.Parameter');
    const sc = resolved?.find((p) => p.key === 'storageClass');
    return sc?.options ?? [];
}

// Attempt to apply an edit to a schema-projected, editable property, writing back
// into the node's serial._properties bag along the prop's sourcePath (including
// nested CoderInfo). Returns:
//   null  — `key` is not a writable schema property (caller falls back to its own
//           setProperty logic); this covers unknown keys and read-only 'label' props.
//   true  — the value was validated and written; caller need do nothing more.
//   SetPropertyResult — validation failed; caller surfaces the refusal.
// The caller (DataNode.setProperty) owns _markModified via the returned true.
export function trySetSchemaProperty(node: BaseNode, key: string, stringValue: string): true | SetPropertyResult | null {
    const className = (node as unknown as { className?: string }).className;
    if (!className) {
        return null;
    }
    const resolved = getSchema(className);
    const prop = resolved?.find((p) => p.key === key && p.projected === true);
    if (!prop || prop.editor === 'label') {
        return null;
    }

    let value: unknown = stringValue;
    if (prop.editor === 'select') {
        const options = prop.options ?? storageClassOptions();
        if (options.length > 0 && !options.includes(stringValue)) {
            return { error: true, reason: 'Invalid value for ' + prop.label, invalidValue: stringValue, validValue: '' };
        }
    } else if (prop.type === 'int') {
        const num = Number(stringValue);
        if (stringValue.trim() === '' || !Number.isInteger(num)) {
            return { error: true, reason: prop.label + ' must be an integer', invalidValue: stringValue, validValue: '' };
        }
        value = num;
    }

    const props = (node as unknown as { serial?: { _properties?: Record<string, unknown> } }).serial?._properties;
    const ok = writeSourcePath(props, prop.sourcePath, value);
    if (!ok) {
        return { error: true, reason: 'Cannot set ' + prop.label + ' (target property is absent)', invalidValue: stringValue, validValue: '' };
    }
    (node as unknown as { _markModified?: () => void })._markModified?.();
    return true;
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
