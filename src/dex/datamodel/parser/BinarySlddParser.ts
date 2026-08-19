// Copyright 2026 The MathWorks, Inc.

import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (name: string) => name === 'Object' || name === 'P' || name === 'Element',
  trimValues: false,
});

interface XmlNode {
  '@_Class'?: string;
  '@_Name'?: string;
  '@_Dimension'?: string;
  '@_IsComplex'?: string;
  '@_Source'?: string;
  '@_FormatVersion'?: string;
  '@_MinRelease'?: string;
  '@_Arch'?: string;
  '#text'?: string | number;
  P?: XmlNode[];
  Element?: XmlNode[];
  Object?: XmlNode[];
}

export function parseBinarySldd(arrayBuffer: ArrayBuffer): Record<string, unknown> {
  const uint8 = new Uint8Array(arrayBuffer);
  const entries = unzipSync(uint8);
  const decoder = new TextDecoder();

  const dataXml = entries['data/chunk0.xml'];
  if (!dataXml) {
    throw new Error('Missing data/chunk0.xml in binary SLDD');
  }
  const xmlString = decoder.decode(dataXml);

  const zipMetadata: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(entries)) {
    if (name !== 'data/chunk0.xml') {
      zipMetadata[name] = data;
    }
  }

  return parseBinarySlddParts(xmlString, zipMetadata);
}

// Build the model content from a live data/chunk0.xml string plus the pass-through
// zip parts, without a zip/unzip round-trip. Used by the writable binary editor to
// rebuild the model after each in-memory edit, and by the save gate to re-validate.
export function parseBinarySlddParts(
  xmlString: string,
  zipMetadata: Record<string, Uint8Array>,
): Record<string, unknown> {
  const decoder = new TextDecoder();

  let release = '';
  if (zipMetadata['metadata/mwcoreProperties.xml']) {
    const xml = decoder.decode(zipMetadata['metadata/mwcoreProperties.xml']);
    const match = xml.match(/<matlabRelease>([^<]+)<\/matlabRelease>/);
    if (match) {
      release = match[1];
    }
  }

  const doc = xmlParser.parse(xmlString);
  const dataSource = doc.DataSource as XmlNode;
  const dataSourceAttrs = {
    FormatVersion: dataSource['@_FormatVersion'] || '1',
    MinRelease: dataSource['@_MinRelease'] || 'R2014a',
    Arch: dataSource['@_Arch'] || '',
  };

  const entryXmlFragments = extractEntryFragments(xmlString);
  const ddEntries: Record<string, unknown>[] = [];
  const objects = (dataSource.Object || []) as XmlNode[];

  let entryIdx = 0;
  for (const obj of objects) {
    const objClass = obj['@_Class'];
    if (objClass === 'DD.ENTRY') {
      ddEntries.push(parseEntry(obj, entryXmlFragments[entryIdx] || ''));
      entryIdx++;
    }
  }

  let allowAccessBWS = false;
  const dictionaryReferences: string[] = [];
  for (const obj of objects) {
    if (obj['@_Class'] === 'DD.Dictionary') {
      const abws = getProperty(obj, 'AccessBaseWorkspace');
      if (abws === '1' || abws === 'true') {
        allowAccessBWS = true;
      }
    }
    // Referenced sub-dictionaries (sldd -> sldd) are stored as
    // <Object Class="DD.DICTIONARYREFERENCE"><P Name="Subdictionary">x.sldd</P></Object>
    if (obj['@_Class'] === 'DD.DICTIONARYREFERENCE') {
      const sub = getProperty(obj, 'Subdictionary');
      if (sub) {
        dictionaryReferences.push(sub);
      }
    }
  }

  return {
    __MW_TEXT_COREPROPERTIES__: { release },
    __MW_TEXT_PARTS__: {
      '__MW_TEXT_PART__/data/chunk0': {
        __MW_TEXT_content: {
          entries: ddEntries,
          'Dictionary References': dictionaryReferences,
          AllowAccessBWS: allowAccessBWS,
        },
      },
    },
    __rawXml: xmlString,
    __zipMetadata: zipMetadata,
    __dataSourceAttrs: dataSourceAttrs,
  };
}

