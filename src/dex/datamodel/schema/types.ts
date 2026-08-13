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
    // UI grouping label (e.g. 'Data Object', 'Code Generation'); omitted = top.
    group?: string;
    // 'text' | 'textArea' | 'label' | 'bool'; 'label' = read-only.
    editor: string;
}

// A class references a shared prop by key, optionally overlaying overrides.
export type ClassRef = string | ({ $ref: string } & Partial<RawProp>);

// The registry (merged props/*.json) plus per-class reference lists.
export interface SchemaBundle {
    props: Record<string, RawProp>;
    classes: Record<string, ClassRef[]>;
}

// A fully resolved descriptor for one property of one class.
export interface ResolvedProp {
    key: string;        // the registry key (identity), e.g. 'storageClass'
    label: string;
    sourcePath: string;
    default?: unknown;
    type: string;
    group?: string;
    editor: string;
}
