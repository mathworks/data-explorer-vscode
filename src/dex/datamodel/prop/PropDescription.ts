// Copyright 2026 The MathWorks, Inc.

export default class PropDescription {
    static key = 'Description';
    static displayName = 'Description';
    static editor = 'textArea';
    static column = 'Description';
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
