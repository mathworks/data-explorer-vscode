// Copyright 2026 The MathWorks, Inc.

import type BaseNode from '../node/BaseNode';

export default class PropBlockPath {
    static key = 'BlockPath';
    static displayName = 'Block Path';
    static editor = 'label';
    static column: string | null = null;

    static readValue(node: BaseNode): string {
        return (node as unknown as { blockPath?: string }).blockPath || '';
    }

    static format(value: unknown): string {
        return (value as string) || '';
    }
}
