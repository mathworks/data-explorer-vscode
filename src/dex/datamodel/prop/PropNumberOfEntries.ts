// Copyright 2026 The MathWorks, Inc.

export default class PropNumberOfEntries {
    static key = 'NumberOfEntries';
    static displayName = 'Number of Entries';
    static editor = 'label';

    static format(value: unknown): string {
        return String(value || 0);
    }
}