function extractEntryFragments(xmlString: string): string[] {
  const fragments: string[] = [];
  const openTag = '<Object Class="DD.ENTRY">';
  const closeTag = '</Object>';
  let pos = 0;
  while (true) {
    const start = xmlString.indexOf(openTag, pos);
    if (start < 0) {
      break;
    }
    const end = xmlString.indexOf(closeTag, start);
    if (end < 0) {
      break;
    }
    fragments.push(xmlString.substring(start, end + closeTag.length));
    pos = end + closeTag.length;
  }
  return fragments;
}

function parseEntry(obj: XmlNode, rawXml: string): Record<string, unknown> {
  const name = getProperty(obj, 'Name') || '';
  const uuid = getProperty(obj, 'UUID') || '';
  const namespace = getProperty(obj, 'Namespace') || '';
  const lastMod = getProperty(obj, 'LastMod') || '';
  const lastModBy = getProperty(obj, 'LastModBy') || '';
  const isDerived = getProperty(obj, 'IsDerived') || '0';

  const valueProp = getPropertyNode(obj, 'Value');
  let value: unknown = null;
  if (valueProp) {
    value = parseEntryValue(valueProp);
  }

  return {
    name,
    metadata: {
      uuid,
      namespace,
      lastModifiedDate: formatDate(lastMod),
      lastModifiedBy: lastModBy,
      isderived: isDerived,
      _rawLastMod: lastMod,
    },
    value,
    rawXml,
  };
}

function parseEntryValue(prop: XmlNode): unknown {
  const className = prop['@_Class'] || null;
  const dimension = prop['@_Dimension'] || null;
  const elements = prop.Element;

  // Struct: Class="struct" with Element children (no Class on Element)
  if (className === 'struct') {
    const dimParts = dimension ? dimension.split('*').map(Number) : [1, 1];
    const elems = elements || [];
    const parsed = elems.map((e) => parseStructElement(e));
    const fields = parsed.length > 0 ? Object.keys(parsed[0]) : [];
    return {
      _array_type: 'Struct',
      _dimensions: dimParts,
      _elements: parsed,
      _fields: fields,
      _mw_element_type: 'MATLABArray',
    };
  }

  // Cell: Class="cell" with Element children
  if (className === 'cell') {
    const dimParts = dimension ? dimension.split('*').map(Number) : [1, 1];
    const elems = elements || [];
    const cellElements = elems.map((e) => parseCellElement(e));
    return {
      _array_type: 'Cell',
      _dimensions: dimParts,
      _elements: cellElements,
      _mw_element_type: 'MATLABArray',
    };
  }

  // String object: Element with Class="string"
  if (elements && elements.length > 0 && elements[0]['@_Class'] === 'string') {
    return parseStringValue(elements[0], dimension);
  }

  // Object: Element(s) with a Simulink class. A single <Element> is a scalar
  // object; MULTIPLE <Element>s are an object ARRAY (e.g. a 3x1 Simulink.Parameter)
  // and every element must be kept so the data model expands one row per element.
  if (elements && elements.length > 0 && elements[0]['@_Class']) {
    if (elements.length === 1) {
      return parseElement(elements[0]);
    }
    const dimParts = dimension ? dimension.split('*').map(Number) : [elements.length, 1];
    return {
      _array_class: elements[0]['@_Class'],
      _dimensions: dimParts,
      _mw_element_type: 'MATLABArray',
      _elements: elements.map((el) => {
        const parsed = parseElement(el);
        const inner = (parsed._elements as Record<string, unknown>[])[0];
        return { _properties: inner._properties };
      }),
    };
  }

  // Char scalar (no elements, Class="char")
  if (className === 'char') {
    return getTextContent(prop) || '';
  }

  // Logical scalar (no dimension)
  if (className === 'logical' && !dimension) {
    const text = getTextContent(prop);
    return text === '1' || text === 'true';
  }

  // Numeric scalar or array
  const text = getTextContent(prop);
  if (prop['@_IsComplex'] === '1') {
    const result: Record<string, unknown> = { _type: 'cdata', _value: text };
    if (dimension) {
      result._dimensions = dimension.split('*').map(Number);
    }
    return result;
  }
  const type = className || 'double';
  if (dimension) {
    const dimParts = dimension.split('*').map(Number);
    const total = dimParts.reduce((a, b) => a * b, 1);
    if (total === 0) {
      return { _type: type, _emptyDims: dimParts };
    }
    // Logical vector
    if (type === 'logical') {
      const parts = text.trim().split(/\s+/);
      return { _type: 'logical', _value: '[' + parts.join(', ') + ']' };
    }
    const parts = text.trim().split(/\s+/).map(Number);
    // Column-major to row-major transpose
    const rowMajor = transposeColumnMajor(parts, dimParts);
    // Row vector (1*N)
    if (dimParts[0] === 1) {
      return formatTypedVector(rowMajor, type);
    }
    // Column or matrix
    return formatMatrix(rowMajor, dimParts, type);
  }

  return formatTypedScalar(text, type);
}

