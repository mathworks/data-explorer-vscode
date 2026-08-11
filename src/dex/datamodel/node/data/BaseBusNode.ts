// Copyright 2026 The MathWorks, Inc.

import DataNode from '../DataNode';
import type { PropClass } from '../BaseNode';
import type BaseNode from '../BaseNode';
import PropName from '../../prop/PropName';
import PropDataType from '../../prop/PropDataType';
import PropDescription from '../../prop/PropDescription';

export class BaseBusElementNode extends DataNode {
    Description: string;

    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) {
        super(name, parent, serial);
        this.Description = (props.Description as string) || '';
    }

    get icon(): string { return 'typeBusElement'; }
    get displayValue(): string { return ''; }
    get disabled(): boolean { return true; }

    serializeValue(): unknown {
        const props = Object.assign({}, this.serial._properties as Record<string, unknown>);
        props.Name = this.name;
        this._applyElementOverrides(props);
        return Object.assign({}, this.serial._rawElem as Record<string, unknown>, { _properties: props });
    }

    _applyElementOverrides(props: Record<string, unknown>): void {
        if ('Description' in (this.serial._properties as Record<string, unknown>) || this.Description) { props.Description = this.Description; }
    }
}

export class BaseBusNode extends DataNode {
    Description: string;

    constructor(name: string, parent: BaseNode | null, serial: Record<string, unknown>) {
        super(name, parent, serial);
        this.Description = '';
    }

    get icon(): string { return this.isDerived ? 'typeBus' : 'wsBus'; }
    get displayValue(): string { return ''; }
    get valueEditable(): boolean { return false; }

    getProperties(): PropClass[] { return [PropName, PropDataType, PropDescription]; }
    getPILayout() { return [{ group: 'Data Properties', items: [PropName, PropDataType, PropDescription] }]; }

