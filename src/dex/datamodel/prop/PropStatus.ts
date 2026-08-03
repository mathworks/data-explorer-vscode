// Copyright 2026 The MathWorks, Inc.

import type BaseNode from '../node/BaseNode';

export default class PropStatus {
    static key = 'Status';
    static displayName = 'Status';
    static editor = 'label';
    static column: string | null = null;

    static readValue(node: BaseNode): string {
        return (node as unknown as { resolved?: boolean }).resolved ? 'Loaded' : 'Not Loaded';
    }

    static format(value: unknown): string {
        return (value as string) || '';
    }
}
