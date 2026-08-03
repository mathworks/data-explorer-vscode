// Copyright 2026 The MathWorks, Inc.

import type BaseNode from '../node/BaseNode';

export default class PropLocation {
    static key = 'Location';
    static displayName = 'Location';
    static editor = 'label';
    static column: string | null = 'Location';

    static readValue(node: BaseNode): string {
        return (node as unknown as { location?: string }).location || '';
    }

    static format(value: unknown): string {
        return (value as string) || '';
    }
}
