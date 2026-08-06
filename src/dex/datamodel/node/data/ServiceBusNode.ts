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
    get dataType(): string { return 'Simulink.FunctionElement'; }
    // A function element has no meaningful data type — the DataType column is
    // empty (not applicable).
    get displayDataType(): string { return ''; }
    get displayValue(): string { return this.Prototype; }
    getProperties(): PropClass[] { return [PropName, PropDataType, PropDescription]; }
    getPILayout() { return [{ group: 'Element Properties', items: [PropName, PropDataType, PropDescription] }]; }
}

export class ServiceBusNode extends BaseBusNode {
    // A derived ServiceBus is an Architectural Data ServiceInterface.
    get icon(): string { return this.isDerived ? 'serviceInterfaces' : 'wsDefault'; }
    get dataType(): string { return CLASS_NAME; }
    // A service interface has no scalar value — the Value column is empty and not
    // editable, matching the other bus-like interface types.
    get displayValue(): string { return ''; }
    get valueEditable(): boolean { return false; }
    _createElementNode(name: string, props: Record<string, unknown>, serial: Record<string, unknown>): FunctionElementNode { return new FunctionElementNode(name, this, props, serial); }
    static ELEMENT_CLASS_NAME = 'Simulink.FunctionElement';
    static get defaultName(): string { return 'ServiceInterface'; }
    static createDefault(name: string, parent: BaseNode | null): ServiceBusNode { return BaseBusNode._createDefaultBus(name, parent, ServiceBusNode, CLASS_NAME) as ServiceBusNode; }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): ServiceBusNode { return BaseBusNode._parseElements(rawVal, name, parent, ServiceBusNode, FunctionElementNode) as ServiceBusNode; }
}

export default { ServiceBusNode, FunctionElementNode };
