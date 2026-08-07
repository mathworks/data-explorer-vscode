// Copyright 2026 The MathWorks, Inc.
import DataNode from '../DataNode';
import type { PropClass } from '../BaseNode';
import type BaseNode from '../BaseNode';
import PropName from '../../prop/PropName';
import PropValue from '../../prop/PropValue';
import PropDataType from '../../prop/PropDataType';
import PropDescription from '../../prop/PropDescription';
const CLASS_NAME = 'Simulink.NumericType';
export default class NumericTypeNode extends DataNode {
    Description: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) { super(name, parent, serial); this.Description = (props.Description as string) || ''; }
    get icon(): string { return this.isDerived ? 'typeNumeric' : 'wsNumeric'; }
    get className(): string { return CLASS_NAME; }
    // A NumericType has no scalar "value" — the Value column is empty and not
    // editable (the class name is surfaced in the Data Type column).
    get displayValue(): string { return ''; }
    get valueEditable(): boolean { return false; }
    getProperties(): PropClass[] { return [PropName, PropDataType, PropDescription]; }
    getPILayout() { return [{ group: 'Data Properties', items: [PropName, PropValue, PropDataType, PropDescription] }]; }
    _getSerializedProperties(): Record<string, unknown> { const props = Object.assign({}, this.serial._properties as Record<string, unknown>); if ('Description' in (this.serial._properties as Record<string, unknown>) || this.Description) { props.Description = this.Description; } return props; }
    serializeValue(): unknown { const overrides: Record<string, unknown> = {}; if ('Description' in (this.serial._properties as Record<string, unknown>) || this.Description) { overrides.Description = this.Description; } return this._serializeSimulinkObject(overrides); }
    static get defaultName(): string { return 'NumericType'; }
    static createDefault(name: string, parent: BaseNode | null): NumericTypeNode { const rawVal = { _array_class: CLASS_NAME, _array_type: 'MATLABArray', _dimensions: [1, 1], _mw_element_type: 'MATLABArray', _elements: [{ _properties: {} }] }; const props = rawVal._elements[0]._properties; const serial = { _rawVal: rawVal, _properties: props }; return new NumericTypeNode(name, parent, props as unknown as Record<string, unknown>, serial as unknown as Record<string, unknown>); }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): NumericTypeNode { const elem = rawVal._elements && (rawVal._elements as unknown[])[0]; const props = ((elem && (elem as Record<string, unknown>)._properties) || {}) as Record<string, unknown>; const serial = { _rawVal: rawVal, _properties: props }; return new NumericTypeNode(name, parent, props, serial as Record<string, unknown>); }
}
