// Copyright 2026 The MathWorks, Inc.

export interface PropClass {
  key: string;
  displayName: string;
  column?: string | null;
  editor: string;
  nodeProperty?: string;
  readValue?: (node: BaseNode) => string;
  readOptions?: (node: BaseNode) => string[];
  format: (value: unknown) => string;
}

export interface PropInfo {
  key: string;
  displayName: string;
  value: unknown;
  displayValue: string;
  editable: boolean;
  editor: string;
  options?: string[];
}

export interface RowData {
  ID: string;
  parent: string | null;
  Status: string;
  Name?: { label: string; iconId: string; disabled: boolean; editable: boolean };
  Value?: unknown;
  _valueEditable?: boolean;
  DataType?: string | { text: string; linkTarget?: string };
  Description?: string;
  UsedBy?: string | { text: string; linkTarget?: string } | { links: { text: string; linkTarget: string }[] };
  [key: string]: unknown;
}

export interface PIGroupDef {
  group: string;
  items: PropClass[];
}

export interface PIObject {
  propertySheet: { properties: unknown[]; groups: unknown[] };
  objects: unknown[];
  showGroups: boolean;
  showDefaultGroup: boolean;
}

export default class BaseNode {
  name: string;
  parent: BaseNode | null;
  children: BaseNode[];
  _displayName?: string;
  _kind?: string;
  _dims?: number[];

  constructor(name: string, parent: BaseNode | null) {
    this.name = name;
    this.parent = parent;
    this.children = [];
  }

  get id(): string {
    return this.parent ? this.parent.id + '/' + this.name : this.name;
  }

  get icon(): string {
    return 'wsDefault';
  }

  get dataType(): string {
    return '';
  }

  // The value shown in the DataType column; subclasses may override to show a
  // friendlier type than the class-identity dataType.
  get displayDataType(): string {
    return this.dataType;
  }

  get displayValue(): string {
    return '';
  }

  get disabled(): boolean {
    return false;
  }

  get nameEditable(): boolean {
    if (
      this.parent &&
      (this.parent._kind === 'cell' || this.parent._kind === 'array' || this.parent._kind === 'string')
    ) {
      return false;
    }
    if (this._displayName) {
      return false;
    }
    return true;
  }

  canAddChild(): boolean {
    return false;
  }

  addChildNode(): BaseNode | null {
    return null;
  }

  addChild(child: BaseNode, index?: number): BaseNode {
    if (index !== undefined && index >= 0) {
      this.children.splice(index, 0, child);
    } else {
      this.children.push(child);
    }
    child.parent = this;
    return child;
  }

  removeChild(child: BaseNode): void {
    const idx = this.children.indexOf(child);
    if (idx >= 0) {
      this.children.splice(idx, 1);
      child.parent = null;
    }
  }

  _replaceWith(newNode: BaseNode): boolean {
    if (!this.parent) {
      return false;
    }
    const idx = this.parent.children.indexOf(this);
    if (idx < 0) {
      return false;
    }
    newNode.parent = this.parent;
    this.parent.children[idx] = newNode;
    this.parent = null;
    return true;
  }