function parseCellElement(el: XmlNode): unknown {
  const elClass = el['@_Class'] || '';
  const dimension = el['@_Dimension'] || null;
  const text = getTextContent(el);

  if (
    elClass === 'double' ||
    elClass === 'single' ||
    elClass === 'int32' ||
    elClass === 'uint32' ||
    elClass === 'int16' ||
    elClass === 'uint16' ||
    elClass === 'int8' ||
    elClass === 'uint8'
  ) {
    if (dimension) {
      const dimParts = dimension.split('*').map(Number);
      const total = dimParts.reduce((a, b) => a * b, 1);
      if (total === 0) {
        return { _type: elClass, _value: 'Matrix(' + dimParts[0] + ',' + dimParts[1] + ')' };
      }
      const parts = text.trim().split(/\s+/).map(Number);
      const rowMajor = transposeColumnMajor(parts, dimParts);
      if (dimParts[0] === 1) {
        return formatTypedVector(rowMajor, elClass);
      }
      return formatMatrix(rowMajor, dimParts, elClass);
    }
    if (el['@_IsComplex'] === '1') {
      return { _type: 'cdata', _value: text };
    }
    return formatTypedScalar(text, elClass);
  }
  if (elClass === 'logical') {
    if (dimension) {
      const dimParts = dimension.split('*').map(Number);
      const total = dimParts.reduce((a, b) => a * b, 1);
      if (total === 0) {
        return { _type: 'logical', _value: '[]' };
      }
      const parts = text.trim().split(/\s+/);
      return { _type: 'logical', _value: '[' + parts.join(', ') + ']' };
    }
    return text === '1' || text === 'true';
  }
  if (elClass === 'char') {
    return text || '';
  }
  if (elClass === 'struct') {
    const childElements = el.Element || [];
    const parsed = childElements.map((e) => parseStructElement(e));
    const fields = parsed.length > 0 ? Object.keys(parsed[0]) : [];
    return {
      _array_type: 'Struct',
      _dimensions: [1, 1],
      _elements: parsed,
      _fields: fields,
      _mw_element_type: 'MATLABArray',
    };
  }
  if (elClass === 'cell') {
    const childElements = el.Element || [];
    const dimParts = dimension ? dimension.split('*').map(Number) : [1, childElements.length];
    const cellElements = childElements.map((e) => parseCellElement(e));
    return {
      _array_type: 'Cell',
      _dimensions: dimParts,
      _elements: cellElements,
      _mw_element_type: 'MATLABArray',
    };
  }
  // Nested object
  const childElements = el.Element;
  if (childElements && childElements.length > 0) {
    return parseElement(childElements[0]);
  }
  return text || '';
}

function parseStringValue(el: XmlNode, _outerDimension: string | null): unknown {
  const props = el.P || [];
  const cellProp = props.find((p) => p['@_Source'] === 'saveobj');
  if (!cellProp) {
    return [''];
  }

  const cellDim = cellProp['@_Dimension'];
  const cellElements = cellProp.Element;
  if (!cellElements || cellElements.length === 0) {
    return [''];
  }

  const strings = cellElements.map((e) => getTextContent(e) || '');

  if (cellDim) {
    const dimParts = cellDim.split('*').map(Number);
    if (dimParts[0] === 1 && dimParts[1] === 1) {
      return strings;
    }
    return {
      _array_type: 'String',
      _dimensions: dimParts,
      _elements: strings,
      _mw_element_type: 'MATLABArray',
    };
  }
  return strings;
}

function transposeColumnMajor(values: number[], dims: number[]): number[] {
  const rows = dims[0];
  const cols = dims[1];
  if (rows <= 1) {
    return values;
  }
  const result = new Array(values.length);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      result[r * cols + c] = values[c * rows + r];
    }
  }
  return result;
}

