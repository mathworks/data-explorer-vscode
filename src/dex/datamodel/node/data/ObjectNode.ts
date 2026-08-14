// Copyright 2026 The MathWorks, Inc.

import DataNode from '../DataNode';
import * as NodeRegistry from '../NodeRegistry';
import type BaseNode from '../BaseNode';
import type { PropClass, PIGroupDef } from '../BaseNode';
import PropName from '../../prop/PropName';
import PropValue from '../../prop/PropValue';
import PropDataType from '../../prop/PropDataType';
import PropDescription from '../../prop/PropDescription';

export default class ObjectNode extends DataNode {
    arrayClass: string;

    constructor(name: string, parent: BaseNode | null, arrayClass: string, serial?: Record<string, unknown>) {
        super(name, parent, serial);
        this.arrayClass = arrayClass;
    }

    get icon(): string {
        // A derived Simulink.ServiceBus is an Architectural Data ServiceInterface;
        // give it the service-interface icon instead of the generic object one.
        if (this.isDerived && this.arrayClass === 'Simulink.ServiceBus') {
            return 'serviceInterfaces';
        }
        return 'wsDefault';
    }

    get className(): string {
        return this.arrayClass;
    }

    // This node's children are MATLAB class properties, whose names are fixed by
    // the class definition and therefore not renameable (see BaseNode).
    get isObjectPropertyBag(): boolean {
        return true;
    }

    get displayValue(): string {
        const raw = (this.serial._rawVal as Record<string, unknown>) || {};
        const d = (raw._dimensions as number[]) || [(raw._num_rows as number) || 1, (raw._num_columns as number) || 1];
        return '<' + d.join('x') + ' ' + this.arrayClass + '>';
    }

    getProperties(): PropClass[] {
        return [PropName, PropValue, PropDataType, PropDescription];
    }

    getPILayout(): PIGroupDef[] {
        return [
            { group: 'Properties', items: [PropName, PropValue, PropDataType, PropDescription] }
        ];
    }

    // Rebuild the object's serialized value from its LIVE child nodes so a property
    // edit writes back (issue #3). Without this the loaded `_rawVal` is emitted
    // verbatim and edits are silently discarded. An object with no expanded children
    // (an object array, or an empty object) has nothing to rebuild and keeps its raw
    // value unchanged.
    serializeValue(): unknown {
        const rawVal = (this.serial._rawVal as Record<string, unknown>) || {};
        if (this.children.length === 0) {
            return rawVal;
        }
        const props = this._getSerializedProperties();
        // Nested-object form { _id?, _object_class, _properties }: keep the identity
        // keys, replace only _properties.
        if (rawVal._object_class) {
            return Object.assign({}, rawVal, { _properties: props });
        }
        // Top-level value-object form { _array_class, _elements: [{ _id?, _properties }] }:
        // keep the wrapper and the element's identity keys, replace only _properties.
        const rawElements = (rawVal._elements as Record<string, unknown>[]) || [{}];
        const firstElem = Object.assign({}, rawElements[0], { _properties: props });
        return Object.assign({}, rawVal, { _elements: [firstElem] });
    }

    // The property bag rebuilt from live children, keyed by property name and in the
    // children's order. Each value is the child's own serialized form, so a nested
    // object/struct/cell edit recurses through the same path. Feeds both the JSON
    // (serializeValue) and XML (_serializeSimulinkObjectXml) write-back paths.
    _getSerializedProperties(): Record<string, unknown> {
        if (this.children.length === 0) {
            return Object.assign({}, this.serial._properties as Record<string, unknown>);
        }
        const props: Record<string, unknown> = {};
        for (const child of this.children) {
            props[child.name] = (child as DataNode).serializeValue();
        }
        return props;
    }

    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): ObjectNode {
        const serial = { _rawVal: rawVal };
        // Two shapes converge here (issue #3):
        //   • a top-level value object: { _array_class, _elements: [{ _properties }] }
        //   • a nested object property: { _object_class, _properties } (no _elements
        //     wrapper), reached when a struct field or cell element is itself an
        //     object. NodeRegistry dispatches both here so nested objects expand no
        //     matter where in the graph they sit.
        const arrayClass = (rawVal._object_class ?? rawVal._array_class) as string;
        const node = new ObjectNode(name, parent, arrayClass, serial);
        // Surface the object's serialized properties as child nodes so it expands
        // in the tree like a struct. Only a scalar object (a single element) is
        // expanded; object arrays keep the opaque leaf presentation.
        let properties: Record<string, unknown> | undefined;
        if (rawVal._object_class) {
            properties = rawVal._properties as Record<string, unknown>;
        } else {
            const elements = (rawVal._elements as Record<string, unknown>[]) || [];
            if (elements.length === 1) {
                properties = elements[0]._properties as Record<string, unknown>;
            }
        }
        ObjectNode._addPropertyChildren(node, properties);
        return node;
    }

    // Build a child node per serialized property. Every value — scalar, struct,
    // cell, string, or a nested { _object_class, _properties } object — routes
    // through NodeRegistry.parseValue, which now recognizes the nested-object shape
    // and dispatches it back to ObjectNode. This single path makes objects expand
    // recursively even when nested inside a struct field or a cell element.
    static _addPropertyChildren(node: ObjectNode, properties: Record<string, unknown> | undefined): void {
        if (!properties || typeof properties !== 'object') { return; }
        for (const propName of Object.keys(properties)) {
            const child = NodeRegistry.parseValue(properties[propName], propName, node);
            node.addChild(child);
        }
    }
}
