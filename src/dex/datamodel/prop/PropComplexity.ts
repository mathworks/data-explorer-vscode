// Copyright 2026 The MathWorks, Inc.

import type BaseNode from '../node/BaseNode';

// A bus element's Complexity ('real' | 'complex'). MATLAB constrains it to that
// enum (verified: any other value raises "There is no enumerated value named
// ..."), so it COULD be an editable select; it is surfaced read-only for now to
// stay conservative and stop the column rendering empty for elements. Emits into
// the shared `complexity` column (same key the Parameter/Signal schema uses).
export default class PropComplexity {
    static key = 'complexity';
    static displayName = 'Complexity';
    static editor = 'label';
    static column: string | null = 'complexity';
    static defaultValue = '';

    static readValue(node: BaseNode): string {
        return ((node as unknown as { Complexity?: string }).Complexity) || '';
    }

    static format(value: unknown): string {
        return (value as string) || '';
    }
}
