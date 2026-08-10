// Copyright 2026 The MathWorks, Inc.

import BaseNode from './BaseNode';
import {
  escapeXml,
  formatDoubleXml,
  formatNumericXml,
  formatComplexXml,
  transposeToColumnMajor,
  pad as xmlPad,
} from '../parser/XmlUtils';

const MATLAB_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const MATLAB_KEYWORDS = new Set([
  'break',
  'case',
  'catch',
  'classdef',
  'continue',
  'else',
  'elseif',
  'end',
  'for',
  'function',
  'global',
  'if',
  'otherwise',
  'parfor',
  'persistent',
  'return',
  'spmd',
  'switch',
  'try',
  'while',
]);

function validateMatlabName(name: string): string | null {
  if (!name || !name.trim()) {
    return 'Name cannot be empty';
  }
  if (!MATLAB_NAME_RE.test(name)) {
    return 'Invalid MATLAB name. Must start with a letter and contain only letters, digits, and underscores';
  }
  if (name.length > 63) {
    return 'Name exceeds maximum length of 63 characters';
  }
  if (MATLAB_KEYWORDS.has(name)) {
    return "'" + name + "' is a reserved MATLAB keyword";
  }
  return null;
}

export interface SetPropertyResult {
  error: boolean;
  reason: string;
  invalidValue: string;
  validValue: string;
}

// The user-facing Kind for each object Class. This is the friendly name shown
// in the Kind column (e.g. Class 'Simulink.Bus' → Kind 'Bus'); it never appears
// in the Class column (which shows the raw class identity) or the Data Type
// column (which shows a real data type). A class absent from this map falls back
// to its raw class name as its Kind.
const KIND_BY_CLASS: Record<string, string> = {
  'Simulink.Parameter': 'Simulink Parameter',
  'Simulink.Signal': 'Simulink Signal',
  'Simulink.LookupTable': 'Lookup Table',
  'Simulink.Breakpoint': 'Breakpoint',
  'Simulink.Bus': 'Bus',
  'Simulink.BusElement': 'Bus Element',
  'Simulink.ConnectionBus': 'Connection Bus',
  'Simulink.ConnectionElement': 'Connection Element',
  'Simulink.ServiceBus': 'Service Interface',
  'Simulink.FunctionElement': 'Function Element',
  'Simulink.ValueType': 'Value Type',
  'Simulink.AliasType': 'Alias Type',
  'Simulink.NumericType': 'Numeric Type',
  'Simulink.data.dictionary.EnumTypeDefinition': 'Enumerated Type',
  'Simulink.VariantExpression': 'Variant Expression',
  'Simulink.VariantControl': 'Variant Control',
  'Simulink.VariantVariable': 'Variant Variable',
  'Simulink.VariantBank': 'Variant Bank',
  'Simulink.VariantBankCoderInfo': 'Variant Bank Coder Info',
  'Simulink.VariantConfigurationData': 'Variant Configuration',
  'Simulink.VariantConfigurations': 'Variant Configuration',
  'Simulink.ConfigSet': 'Configuration Set',
  'Simulink.ConfigSetRef': 'Configuration Reference',
};

// The user-facing Kind for each semantic classification token. Some entries are
// classified (via the systemcomposer catalog) into a Kind that comes from the
// classification rather than the Class, so the same Simulink.Bus can be a
// 'Data Interface' or a 'Struct Type' depending on how the catalog models it.
const KIND_BY_CLASSIFICATION: Record<string, string> = {
  DataInterface: 'Data Interface',
  PhysicalInterface: 'Physical Interface',
  ServiceInterface: 'Service Interface',
  ValueType: 'Value Type',
  StructType: 'Struct Type',
  NumericType: 'Numeric Type',
  EnumType: 'Enumerated Type',
  AliasType: 'Alias Type',
};

export default class DataNode extends BaseNode {
  metadata: Record<string, unknown> | null;
  serial: Record<string, unknown>;
  status: string;
  Description?: string;
  _rawInput?: unknown;
  rawXml?: string;
  // A semantic classification token (e.g. 'DataInterface', 'StructType') set at
  // parse time for entries the source classifies beyond their Class (currently
  // the systemcomposer catalog). It drives the user-facing Kind (see the `kind`
  // getter). Unclassified entries derive their Kind from the Class alone.
  classification?: string;

