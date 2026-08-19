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

export default class StructNode extends DataNode {
    _isElementNode?: boolean;

    get icon(): string {
        return 'wsTree';
    }

    get className(): string {
        return 'struct';
    }

    // 'struct' is a real data type, so it belongs in the DataType column.
    get dataType(): string {
        return this.className;
    }

    // A struct is a MATLAB variable, like scalars/arrays/cells.
    get kind(): string {
        return 'MATLAB Variable';
    }

    get displayValue(): string {
        const d = (this.serial._dimensions as number[]) || [1, 1];
        return '<' + d.join('x') + ' struct>';
    }

    getProperties(): PropClass[] {
        return [PropName, PropValue, PropDataType, PropDescription];
    }

    getPILayout(): PIGroupDef[] {
        // className is the data type 'struct' (shared with plain struct variables),
        // so this can't be schema-keyed; author the common "General" group directly.
        return [
            { group: 'General', items: [PropName, PropValue, PropDataType, PropKind, PropClassAtom, PropDescription] }
        ];
    }

    serializeElement(): Record<string, unknown> {
        const fields = (this.serial._fields as string[]) || [];
        const elem: Record<string, unknown> = {};
        fields.forEach((field) => {
            const child = this.children.find((c) => c.name === field);
            elem[field] = child ? (child as DataNode).serializeValue() : undefined;
        });
        return elem;
    }

    serializeValue(): unknown {
        if (this._rawInput !== undefined && this.status !== 'Modified') {
            return this._rawInput;
        }
        const d = (this.serial._dimensions as number[]) || [1, 1];
        const numElems = d[0] * d[1];
        const fields = (this.serial._fields as string[]) || [];

        if (this._isElementNode) {
            return this.serializeElement();
        }

        const elements: Record<string, unknown>[] = [];
        if (numElems > 1) {
            this.children.forEach((elemNode) => {
                elements.push((elemNode as StructNode).serializeValue() as Record<string, unknown>);
            });
        } else {
            elements.push(this.serializeElement());
        }

        const result: Record<string, unknown> = {
            _array_type: 'Struct',
            _dimensions: d,
            _elements: elements
        };
        if (this.serial._fields) {
            result._fields = fields;
        }
        result._mw_element_type = (this.serial._mw_element_type as string) || 'MATLABArray';
        return result;
    }

    serializeXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string {
        const p = xmlPad(indent);
        const d = (this.serial._dimensions as number[]) || [1, 1];
        let attrStr = '';
        if (attrs && attrs.Name) { attrStr += ' Name="' + escapeXml(attrs.Name) + '"'; }

        if (this._isElementNode) {
            let xml = p + '<Element>\n';
            for (const child of this.children) {
                xml += (child as DataNode).serializeXml('P', { Name: child.name }, indent + 1) + '\n';
            }
            xml += p + '</Element>';
            return xml;
        }

        const dimAttr = (d[0] === 1 && d[1] === 1) ? '' : ' Dimension="' + d[0] + '*' + d[1] + '"';
        let xml = p + '<' + tagName + attrStr + ' Class="struct"' + dimAttr + '>\n';
        const numElems = d[0] * d[1];
        if (numElems > 1) {
            for (const elemNode of this.children) {
                xml += (elemNode as DataNode).serializeXml('Element', {}, indent + 1) + '\n';
            }
        } else {
            xml += xmlPad(indent + 1) + '<Element>\n';
            for (const child of this.children) {
                xml += (child as DataNode).serializeXml('P', { Name: child.name }, indent + 2) + '\n';
            }
            xml += xmlPad(indent + 1) + '</Element>\n';
        }
        xml += p + '</' + tagName + '>';
        return xml;
    }

    canRemoveChild(): boolean {
        const d = (this.serial._dimensions as number[]) || [1, 1];
        return d[0] === 1 && d[1] === 1 && !this._isElementNode && this.children.length > 0;
    }

