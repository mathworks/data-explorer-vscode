// Copyright 2026 The MathWorks, Inc.

import type BaseNode from '../node/BaseNode';

// The EnumType "Value" cell: a dropdown whose options are the enumeral child
// names. The chosen option is written to the node's DefaultValue, so selecting a
// row sets which enumeral the enum defaults to. Reading falls back to the first
// enumeral when no DefaultValue is set (matching the child "current" icon rule).
export default class PropEnumValue {
    static key = 'Value';
    static displayName = 'Value';
    static editor = 'select';
    static column = 'Value';
    static nodeProperty = 'DefaultValue';
    static defaultValue = '';

    static readValue(node: BaseNode): string {
        return node.displayValue;
    }

    static readOptions(node: BaseNode): string[] {
        return node.children.map((c) => c.name);
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