  constructor(name: string, parent: BaseNode | null, serial?: Record<string, unknown>) {
    super(name, parent);
    this.metadata = null;
    this.serial = serial || {};
    this.status = '';
  }

  // Each data node captures three distinct concepts, one per column:
  //   • className — the raw class identity (e.g. 'Simulink.Bus', 'double').
  //   • kind      — the user-facing name (e.g. 'Bus', 'MATLAB Variable').
  //   • dataType  — a real data type only (e.g. 'double', 'int8'), or empty.
  // These never mix: the Class column shows className, the Kind column shows
  // kind, and the Data Type column shows dataType.

  // The user-facing Kind. A classified entry's Kind comes from its classification
  // token; otherwise it is derived from the Class. Nodes with no known mapping
  // fall back to their raw class name.
  get kind(): string {
    if (this.classification) {
      return KIND_BY_CLASSIFICATION[this.classification] || this.classification;
    }
    const cls = this.className;
    return KIND_BY_CLASS[cls] || cls;
  }

  // The value shown in the Data Type column. This column shows a real data type
  // only; it never surfaces the node's Class (the class identity, e.g.
  // 'Simulink.Bus') or its Kind. Object-type nodes therefore show nothing here
  // by default; only nodes that carry a genuine data type (primitive variables,
  // structs, bus elements, value types) override this.
  get dataType(): string {
    return '';
  }

  get isEntry(): boolean {
    return !!(this.parent && (this.parent as unknown as { isContainer?: boolean }).isContainer);
  }

  // isIndexedName is inherited from BaseNode (structural: parent is array/cell/
  // string). DataNode keeps its own nameEditable because a _displayName alias also
  // fixes the name here.

  get isDerived(): boolean {
    return !!(this.metadata && this.metadata.isderived === '1');
  }

  get nameEditable(): boolean {
    if (this._displayName) {
      return false;
    }
    return !this.isIndexedName;
  }

  get disabled(): boolean {
    return !this.isEntry;
  }

  _resolveProperty(propName: string): string {
    const props = this.getProperties();
    for (let i = 0; i < props.length; i++) {
      if (props[i].key === propName || (props[i] as unknown as { column?: string }).column === propName) {
        return (props[i] as unknown as { nodeProperty?: string }).nodeProperty || props[i].key;
      }
    }
    return propName;
  }

  setProperty(propName: string, stringValue: string): true | SetPropertyResult {
    const resolved = this._resolveProperty(propName);
    if (resolved === 'name') {
      const error = validateMatlabName(stringValue);
      if (error) {
        return { error: true, reason: error, invalidValue: stringValue, validValue: this.name };
      }
      if (this.parent && this.parent.children) {
        const duplicate = this.parent.children.some((sibling) => sibling !== this && sibling.name === stringValue);
        if (duplicate) {
          return {
            error: true,
            reason: "'" + stringValue + "' already exists in this section",
            invalidValue: stringValue,
            validValue: this.name,
          };
        }
      }
      const oldName = this.name;
      this.name = stringValue;
      if (this.parent && (this.parent as unknown as { serial?: { _fields?: string[] } }).serial) {
        const parentSerial = (this.parent as unknown as { serial: { _fields?: string[] } }).serial;
        if (parentSerial._fields) {
          const idx = parentSerial._fields.indexOf(oldName);
          if (idx >= 0) {
            parentSerial._fields[idx] = stringValue;
          }
        }
      }
      this._markModified();
      return true;
    }
    const self = this as unknown as Record<string, unknown>;
    const current = self[resolved];
    const type = typeof current;
    if (type === 'number') {
      const num = Number(stringValue);
      if (Number.isNaN(num)) {
        return {
          error: true,
          reason: 'Expected a numeric value',
          invalidValue: stringValue,
          validValue: String(current),
        };
      }
      self[resolved] = num;
    } else if (type === 'boolean') {
      self[resolved] = stringValue === 'true';
    } else {
      self[resolved] = stringValue;
    }
    this._markModified();
    return true;
  }

