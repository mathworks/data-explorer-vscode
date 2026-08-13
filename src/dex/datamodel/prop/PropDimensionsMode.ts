// Copyright 2026 The MathWorks, Inc.

import type BaseNode from '../node/BaseNode';

// A bus element's DimensionsMode ('Fixed' | 'Variable'). MATLAB constrains it to
// that enum (verified), so it COULD be an editable select; surfaced read-only for
// now to stay conservative and stop the column rendering empty for elements.
// Emits into the shared `dimensionsMode` column.
export default class PropDimensionsMode {
    static key = 'dimensionsMode';
    static displayName = 'Dimensions Mode';
    static editor = 'label';
    static column: string | null = 'dimensionsMode';
    static defaultValue = '';

    static readValue(node: BaseNode): string {
        return ((node as unknown as { DimensionsMode?: string }).DimensionsMode) || '';
    }

    static format(value: unknown): string {
        return (value as string) || '';
    }
}
