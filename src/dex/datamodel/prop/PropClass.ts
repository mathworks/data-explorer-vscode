// Copyright 2026 The MathWorks, Inc.

import type BaseNode from '../node/BaseNode';

// The raw class identity (e.g. 'Simulink.Parameter', 'Simulink.Bus') — the
// object's Class, distinct from PropKind (the human-readable Kind label, e.g.
// 'Simulink Parameter'). Read-only, computed from the live node getter, so it
// must resolve via this atom rather than schema hydration. PI-only (column:
// null) — the table already emits its own Class column in toRow.
export default class PropClass {
    static key = 'Class';
    static displayName = 'Class';
    static editor = 'label';
    static column: string | null = null;

    static readValue(node: BaseNode): string {
        return node.className;
    }

    static format(value: unknown): string {
        return (value as string) || '';
    }
}
