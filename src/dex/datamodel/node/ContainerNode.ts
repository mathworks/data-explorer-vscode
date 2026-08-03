// Copyright 2026 The MathWorks, Inc.

import BaseNode from './BaseNode';

export interface TableColumnConfig {
  columns: string[];
  labels?: Record<string, string>;
}

export default class ContainerNode extends BaseNode {
  get isContainer(): boolean {
    return true;
  }

  get tableColumnConfig(): TableColumnConfig {
    return { columns: ['Name', 'Value', 'DataType', 'Status', 'UsedBy'] };
  }

  toRow(): null {
    return null;
  }

  flatten(): BaseNode[] {
    const result: BaseNode[] = [];
    const stack: BaseNode[] = [];
    for (let i = this.children.length - 1; i >= 0; i--) {
      stack.push(this.children[i]);
    }
    while (stack.length > 0) {
      const node = stack.pop()!;
      result.push(node);
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i]);
      }
    }
    return result;
  }
}
