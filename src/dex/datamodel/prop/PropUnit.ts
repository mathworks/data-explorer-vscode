// Copyright 2026 The MathWorks, Inc.

export default class PropUnit {
    static key = 'Unit';
    static displayName = 'Unit';
    static editor = 'text';
    static column: string | null = null;
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
