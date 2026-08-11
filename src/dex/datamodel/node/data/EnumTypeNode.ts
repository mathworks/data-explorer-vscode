// Copyright 2026 The MathWorks, Inc.

import DataNode from '../DataNode';
import type { PropClass } from '../BaseNode';
import type BaseNode from '../BaseNode';
import PropName from '../../prop/PropName';
import PropValue from '../../prop/PropValue';
import PropEnumValue from '../../prop/PropEnumValue';
import PropDataType from '../../prop/PropDataType';
import PropDescription from '../../prop/PropDescription';

const CLASS_NAME = 'Simulink.data.dictionary.EnumTypeDefinition';

export class EnumValueNode extends DataNode {
    Value: unknown;
    Description: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>) {
        super(name, parent, { _rawProps: props });
        this.Value = props.Value;
        this.Description = (props.Description as string) || '';
    }
    // The enumeral that the parent EnumType defaults to gets the "current" icon;
    // every other enumeral gets the plain bus-element icon. When the parent has no
    // DefaultValue set, the first enumeral is treated as the current one. A
    // derived (Architectural Data) enum uses the arch "current" icon; a plain
    // Design Data enum uses the workspace variant.
    get icon(): string {
        const parent = this.parent as EnumTypeNode | null;
        if (!parent) { return 'busElement'; }
        const isCurrent = parent.DefaultValue
            ? parent.DefaultValue === this.name
            : parent.children[0] === this;
        if (!isCurrent) { return 'busElement'; }
        return parent.isDerived ? 'typeElement' : 'wsElement';
    }
    get className(): string { return CLASS_NAME; }
    // An enumeral has no meaningful data type — the DataType column is empty
    // (not applicable).
    get dataType(): string { return ''; }
    get displayValue(): string { return this.Value !== undefined ? String(this.Value) : ''; }
    get disabled(): boolean { return true; }
    getProperties(): PropClass[] { return [PropName, PropValue, PropDescription]; }
    getPILayout() { return [{ group: 'Properties', items: [PropName, PropValue, PropDescription] }]; }
    serializeValue(): unknown {
        const raw = Object.assign({}, this.serial._rawProps as Record<string, unknown>);
        raw.Name = this.name; raw.Value = this.Value; raw.Description = this.Description;
        return raw;
    }
}

