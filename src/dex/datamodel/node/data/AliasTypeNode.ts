// Copyright 2026 The MathWorks, Inc.
import DataNode from '../DataNode';
import type { PropClass } from '../BaseNode';
import type BaseNode from '../BaseNode';
import PropName from '../../prop/PropName';
import PropBaseType from '../../prop/PropBaseType';
import PropDataType from '../../prop/PropDataType';
import PropDescription from '../../prop/PropDescription';
const CLASS_NAME = 'Simulink.AliasType';
export default class AliasTypeNode extends DataNode {
    BaseType: string; Description: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) { super(name, parent, serial); this.BaseType = (props.BaseType as string) || ''; this.Description = (props.Description as string) || ''; }
    get icon(): string { return this.isDerived ? 'typeAlias' : 'wsAlias'; }
    get dataType(): string { return CLASS_NAME; }
    // An alias has no "value" — its base type ("double") is surfaced in the Data
    // Type column via PropBaseType. The Value column is therefore empty and not
    // editable.
    get displayValue(): string { return ''; }
    get valueEditable(): boolean { return false; }
    // Table columns: PropBaseType owns the Data Type column, so PropDataType (which
    // would show the class name 'Simulink.AliasType') is omitted here.
    getProperties(): PropClass[] { return [PropName, PropBaseType, PropDescription]; }
    getPILayout() { return [{ group: 'Data Properties', items: [PropName, PropBaseType, PropDataType, PropDescription] }]; }
    _getSerializedProperties(): Record<string, unknown> { const props = Object.assign({}, this.serial._properties as Record<string, unknown>); props.BaseType = this.BaseType; if ('Description' in (this.serial._properties as Record<string, unknown>) || this.Description) { props.Description = this.Description; } return props; }
    serializeValue(): unknown { const overrides: Record<string, unknown> = { BaseType: this.BaseType }; if ('Description' in (this.serial._properties as Record<string, unknown>) || this.Description) { overrides.Description = this.Description; } return this._serializeSimulinkObject(overrides); }
    static get defaultName(): string { return 'AliasType'; }
    static createDefault(name: string, parent: BaseNode | null): AliasTypeNode { const rawVal = { _array_class: CLASS_NAME, _array_type: 'MATLABArray', _dimensions: [1, 1], _mw_element_type: 'MATLABArray', _elements: [{ _properties: { BaseType: 'double', DataScope: 'Auto', Description: '', HeaderFile: '' } }] }; const props = rawVal._elements[0]._properties; const serial = { _rawVal: rawVal, _properties: props }; return new AliasTypeNode(name, parent, props as unknown as Record<string, unknown>, serial as unknown as Record<string, unknown>); }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): AliasTypeNode { const elem = rawVal._elements && (rawVal._elements as unknown[])[0]; const props = ((elem && (elem as Record<string, unknown>)._properties) || {}) as Record<string, unknown>; const serial = { _rawVal: rawVal, _properties: props }; return new AliasTypeNode(name, parent, props, serial as Record<string, unknown>); }
}
