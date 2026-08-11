// Copyright 2026 The MathWorks, Inc.

import ContainerNode from '../ContainerNode';
import type { TableColumnConfig } from '../ContainerNode';
import type BaseNode from '../BaseNode';
import type DataNode from '../DataNode';
import type { NodeClassMapAPI } from '../NodeRegistry';
import type { SystemComposerCatalog } from './SlddNode';
import { classificationOf as _classificationOf } from './SlddNode';

import { NS_DESIGN, NS_CONFIGURATIONS, NS_OTHER, SECTION_NAMESPACE } from '../../SectionConstants.js';
export { NS_DESIGN, NS_CONFIGURATIONS, NS_OTHER, SECTION_NAMESPACE };

const ALLOWED_TYPES: Record<string, string[]> = {
  design: [
    'MatlabVariable',
    'MatlabStruct',
    'Simulink.Parameter',
    'Simulink.LookupTable',
    'Simulink.Breakpoint',
    'Simulink.Signal',
    'Simulink.Bus',
    'Simulink.ConnectionBus',
    'Simulink.NumericType',
    'Simulink.AliasType',
    'Simulink.ValueType',
    'Simulink.data.dictionary.EnumTypeDefinition',
    'Simulink.VariantExpression',
    'Simulink.VariantControl',
    'Simulink.VariantVariable',
    'Simulink.VariantBank',
    'Simulink.VariantBankCoderInfo',
    'CustomObject',
  ],
  arch: [
    'Simulink.Parameter',
    'Simulink.Signal',
    'Simulink.Bus',
    'Simulink.ConnectionBus',
    'Simulink.ServiceBus',
    'Simulink.data.dictionary.EnumTypeDefinition',
    'Simulink.AliasType',
  ],
  config: ['Simulink.ConfigSet', 'Simulink.ConfigSetRef', 'Simulink.VariantConfigurationData', 'Simulink.VariantConfigurations'],
  other: ['MatlabVariable', 'Simulink.VariantExpression', 'Simulink.VariantVariable', 'CustomObject'],
};

export function generateUuid(): string {
  const hex = '0123456789abcdef';
  const segments = [8, 4, 4, 4, 12];
  return segments
    .map(function (len) {
      let s = '';
      for (let i = 0; i < len; i++) {
        s += hex[Math.floor(Math.random() * 16)];
      }
      return s;
    })
    .join('-');
}

function formatTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, '.000000');
}

// Lazy import to avoid circular dependency — NodeClassMap imports node classes
let _nodeClassMap: NodeClassMapAPI | null = null;

export function _injectNodeClassMap(map: NodeClassMapAPI): void {
  _nodeClassMap = map;
}

export default class SectionNode extends ContainerNode {
  label: string;
  iconId: string;

  constructor(name: string, parent: BaseNode | null, label: string, iconId: string) {
    super(name, parent);
    this.label = label;
    this.iconId = iconId;
  }

  get icon(): string {
    return this.iconId;
  }

  get displayName(): string {
    return this.label;
  }

  get tableColumnConfig(): TableColumnConfig {
    if (this.name === 'config') {
      return { columns: ['Name', 'Description', 'Status'] };
    }
    return { columns: ['Name', 'Value', 'DataType', 'Status', 'UsedBy'] };
  }

  getAllowedTypes(): string[] {
    return ALLOWED_TYPES[this.name] || [];
  }

  addEntry(className: string, entryName?: string): DataNode | null {
    if (!_nodeClassMap) {
      return null;
    }
    const NodeClass = _nodeClassMap.getClass(className);
    if (!NodeClass || !NodeClass.createDefault) {
      return null;
    }

    const allowed = this.getAllowedTypes();
    if (allowed.length > 0 && allowed.indexOf(className) === -1) {
      return null;
    }

    const baseName = entryName || NodeClass.defaultName || className.split('.').pop()!;
    const uniqueName = this._uniqueName(baseName);
    const node = NodeClass.createDefault(uniqueName, this) as DataNode;

    node.metadata = {
      uuid: generateUuid(),
      namespace: SECTION_NAMESPACE[this.name] || NS_OTHER,
      lastmod: formatTimestamp(),
      modifiedby: '',
      isderived: this.name === 'arch' ? '1' : '0',
    };
    node.status = 'New';

    this.addChild(node);

    let root: BaseNode | null = this.parent;
    while (root && root.parent) {
      root = root.parent;
    }
    if (root && (root as unknown as { dirty?: boolean }).dirty !== undefined) {
      (root as unknown as { dirty: boolean }).dirty = true;
    }

    return node;
  }

  execAddEntry(className: string, entryName?: string): { node: DataNode; undo: () => void; redo: () => void } | null {
    const node = this.addEntry(className, entryName);
    if (!node) {
      return null;
    }
    const index = this.children.indexOf(node);
    return {
      node,
      undo: () => {
        this.removeChild(node);
      },
      redo: () => {
        this.addChild(node, index);
      },
    };
  }

  execRemoveEntry(node: BaseNode): { undo: () => void; redo: () => void } | null {
    const index = this.children.indexOf(node);
    if (index < 0) {
      return null;
    }
    this.removeChild(node);
    let root: BaseNode | null = this.parent;
    while (root && root.parent) {
      root = root.parent;
    }
    if (root && (root as unknown as { dirty?: boolean }).dirty !== undefined) {
      (root as unknown as { dirty: boolean }).dirty = true;
    }
    return {
      undo: () => {
        this.addChild(node, index);
      },
      redo: () => {
        this.removeChild(node);
      },
    };
  }

  _uniqueName(baseName: string): string {
    const existing = new Set(this.children.map((c) => c.name));
    if (!existing.has(baseName)) {
      return baseName;
    }
    let i = 1;
    while (existing.has(baseName + i)) {
      i++;
    }
    return baseName + i;
  }

  parseEntry(rawEntry: Record<string, unknown>, systemComposer?: SystemComposerCatalog | null): DataNode | null {
    if (!_nodeClassMap) {
      return null;
    }
    const entryName = (rawEntry.name as string) || '';
    const dataNode = _nodeClassMap.parseValue(rawEntry.value, entryName, this) as DataNode;
    dataNode.metadata = (rawEntry.metadata as Record<string, unknown>) || null;
    if (rawEntry.rawXml) {
      dataNode.rawXml = rawEntry.rawXml as string;
    }

    // Classify entries via the systemcomposer catalog. The classification token
    // (e.g. 'DataInterface', 'StructType') drives the entry's user-facing Kind
    // and also distinguishes a StructType from a DataInterface (both Simulink.Bus).
    const classification = _classificationOf(systemComposer, entryName);
    if (classification) {
      dataNode.classification = classification;
      if (classification === 'StructType') {
        (dataNode as unknown as { isStructType?: boolean }).isStructType = true;
      }
    }

    this.addChild(dataNode);
    return dataNode;
  }
}
