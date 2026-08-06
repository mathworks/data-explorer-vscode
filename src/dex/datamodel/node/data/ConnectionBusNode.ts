// Copyright 2026 The MathWorks, Inc.

import { BaseBusNode, BaseBusElementNode, PropName, PropDataType, PropDescription } from './BaseBusNode';
import type { PropClass } from '../BaseNode';
import type BaseNode from '../BaseNode';

const CLASS_NAME = 'Simulink.ConnectionBus';

// The default connection type when a physical element has no explicit domain.
const DEFAULT_CONNECTION_TYPE = 'Connection: <domain name>';

export class ConnectionBusElementNode extends BaseBusElementNode {
    Type: string;

    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) {
        super(name, parent, props, serial);
        // The element's connection type is stored in Type_internal (falling back
        // to Type); when unset it is the generic 'Connection: <domain name>'.
        const rawType = props.Type_internal !== undefined ? props.Type_internal : props.Type;
        this.Type = (rawType as string) || DEFAULT_CONNECTION_TYPE;
    }

    get icon(): string { return 'typeConnectionElement'; }
    get dataType(): string { return this.Type; }
    getProperties(): PropClass[] { return [PropName, PropDataType, PropDescription]; }
    getPILayout() { return [{ group: 'Element Properties', items: [PropName, PropDataType, PropDescription] }]; }

    _applyElementOverrides(props: Record<string, unknown>): void {
        const sp = this.serial._properties as Record<string, unknown>;
        const typeKey = 'Type_internal' in sp ? 'Type_internal' : 'Type';
        // Only write the type back when the source had it or it differs from the
        // implicit default, so untyped elements stay untouched.
        if (typeKey in sp || this.Type !== DEFAULT_CONNECTION_TYPE) { props[typeKey] = this.Type; }
        if ('Description' in sp || this.Description) { props.Description = this.Description; }
    }
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
