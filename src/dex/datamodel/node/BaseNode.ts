// Copyright 2026 The MathWorks, Inc.

import { buildPILayout } from './schemaBridge';
import { buildOtherRows } from './piOther';

export interface PropClass {
  key: string;
  displayName: string;
  column?: string | null;
  editor: string;
  nodeProperty?: string;
  readValue?: (node: BaseNode) => string;
  readOptions?: (node: BaseNode) => string[];
  // Top-level keys in the node's raw `_properties` bag that this prop consumes.
  // The PI "Other" catch-all group uses this to avoid re-listing already-shown
  // data. When omitted, toPIObject falls back to [nodeProperty ?? key].
  sourceKeys?: string[];
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
  // `element` marks a positional array/cell/string element (its name is a
  // synthetic index, not a real identifier) — the ONLY signal that grays a Name.
  // It is structural and format-independent. `editable` (whether the name can be
  // typed into) is separate and, together with document-level readonly, gates the
  // inline editor — it must never drive coloring.
  Name?: { label: string; iconId: string; disabled: boolean; editable: boolean; element: boolean };
  Value?: unknown;
  _valueEditable?: boolean;
  DataType?: string | { text: string; linkTarget?: string };
  Class?: string;
  Kind?: string;
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

// Columns the webview renders through a dedicated, format-specific branch (they
// consume a plain string cell and manage their own editability). Generic
// editable columns (the schema Code Generation columns) are NOT in this set, so
// only they receive the editable-object cell shape in toRow.
const DEDICATED_COLUMNS = new Set(['Name', 'Value', 'DataType', 'Class', 'Kind', 'Description', 'UsedBy', 'Status']);

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

  // The raw class identity (e.g. 'Simulink.Bus', 'double'), shown in the Class
  // column.
  get className(): string {
    return '';
  }

  // The user-facing Kind (e.g. 'Bus', 'MATLAB Variable'), shown in the Kind
  // column. Base nodes with no friendlier name fall back to the class identity.
  get kind(): string {
    return this.className;
  }

  // The value shown in the Data Type column. Base nodes carry no distinct data
  // type, so this falls back to the class identity; DataNode narrows this to a
  // real data type only (empty for object types).
  get dataType(): string {
    return this.className;
  }

  get displayValue(): string {
    return '';
  }

  get disabled(): boolean {
    return false;
  }

  // A positional element of a container whose parent is a bare array/cell/string:
  // its name is a synthetic index (1, 2, …), not a real identifier.
  get isIndexedName(): boolean {
    return !!(
      this.parent &&
      (this.parent._kind === 'cell' || this.parent._kind === 'array' || this.parent._kind === 'string')
    );
  }

  // The sole signal for graying a Name cell: this node's displayed name is a
  // synthetic positional subscript, not a user-assigned identifier. Covers bare
  // array/cell/string indices (isIndexedName) and struct-array elements (which
  // carry a `Name(i)` alias in `_displayName`). Structural and independent of file
  // format — entries and struct FIELDS are never elements, so they render normally.
  get isElementName(): boolean {
    return this.isIndexedName || !!this._displayName;
  }

  // True when this node's CHILDREN are the properties of a MATLAB class object
  // (ObjectNode overrides it). A class property's name is fixed by the class
  // definition, so — unlike a struct field — it can never be renamed. Children
  // consult `this.parent?.isObjectPropertyBag` in nameEditable. Kept as a getter
  // on BaseNode (rather than an `instanceof ObjectNode` check) to avoid the import
  // cycle ObjectNode → DataNode → BaseNode.
  get isObjectPropertyBag(): boolean {
    return false;
  }

