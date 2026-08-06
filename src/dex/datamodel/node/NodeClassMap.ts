// Copyright 2026 The MathWorks, Inc.

import * as NodeRegistry from './NodeRegistry';
import type { NodeClassType } from './NodeRegistry';
import type BaseNode from './BaseNode';
import type DataNode from './DataNode';
import MatlabVariableNode from './data/MatlabVariableNode';
import StructNode from './data/StructNode';
import ObjectNode from './data/ObjectNode';
import ParameterNode from './data/ParameterNode';
import SignalNode from './data/SignalNode';
import { BusNode } from './data/BusNode';
import { ConnectionBusNode } from './data/ConnectionBusNode';
import { ServiceBusNode } from './data/ServiceBusNode';
import { EnumTypeNode } from './data/EnumTypeNode';
import AliasTypeNode from './data/AliasTypeNode';
import ConfigSetNode from './data/ConfigSetNode';
import VariantExpressionNode from './data/VariantExpressionNode';
import VariantVariableNode from './data/VariantVariableNode';
import LookupTableNode from './data/LookupTableNode';
import BreakpointNode from './data/BreakpointNode';
import NumericTypeNode from './data/NumericTypeNode';
import ValueTypeNode from './data/ValueTypeNode';
import VariantControlNode from './data/VariantControlNode';
import VariantBankNode from './data/VariantBankNode';
import VariantBankCoderInfoNode from './data/VariantBankCoderInfoNode';
import CustomObjectNode from './data/CustomObjectNode';
import ConfigSetRefNode from './data/ConfigSetRefNode';
import VariantConfigurationDataNode from './data/VariantConfigurationDataNode';
import { _injectNodeClassMap } from './container/SectionNode';

const CLASS_MAP: Record<string, NodeClassType> = {
    'MatlabVariable': MatlabVariableNode,
    'MatlabStruct': StructNode,
    'Simulink.Parameter': ParameterNode,
    'Simulink.LookupTable': LookupTableNode,
    'Simulink.Breakpoint': BreakpointNode,
    'Simulink.Signal': SignalNode,
    'Simulink.Bus': BusNode,
    'Simulink.ConnectionBus': ConnectionBusNode,
    'Simulink.ServiceBus': ServiceBusNode,
    'Simulink.NumericType': NumericTypeNode,
    'Simulink.AliasType': AliasTypeNode,
    'Simulink.ValueType': ValueTypeNode,
    'Simulink.data.dictionary.EnumTypeDefinition': EnumTypeNode,
    'Simulink.VariantExpression': VariantExpressionNode,
    'Simulink.VariantControl': VariantControlNode,
    'Simulink.VariantVariable': VariantVariableNode,
    'Simulink.VariantBank': VariantBankNode,
    'Simulink.VariantBankCoderInfo': VariantBankCoderInfoNode,
    'CustomObject': CustomObjectNode,
    'Simulink.ConfigSet': ConfigSetNode,
    'Simulink.ConfigSetRef': ConfigSetRefNode,
    'Simulink.VariantConfigurationData': VariantConfigurationDataNode
};

interface StructuralParser {
    matcher: (val: unknown) => boolean;
    NodeClass: NodeClassType;
}

const STRUCTURAL_PARSERS: StructuralParser[] = [
    { matcher: function (val) { return Array.isArray(val) && val.length > 0 && val.every(function (el) { return typeof el === 'string'; }); }, NodeClass: MatlabVariableNode },
    { matcher: function (val) { return val !== null && typeof val === 'object' && (val as Record<string, unknown>)._array_type === 'String'; }, NodeClass: MatlabVariableNode },
    { matcher: function (val) { return val !== null && typeof val === 'object' && (val as Record<string, unknown>)._array_type === 'Struct'; }, NodeClass: StructNode },
    { matcher: function (val) { return val !== null && typeof val === 'object' && (val as Record<string, unknown>)._array_type === 'Cell'; }, NodeClass: MatlabVariableNode },
    { matcher: function (val) { return val !== null && typeof val === 'object' && !!(val as Record<string, unknown>)._type && !!(val as Record<string, unknown>)._value && typeof (val as Record<string, unknown>)._value === 'string' && ((val as Record<string, unknown>)._value as string).indexOf('Matrix(') === 0; }, NodeClass: MatlabVariableNode },
    { matcher: function (val) { return Array.isArray(val); }, NodeClass: MatlabVariableNode },
    { matcher: function (val) { return val !== null && typeof val === 'object' && !!(val as Record<string, unknown>)._array_class; }, NodeClass: ObjectNode },
    { matcher: function (val) { return val === null || val === undefined || typeof val === 'number' || typeof val === 'boolean' || typeof val === 'string'; }, NodeClass: MatlabVariableNode }
];

export function getClass(className: string): NodeClassType | null {
    return CLASS_MAP[className] || null;
}

export function parseValue(rawVal: unknown, name: string, parent: BaseNode | null): DataNode {
    if (rawVal && typeof rawVal === 'object' && (rawVal as Record<string, unknown>)._array_class) {
        const NodeClass = CLASS_MAP[(rawVal as Record<string, unknown>)._array_class as string];
        if (NodeClass) {
            return NodeClass.parse(rawVal, name, parent);
        }
    }

    for (let i = 0; i < STRUCTURAL_PARSERS.length; i++) {
        if (STRUCTURAL_PARSERS[i].matcher(rawVal)) {
            return STRUCTURAL_PARSERS[i].NodeClass.parse(rawVal, name, parent);
        }
    }

    return MatlabVariableNode.parse(rawVal, name, parent);
}

export function getRegisteredClasses(): string[] {
    return Object.keys(CLASS_MAP);
}

const api = { getClass, parseValue, getRegisteredClasses };
NodeRegistry.init(api);
_injectNodeClassMap(api);

export default api;