function formatTypedScalar(text: string, type: string): unknown {
  if (type === 'double') {
    return parseFloat(text) || 0;
  }
  const num = parseFloat(text);
  if (type === 'single') {
    return { _type: 'single', _value: formatNumLiteral(num, 'single') };
  }
  if (type === 'uint8' || type === 'uint16' || type === 'uint32') {
    return { _type: type, _value: formatNumLiteral(parseInt(text, 10), type) };
  }
  return { _type: type, _value: text };
}

function formatTypedVector(values: number[], type: string): unknown {
  if (type === 'double') {
    return values;
  }
  const formatted = values.map((v) => formatNumLiteral(v, type));
  return { _type: type, _value: '[' + formatted.join(', ') + ']' };
}

function formatNumLiteral(num: number, type: string): string {
  if (type === 'single') {
    const s = String(num);
    return s + 'F';
  }
  if (type === 'uint8' || type === 'uint16' || type === 'uint32') {
    return String(num) + 'U';
  }
  if (type === 'double') {
    const s = String(num);
    if (!s.includes('.') && !s.includes('e') && !s.includes('E')) {
      return s + '.0';
    }
    return s;
  }
  return String(num);
}

function formatMatrix(values: number[], dims: number[], type: string): unknown {
  const rows = dims[0];
  const cols = dims[1];
  type = type || 'double';
  // Column vector: single bracketed list
  if (cols === 1) {
    const formatted = values.map((v) => formatNumLiteral(v, type));
    return { _type: type, _value: 'Matrix(' + rows + ',' + cols + ')\n[' + formatted.join(', ') + ']' };
  }
  const rowStrs: string[] = [];
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(formatNumLiteral(values[r * cols + c], type));
    }
    rowStrs.push('[' + row.join(', ') + ']');
  }
  return {
    _type: type,
    _value: 'Matrix(' + rows + ',' + cols + ')\n[' + rowStrs.join('; ') + ']',
  };
}

function parsePropContent(prop: XmlNode, handleStructClass = true): unknown {
  const propClass = prop['@_Class'] || null;
  const dimension = prop['@_Dimension'] || null;
  const childElements = prop.Element;

  if (childElements && childElements.length > 0) {
    if (propClass === 'cell') {
      // A nested cell property (with or without a Dimension) serializes its
      // items as <Element> children — decode them like the top-level entry
      // path instead of treating each as a generic object with empty props.
      const dimParts = dimension ? dimension.split('*').map(Number) : [1, childElements.length];
      return {
        _array_type: 'Cell',
        _dimensions: dimParts,
        _elements: childElements.map((e) => parseCellElement(e)),
        _mw_element_type: 'MATLABArray',
      };
    } else if (dimension) {
      return parseArrayOfElements(childElements, dimension, propClass);
    } else if (handleStructClass && propClass === 'struct') {
      const parsed = childElements.map((e) => parseStructElement(e));
      const fields = parsed.length > 0 ? Object.keys(parsed[0]) : [];
      return {
        _array_type: 'Struct',
        _dimensions: [1, 1],
        _elements: parsed,
        _fields: fields,
        _mw_element_type: 'MATLABArray',
      };
    } else if (childElements[0]['@_Class'] === 'string') {
      // A nested MATLAB string property serializes as <Element Class="string">
      // wrapping a saveobj cell of chars — decode it to its text like the
      // top-level entry path does, instead of treating it as a generic object
      // (which drops the value into a bogus "undefined" -> char envelope).
      return parseStringValue(childElements[0], dimension);
    } else if (childElements.length === 1) {
      return parseElement(childElements[0]);
    } else {
      return childElements.map((e) => parseElement(e));
    }
  } else {
    const text = getTextContent(prop);
    return parseTypedValue(text, propClass, dimension);
  }
}

function parseElement(el: XmlNode): Record<string, unknown> {
  const className = el['@_Class'] || '';
  if (!className) {
    return parseStructElement(el);
  }

  const properties: Record<string, unknown> = {};
  const props = el.P || [];
  for (const prop of props) {
    const propName = prop['@_Name']!;
    if (!prop.Element?.length && prop['@_IsComplex'] === '1') {
      const text = getTextContent(prop);
      const dimension = prop['@_Dimension'] || null;
      const result: Record<string, unknown> = { _type: 'cdata', _value: text };
      if (dimension) {
        result._dimensions = dimension.split('*').map(Number);
      }
      properties[propName] = result;
    } else {
      properties[propName] = parsePropContent(prop);
    }
  }

  return {
    _array_class: className,
    _dimensions: [1, 1],
    _mw_element_type: 'MATLABArray',
    _elements: [{ _properties: properties }],
  };
}