    _getSerializedProperties(): Record<string, unknown> {
        const elementsInternal = this.children.map(function (child) { return (child as BaseBusElementNode).serializeValue(); });
        const props = Object.assign({}, this.serial._properties as Record<string, unknown>);
        const rawEI = (this.serial._properties as Record<string, unknown>).Elements_internal;
        if (rawEI && typeof rawEI === 'object' && !Array.isArray(rawEI)) {
            // Preserve the source's Elements_internal metadata but re-derive both
            // _elements and _dimensions from the live children, so adding or
            // removing an element keeps the column-vector dimension in sync.
            props.Elements_internal = Object.assign({}, rawEI as Record<string, unknown>, { _elements: elementsInternal, _dimensions: [elementsInternal.length, 1] });
        } else if (elementsInternal.length > 0) {
            props.Elements_internal = { _array_class: (this.constructor as typeof BaseBusNode).ELEMENT_CLASS_NAME, _dimensions: [elementsInternal.length, 1], _elements: elementsInternal, _mw_element_type: 'MATLABArray' };
        }
        if ('Description' in (this.serial._properties as Record<string, unknown>) || this.Description) { props.Description = this.Description; }
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

    addChildNode(): BaseNode | null {
        const baseName = 'a';
        const existing = new Set(this.children.map(function (c) { return c.name; }));
        let uniqueName = baseName;
        let i = 1;
        while (existing.has(uniqueName)) { uniqueName = baseName + i; i++; }
        const props = { Name: uniqueName };
        const childSerial = { _rawElem: { _id: this._nextElementId(), _properties: props }, _properties: props };
        const childNode = this._createElementNode(uniqueName, props as Record<string, unknown>, childSerial as Record<string, unknown>);
        if (childNode) { this.addChild(childNode); this._markModified(); }
        return childNode;
    }

    // Allocate a unique element _id within this bus's id namespace. Elements and
    // the bus wrapper share one entry-scoped numbering (bus="1", elements "2",
    // "3", ...); pick one past the highest existing id so a new element never
    // collides with the wrapper or a sibling.
    _nextElementId(): string {
        let max = 0;
        const consider = function (id: unknown): void {
            const n = typeof id === 'string' ? parseInt(id, 10) : typeof id === 'number' ? id : NaN;
            if (Number.isFinite(n) && n > max) { max = n; }
        };
        const wrapper = ((this.serial._rawVal as Record<string, unknown> | undefined)?._elements as Record<string, unknown>[] | undefined)?.[0];
        if (wrapper) { consider(wrapper._id); }
        this.children.forEach(function (c) {
            const rawElem = (c as BaseBusElementNode).serial._rawElem as Record<string, unknown> | undefined;
            if (rawElem) { consider(rawElem._id); }
        });
        return String(max + 1);
    }

    execAddChild(): unknown {
        if (!this.canAddChild()) { return null; }
        const child = this.addChildNode();
        if (!child) { return null; }
        const self = this;
        const index = this.children.indexOf(child);
        return { node: child, undo() { self.removeChildNode(child); }, redo() { self.restoreChildNode(child, index); } };
    }

    execRemoveChild(child?: BaseNode): unknown {
        if (!this.canRemoveChild() || !child) { return null; }
        const index = this.children.indexOf(child);
        if (index < 0) { return null; }
        this.removeChildNode(child);
        const self = this;
        return { undo() { self.restoreChildNode(child, index); }, redo() { self.removeChildNode(child); } };
    }

    _createElementNode(_name: string, _props: Record<string, unknown>, _serial: Record<string, unknown>): BaseNode | null { return null; }

    static ELEMENT_CLASS_NAME = '';

    static _parseElements(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null, BusNodeClass: new (name: string, parent: BaseNode | null, serial: Record<string, unknown>) => BaseBusNode, ElementNodeClass: new (name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) => BaseBusElementNode): BaseBusNode {
        const elem = rawVal._elements && (rawVal._elements as unknown[])[0];
        const props = ((elem && (elem as Record<string, unknown>)._properties) || {}) as Record<string, unknown>;
        const serial = { _rawVal: rawVal, _properties: props };
        const node = new BusNodeClass(name, parent, serial as Record<string, unknown>);
        node.Description = (props.Description as string) || '';
        const busElements = props.Elements_internal as Record<string, unknown> | undefined;
        if (busElements && (busElements as Record<string, unknown>)._elements) {
            ((busElements as Record<string, unknown>)._elements as Record<string, unknown>[]).forEach(function (busElem) {
                const childProps = (busElem._properties as Record<string, unknown>) || {};
                const elemName = (childProps.Name as string) || '';
                const childSerial = { _rawElem: busElem, _properties: childProps };
                const childNode = new ElementNodeClass(elemName, node, childProps, childSerial as Record<string, unknown>);
                node.addChild(childNode);
            });
        } else if (busElements && (busElements as Record<string, unknown>)._properties) {
            const childProps = (busElements as Record<string, unknown>)._properties as Record<string, unknown>;
            const elemName = (childProps.Name as string) || '';
            const childSerial = { _rawElem: busElements, _properties: childProps };
            const childNode = new ElementNodeClass(elemName, node, childProps, childSerial as Record<string, unknown>);
            node.addChild(childNode);
        }
        return node;
    }

    static _createDefaultBus(name: string, parent: BaseNode | null, BusNodeClass: new (name: string, parent: BaseNode | null, serial: Record<string, unknown>) => BaseBusNode, className: string): BaseBusNode {
        let defaultProps: Record<string, unknown>;
        if (className === 'Simulink.Bus') { defaultProps = { DataScope: 'Auto', Description: '', Elements_internal: [], HeaderFile: '', PreserveElementDimensions: false }; }
        else if (className === 'Simulink.ConnectionBus') { defaultProps = { Description: '', Elements_internal: [] }; }
        else if (className === 'Simulink.ServiceBus') { defaultProps = { Description: '', Elements_internal: [] }; }
        else { defaultProps = {}; }
        const rawVal = { _array_class: className, _array_type: 'MATLABArray', _dimensions: [1, 1], _mw_element_type: 'MATLABArray', _elements: [{ _properties: defaultProps }] };
        const props = rawVal._elements[0]._properties;
        const serial = { _rawVal: rawVal, _properties: props };
        return new BusNodeClass(name, parent, serial as unknown as Record<string, unknown>);
    }
}

export { PropName, PropDataType, PropDescription };
export default { BaseBusNode, BaseBusElementNode, PropName, PropDataType, PropDescription };
