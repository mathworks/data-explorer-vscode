// Copyright 2026 The MathWorks, Inc.

// Bridges the language-neutral `schema/` descriptors into the existing PropClass
// render contract. Lives OUTSIDE schema/ (it depends on both the schema and node
// types) so the schema module stays a self-contained, extractable package.
//
// Two surfaces are bridged:
//   - buildPILayout: turns a class's declarative PI layout (schema `layout`:
//     ordered groups → prop keys) into PIGroupDef[]. Each key resolves either to
//     a curated node atom (ATOM_BY_KEY — computed/live props like Name, Value,
//     Data Type) or to a hydrated schema prop (Dimensions, Storage Class, …).
//     This is the single generic implementation behind BaseNode.getPILayout.
//   - schemaColumns / schemaColumnLabels: the schema-driven read-only table
//     columns (Dimensions, Complexity, Storage Class, …). Column GROUPING is NOT
//     here — it is a global table concern owned by host/rowBuilder.COLUMN_GROUPS.

import { getSchema, getSchemaClasses, getLayout, hydrate, writeSourcePath } from '../schema/index';
import type { ResolvedProp } from '../schema/types';
import type { PropClass, PIGroupDef } from './BaseNode';
import type BaseNode from './BaseNode';
import type { SetPropertyResult } from './DataNode';
import PropName from '../prop/PropName';
import PropValue from '../prop/PropValue';
import PropDataType from '../prop/PropDataType';
import PropKind from '../prop/PropKind';
import PropClassAtom from '../prop/PropClass';
import PropBaseType from '../prop/PropBaseType';
import PropCondition from '../prop/PropCondition';
import PropSpecification from '../prop/PropSpecification';
import PropEnumValue from '../prop/PropEnumValue';
import PropMin from '../prop/PropMin';
import PropMax from '../prop/PropMax';
import PropUnit from '../prop/PropUnit';
import PropDescription from '../prop/PropDescription';

// Curated atom keys a schema `layout` may reference. These are the node-owned,
// often COMPUTED properties (Name→displayName, Value→displayValue formatting,
// Data Type→computed getter) that a static sourcePath cannot express — the schema
// declares WHERE they sit (layout), the atom supplies HOW to read/format them.
// Keyed by the lowercase layout key; the atom keeps its own display key ('Name').
// Extend this map when a new schema-driven class references a new atom key.
const ATOM_BY_KEY: Record<string, PropClass> = {
    name: PropName as unknown as PropClass,
    value: PropValue as unknown as PropClass,
    dataType: PropDataType as unknown as PropClass,
    kind: PropKind as unknown as PropClass,
    class: PropClassAtom as unknown as PropClass,
    baseType: PropBaseType as unknown as PropClass,
    condition: PropCondition as unknown as PropClass,
    specification: PropSpecification as unknown as PropClass,
    enumValue: PropEnumValue as unknown as PropClass,
    min: PropMin as unknown as PropClass,
    max: PropMax as unknown as PropClass,
    unit: PropUnit as unknown as PropClass,
    description: PropDescription as unknown as PropClass,
};

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
        // The top-level _properties key this prop reads through (e.g. 'CoderInfo'
        // for 'CoderInfo.StorageClass'). Lets the PI "Other" catch-all exclude the
        // whole bag this prop already surfaces.
        sourceKeys: [prop.sourcePath.split('.')[0]],
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

// Resolve one PI-layout key to a renderable PropClass for `className`. Curated
// atom keys (Name/Value/Data Type/…) resolve to the node atom; any other key is
// a schema-registry prop, hydrated from its sourcePath and forced read-only
// ('label') because the Property Inspector has no edit channel. Returns null if
// the key matches neither (a layout referencing an unknown key is skipped).
function resolvePropForKey(className: string, key: string): PropClass | null {
    const atom = ATOM_BY_KEY[key];
    if (atom) {
        return atom;
    }
    const resolved = getSchema(className)?.find((p) => p.key === key);
    if (!resolved) {
        return null;
    }
    return toPropClass(resolved, null, 'label');
}

// The Property Inspector layout for `className`, built from the declarative schema
// `layout` (ordered groups → prop keys). Returns null when the class has no schema
// layout, so BaseNode.getPILayout can fall back to a node-authored override. This
// is the single generic PI-layout implementation; grouping/order live in the
// schema, value resolution in the atoms/schema props.
export function buildPILayout(className: string): PIGroupDef[] | null {
    const layout = getLayout(className);
    if (!layout) {
        return null;
    }
    return layout.map((g) => ({
        group: g.group,
        items: g.items
            .map((key) => resolvePropForKey(className, key))
            .filter((pc): pc is PropClass => pc !== null),
    }));
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
