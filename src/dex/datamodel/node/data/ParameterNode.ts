// Copyright 2026 The MathWorks, Inc.

import DataNode from '../DataNode';
import type { SetPropertyResult } from '../DataNode';
import type { PropClass } from '../BaseNode';
import type BaseNode from '../BaseNode';
import * as NodeRegistry from '../NodeRegistry';
import PropName from '../../prop/PropName';
import PropValue from '../../prop/PropValue';
import PropDataType from '../../prop/PropDataType';
import PropMin from '../../prop/PropMin';
import PropMax from '../../prop/PropMax';
import PropUnit from '../../prop/PropUnit';
import PropDescription from '../../prop/PropDescription';
import MatlabValueParser from '../../parser/MatlabValueParser';
import { schemaPILayout, schemaColumns } from '../schemaBridge';

const CLASS_NAME = 'Simulink.Parameter';

export default class ParameterNode extends DataNode {
    Value: unknown;
    _rawMin: unknown;
    _rawMax: unknown;
    Min: number | undefined;
    Max: number | undefined;
    Unit: string;
    Description: string;

    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) {
        super(name, parent, serial);
        this.Value = props.Value;
        this._rawMin = props.Min;
        this._rawMax = props.Max;
        this.Min = ParameterNode._normalizeMinMax(props.Min);
        this.Max = ParameterNode._normalizeMinMax(props.Max);
        this.Unit = (props.DocUnits as string) || (props.Unit as string) || '';
        this.Description = (props.Description as string) || '';
    }

    get icon(): string {
        return this.isDerived ? 'typeConstant' : 'wsParameters';
    }

    get className(): string {
        return CLASS_NAME;
    }

    get displayValue(): string {
        if (this.children.length > 0) {
            return this.children[0].displayValue;
        }
        return PropValue.format(this.Value);
    }

    getProperties(): PropClass[] {
        return [PropName, PropValue, PropDataType, PropMin, PropMax, PropUnit, PropDescription, ...schemaColumns(this.className)];
    }

    getPILayout() {
        return [
            { group: 'Data Properties', items: [PropName, PropValue, PropDataType] },
            { group: 'Value Properties', items: [PropMin, PropMax, PropUnit, PropDescription] },
            ...schemaPILayout(this.className)
        ];
    }

    setProperty(propName: string, stringValue: string): true | SetPropertyResult {
        if (propName === 'Value') {
            const parsed = MatlabValueParser.parse(stringValue);
            if (!parsed) {
                return { error: true, reason: 'Invalid MATLAB expression', invalidValue: stringValue, validValue: this.displayValue };
            }
            // MATLAB rejects cell arrays as Parameter.Value (R2027a probe).
            if (parsed.type === 'cell') {
                return {
                    error: true,
                    reason: 'Invalid value specified for parameter. Value must be a numeric array, fi object, enumerated value, structure whose fields contain valid values, string scalar, or an expression.',
                    invalidValue: stringValue,
                    validValue: this.displayValue,
                };
            }
            if ((parsed.type === 'double' && Array.isArray(parsed.value)) || parsed.type === 'string-array') {
                let rawValue: unknown;
                if (parsed.type === 'string-array') {
                    rawValue = { _array_type: 'String', _dimensions: parsed.dims, _elements: parsed.value };
                } else if (parsed.dims && parsed.dims[0] > 1) {
                    const rows = parsed.dims[0];
                    const cols = parsed.dims[1];
                    const rowStrs: string[] = [];
                    for (let r = 0; r < rows; r++) {
                        const vals: string[] = [];
                        for (let c = 0; c < cols; c++) { vals.push(String((parsed.value as number[])[r * cols + c])); }
                        rowStrs.push('[' + vals.join(', ') + ']');
                    }
                    rawValue = { _type: 'double', _value: 'Matrix(' + rows + ',' + cols + ')\n' + rowStrs.join('\n') };
                } else {
                    rawValue = parsed.value;
                }
                const childNode = NodeRegistry.parseValue(rawValue, 'Value', this);
                this.children = [];
                this.addChild(childNode);
                this.Value = parsed.value;
                this._markModified();
                return true;
            }
            if (parsed.type === 'complex') {
                const rawValue = { _type: 'cdata', _value: parsed.value };
                const childNode = NodeRegistry.parseValue(rawValue, 'Value', this);
                this.children = [];
                this.addChild(childNode);
                this.Value = parsed.value;
                this._markModified();
                return true;
            }
            this.children = [];
            this.Value = parsed.value;
            this._markModified();
            return true;
        }
        if (propName === 'Min' || propName === 'Max') {
            return this._setMinMax(propName, stringValue);
        }
        return DataNode.prototype.setProperty.call(this, propName, stringValue);
    }

    _getSerializedProperties(): Record<string, unknown> {
        let innerValue: unknown;
        if (this.children.length > 0) {
            innerValue = (this.children[0] as DataNode).serializeValue();
        } else {
            innerValue = this.Value;
        }
        const props = Object.assign({}, this.serial._properties as Record<string, unknown>);
        if (innerValue !== undefined) { props.Value = innerValue; }
        if ('Min' in (this.serial._properties as Record<string, unknown>) || this.Min !== undefined) {
            props.Min = this.Min !== undefined ? this.Min : this._rawMin;
        }
        if ('Max' in (this.serial._properties as Record<string, unknown>) || this.Max !== undefined) {
            props.Max = this.Max !== undefined ? this.Max : this._rawMax;
        }
        if ('DocUnits' in (this.serial._properties as Record<string, unknown>) || this.Unit) { props.DocUnits = this.Unit; }
        if ('Description' in (this.serial._properties as Record<string, unknown>) || this.Description) { props.Description = this.Description; }
        return props;
    }

    serializeValue(): unknown {
        const props = this._getSerializedProperties();
        const result = Object.assign({}, this.serial._rawVal as Record<string, unknown>);
        result._elements = [Object.assign({}, (result._elements as unknown[])[0] as Record<string, unknown>, { _properties: props })];
        return result;
    }

    serializeXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string {
        return this._serializeSimulinkObjectXml(tagName, attrs, indent);
    }

    static get defaultName(): string { return 'Param'; }

    static createDefault(name: string, parent: BaseNode | null): ParameterNode {
        const rawVal = {
            _array_class: CLASS_NAME,
            _array_type: 'MATLABArray',
            _dimensions: [1, 1],
            _mw_element_type: 'MATLABArray',
            _elements: [{ _properties: { CoderInfo: { _object_class: 'Simulink.CoderInfo', _properties: { CSCPackageName: 'Simulink', CustomAttributes: { _object_class: 'SimulinkCSC.AttribClass_Simulink_Default', _properties: {} }, CustomStorageClass: 'Default', ParameterOrSignal: 'Parameter', StorageClass: 'Auto' } }, Complexity: 'real', Dimensions: -1, Value: 0 } }]
        };
        const props = rawVal._elements[0]._properties;
        const serial = { _rawVal: rawVal, _properties: props };
        return new ParameterNode(name, parent, props as unknown as Record<string, unknown>, serial as unknown as Record<string, unknown>);
    }

    static _normalizeMinMax(val: unknown): number | undefined {
        if (Array.isArray(val) && val.length === 0) { return undefined; }
        return val as number | undefined;
    }

    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): ParameterNode {
        const elem = rawVal._elements && (rawVal._elements as unknown[])[0];
        const props = ((elem && (elem as Record<string, unknown>)._properties) || {}) as Record<string, unknown>;
        const serial = { _rawVal: rawVal, _properties: props };
        const node = new ParameterNode(name, parent, props, serial as Record<string, unknown>);
        if (props.Value && typeof props.Value === 'object' && !(Array.isArray(props.Value) && (props.Value as unknown[]).length === 0)) {
            const childNode = NodeRegistry.parseValue(props.Value, 'Value', node);
            node.addChild(childNode);
        }
        return node;
    }
}