  get nameEditable(): boolean {
    if (this.isIndexedName) {
      return false;
    }
    if (this._displayName) {
      return false;
    }
    // A class property name is fixed by the class definition.
    if (this.parent?.isObjectPropertyBag) {
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
        row.Name = { label: info.displayValue, iconId: this.icon, disabled: this.disabled, editable: info.editable, element: this.isElementName };
      } else if (colKey === 'Value') {
        // A 'select' editor carries its dropdown options on the cell so the
        // webview can render a combobox instead of a text input.
        if (info.editor === 'select') {
          row.Value = { text: info.displayValue, editable: info.editable, editor: 'select', options: info.options || [] };
        } else {
          row.Value = info.displayValue;
        }
        row._valueEditable = info.editable;
      } else if (info.editable && !DEDICATED_COLUMNS.has(colKey)) {
        // An editable GENERIC column (e.g. the schema Code Generation columns).
        // Carry the editor + options onto the cell so the webview can open the
        // right editor. Columns with a dedicated webview render branch (DataType,
        // Class, …) consume a plain string and set their own editability, so they
        // are excluded here and fall through to the string form below.
        row[colKey] = { text: info.displayValue, editable: true, editor: info.editor, options: info.options };
      } else {
        row[colKey] = info.displayValue;
      }
    }

    if (!row.Name) {
      row.Name = { label: this.displayName, iconId: this.icon, disabled: this.disabled, editable: this.nameEditable, element: this.isElementName };
    }
    if (!('Value' in row)) {
      row.Value = this.displayValue;
      row._valueEditable = this.valueEditable;
    }
    if (!('DataType' in row)) {
      row.DataType = this.dataType;
    }
    if (!('Class' in row)) {
      row.Class = this.className;
    }
    if (!('Kind' in row)) {
      row.Kind = this.kind;
    }
    if (!('Description' in row)) {
      row.Description = (this as unknown as { Description?: string }).Description || '';
    }

    return row;
  }

  getProperties(): PropClass[] {
    return [];
  }

  // The Property Inspector layout (ordered groups → props). Default: the
  // declarative schema layout for this node's class, when one exists (see
  // schema/classes/*.json + buildPILayout). Node subclasses without a schema
  // layout override this to author their groups directly; a subclass may also
  // override to fully replace the schema-driven layout. Returns null when neither
  // a schema layout nor an override applies → no curated groups (toPIObject may
  // still show the "Other" group).
  getPILayout(): PIGroupDef[] | null {
    return buildPILayout(this.className);
  }

  toPIObject(): PIObject | null {
    const layout = this.getPILayout();
    if (!layout) {
      return null;
    }

    const properties: unknown[] = [];
    const groups: unknown[] = [];
    const obj: Record<string, unknown> = { _id: { nodeId: this.id } };

    // Top-level raw `_properties` keys the curated/schema layout already shows, so
    // the "Other" catch-all below never re-lists them. A prop names its consumed
    // keys via `sourceKeys`; absent that, it consumes [nodeProperty ?? key].
    const shownKeys = new Set<string>();

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
        const keys = PropClassRef.sourceKeys ?? [PropClassRef.nodeProperty ?? PropClassRef.key];
        for (const k of keys) {
          shownKeys.add(k);
        }
      }
      // Schema-driven classes open with a fixed "General" identity group, so group
      // titles are normally literal. A layout MAY still embed the `{name}` token to
      // fold its object name into a title (buildPILayout has no node instance); the
      // node substitutes its displayName here. Titles without the token pass through.
      const displayName = groupDef.group.replace('{name}', this.displayName);
      groups.push({
        name: displayName.replace(/[^A-Za-z0-9]+/g, '') + 'Group',
        type: 'group',
        displayName,
        items: groupItems,
        expanded: true,
      });
    }

    // "Other" catch-all: every remaining raw property this node carries but the
    // curated/schema layout did not surface. Namespaced property names ('Other.X')
    // avoid colliding with a group prop that shares a bare key.
    const rawProps = (this as unknown as { serial?: { _properties?: unknown } }).serial?._properties;
    const otherRows = buildOtherRows(rawProps, shownKeys);
    if (otherRows.length > 0) {
      const otherItems: unknown[] = [];
      for (const row of otherRows) {
        const propName = 'Other.' + row.name;
        properties.push({
          name: propName,
          displayName: row.name,
          dataType: 'char',
          renderer: 'rendererseditors/editors/LabelEditor',
          inPlaceEditor: null,
          editor: null,
          editable: false,
          valid: true,
        });
        otherItems.push({ name: propName, type: 'property' });
        obj[propName] = row.value;
      }
      groups.push({
        name: 'OtherGroup',
        type: 'group',
        displayName: 'Other',
        items: otherItems,
        expanded: false,
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
