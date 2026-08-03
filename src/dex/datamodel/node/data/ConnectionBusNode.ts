// Copyright 2026 The MathWorks, Inc.

import { BaseBusNode, BaseBusElementNode, PropName, PropDataType, PropDescription } from './BaseBusNode';
import type { PropClass } from '../BaseNode';
import type BaseNode from '../BaseNode';

const CLASS_NAME = 'Simulink.ConnectionBus';

export class ConnectionBusElementNode extends BaseBusElementNode {
    get dataType(): string { return 'Simulink.ConnectionElement'; }
    getProperties(): PropClass[] { return [PropName, PropDataType, PropDescription]; }
    getPILayout() { return [{ group: 'Element Properties', items: [PropName, PropDataType, PropDescription] }]; }
}

export class ConnectionBusNode extends BaseBusNode {
    get icon(): string { return this.isDerived ? 'typeConnection' : 'wsConnectionBus'; }
    get dataType(): string { return CLASS_NAME; }
    _createElementNode(name: string, props: Record<string, unknown>, serial: Record<string, unknown>): ConnectionBusElementNode { return new ConnectionBusElementNode(name, this, props, serial); }
    static ELEMENT_CLASS_NAME = 'Simulink.ConnectionElement';
    static get defaultName(): string { return 'ConnectionBus'; }
    static createDefault(name: string, parent: BaseNode | null): ConnectionBusNode { return BaseBusNode._createDefaultBus(name, parent, ConnectionBusNode, CLASS_NAME) as ConnectionBusNode; }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): ConnectionBusNode { return BaseBusNode._parseElements(rawVal, name, parent, ConnectionBusNode, ConnectionBusElementNode) as ConnectionBusNode; }
}

export default { ConnectionBusNode, ConnectionBusElementNode };