  execAddChild(): unknown {
    return null;
  }

  execRemoveChild(_child?: BaseNode): unknown {
    return null;
  }

  _markModified(): void {
    let node: BaseNode | null = this;
    while (node && !(node as DataNode).isEntry) {
      if ((node as DataNode)._rawInput !== undefined) {
        (node as DataNode)._rawInput = undefined;
      }
      node = node.parent;
    }
    if (node) {
      (node as DataNode).status = 'Modified';
      if ((node as DataNode)._rawInput !== undefined) {
        (node as DataNode)._rawInput = undefined;
      }
    }
    let root: BaseNode = this;
    while (root.parent) {
      root = root.parent;
    }
    if ((root as unknown as { dirty?: boolean }).dirty !== undefined) {
      (root as unknown as { dirty: boolean }).dirty = true;
    }
  }

  serialize(): unknown {
    if (this.isEntry) {
      return {
        name: this.name,
        metadata: this.metadata,
        value: this.serializeValue(),
      };
    }
    return this.serializeValue();
  }

  _serializeSimulinkObject(propOverrides: Record<string, unknown>): unknown {
    const props = Object.assign({}, this.serial._properties as Record<string, unknown>, propOverrides);
    const result = Object.assign({}, this.serial._rawVal as Record<string, unknown>);
    const rawElements = (result._elements as unknown[]) || [];
    result._elements = [Object.assign({}, rawElements[0] as Record<string, unknown>, { _properties: props })];
    return result;
  }

  serializeValue(): unknown {
    return null;
  }

  serializeXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string {
    if (this.serial && this.serial._rawVal && (this.serial._rawVal as Record<string, unknown>)._array_class) {
      return this._serializeSimulinkObjectXml(tagName, attrs, indent);
    }
    return xmlPad(indent) + '<' + tagName + '/>';
  }

  _serializeSimulinkObjectXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string {
    const p = xmlPad(indent);
    const ip = xmlPad(indent + 1);
    const rawVal = this.serial._rawVal as Record<string, unknown>;
    const className = rawVal._array_class as string;
    const props = this._getSerializedProperties();

    let attrStr = '';
    if (attrs && attrs.Name) {
      attrStr += ' Name="' + escapeXml(attrs.Name) + '"';
    }

    let xml = p + '<' + tagName + attrStr + '>\n';
    xml += ip + '<Element Class="' + escapeXml(className) + '">\n';
    for (const [propName, propVal] of Object.entries(props)) {
      xml += DataNode.serializePropertyXml(propName, propVal, indent + 2, this) + '\n';
    }
    xml += ip + '</Element>\n';
    xml += p + '</' + tagName + '>';
    return xml;
  }

  _getSerializedProperties(): Record<string, unknown> {
    return Object.assign({}, this.serial._properties as Record<string, unknown>);
  }

