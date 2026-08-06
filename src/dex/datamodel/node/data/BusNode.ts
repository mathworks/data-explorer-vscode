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
    DataType: string;

    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) {
        super(name, parent, props, serial);
        this._rawMin = props.Min_internal !== undefined ? props.Min_internal : props.Min;
        this._rawMax = props.Max_internal !== undefined ? props.Max_internal : props.Max;
        this.Min = BusElementNode._normalizeMinMax(this._rawMin);
        this.Max = BusElementNode._normalizeMinMax(this._rawMax);
        this.Unit = (props.DocUnits as string) || (props.Unit as string) || '';
        // The element's data type is stored in DataType_internal (falling back to
        // DataType); an unset type means the Simulink default of 'double'.
        const rawDataType = props.DataType_internal !== undefined ? props.DataType_internal : props.DataType;
        this.DataType = (rawDataType as string) || 'double';
    }

    static _normalizeMinMax(val: unknown): number | undefined {
        if (Array.isArray(val) && val.length === 0) { return undefined; }
        return val as number | undefined;
    }

    // A StructType's elements use the struct-element icon; a DataInterface's use
    // the plain bus-element icon.
    get icon(): string { return (this.parent as { isStructType?: boolean } | null)?.isStructType ? 'typeStructElement' : 'typeBusElement'; }
    get dataType(): string { return this.DataType; }
    // Elements of a Simulink.Bus are normally read-only, but when the bus is a
    // derived Architectural Data entry (a DataInterface) its elements are
    // editable, including their names.
    get nameEditable(): boolean {
        return !!(this.parent && (this.parent as { isDerived?: boolean }).isDerived);
    }
    getProperties(): PropClass[] { return [PropName, PropDataType, PropMin, PropMax, PropUnit, PropDescription]; }
    getPILayout() { return [{ group: 'Element Properties', items: [PropName, PropDataType, PropMin, PropMax, PropUnit, PropDescription] }]; }

    _applyElementOverrides(props: Record<string, unknown>): void {
        const sp = this.serial._properties as Record<string, unknown>;
        const minKey = 'Min_internal' in sp ? 'Min_internal' : 'Min';
        const maxKey = 'Max_internal' in sp ? 'Max_internal' : 'Max';
        const unitKey = 'DocUnits' in sp ? 'DocUnits' : 'Unit';
        const dtKey = 'DataType_internal' in sp ? 'DataType_internal' : 'DataType';
        if (minKey in sp || this.Min !== undefined) { props[minKey] = this.Min !== undefined ? this.Min : this._rawMin; }
        if (maxKey in sp || this.Max !== undefined) { props[maxKey] = this.Max !== undefined ? this.Max : this._rawMax; }
        if (unitKey in sp || this.Unit) { props[unitKey] = this.Unit; }
        // Only write the data type back when the source had it or it differs from
        // the implicit 'double' default, so untyped elements stay untouched.
        if (dtKey in sp || this.DataType !== 'double') { props[dtKey] = this.DataType; }
        if ('Description' in sp || this.Description) { props.Description = this.Description; }
    }
}

export class BusNode extends BaseBusNode {
    // A derived arch Simulink.Bus is a DataInterface by default, but the
    // systemcomposer catalog may classify it as a StructType (set at parse time).
    isStructType = false;

    get icon(): string {
        if (this.isStructType) { return 'typeStruct'; }
        return super.icon;
    }
    get dataType(): string { return CLASS_NAME; }
    _createElementNode(name: string, props: Record<string, unknown>, serial: Record<string, unknown>): BusElementNode { return new BusElementNode(name, this, props, serial); }
    static ELEMENT_CLASS_NAME = 'Simulink.BusElement';
    static get defaultName(): string { return 'Bus'; }
    static createDefault(name: string, parent: BaseNode | null): BusNode { return BaseBusNode._createDefaultBus(name, parent, BusNode, CLASS_NAME) as BusNode; }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): BusNode { return BaseBusNode._parseElements(rawVal, name, parent, BusNode, BusElementNode) as BusNode; }
}

export default { BusNode, BusElementNode };
