// Copyright 2026 The MathWorks, Inc.

import type BaseNode from './BaseNode';
import type DataNode from './DataNode';

export interface NodeClassMapAPI {
    parseValue(rawVal: unknown, name: string, parent: BaseNode | null): DataNode;
    getClass(className: string): NodeClassType | null;
    getRegisteredClasses(): string[];
    // Reclass a just-parsed plain MATLAB variable as a Constant. SectionNode calls
    // this when an entry is derived (Architectural Data), so a Constant is modeled
    // by its own class without SectionNode importing it (avoids a cycle). Returns
    // the node unchanged if it isn't a plain MATLAB variable.
    wrapDerivedVariable(node: DataNode): DataNode;
}

export interface NodeClassType {
    parse(rawVal: unknown, name: string, parent: BaseNode | null): DataNode;
    createDefault?(name: string, parent: BaseNode | null): DataNode;
    defaultName?: string;
}

let classMap: NodeClassMapAPI | null = null;

export function init(map: NodeClassMapAPI): void {
    classMap = map;
}

export function parseValue(rawVal: unknown, name: string, parent: BaseNode | null): DataNode {
    return classMap!.parseValue(rawVal, name, parent);
}

export function getClass(className: string): NodeClassType | null {
    return classMap!.getClass(className);
}

export function getRegisteredClasses(): string[] {
    return classMap!.getRegisteredClasses();
}

export default { init, parseValue, getClass, getRegisteredClasses };
