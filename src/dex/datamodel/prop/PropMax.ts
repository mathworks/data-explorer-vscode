// Copyright 2026 The MathWorks, Inc.

export default class PropMax {
    static key = 'Max';
    static displayName = 'Maximum';
    static editor = 'text';
    static column: string | null = 'Max';
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
            return 'Max must be a number';
        }
        return null;
    }
}
