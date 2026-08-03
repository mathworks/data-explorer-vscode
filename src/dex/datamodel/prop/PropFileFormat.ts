// Copyright 2026 The MathWorks, Inc.

export default class PropFileFormat {
    static key = 'FileFormat';
    static displayName = 'File Format';
    static editor = 'label';

    static format(value: unknown): string {
        return (value as string) || '';
    }
}
