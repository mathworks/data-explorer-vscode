// Copyright 2026 The MathWorks, Inc.

import type BaseNode from '../node/BaseNode';

export default class PropValue {
    static key = 'Value';
    static displayName = 'Value';
    static editor = 'text';
    static column = 'Value';
    static defaultValue = 0;

    static readValue(node: BaseNode): string {
        return node.displayValue;
    }

    static format(value: unknown): string {
        if (value === null || value === undefined) {
            return '[ ]';
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }
        if (typeof value === 'string') {
            return "'" + value + "'";
        }
        if (Array.isArray(value)) {
            if (value.length === 0) { return '[ ]'; }
            if (value.length === 1 && typeof value[0] === 'string') {
                return '"' + value[0] + '"';
            }
            const arrStr = '[' + value.join(' ') + ']';
            return arrStr.length > 50 ? '<1x' + value.length + ' double>' : arrStr;
        }
        return '';
    }

    static parse(raw: unknown): unknown {
        return raw;
    }

    static validate(): string | null {
        return null;
    }
}
