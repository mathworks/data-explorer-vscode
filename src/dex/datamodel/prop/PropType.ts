// Copyright 2026 The MathWorks, Inc.

import type BaseNode from '../node/BaseNode';

export default class PropType {
    static key = 'Type';
    static displayName = 'Type';
    static editor = 'label';
    static column: string | null = 'Type';

    static readValue(node: BaseNode): string {
        const n = node as unknown as { projectItemType?: string; className?: string };
        return n.projectItemType || n.className || '';
    }

    static format(value: unknown): string {
        return (value as string) || '';
    }
}
