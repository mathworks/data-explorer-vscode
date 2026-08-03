// Copyright 2026 The MathWorks, Inc.

import { BaseBusNode, BaseBusElementNode, PropName, PropDataType, PropDescription } from './BaseBusNode';
import type { PropClass } from '../BaseNode';
import type BaseNode from '../BaseNode';
import PropMin from '../../prop/PropMin';
import PropMax from '../../prop/PropMax';
import PropUnit from '../../prop/PropUnit';

const CLASS_NAME = 'Simulink.Bus';

export class BusElementNode extends BaseBusElementNode {
    _rawMin: unknown;
    _rawMax: unknown;
    Min: number | undefined;
    Max: number | undefined;
    Unit: string;

    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) {
        super(name, parent, props, serial);
        this._rawMin = props.Min_internal !== undefined ? props.Min_internal : props.Min;
        this._rawMax = props.Max_internal !== undefined ? props.Max_internal : props.Max;
        this.Min = BusElementNode._normalizeMinMax(this._rawMin);
        this.Max = BusElementNode._normalizeMinMax(this._rawMax);
        this.Unit = (props.DocUnits as string) || (props.Unit as string) || '';
    }

    static _normalizeMinMax(val: unknown): number | undefined {
        if (Array.isArray(val) && val.length === 0) { return undefined; }
        return val as number | undefined;
    }

    get dataType(): string { return 'Simulink.BusElement'; }
    get nameEditable(): boolean { return false; }
    getProperties(): PropClass[] { return [PropName, PropDataType, PropMin, PropMax, PropUnit, PropDescription]; }
    getPILayout() { return [{ group: 'Element Properties', items: [PropName, PropDataType, PropMin, PropMax, PropUnit, PropDescription] }]; }

    _applyElementOverrides(props: Record<string, unknown>): void {
        const sp = this.serial._properties as Record<string, unknown>;
        const minKey = 'Min_internal' in sp ? 'Min_internal' : 'Min';
        const maxKey = 'Max_internal' in sp ? 'Max_internal' : 'Max';
        const unitKey = 'DocUnits' in sp ? 'DocUnits' : 'Unit';
        if (minKey in sp || this.Min !== undefined) { props[minKey] = this.Min !== undefined ? this.Min : this._rawMin; }
        if (maxKey in sp || this.Max !== undefined) { props[maxKey] = this.Max !== undefined ? this.Max : this._rawMax; }
        if (unitKey in sp || this.Unit) { props[unitKey] = this.Unit; }
        if ('Description' in sp || this.Description) { props.Description = this.Description; }
    }
}

export class BusNode extends BaseBusNode {
    get dataType(): string { return CLASS_NAME; }
    _createElementNode(name: string, props: Record<string, unknown>, serial: Record<string, unknown>): BusElementNode { return new BusElementNode(name, this, props, serial); }
    static ELEMENT_CLASS_NAME = 'Simulink.BusElement';
    static get defaultName(): string { return 'Bus'; }
    static createDefault(name: string, parent: BaseNode | null): BusNode { return BaseBusNode._createDefaultBus(name, parent, BusNode, CLASS_NAME) as BusNode; }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): BusNode { return BaseBusNode._parseElements(rawVal, name, parent, BusNode, BusElementNode) as BusNode; }
}

export default { BusNode, BusElementNode };
