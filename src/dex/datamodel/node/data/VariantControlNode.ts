// Copyright 2026 The MathWorks, Inc.
import DataNode, { type SetPropertyResult } from '../DataNode';
import type { PropClass } from '../BaseNode';
import type BaseNode from '../BaseNode';
import PropName from '../../prop/PropName';
import PropValue from '../../prop/PropValue';
import PropDataType from '../../prop/PropDataType';

const CLASS_NAME = 'Simulink.VariantControl';

// Verbatim MATLAB R2027a rejection messages for Simulink.VariantControl.Value.
const MSG_INTEGER = 'Simulink.VariantControl value must be an integer, logical, an enumeration, or a Simulink.Parameter with value of type integer, logical or enumeration.';
const MSG_SCALAR = 'Simulink.VariantControl value must be a scalar or a Simulink.Parameter with scalar value.';

export default class VariantControlNode extends DataNode {
    Value: unknown;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) { super(name, parent, serial); this.Value = props.Value !== undefined ? props.Value : ''; }
    get icon(): string { return 'twoConnected_wsDefault'; }
    get className(): string { return CLASS_NAME; }
    get displayValue(): string { return PropValue.format(this.Value); }
    getProperties(): PropClass[] { return [PropName, PropValue, PropDataType]; }
    // PI layout: inherited BaseNode.getPILayout → buildPILayout drives the schema
    // "General" identity group (classes/variantControl.json).

    /**
     * Validate and apply a Value edit. MATLAB requires the Value to be an
     * integer-valued real scalar, a logical (true/false), or empty (''/'[]').
     * Our editor always delivers a string; we parse it and mirror the same
     * accept/reject logic MATLAB applies.
     */
    setProperty(propName: string, stringValue: string): true | SetPropertyResult {
        if (propName !== 'Value') {
            return super.setProperty(propName, stringValue);
        }
        const validValue = PropValue.format(this.Value);
        const trimmed = stringValue.trim();

        // Accept empty: '' or [] — MATLAB allows both.
        if (trimmed === '' || trimmed === "''" || trimmed === '[]') {
            this.Value = trimmed === '[]' ? null : '';
            this._markModified();
            return true;
        }

        // Accept logical literals.
        if (trimmed === 'true' || trimmed === 'false') {
            this.Value = trimmed === 'true' ? true : false;
            this._markModified();
            return true;
        }

        // Reject Inf/-Inf/NaN keywords explicitly (MATLAB notation). JS Number()
        // converts "Infinity"/"-Infinity" to Infinity but "Inf"/"-Inf"/"NaN" to NaN,
        // so we catch them before the generic parse.
        if (/^-?Inf(inity)?$/i.test(trimmed) || /^NaN$/i.test(trimmed)) {
            return { error: true, reason: MSG_INTEGER, invalidValue: stringValue, validValue };
        }

        // Attempt numeric parse. Non-numeric text fails Number() → NaN.
        const num = Number(trimmed);
        if (Number.isNaN(num)) {
            // Text / unparseable → MATLAB gives the scalar message (same as
            // 'text', 'double', 'int32', {1,2} in the probe).
            return { error: true, reason: MSG_SCALAR, invalidValue: stringValue, validValue };
        }

        // Reject Infinity/-Infinity that slipped through (e.g. very large exponent).
        if (!Number.isFinite(num)) {
            return { error: true, reason: MSG_INTEGER, invalidValue: stringValue, validValue };
        }

        // Reject non-integer (e.g. 1.5) — MATLAB: integer message.
        if (!Number.isInteger(num)) {
            return { error: true, reason: MSG_INTEGER, invalidValue: stringValue, validValue };
        }

        // Reject array-like syntax: "[1 2 3]", "[1,2]", "[1 2;3 4]".
        // These parse as NaN via Number() so they're already caught above, but an
        // explicit single-element bracket like "[5]" would parse to NaN too — also
        // caught. This comment documents the reasoning.

        // Accept: integer-valued real scalar.
        this.Value = num;
        this._markModified();
        return true;
    }

    _getSerializedProperties(): Record<string, unknown> { const props = Object.assign({}, this.serial._properties as Record<string, unknown>); props.Value = this.Value; return props; }
    serializeValue(): unknown { return this._serializeSimulinkObject({ Value: this.Value }); }
    static get defaultName(): string { return 'VariantControl'; }
    static createDefault(name: string, parent: BaseNode | null): VariantControlNode { const rawVal = { _array_class: CLASS_NAME, _array_type: 'MATLABArray', _dimensions: [1, 1], _mw_element_type: 'MATLABArray', _elements: [{ _properties: { Value: '' } }] }; const props = rawVal._elements[0]._properties; const serial = { _rawVal: rawVal, _properties: props }; return new VariantControlNode(name, parent, props as unknown as Record<string, unknown>, serial as unknown as Record<string, unknown>); }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): VariantControlNode { const elem = rawVal._elements && (rawVal._elements as unknown[])[0]; const props = ((elem && (elem as Record<string, unknown>)._properties) || {}) as Record<string, unknown>; const serial = { _rawVal: rawVal, _properties: props }; return new VariantControlNode(name, parent, props, serial as Record<string, unknown>); }
}
