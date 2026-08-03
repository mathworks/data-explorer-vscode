// Copyright 2026 The MathWorks, Inc.

import type BaseNode from '../node/BaseNode';

export default class PropLabels {
    static key = 'Labels';
    static displayName = 'Labels';
    static editor = 'label';
    static column: string | null = 'Labels';

    static readValue(node: BaseNode): string {
        const labels = (node as unknown as { labels?: string[] }).labels;
        return labels && labels.length > 0 ? labels.join(', ') : '';
    }

    static format(value: unknown): string {
        return (value as string) || '';
    }
}
