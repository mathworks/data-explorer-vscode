// Copyright 2026 The MathWorks, Inc.

import type BaseNode from '../node/BaseNode';

// The user-facing Kind (e.g. 'Simulink Parameter', 'Bus', 'Value Type') — the
// human-readable label for the object's class, distinct from PropClass (the raw
// class identity, e.g. 'Simulink.Parameter'). Read-only, computed from the live
// node getter (which applies classification/derived/MATLAB-variable overrides),
// so it must resolve via this atom rather than schema hydration. PI-only
// (column: null) — the table already emits its own Kind column in toRow.
export default class PropKind {
    static key = 'Kind';
    static displayName = 'Kind';
    static editor = 'label';
    static column: string | null = null;

    static readValue(node: BaseNode): string {
        return node.kind;
    }

    static format(value: unknown): string {
        return (value as string) || '';
    }
}
