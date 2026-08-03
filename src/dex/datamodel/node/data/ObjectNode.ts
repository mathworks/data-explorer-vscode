// Copyright 2026 The MathWorks, Inc.

import DataNode from '../DataNode';
import type BaseNode from '../BaseNode';
import type { PropClass, PIGroupDef } from '../BaseNode';
import PropName from '../../prop/PropName';
import PropValue from '../../prop/PropValue';
import PropDataType from '../../prop/PropDataType';
import PropDescription from '../../prop/PropDescription';

export default class ObjectNode extends DataNode {
    arrayClass: string;

    constructor(name: string, parent: BaseNode | null, arrayClass: string, serial?: Record<string, unknown>) {
        super(name, parent, serial);
        this.arrayClass = arrayClass;
    }

    get icon(): string {
        return 'wsDefault';
    }

    get dataType(): string {
        return this.arrayClass;
    }

    get displayValue(): string {
        const raw = (this.serial._rawVal as Record<string, unknown>) || {};
        const d = (raw._dimensions as number[]) || [(raw._num_rows as number) || 1, (raw._num_columns as number) || 1];
        return '<' + d.join('x') + ' ' + this.arrayClass + '>';
    }

    getProperties(): PropClass[] {
        return [PropName, PropValue, PropDataType, PropDescription];
    }

    getPILayout(): PIGroupDef[] {
        return [
            { group: 'Properties', items: [PropName, PropValue, PropDataType, PropDescription] }
        ];
    }

    serializeValue(): unknown {
        return this.serial._rawVal;
    }

    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): ObjectNode {
        const serial = { _rawVal: rawVal };
        return new ObjectNode(name, parent, rawVal._array_class as string, serial);
    }
}
