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
    // Unit is displayed from either raw key (DocUnits is the modern SLDD key;
    // Unit the legacy one). Listing both lets the PI "Other" catch-all treat
    // whichever key the node carries as already shown, so it is never re-listed.
    static sourceKeys = ['DocUnits', 'Unit'];

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
