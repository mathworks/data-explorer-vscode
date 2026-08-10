// Copyright 2026 The MathWorks, Inc.
import DataNode from '../DataNode';
import type { PropClass } from '../BaseNode';
import type BaseNode from '../BaseNode';
import PropName from '../../prop/PropName';
import PropValue from '../../prop/PropValue';
import PropDataType from '../../prop/PropDataType';
const CLASS_NAME = 'Simulink.ConfigSetRef';
export default class ConfigSetRefNode extends DataNode {
    SourceName: string;
    // See ConfigSetNode.active — set by the SLX parser only.
    active?: boolean;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) { super(name, parent, serial); this.SourceName = (props.SourceName as string) || ''; }
    get icon(): string { return this.active ? 'check_configurationReference' : 'configurationReference'; }
    get className(): string { return CLASS_NAME; }
    // A ConfigSetRef has no scalar "value" — the Value column is empty and not editable.
    get displayValue(): string { return ''; }
    get valueEditable(): boolean { return false; }
    getProperties(): PropClass[] { return [PropName, PropDataType]; }
    getPILayout() { return [{ group: 'Data Properties', items: [PropName, PropValue, PropDataType] }]; }
    _getSerializedProperties(): Record<string, unknown> { const props = Object.assign({}, this.serial._properties as Record<string, unknown>); props.SourceName = this.SourceName; return props; }
    serializeValue(): unknown { return this._serializeSimulinkObject({ SourceName: this.SourceName }); }
    static get defaultName(): string { return 'ConfigSetRef'; }
    static createDefault(name: string, parent: BaseNode | null): ConfigSetRefNode { const rawVal = { _array_class: CLASS_NAME, _array_type: 'MATLABArray', _dimensions: [1, 1], _mw_element_type: 'MATLABArray', _elements: [{ _properties: { SourceName: '' } }] }; const props = rawVal._elements[0]._properties; const serial = { _rawVal: rawVal, _properties: props }; return new ConfigSetRefNode(name, parent, props as unknown as Record<string, unknown>, serial as unknown as Record<string, unknown>); }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): ConfigSetRefNode { const elem = rawVal._elements && (rawVal._elements as unknown[])[0]; const props = ((elem && (elem as Record<string, unknown>)._properties) || {}) as Record<string, unknown>; const serial = { _rawVal: rawVal, _properties: props }; return new ConfigSetRefNode(name, parent, props, serial as Record<string, unknown>); }
}
