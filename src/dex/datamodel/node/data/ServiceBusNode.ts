// Copyright 2026 The MathWorks, Inc.

import { BaseBusNode, BaseBusElementNode, PropName, PropDataType, PropDescription } from './BaseBusNode';
import type { PropClass } from '../BaseNode';
import type BaseNode from '../BaseNode';

const CLASS_NAME = 'Simulink.ServiceBus';

// A ServiceBus element is a Simulink.FunctionElement (one service function). The
// element name is the function name, and the Value column shows the function's
// Prototype (e.g. "y = f(u,v)").
export class FunctionElementNode extends BaseBusElementNode {
    Prototype: string;

    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) {
        super(name, parent, props, serial);
        this.Prototype = (props.Prototype as string) || '';
    }

    get icon(): string { return 'function'; }
    get className(): string { return 'Simulink.FunctionElement'; }
    // A function element has no meaningful data type — the DataType column is
    // empty (not applicable).
    get dataType(): string { return ''; }
    get displayValue(): string { return this.Prototype; }
    getProperties(): PropClass[] { return [PropName, PropDataType, PropDescription]; }
    getPILayout() { return [{ group: 'Element Properties', items: [PropName, PropDataType, PropDescription] }]; }
}

export class ServiceBusNode extends BaseBusNode {
    // A derived ServiceBus is an Architectural Data ServiceInterface.
    get icon(): string { return this.isDerived ? 'serviceInterfaces' : 'wsDefault'; }
    get className(): string { return CLASS_NAME; }
    // A service interface has no scalar value — the Value column is empty and not
    // editable, matching the other bus-like interface types.
    get displayValue(): string { return ''; }
    get valueEditable(): boolean { return false; }
    _createElementNode(name: string, props: Record<string, unknown>, serial: Record<string, unknown>): FunctionElementNode { return new FunctionElementNode(name, this, props, serial); }

    // Add a new service function. Unlike a plain bus element, a
    // Simulink.FunctionElement carries a Prototype ("y = fn(u,v)") and an
    // Arguments BusElement array [u, v, y]. The function name fn uses an
    // increasing number so it stays unique, and the element plus each argument
    // get fresh entry-scoped _ids (past every id already in use, including the
    // nested argument ids of sibling functions).
    addChildNode(): FunctionElementNode {
        const existing = new Set(this.children.map(function (c) { return c.name; }));
        let n = this.children.length; let fnName = 'f' + n;
        while (existing.has(fnName)) { n++; fnName = 'f' + n; }
        const prototype = 'y = ' + fnName + '(u,v)';
        let id = this._maxElementId();
        const elemId = String(++id);
        const argNames = ['u', 'v', 'y'];
        const argElements = argNames.map(function (argName) {
            return { _id: String(++id), _properties: { Complexity: 'real', Dimensions: 1, DimensionsMode: 'Fixed', DocUnits: '', Name: argName } };
        });
        const props: Record<string, unknown> = {
            Arguments: { _array_class: 'Simulink.BusElement', _dimensions: [argElements.length, 1], _elements: argElements },
            Asynchronous: false,
            Name: fnName,
            Prototype: prototype,
        };
        const childSerial = { _rawElem: { _id: elemId, _properties: props }, _properties: props };
        const childNode = new FunctionElementNode(fnName, this, props, childSerial as Record<string, unknown>);
        this.addChild(childNode);
        this._markModified();
        return childNode;
    }

    static ELEMENT_CLASS_NAME = 'Simulink.FunctionElement';
    static get defaultName(): string { return 'ServiceInterface'; }
    static createDefault(name: string, parent: BaseNode | null): ServiceBusNode { return BaseBusNode._createDefaultBus(name, parent, ServiceBusNode, CLASS_NAME) as ServiceBusNode; }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): ServiceBusNode { return BaseBusNode._parseElements(rawVal, name, parent, ServiceBusNode, FunctionElementNode) as ServiceBusNode; }
}

export default { ServiceBusNode, FunctionElementNode };