export class EnumTypeNode extends DataNode {
    DefaultValue: string;
    Description: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) {
        super(name, parent, serial);
        this.DefaultValue = (props.DefaultValue as string) || '';
        this.Description = (props.Description as string) || '';
    }
    get icon(): string { return this.isDerived ? 'typeEnum' : 'wsEnum'; }
    get className(): string { return CLASS_NAME; }
    // The Value column shows the enum's DefaultValue; when none is set it falls
    // back to the first enumeral's name (the same one marked "current" by the
    // child icon rule).
    get displayValue(): string {
        if (this.DefaultValue) { return this.DefaultValue; }
        return (this.children[0] && this.children[0].name) || '';
    }
    getProperties(): PropClass[] { return [PropName, PropEnumValue, PropDataType, PropDescription]; }
    getPILayout() { return [{ group: 'Data Properties', items: [PropName, PropEnumValue, PropDataType, PropDescription] }]; }

    _getSerializedProperties(): Record<string, unknown> {
        const enumerals = this.children.map(function (child) { return (child as EnumValueNode).serializeValue(); });
        const props = Object.assign({}, this.serial._properties as Record<string, unknown>);
        if ('DefaultValue' in (this.serial._properties as Record<string, unknown>) || this.DefaultValue) { props.DefaultValue = this.DefaultValue; }
        if ('Description' in (this.serial._properties as Record<string, unknown>) || this.Description) { props.Description = this.Description; }
        const rawEnumerals = (this.serial._rawEnumerals as Record<string, unknown>) || {};
        const enumWrapper: Record<string, unknown> = {};
        Object.keys(rawEnumerals).forEach(function (k) { if (k === '_elements') { enumWrapper._elements = enumerals; } else { enumWrapper[k] = rawEnumerals[k]; } });
        if (!('_elements' in rawEnumerals)) { enumWrapper._elements = enumerals; }
        // Keep _dimensions in sync with the enumeral count so adding or removing
        // one stays consistent. Enumerals are stored as a row-vector struct array.
        enumWrapper._dimensions = [1, enumerals.length];
        props.Enumerals = enumWrapper;
        return props;
    }

    serializeValue(): unknown {
        const props = this._getSerializedProperties();
        const result = Object.assign({}, this.serial._rawVal as Record<string, unknown>);
        result._elements = [Object.assign({}, (result._elements as unknown[])[0] as Record<string, unknown>, { _properties: props })];
        return result;
    }

    canRemoveChild(): boolean { return this.children.length > 0; }
    removeChildNode(child: BaseNode): void { this.removeChild(child); this._markModified(); }
    restoreChildNode(child: BaseNode, index: number): void { this.children.splice(index, 0, child); child.parent = this; this._markModified(); }
    canAddChild(): boolean { return true; }

    addChildNode(): BaseNode {
        const existing = new Set(this.children.map(function (c) { return c.name; }));
        let i = 1; let uniqueName = 'enum' + i;
        while (existing.has(uniqueName)) { i++; uniqueName = 'enum' + i; }
        // Enumeral values are stored as strings (e.g. "0", "1") to match the
        // source format, so the new value is stringified.
        const nextVal = String(this.children.length);
        const props = { Name: uniqueName, Value: nextVal, Description: '' };
        const childNode = new EnumValueNode(uniqueName, this, props);
        this.addChild(childNode); this._markModified();
        return childNode;
    }

    execAddChild(): unknown {
        if (!this.canAddChild()) { return null; }
        const child = this.addChildNode(); if (!child) { return null; }
        const self = this; const index = this.children.indexOf(child);
        return { node: child, undo() { self.removeChildNode(child); }, redo() { self.restoreChildNode(child, index); } };
    }

    execRemoveChild(child?: BaseNode): unknown {
        if (!this.canRemoveChild() || !child) { return null; }
        const index = this.children.indexOf(child); if (index < 0) { return null; }
        this.removeChildNode(child); const self = this;
        return { undo() { self.restoreChildNode(child, index); }, redo() { self.removeChildNode(child); } };
    }

    static get defaultName(): string { return 'EnumType'; }

    static createDefault(name: string, parent: BaseNode | null): EnumTypeNode {
        const enumerals = { _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ Description: '', Name: 'enum1', Value: '0' }], _fields: ['Name', 'Value', 'Description'] };
        const rawVal = { _array_class: CLASS_NAME, _array_type: 'MATLABArray', _dimensions: [1, 1], _mw_element_type: 'MATLABArray', _elements: [{ _properties: { Enumerals: enumerals } }] };
        const props = rawVal._elements[0]._properties;
        const serial = { _rawVal: rawVal, _properties: props, _rawEnumerals: enumerals };
        const node = new EnumTypeNode(name, parent, props as unknown as Record<string, unknown>, serial as unknown as Record<string, unknown>);
        const childProps = enumerals._elements[0];
        const childNode = new EnumValueNode('enum1', node, childProps as unknown as Record<string, unknown>);
        node.addChild(childNode);
        return node;
    }

    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): EnumTypeNode {
        const elem = rawVal._elements && (rawVal._elements as unknown[])[0];
        const props = ((elem && (elem as Record<string, unknown>)._properties) || {}) as Record<string, unknown>;
        const enumerals = ((props.Enumerals) || {}) as Record<string, unknown>;
        const serial = { _rawVal: rawVal, _properties: props, _rawEnumerals: enumerals };
        const node = new EnumTypeNode(name, parent, props, serial as Record<string, unknown>);
        if (enumerals._elements) {
            (enumerals._elements as Record<string, unknown>[]).forEach(function (en) {
                const enumName = (en.Name as string) || '';
                const childNode = new EnumValueNode(enumName, node, en);
                node.addChild(childNode);
            });
        }
        return node;
    }
}

export default { EnumTypeNode, EnumValueNode };
