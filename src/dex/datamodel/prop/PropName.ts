// Copyright 2026 The MathWorks, Inc.

import type BaseNode from '../node/BaseNode';

export default class PropName {
    static key = 'Name';
    static displayName = 'Name';
    static editor = 'text';
    static column = 'Name';
    static nodeProperty = 'name';
    static defaultValue = '';
    // The raw _properties key is 'Name' (capital) — distinct from nodeProperty
    // ('name', the JS field). Declare it so the PI "Other" catch-all treats a
    // node's raw 'Name' key as already shown (e.g. bus elements store it).
    static sourceKeys = ['Name'];

    static readValue(node: BaseNode): string {
        return node.displayName;
    }

    static format(value: unknown): string {
        return (value as string) || '';
    }

    static parse(raw: unknown): string {
        return String(raw || '');
    }

    static validate(value: unknown): string | null {
        if (!value || !(value as string).trim()) {
            return 'Name cannot be empty';
        }
        return null;
    }
}
