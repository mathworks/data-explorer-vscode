// Copyright 2026 The MathWorks, Inc.
import DataNode from '../DataNode';
import type { PropClass } from '../BaseNode';
import type BaseNode from '../BaseNode';
import PropName from '../../prop/PropName';
import PropValue from '../../prop/PropValue';
import PropDataType from '../../prop/PropDataType';
const CLASS_NAME = 'Simulink.ConfigSet';
export default class ConfigSetNode extends DataNode {
    ConfigName: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) { super(name, parent, serial); this.ConfigName = (props.Name as string) || ''; }
    get icon(): string { return 'settings'; }
    get className(): string { return CLASS_NAME; }
    get displayValue(): string { return this.ConfigName || '<1x1 ' + CLASS_NAME + '>'; }
    getProperties(): PropClass[] { return [PropName, PropValue, PropDataType]; }
    getPILayout() { return [{ group: 'Data Properties', items: [PropName, PropValue, PropDataType] }]; }
    _getSerializedProperties(): Record<string, unknown> { const props = Object.assign({}, this.serial._properties as Record<string, unknown>); props.Name = this.ConfigName; return props; }
    serializeValue(): unknown { return this._serializeSimulinkObject({ Name: this.ConfigName }); }
    static get defaultName(): string { return 'Configuration'; }
    static createDefault(name: string, parent: BaseNode | null): ConfigSetNode { const rawVal = { _array_class: CLASS_NAME, _array_type: 'MATLABArray', _dimensions: [1, 1], _mw_element_type: 'MATLABArray', _elements: [{ _properties: { Name: name || 'Configuration' } }] }; const props = rawVal._elements[0]._properties; const serial = { _rawVal: rawVal, _properties: props }; return new ConfigSetNode(name, parent, props as unknown as Record<string, unknown>, serial as unknown as Record<string, unknown>); }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): ConfigSetNode { const elem = rawVal._elements && (rawVal._elements as unknown[])[0]; const props = ((elem && (elem as Record<string, unknown>)._properties) || {}) as Record<string, unknown>; const serial = { _rawVal: rawVal, _properties: props }; return new ConfigSetNode(name, parent, props, serial as Record<string, unknown>); }
}
