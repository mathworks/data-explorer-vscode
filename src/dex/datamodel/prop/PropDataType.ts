// Copyright 2026 The MathWorks, Inc.

import type BaseNode from '../node/BaseNode';

export default class PropDataType {
    static key = 'DataType';
    static displayName = 'Data Type';
    static editor = 'label';
    static column = 'DataType';
    static defaultValue = '';

    static readValue(node: BaseNode): string {
        return node.dataType;
    }

    static format(value: unknown): string {
        return (value as string) || '';
    }

    static parse(raw: unknown): string {
        return String(raw || '');
    }

    static validate(): string | null {
        return null;
    }
}