function parseStructElement(el: XmlNode): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const props = el.P || [];
  for (const prop of props) {
    result[prop['@_Name']!] = parsePropContent(prop);
  }
  return result;
}

function parseArrayOfElements(
  elements: XmlNode[],
  dimension: string,
  propClass: string | null,
): Record<string, unknown> {
  const dimParts = dimension.split('*').map(Number);

  if (propClass === 'struct') {
    const parsed = elements.map((e) => parseStructElement(e));
    const fields = parsed.length > 0 ? Object.keys(parsed[0]) : [];
    return {
      _array_type: 'Struct',
      _dimensions: dimParts,
      _elements: parsed,
      _fields: fields,
      _mw_element_type: 'MATLABArray',
    };
  }

  const firstClass = elements.length > 0 ? elements[0]['@_Class'] || '' : '';

  const parsed = elements.map((e) => {
    const elClass = e['@_Class'] || '';
    if (!elClass) {
      return { _properties: parseStructElement(e) };
    }
    const elProps: Record<string, unknown> = {};
    const childPs = e.P || [];
    for (const p of childPs) {
      elProps[p['@_Name']!] = parsePropContent(p, false);
    }
    return { _properties: elProps };
  });

  return {
    _array_class: firstClass,
    _dimensions: dimParts,
    _mw_element_type: 'MATLABArray',
    _elements: parsed,
  };
}

function parseTypedValue(text: string, className: string | null, dimension: string | null): unknown {
  if (!className) {
    return text;
  }

  if (dimension) {
    const dimParts = dimension.split('*').map(Number);
    const total = dimParts.reduce((a, b) => a * b, 1);
    if (total === 0) {
      if (isNumericClass(className)) {
        return [];
      }
      return '';
    }

    if (className === 'logical') {
      const parts = text.trim().split(/\s+/);
      return { _type: 'logical', _value: '[' + parts.join(', ') + ']' };
    }

    if (isNumericClass(className)) {
      const parts = text.trim().split(/\s+/).map(Number);
      const rowMajor = transposeColumnMajor(parts, dimParts);
      if (dimParts[0] === 1) {
        return formatTypedVector(rowMajor, className);
      }
      return formatMatrix(rowMajor, dimParts, className);
    }
  }

  switch (className) {
    case 'double':
      return parseFloat(text) || 0;
    case 'single':
    case 'int32':
    case 'uint32':
    case 'int16':
    case 'uint16':
    case 'int8':
    case 'uint8':
      return formatTypedScalar(text, className);
    case 'logical':
      return text === '1' || text === 'true';
    case 'char':
      return text || '';
    default:
      return text || '';
  }
}

function isNumericClass(className: string): boolean {
  return (
    className === 'double' ||
    className === 'single' ||
    className === 'int32' ||
    className === 'uint32' ||
    className === 'int16' ||
    className === 'uint16' ||
    className === 'int8' ||
    className === 'uint8'
  );
}

function getTextContent(node: XmlNode): string {
  if (node['#text'] !== undefined) {
    return String(node['#text']);
  }
  return '';
}

function getProperty(obj: XmlNode, name: string): string | null {
  const props = obj.P || [];
  for (const p of props) {
    if (p['@_Name'] === name) {
      return getTextContent(p);
    }
  }
  return null;
}

function getPropertyNode(obj: XmlNode, name: string): XmlNode | null {
  const props = obj.P || [];
  for (const p of props) {
    if (p['@_Name'] === name) {
      return p;
    }
  }
  return null;
}

function formatDate(matlabDate: string): string {
  if (!matlabDate || matlabDate.length < 15) {
    return matlabDate;
  }
  const year = matlabDate.substring(0, 4);
  const month = matlabDate.substring(4, 6);
  const day = matlabDate.substring(6, 8);
  const hour = matlabDate.substring(9, 11);
  const min = matlabDate.substring(11, 13);
  const sec = matlabDate.substring(13, 15);
  return year + '-' + month + '-' + day + 'T' + hour + ':' + min + ':' + sec + 'Z';
}
