// Copyright 2026 The MathWorks, Inc.

import type BaseNode from '../node/BaseNode';

export default class PropPath {
    static key = 'Path';
    static displayName = 'Path';
    static editor = 'label';
    static column: string | null = null;

    static readValue(node: BaseNode): string {
        return (node as unknown as { fullPath?: string }).fullPath || node.name;
    }

    static format(value: unknown): string {
        return (value as string) || '';
    }
}
