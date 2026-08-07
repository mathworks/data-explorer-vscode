// Copyright 2026 The MathWorks, Inc.

import DataNode from '../DataNode';
import type { SetPropertyResult } from '../DataNode';
import type { PropClass } from '../BaseNode';
import type BaseNode from '../BaseNode';
import PropName from '../../prop/PropName';
import PropDataType from '../../prop/PropDataType';
import PropMin from '../../prop/PropMin';
import PropMax from '../../prop/PropMax';
import PropUnit from '../../prop/PropUnit';
import PropDescription from '../../prop/PropDescription';

const CLASS_NAME = 'Simulink.Signal';

export default class SignalNode extends DataNode {
    Min: number | undefined;
    Max: number | undefined;
    Unit: string;
    Description: string;

    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) {
        super(name, parent, serial);
        this.Min = props.Min as number | undefined;
        this.Max = props.Max as number | undefined;
        this.Unit = (props.DocUnits as string) || (props.Unit as string) || '';
        this.Description = (props.Description as string) || '';
    }

    get icon(): string { return this.isDerived ? 'serviceInterfaces' : 'wsSignal'; }
    get className(): string { return CLASS_NAME; }
    get displayValue(): string { return '<1x1 ' + CLASS_NAME + '>'; }

    getProperties(): PropClass[] { return [PropName, PropDataType, PropMin, PropMax, PropUnit, PropDescription]; }
    getPILayout() { return [{ group: 'Data Properties', items: [PropName, PropDataType] }, { group: 'Value Properties', items: [PropMin, PropMax, PropUnit, PropDescription] }]; }

    setProperty(propName: string, stringValue: string): true | SetPropertyResult {
        if (propName === 'Min' || propName === 'Max') {
            if (stringValue === '' || stringValue === '[]') { (this as unknown as Record<string, unknown>)[propName] = undefined; this._markModified(); return true; }
            const num = Number(stringValue);
            if (Number.isNaN(num)) { const cv = (this as unknown as Record<string, unknown>)[propName] as number | undefined; return { error: true, reason: 'Expected a numeric value', invalidValue: stringValue, validValue: cv !== undefined ? String(cv) : '[]' }; }
            if (propName === 'Min' && this.Max !== undefined && num > this.Max) { return { error: true, reason: 'Min must not exceed Max (' + this.Max + ')', invalidValue: stringValue, validValue: this.Min !== undefined ? String(this.Min) : '[]' }; }
            if (propName === 'Max' && this.Min !== undefined && num < this.Min) { return { error: true, reason: 'Max must not be less than Min (' + this.Min + ')', invalidValue: stringValue, validValue: this.Max !== undefined ? String(this.Max) : '[]' }; }
            (this as unknown as Record<string, unknown>)[propName] = num; this._markModified(); return true;
        }
        return DataNode.prototype.setProperty.call(this, propName, stringValue);
    }

    _getSerializedProperties(): Record<string, unknown> {
        const sp = this.serial._properties as Record<string, unknown>;
        const unitKey = 'DocUnits' in sp ? 'DocUnits' : 'Unit';
        const props = Object.assign({}, sp);
        if ('Min' in sp || this.Min !== undefined) { props.Min = this.Min !== undefined ? this.Min : []; }
        if ('Max' in sp || this.Max !== undefined) { props.Max = this.Max !== undefined ? this.Max : []; }
        if (unitKey in sp || this.Unit) { props[unitKey] = this.Unit; }
        if ('Description' in sp || this.Description) { props.Description = this.Description; }
        return props;
    }

    serializeValue(): unknown {
        const sp = this.serial._properties as Record<string, unknown>;
        const unitKey = 'DocUnits' in sp ? 'DocUnits' : 'Unit';
        const overrides: Record<string, unknown> = {};
        if ('Min' in sp || this.Min !== undefined) { overrides.Min = this.Min; }
        if ('Max' in sp || this.Max !== undefined) { overrides.Max = this.Max; }
        if (unitKey in sp || this.Unit) { overrides[unitKey] = this.Unit; }
        if ('Description' in sp || this.Description) { overrides.Description = this.Description; }
        return this._serializeSimulinkObject(overrides);
    }

    static get defaultName(): string { return 'Signal'; }

    static createDefault(name: string, parent: BaseNode | null): SignalNode {
        const rawVal = { _array_class: CLASS_NAME, _array_type: 'MATLABArray', _dimensions: [1, 1], _mw_element_type: 'MATLABArray', _elements: [{ _properties: { CoderInfo: { _object_class: 'Simulink.CoderInfo', _properties: { CSCPackageName: 'Simulink', CustomAttributes: { _object_class: 'SimulinkCSC.AttribClass_Simulink_Default', _properties: {} }, CustomStorageClass: 'Default', ParameterOrSignal: 'Signal', StorageClass: 'Auto' } }, LoggingInfo: { _object_class: 'Simulink.LoggingInfo', _properties: {} } } }] };
        const props = rawVal._elements[0]._properties;
        const serial = { _rawVal: rawVal, _properties: props };
        return new SignalNode(name, parent, props as unknown as Record<string, unknown>, serial as unknown as Record<string, unknown>);
    }

    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): SignalNode {
        const elem = rawVal._elements && (rawVal._elements as unknown[])[0];
        const props = ((elem && (elem as Record<string, unknown>)._properties) || {}) as Record<string, unknown>;
        const serial = { _rawVal: rawVal, _properties: props };
        return new SignalNode(name, parent, props, serial as Record<string, unknown>);
    }
}
