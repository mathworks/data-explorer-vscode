// Copyright 2026 The MathWorks, Inc.

import BaseNode from '../BaseNode';
import type { PropClass, PIGroupDef, RowData } from '../BaseNode';
import PropName from '../../prop/PropName';
import PropBlockPath from '../../prop/PropBlockPath';
import PropStatus from '../../prop/PropStatus';

export default class ModelReferenceNode extends BaseNode {
    blockPath: string;
    resolved: boolean;

    constructor(name: string, parent: BaseNode | null, blockPath: string) {
        super(name, parent);
        this.blockPath = blockPath;
        this.resolved = false;
    }

    get isEntry(): boolean {
        return true;
    }

    get icon(): string {
        return 'modelReference';
    }

    get displayName(): string {
        return this.name;
    }

    get displayValue(): string {
        return this.blockPath;
    }

    get dataType(): string {
        return 'Model Reference';
    }

    get nameEditable(): boolean {
        return false;
    }

    get valueEditable(): boolean {
        return false;
    }

    toRow(): RowData | null {
        const row = super.toRow();
        if (row) {
            row.Value = { text: row.Value as string, linkTarget: this.name };
        }
        return row;
    }

    getProperties(): PropClass[] {
        return [PropName, PropBlockPath, PropStatus];
    }

    getPILayout(): PIGroupDef[] {
        return [
            { group: 'General', items: [PropName, PropBlockPath, PropStatus] }
        ];
    }
}
