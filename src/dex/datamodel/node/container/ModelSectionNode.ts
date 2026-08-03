// Copyright 2026 The MathWorks, Inc.

import ContainerNode from '../ContainerNode';
import type { TableColumnConfig } from '../ContainerNode';
import MatlabVariableNode from '../data/MatlabVariableNode';
import type { MatVariable } from '../data/MatlabVariableNode';
import ModelBlockNode from '../data/ModelBlockNode';
import ModelConfigSetNode from '../data/ModelConfigSetNode';
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
    const node = new ModelConfigSetNode(cfg.name, this, cfg.active, cfg.data);
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