  static serializePropertyXml(name: string, value: unknown, indent: number, ownerNode: DataNode | null): string {
    const p = xmlPad(indent);

    if (value === null || value === undefined) {
      return p + '<P Name="' + escapeXml(name) + '" Class="char"/>';
    }
    if (typeof value === 'number') {
      return p + '<P Name="' + escapeXml(name) + '" Class="double">' + formatDoubleXml(value) + '</P>';
    }
    if (typeof value === 'boolean') {
      return p + '<P Name="' + escapeXml(name) + '" Class="logical">' + (value ? '1' : '0') + '</P>';
    }
    if (typeof value === 'string') {
      if (value === '') {
        return p + '<P Name="' + escapeXml(name) + '" Class="char"/>';
      }
      return p + '<P Name="' + escapeXml(name) + '" Class="char">' + escapeXml(value) + '</P>';
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return p + '<P Name="' + escapeXml(name) + '" Class="double" Dimension="0*0"/>';
      }
      const formatted = value.map(function (v: number) {
        return formatDoubleXml(v);
      });
      return (
        p +
        '<P Name="' +
        escapeXml(name) +
        '" Class="double" Dimension="1*' +
        value.length +
        '">' +
        formatted.join(' ') +
        '</P>'
      );
    }
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (obj._type && obj._value !== undefined) {
        return DataNode._serializeTypedPropertyXml(name, obj, indent);
      }
      if (obj._array_class) {
        return DataNode._serializeObjectPropertyXml(name, obj, indent, ownerNode);
      }
      if (obj._object_class) {
        const wrapped = {
          _array_class: obj._object_class,
          _dimensions: [1, 1],
          _elements: [{ _properties: obj._properties || {} }],
        };
        return DataNode._serializeObjectPropertyXml(name, wrapped, indent, ownerNode);
      }
      if (obj._array_type === 'Struct') {
        return DataNode._serializeStructPropertyXml(name, obj, indent);
      }
      if (obj._array_type === 'Cell') {
        return DataNode._serializeCellPropertyXml(name, obj, indent);
      }
    }
    return p + '<P Name="' + escapeXml(name) + '" Class="char">' + escapeXml(String(value)) + '</P>';
  }

  static _serializeTypedPropertyXml(name: string, value: Record<string, unknown>, indent: number): string {
    const p = xmlPad(indent);
    const type = value._type as string;
    const raw = String(value._value);

    if (type === 'cdata') {
      const formatted = formatComplexXml(raw);
      return p + '<P Name="' + escapeXml(name) + '" Class="double" IsComplex="1">' + formatted + '</P>';
    }

    const matrixMatch = raw.match(/^Matrix\((\d+),(\d+)\)\n(.+)$/s);
    if (matrixMatch) {
      const rows = parseInt(matrixMatch[1], 10);
      const cols = parseInt(matrixMatch[2], 10);
      const nums = DataNode._parseMatrixNums(matrixMatch[3], type);
      const colMajor = transposeToColumnMajor(nums, rows, cols);
      const formatted = colMajor.map(function (v: number) {
        return formatNumericXml(v, type);
      });
      return (
        p +
        '<P Name="' +
        escapeXml(name) +
        '" Class="' +
        type +
        '" Dimension="' +
        rows +
        '*' +
        cols +
        '">' +
        formatted.join(' ') +
        '</P>'
      );
    }

    const vecMatch = raw.match(/^\[(.+)\]$/);
    if (vecMatch) {
      const parts = vecMatch[1].split(',').map(function (s: string) {
        return parseFloat(s.trim().replace(/[FU]$/, ''));
      });
      const formatted = parts.map(function (v: number) {
        return formatNumericXml(v, type);
      });
      return (
        p +
        '<P Name="' +
        escapeXml(name) +
        '" Class="' +
        type +
        '" Dimension="1*' +
        parts.length +
        '">' +
        formatted.join(' ') +
        '</P>'
      );
    }

    const num = parseFloat(raw.replace(/[FU]$/, ''));
    return p + '<P Name="' + escapeXml(name) + '" Class="' + type + '">' + formatNumericXml(num, type) + '</P>';
  }

  static _serializeObjectPropertyXml(
    name: string,
    value: Record<string, unknown>,
    indent: number,
    ownerNode: DataNode | null,
  ): string {
    const p = xmlPad(indent);
    const ip = xmlPad(indent + 1);
    const className = value._array_class as string;
    const dims = (value._dimensions as number[]) || [1, 1];
    const elements = (value._elements as Record<string, unknown>[]) || [];

    if (
      elements.length === 0 ||
      (elements.length === 1 &&
        (!elements[0]._properties || Object.keys(elements[0]._properties as object).length === 0))
    ) {
      return (
        p +
        '<P Name="' +
        escapeXml(name) +
        '">\n' +
        ip +
        '<Element Class="' +
        escapeXml(className) +
        '"/>\n' +
        p +
        '</P>'
      );
    }

    const dimAttr =
      dims[0] === 1 && dims[1] === 1 && elements.length === 1 ? '' : ' Dimension="' + dims[0] + '*' + dims[1] + '"';
    let xml = p + '<P Name="' + escapeXml(name) + '"' + dimAttr + '>\n';
    for (const elem of elements) {
      const props = (elem._properties as Record<string, unknown>) || {};
      xml += ip + '<Element Class="' + escapeXml(className) + '">\n';
      for (const [propName, propVal] of Object.entries(props)) {
        xml += DataNode.serializePropertyXml(propName, propVal, indent + 2, ownerNode) + '\n';
      }
      xml += ip + '</Element>\n';
    }
    xml += p + '</P>';
    return xml;
  }

  static _serializeStructPropertyXml(name: string, value: Record<string, unknown>, indent: number): string {
    const p = xmlPad(indent);
    const ip = xmlPad(indent + 1);
    const dims = (value._dimensions as number[]) || [1, 1];
    const elements = (value._elements as Record<string, unknown>[]) || [];
    const dimAttr = dims[0] === 1 && dims[1] === 1 ? '' : ' Dimension="' + dims[0] + '*' + dims[1] + '"';

    let xml = p + '<P Name="' + escapeXml(name) + '" Class="struct"' + dimAttr + '>\n';
    for (const elem of elements) {
      xml += ip + '<Element>\n';
      for (const [field, fieldVal] of Object.entries(elem)) {
        xml += DataNode.serializePropertyXml(field, fieldVal, indent + 2, null) + '\n';
      }
      xml += ip + '</Element>\n';
    }
    xml += p + '</P>';
    return xml;
  }

  static _serializeCellPropertyXml(name: string, value: Record<string, unknown>, indent: number): string {
    const p = xmlPad(indent);
    const dims = (value._dimensions as number[]) || [1, 1];
    const elements = (value._elements as unknown[]) || [];

    let xml = p + '<P Name="' + escapeXml(name) + '" Class="cell" Dimension="' + dims[0] + '*' + dims[1] + '">\n';
    for (const elem of elements) {
      xml += DataNode._serializeCellElementXml(elem, indent + 1) + '\n';
    }
    xml += p + '</P>';
    return xml;
  }

  static _serializeCellElementXml(elem: unknown, indent: number): string {
    const p = xmlPad(indent);
    if (typeof elem === 'number') {
      return p + '<Element Class="double">' + formatDoubleXml(elem) + '</Element>';
    }
    if (typeof elem === 'boolean') {
      return p + '<Element Class="logical">' + (elem ? '1' : '0') + '</Element>';
    }
    if (typeof elem === 'string') {
      return p + '<Element Class="char">' + escapeXml(elem) + '</Element>';
    }
    if (Array.isArray(elem)) {
      if (elem.length === 0) {
        return p + '<Element Class="double" Dimension="0*0"/>';
      }
      const formatted = elem.map(function (v: number) {
        return formatDoubleXml(v);
      });
      return p + '<Element Class="double" Dimension="1*' + elem.length + '">' + formatted.join(' ') + '</Element>';
    }
    if (typeof elem === 'object' && elem !== null && (elem as Record<string, unknown>)._type) {
      const obj = elem as Record<string, unknown>;
      const type = obj._type as string;
      const raw = String(obj._value);
      const vecMatch = raw.match(/^\[(.+)\]$/);
      if (vecMatch) {
        const parts = vecMatch[1].split(',').map(function (s: string) {
          return parseFloat(s.trim().replace(/[FU]$/, ''));
        });
        return (
          p +
          '<Element Class="' +
          type +
          '" Dimension="1*' +
          parts.length +
          '">' +
          parts
            .map(function (v: number) {
              return formatNumericXml(v, type);
            })
            .join(' ') +
          '</Element>'
        );
      }
      const num = parseFloat(raw.replace(/[FU]$/, ''));
      return p + '<Element Class="' + type + '">' + formatNumericXml(num, type) + '</Element>';
    }
    return p + '<Element Class="char">' + escapeXml(String(elem)) + '</Element>';
  }

  static _parseMatrixNums(body: string, _type: string): number[] {
    const cleaned = body.replace(/^\[/, '').replace(/\]$/, '');
    const rows = cleaned.split(';').map(function (s: string) {
      return s.trim().replace(/^\[/, '').replace(/\]$/, '');
    });
    const nums: number[] = [];
    for (const row of rows) {
      const parts = row.split(',').map(function (s: string) {
        return parseFloat(s.trim().replace(/[FU]$/, ''));
      });
      nums.push(...parts);
    }
    return nums;
  }
}
