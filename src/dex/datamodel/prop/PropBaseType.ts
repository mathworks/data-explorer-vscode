// Copyright 2026 The MathWorks, Inc.

export default class PropBaseType {
    static key = 'BaseType';
    static displayName = 'Base Type';
    static editor = 'text';
    static column = 'Value';
    static defaultValue = '';

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
