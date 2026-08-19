// Copyright 2026 The MathWorks, Inc.

import DataNode from '../DataNode';
import * as NodeRegistry from '../NodeRegistry';
import type BaseNode from '../BaseNode';
import type { PropClass, PIGroupDef } from '../BaseNode';
import PropName from '../../prop/PropName';
import PropValue from '../../prop/PropValue';
import PropDataType from '../../prop/PropDataType';
import PropDescription from '../../prop/PropDescription';
import PropKind from '../../prop/PropKind';
import PropClassAtom from '../../prop/PropClass';
import { escapeXml, pad as xmlPad } from '../../parser/XmlUtils';

export default class ObjectNode extends DataNode {
    arrayClass: string;
    // True when this node's children are ARRAY ELEMENTS (each an ObjectNode named
    // `name(i)`), not class properties — set for a multi-element object array so the
    // serialize path rebuilds N `_elements` rather than treating the element rows as
    // properties keyed "0","1",…
    _isElementArray?: boolean;

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
        // Object nodes carry a dynamic className (the MATLAB class), so they can't
        // be schema-keyed; author the common "General" identity group directly to
        // match the schema-driven classes.
        return [
            { group: 'General', items: [PropName, PropValue, PropDataType, PropKind, PropClassAtom, PropDescription] }
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
        // Object ARRAY: each child is a scalar element node (an ObjectNode for a
        // custom class, or a typed node like ParameterNode for a known one). Rebuild
        // one `_elements` entry per element from its own serialized value, preserving
        // the array wrapper. A typed node serializes as { _array_class,
        // _elements:[{_properties}] }; a nested ObjectNode as { _object_class,
        // _properties } — normalize both to a bare { _properties } array entry.
        if (this._isElementArray) {
            const elements = this.children.map((child) => {
                const elemVal = (child as DataNode).serializeValue() as Record<string, unknown>;
                let props: Record<string, unknown> = {};
                if (elemVal && Array.isArray(elemVal._elements) && elemVal._elements.length > 0) {
                    props = ((elemVal._elements[0] as Record<string, unknown>)._properties as Record<string, unknown>) ?? {};
                } else if (elemVal && elemVal._properties) {
                    props = elemVal._properties as Record<string, unknown>;
                }
                return { _properties: props };
            });
            return Object.assign({}, rawVal, { _elements: elements });
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

    // XML write-back. An object ARRAY emits one <Element Class="..."> per element
    // (with a Dimension attr) so a multi-element value round-trips; a scalar falls
    // back to DataNode's single-element form.
    serializeXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string {
        if (!this._isElementArray) {
            return super.serializeXml(tagName, attrs, indent);
        }
        const p = xmlPad(indent);
        const ip = xmlPad(indent + 1);
        const rawVal = (this.serial._rawVal as Record<string, unknown>) || {};
        const dims = (rawVal._dimensions as number[]) || [this.children.length, 1];
        let attrStr = '';
        if (attrs && attrs.Name) { attrStr += ' Name="' + escapeXml(attrs.Name) + '"'; }
        const dimAttr = ' Dimension="' + dims[0] + '*' + (dims[1] ?? 1) + '"';
        let xml = p + '<' + tagName + attrStr + dimAttr + '>\n';
        for (const child of this.children) {
            xml += ip + '<Element Class="' + escapeXml(this.arrayClass) + '">\n';
            const props = (child as ObjectNode)._getSerializedProperties();
            for (const [propName, propVal] of Object.entries(props)) {
                xml += DataNode.serializePropertyXml(propName, propVal, indent + 2, child as DataNode) + '\n';
            }
            xml += ip + '</Element>\n';
        }
        xml += p + '</' + tagName + '>';
        return xml;
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
        // in the tree like a struct.
        //   • Nested object ({ _object_class, _properties }): one scalar bag.
        //   • Top-level value object ({ _array_class, _elements }): a SCALAR (one
        //     element) expands its properties directly; an ARRAY (N elements, e.g. a
        //     20x1 Simulink.VariableUsage) expands one child ObjectNode per element,
        //     named `name(i)`, each of which then expands into its own property rows.
        if (rawVal._object_class) {
            ObjectNode._addPropertyChildren(node, rawVal._properties as Record<string, unknown>);
            return node;
        }
        const elements = (rawVal._elements as Record<string, unknown>[]) || [];
        if (elements.length > 1) {
            node._isElementArray = true;
            const dims = (rawVal._dimensions as number[]) || [1, elements.length];
            const rows = dims[0];
            const cols = dims[1];
            const isMatrix = rows > 1 && cols > 1;
            elements.forEach((elem, ei) => {
                // Each element is a SCALAR object of the same class. Route it back
                // through NodeRegistry as a single-element value object so a KNOWN
                // class (Simulink.Parameter, …) becomes its own typed node and an
                // unknown/custom class becomes a scalar ObjectNode — the same
                // dispatch a standalone scalar would take.
                const elemRaw = {
                    _array_class: arrayClass,
                    _array_type: 'MATLABArray',
                    _dimensions: [1, 1],
                    _mw_element_type: (rawVal._mw_element_type as string) || 'MATLABArray',
                    _elements: [{ _properties: (elem._properties as Record<string, unknown>) || {} }],
                };
                const elemNode = NodeRegistry.parseValue(elemRaw, String(ei), node) as DataNode;
                elemNode._displayName = isMatrix
                    ? name + '(' + (Math.floor(ei / cols) + 1) + ',' + ((ei % cols) + 1) + ')'
                    : name + '(' + (ei + 1) + ')';
                node.addChild(elemNode);
            });
        } else if (elements.length === 1) {
            ObjectNode._addPropertyChildren(node, elements[0]._properties as Record<string, unknown>);
        }
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
