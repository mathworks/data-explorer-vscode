// Copyright 2026 The MathWorks, Inc.

export default class PropSpecification {
    static key = 'Specification';
    static displayName = 'Specification';
    static editor = 'text';
    static column = 'Value';
    static defaultValue = '';

    static format(value: unknown): string {
        return value ? "'" + value + "'" : '';
    }

    static parse(raw: unknown): string {
        return String(raw || '');
    }

    static validate(): string | null {
        return null;
    }
}
