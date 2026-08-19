// Copyright 2026 The MathWorks, Inc.
import DataNode from '../DataNode';
import type { PropClass } from '../BaseNode';
import type BaseNode from '../BaseNode';
import PropName from '../../prop/PropName';
import PropCondition from '../../prop/PropCondition';
import PropDataType from '../../prop/PropDataType';
const CLASS_NAME = 'Simulink.VariantExpression';
export default class VariantExpressionNode extends DataNode {
    Condition: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) { super(name, parent, serial); this.Condition = (props.Condition as string) || ''; }
    get icon(): string { return 'wsVariant'; }
    get className(): string { return CLASS_NAME; }
    get displayValue(): string { return PropCondition.format(this.Condition); }
    getProperties(): PropClass[] { return [PropName, PropCondition, PropDataType]; }
    // PI layout: schema-driven "General" group (classes/variantExpression.json).
    _getSerializedProperties(): Record<string, unknown> { const props = Object.assign({}, this.serial._properties as Record<string, unknown>); props.Condition = this.Condition; return props; }
    serializeValue(): unknown { return this._serializeSimulinkObject({ Condition: this.Condition }); }
    static get defaultName(): string { return 'VariantExpression'; }
    static createDefault(name: string, parent: BaseNode | null): VariantExpressionNode { const rawVal = { _array_class: CLASS_NAME, _array_type: 'MATLABArray', _dimensions: [1, 1], _mw_element_type: 'MATLABArray', _elements: [{ _properties: { Condition: '' } }] }; const props = rawVal._elements[0]._properties; const serial = { _rawVal: rawVal, _properties: props }; return new VariantExpressionNode(name, parent, props as unknown as Record<string, unknown>, serial as unknown as Record<string, unknown>); }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): VariantExpressionNode { const elem = rawVal._elements && (rawVal._elements as unknown[])[0]; const props = ((elem && (elem as Record<string, unknown>)._properties) || {}) as Record<string, unknown>; const serial = { _rawVal: rawVal, _properties: props }; return new VariantExpressionNode(name, parent, props, serial as Record<string, unknown>); }
}