    removeChildNode(child: BaseNode): void {
        const idx = this.children.indexOf(child);
        if (idx < 0) { return; }
        this.removeChild(child);
        if (this.serial._fields) {
            const fields = this.serial._fields as string[];
            const fieldIdx = fields.indexOf(child.name);
            if (fieldIdx >= 0) {
                fields.splice(fieldIdx, 1);
            }
        }
        this._markModified();
    }

    restoreChildNode(child: BaseNode, index: number): void {
        this.children.splice(index, 0, child);
        child.parent = this;
        if (this.serial._fields) {
            (this.serial._fields as string[]).splice(index, 0, child.name);
        }
        this._markModified();
    }

    canAddChild(): boolean {
        const d = (this.serial._dimensions as number[]) || [1, 1];
        return d[0] === 1 && d[1] === 1 && !this._isElementNode;
    }

    addChildNode(): DataNode {
        const baseName = 'field';
        const existing = new Set(this.children.map((c) => c.name));
        let uniqueName = baseName;
        let i = 1;
        while (existing.has(uniqueName)) {
            uniqueName = baseName + i;
            i++;
        }
        const childNode = NodeRegistry.parseValue(0, uniqueName, this);
        this.addChild(childNode);
        if (!this.serial._fields) {
            this.serial._fields = [];
        }
        (this.serial._fields as string[]).push(uniqueName);
        this._markModified();
        return childNode;
    }

    execAddChild(): { node: DataNode; undo: () => void; redo: () => void } | null {
        if (!this.canAddChild()) { return null; }
        const child = this.addChildNode();
        if (!child) { return null; }
        const index = this.children.indexOf(child);
        return {
            node: child,
            undo: () => { this.removeChildNode(child); },
            redo: () => { this.restoreChildNode(child, index); }
        };
    }

    execRemoveChild(child: BaseNode): { undo: () => void; redo: () => void } | null {
        if (!this.canRemoveChild()) { return null; }
        const index = this.children.indexOf(child);
        if (index < 0) { return null; }
        this.removeChildNode(child);
        return {
            undo: () => { this.restoreChildNode(child, index); },
            redo: () => { this.removeChildNode(child); }
        };
    }

    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): StructNode {
        const serial: Record<string, unknown> = {
            _dimensions: rawVal._dimensions,
            _fields: rawVal._fields,
            _mw_element_type: rawVal._mw_element_type
        };
        const node = new StructNode(name, parent, serial);
        node._rawInput = rawVal;
        const fields = (rawVal._fields as string[]) || [];
        const elements = (rawVal._elements as Record<string, unknown>[]) || [];

        if (elements.length > 1) {
            const dims = (rawVal._dimensions as number[]) || [1, elements.length];
            const rows = dims[0];
            const cols = dims[1];
            const isMatrix = rows > 1 && cols > 1;
            elements.forEach((elem, ei) => {
                const elemSerial: Record<string, unknown> = {
                    _dimensions: [1, 1],
                    _fields: fields,
                    _mw_element_type: rawVal._mw_element_type
                };
                const elemNode = new StructNode(String(ei), node, elemSerial);
                elemNode._isElementNode = true;
                elemNode._displayName = isMatrix
                    ? name + '(' + (Math.floor(ei / cols) + 1) + ',' + (ei % cols + 1) + ')'
                    : name + '(' + (ei + 1) + ')';
                fields.forEach((field) => {
                    const childNode = NodeRegistry.parseValue(elem[field], field, elemNode);
                    elemNode.addChild(childNode);
                });
                node.addChild(elemNode);
            });
        } else if (elements.length === 1) {
            fields.forEach((field) => {
                const childNode = NodeRegistry.parseValue(elements[0][field], field, node);
                node.addChild(childNode);
            });
        }

        return node;
    }

    static get defaultName(): string { return 'Struct'; }

    static createDefault(name: string, parent: BaseNode | null): StructNode {
        const rawVal: Record<string, unknown> = {
            _array_type: 'Struct',
            _dimensions: [1, 1],
            _num_fields: 0,
            _field_names: [],
            _elements: [{}]
        };
        return StructNode.parse(rawVal, name, parent);
    }
}
