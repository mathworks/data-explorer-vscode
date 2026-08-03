// Copyright 2026 The MathWorks, Inc.

export default class PropRelease {
    static key = 'Release';
    static displayName = 'Release';
    static editor = 'label';

    static format(value: unknown): string {
        return (value as string) || '';
    }
}
