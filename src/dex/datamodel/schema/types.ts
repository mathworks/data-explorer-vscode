// Copyright 2026 The MathWorks, Inc.

// Language-neutral schema types. NO runtime dependency on node classes — this
// module is designed to be extractable into a standalone `dex-schema` package,
// so dependencies must point INTO the schema, never out.

// A single shared property descriptor as authored in props/*.json.
export interface RawProp {
    label: string;
    // Dot path resolved against a node's `_properties` bag. Nested sub-objects
    // (e.g. CoderInfo) are traversed through their inner `_properties`.
    sourcePath: string;
    // Display value used when the resolved value is absent (the JSON `.sldd`
    // format omits default-valued properties).
    default?: unknown;
    // Value kind a consuming app formats by.
    type: string;
    // 'text' | 'textArea' | 'label' | 'select' | 'bool'; 'label' = read-only.
    editor: string;
    // Fixed option list for a 'select' editor (e.g. the StorageClass values).
    options?: string[];
    // Whether the schema itself surfaces this prop into the UI (PI groups + table
    // columns). Props the owning node already exposes as live fields (min/max/unit)
    // are authored here for reference but NOT projected, to avoid duplicating them.
    projected?: boolean;
}

// A class references a shared prop by key, optionally overlaying overrides.
export type ClassRef = string | ({ $ref: string } & Partial<RawProp>);

// One Property Inspector group for a class: a named group and the ordered prop
// keys it contains. Grouping/order is per-CLASS (declared here), not per-prop, so
// the same prop can appear in different groups across classes. `items` are prop
// keys — either a schema-registry key (hydrated from sourcePath) or a curated
// atom key (e.g. 'name', 'value', 'dataType') resolved by the node's atom bridge.
export interface PILayoutGroup {
    group: string;
    items: string[];
}

// A class definition: the ordered prop reference list plus an optional PI layout.
// (Older single-array form is normalized to { props } by the loader.)
export interface ClassDef {
    props: ClassRef[];
    layout?: PILayoutGroup[];
}

// The registry (merged props/*.json) plus per-class definitions.
export interface SchemaBundle {
    props: Record<string, RawProp>;
    classes: Record<string, ClassDef>;
}

// A fully resolved descriptor for one property of one class.
export interface ResolvedProp {
    key: string;        // the registry key (identity), e.g. 'storageClass'
    label: string;
    sourcePath: string;
    default?: unknown;
    type: string;
    editor: string;
    options?: string[];
    projected?: boolean;
}
