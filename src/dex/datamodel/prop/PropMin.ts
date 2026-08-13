// Copyright 2026 The MathWorks, Inc.

export default class PropMin {
    static key = 'Min';
    static displayName = 'Minimum';
    static editor = 'text';
    static column: string | null = 'Min';
    static defaultValue: number | undefined = undefined;

    static format(value: unknown): string {
        return value !== undefined && value !== null ? String(value) : '';
    }

    static parse(raw: unknown): number | undefined | string {
        if (raw === '' || raw === undefined) { return undefined; }
        const num = Number(raw);
        return isNaN(num) ? raw as string : num;
    }

    static validate(value: unknown): string | null {
        if (value !== undefined && value !== null && typeof value !== 'number') {
            return 'Min must be a number';
        }
        return null;
    }
}
