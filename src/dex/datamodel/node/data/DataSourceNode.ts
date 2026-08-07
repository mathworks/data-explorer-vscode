// Copyright 2026 The MathWorks, Inc.

import BaseNode from '../BaseNode';
import type { PropClass, PIGroupDef, RowData } from '../BaseNode';
import PropName from '../../prop/PropName';
import PropPath from '../../prop/PropPath';
import PropStatus from '../../prop/PropStatus';

export default class DataSourceNode extends BaseNode {
    fullPath: string;
    resolved: boolean;

    constructor(name: string, parent: BaseNode | null, fullPath: string) {
        super(name, parent);
        this.fullPath = fullPath;
        this.resolved = false;
    }

    get isEntry(): boolean {
        return true;
    }

    get icon(): string {
        if (this.name.endsWith('.sldd')) { return 'simulinkDataDictionary_FT'; }
        if (this.name.endsWith('.slx')) { return 'simulinkModel_FT'; }
        return 'matlabWorkspaceFile';
    }

    get displayName(): string {
        return this.name;
    }

    get displayValue(): string {
        return this.fullPath;
    }

    get className(): string {
        if (this.name.endsWith('.sldd')) { return 'Data Dictionary'; }
        if (this.name.endsWith('.slx')) { return 'Simulink Model'; }
        return 'MAT File';
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
        return [PropName, PropPath, PropStatus];
    }

    getPILayout(): PIGroupDef[] {
        return [
            { group: 'General', items: [PropName, PropPath, PropStatus] }
        ];
    }
}
