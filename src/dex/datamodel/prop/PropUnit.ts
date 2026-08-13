// Copyright 2026 The MathWorks, Inc.

export default class PropUnit {
    static key = 'Unit';
    static displayName = 'Unit';
    // Read-only: Simulink routes Unit through a unit-expression parser (verified
    // against MATLAB — e.g. '[1 2]' raises "Encountered error while parsing unit
    // expression") that we cannot faithfully replicate, so per the conservative
    // rule we surface Unit as a label rather than risk writing an invalid value.
    static editor = 'label';
    static column: string | null = 'Unit';
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