  flatten(): BaseNode[] {
    const result: BaseNode[] = [];
    const stack: BaseNode[] = [this];
    while (stack.length > 0) {
      const node = stack.pop()!;
      result.push(node);
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i]);
      }
    }
    return result;
  }

  get displayName(): string {
    if (
      this.parent &&
      (this.parent._kind === 'cell' || this.parent._kind === 'array' || this.parent._kind === 'string')
    ) {
      const parentName = this.parent.displayName;
      const idx = this.parent.children.indexOf(this) + 1;
      const cols = this.parent._dims![1];
      const isMatrix = this.parent._dims![0] > 1 && cols > 1;
      if (this.parent._kind === 'cell') {
        return isMatrix
          ? parentName + '{' + (Math.floor((idx - 1) / cols) + 1) + ',' + (((idx - 1) % cols) + 1) + '}'
          : parentName + '{' + idx + '}';
      }
      return isMatrix
        ? parentName + '(' + (Math.floor((idx - 1) / cols) + 1) + ',' + (((idx - 1) % cols) + 1) + ')'
        : parentName + '(' + idx + ')';
    }
    return this._displayName || this.name;
  }

  get valueEditable(): boolean {
    const v = this.displayValue;
    if (v && v.charAt(0) === '<' && v.charAt(v.length - 1) === '>') {
      return false;
    }
    return true;
  }

  getPropInfo(PropClassRef: PropClass): PropInfo {
    const key = PropClassRef.key;
    let displayValue: string;
    if (PropClassRef.readValue) {
      displayValue = PropClassRef.readValue(this);
    } else {
      displayValue = PropClassRef.format((this as unknown as Record<string, unknown>)[key]);
    }

    let editable = PropClassRef.editor !== 'label';
    if (key === 'Name') {
      editable = editable && this.nameEditable;
    }
    if (key === 'Value') {
      editable = editable && this.valueEditable;
    }

    return {
      key,
      displayName: PropClassRef.displayName,
      value: (this as unknown as Record<string, unknown>)[PropClassRef.nodeProperty || key],
      displayValue,
      editable,
      editor: PropClassRef.editor,
      options: PropClassRef.readOptions ? PropClassRef.readOptions(this) : undefined,
    };
  }

  toRow(): RowData | null {
    const parentId =
      this.parent && !(this.parent as unknown as { isContainer?: boolean }).isContainer ? this.parent.id : null;
    const props = this.getProperties();
    const row: RowData = {
      ID: this.id,
      parent: parentId,
      Status: (this as unknown as { status?: string }).status || '',
    };

    for (let i = 0; i < props.length; i++) {
      const info = this.getPropInfo(props[i]);
      const column = props[i].column;
      if (column === null) {
        continue;
      }
      const colKey = column || info.key;

      if (colKey === 'Name') {
        row.Name = { label: info.displayValue, iconId: this.icon, disabled: this.disabled, editable: info.editable };
      } else if (colKey === 'Value') {
        // A 'select' editor carries its dropdown options on the cell so the
        // webview can render a combobox instead of a text input.
        if (info.editor === 'select') {
          row.Value = { text: info.displayValue, editable: info.editable, editor: 'select', options: info.options || [] };
        } else {
          row.Value = info.displayValue;
        }
        row._valueEditable = info.editable;
      } else {
        row[colKey] = info.displayValue;
      }
    }

    if (!row.Name) {
      row.Name = { label: this.displayName, iconId: this.icon, disabled: this.disabled, editable: this.nameEditable };
    }
    if (!('Value' in row)) {
      row.Value = this.displayValue;
      row._valueEditable = this.valueEditable;
    }
    if (!('DataType' in row)) {
      row.DataType = this.displayDataType;
    }
    if (!('Description' in row)) {
      row.Description = (this as unknown as { Description?: string }).Description || '';
    }

    return row;
  }

  getProperties(): PropClass[] {
    return [];
  }

  getPILayout(): PIGroupDef[] | null {
    return null;
  }

  toPIObject(): PIObject | null {
    const layout = this.getPILayout();
    if (!layout) {
      return null;
    }

    const properties: unknown[] = [];
    const groups: unknown[] = [];
    const obj: Record<string, unknown> = { _id: { nodeId: this.id } };

    for (let g = 0; g < layout.length; g++) {
      const groupDef = layout[g];
      const groupItems: unknown[] = [];
      for (let i = 0; i < groupDef.items.length; i++) {
        const PropClassRef = groupDef.items[i];
        const info = this.getPropInfo(PropClassRef);
        properties.push({
          name: info.key,
          displayName: info.displayName,
          dataType: info.editor === 'bool' ? 'logical' : 'char',
          renderer: info.editable ? 'rendererseditors/editors/TextBoxEditor' : 'rendererseditors/editors/LabelEditor',
          inPlaceEditor: info.editable ? 'rendererseditors/editors/TextBoxEditor' : null,
          editor: null,
          editable: info.editable,
          valid: true,
        });
        groupItems.push({ name: info.key, type: 'property' });
        obj[info.key] = info.displayValue;
      }
      groups.push({
        name: groupDef.group.replace(/\s+/g, '') + 'Group',
        type: 'group',
        displayName: groupDef.group,
        items: groupItems,
        expanded: true,
      });
    }

    return {
      propertySheet: { properties, groups },
      objects: [obj],
      showGroups: true,
      showDefaultGroup: false,
    };
  }

  serialize(): unknown {
    return null;
  }
}
