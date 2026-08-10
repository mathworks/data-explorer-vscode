// Copyright 2026 The MathWorks, Inc.

import ContainerNode from '../ContainerNode';
import type { TableColumnConfig } from '../ContainerNode';
import MatlabVariableNode from '../data/MatlabVariableNode';
import type { MatVariable } from '../data/MatlabVariableNode';
import ModelBlockNode from '../data/ModelBlockNode';
import ConfigSetNode from '../data/ConfigSetNode';
import ConfigSetRefNode from '../data/ConfigSetRefNode';
import ModelReferenceNode from '../data/ModelReferenceNode';
import DataSourceNode from '../data/DataSourceNode';
import type BaseNode from '../BaseNode';

export default class ModelSectionNode extends ContainerNode {
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
    switch (this.name) {
      case 'blocks':
        return { columns: ['Name', 'Value', 'DataType'], labels: { Value: 'Block Type', DataType: 'Uses' } };
      case 'workspace':
        return { columns: ['Name', 'Value', 'DataType', 'UsedBy'] };
      case 'config':
        return { columns: ['Name', 'Description'] };
      default:
        return { columns: ['Name', 'Value', 'DataType', 'UsedBy'] };
    }
  }

  addWorkspaceEntry(entry: MatVariable): BaseNode {
    const node = MatlabVariableNode.parseMatVariable(entry, entry.name, this);
    this.addChild(node);
    return node;
  }

  addConfigSetEntry(cfg: { name: string; active: boolean; data: unknown }): BaseNode {
    // The SLX config section uses the SAME node classes as the SLDD path
    // (ConfigSetNode / ConfigSetRefNode) so presentation is identical — empty,
    // non-editable Value and Data Type. The SLX-only "active" state is carried
    // on the shared node and surfaces through the icon, not a Value suffix.
    const objectClass =
      (cfg.data && (cfg.data as Record<string, unknown>)._object_class) === 'Simulink.ConfigSetRef'
        ? 'Simulink.ConfigSetRef'
        : 'Simulink.ConfigSet';
    const rawVal = {
      _array_class: objectClass,
      _array_type: 'MATLABArray',
      _dimensions: [1, 1],
      _mw_element_type: 'MATLABArray',
      _elements: [{ _properties: { Name: cfg.name } }],
    };
    const node =
      objectClass === 'Simulink.ConfigSetRef'
        ? ConfigSetRefNode.parse(rawVal, cfg.name, this)
        : ConfigSetNode.parse(rawVal, cfg.name, this);
    node.active = cfg.active;
    this.addChild(node);
    return node;
  }

  addReferenceEntry(ref: { blockPath: string; modelName: string }): BaseNode {
    const name = ref.modelName.endsWith('.slx') ? ref.modelName : ref.modelName + '.slx';
    const node = new ModelReferenceNode(name, this, ref.blockPath);
    this.addChild(node);
    return node;
  }

  addBlockEntry(
    blockName: string,
    blockType: string,
    paramUsages: Array<{ property: string; value: string }>,
    modelSrcId: string,
    paramSourceId: string | null,
  ): BaseNode {
    const node = new ModelBlockNode(blockName, this, blockType, paramUsages, modelSrcId, paramSourceId);
    this.addChild(node);
    return node;
  }

  addDataSourceEntry(path: string): BaseNode {
    const filename = path.split('/').pop()!;
    const node = new DataSourceNode(filename, this, path);
    this.addChild(node);
    return node;
  }
}
