// Copyright 2026 The MathWorks, Inc.

import BaseNode from '../BaseNode';
import type { PropClass, PIGroupDef, RowData } from '../BaseNode';
import PropName from '../../prop/PropName';

export default class ModelBlockNode extends BaseNode {
  blockType: string;
  paramUsages: Array<{ property: string; value: string }>;
  modelSrcId: string;
  paramSourceId: string | null;

  constructor(
    name: string,
    parent: BaseNode | null,
    blockType: string,
    paramUsages: Array<{ property: string; value: string }>,
    modelSrcId: string,
    paramSourceId: string | null,
  ) {
    super(name, parent);
    this.blockType = blockType;
    this.paramUsages = paramUsages;
    this.modelSrcId = modelSrcId;
    this.paramSourceId = paramSourceId;
  }

  get isEntry(): boolean {
    return true;
  }

  get icon(): string {
    return 'block';
  }

  get displayName(): string {
    return this.name;
  }

  get displayValue(): string {
    return this.blockType;
  }

  get className(): string {
    return this.paramUsages.map((u) => `${u.property}=${u.value}`).join(', ');
  }

  get nameEditable(): boolean {
    return false;
  }

  get valueEditable(): boolean {
    return false;
  }

  toRow(): RowData | null {
    const paramText = this.paramUsages.map((u) => `${u.property}=${u.value}`).join(', ');
    const firstParam = this.paramUsages.length > 0 ? this.paramUsages[0].value : null;
    const paramLink = firstParam && this.paramSourceId ? `${firstParam}@${this.paramSourceId}` : undefined;
    return {
      ID: this.id,
      parent: null,
      Status: '',
      Name: { label: this.name, iconId: this.icon, disabled: false, editable: false, element: false },
      Value: this.blockType,
      DataType: paramLink ? { text: paramText, linkTarget: paramLink } : paramText,
      _valueEditable: false,
      _graphTarget: this.modelSrcId,
    };
  }

  getProperties(): PropClass[] {
    return [PropName];
  }

  getPILayout(): PIGroupDef[] {
    return [{ group: 'General', items: [PropName] }];
  }
}
