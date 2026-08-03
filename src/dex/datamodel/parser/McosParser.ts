// Copyright 2026 The MathWorks, Inc.

import { parseMatrix, MatVariable } from './MatParser';

export interface McosObjectData {
  name: string;
  className: string;
  packageName: string;
  shortClassName: string;
  properties: Record<string, unknown>;
  dimensions: number[];
  value: unknown;
}

interface SubElement {
  type: number;
  bytes: number;
  dataOffset: number;
  totalSize: number;
}

interface ClassInfo {
  numProperties: number;
  classNameStringIndex: number;
}

const MI_MATRIX = 14;
const MCOS_HANDLE_MAGIC = 3707764736; // 0xDD000000

function align8(n: number): number {
  return n + ((8 - (n % 8)) % 8);
}

function readSubelement(view: DataView, offset: number): SubElement {
  const tag = view.getUint32(offset, true);
  const hi = (tag >>> 16) & 0xffff;
  const lo = tag & 0xffff;

  if (hi !== 0 && lo !== 0) {
    return { type: lo, bytes: hi, dataOffset: offset + 4, totalSize: 8 };
  }
  const type = view.getUint32(offset, true);
  const bytes = view.getUint32(offset + 4, true);
  return { type, bytes, dataOffset: offset + 8, totalSize: 8 + align8(bytes) };
}

function parseStringTable(metadata: Uint8Array, endOffset: number): string[] {
  const strings: string[] = [];
  let pos = 40;
  const decoder = new TextDecoder();
  while (pos < endOffset) {
    let end = pos;
    while (end < endOffset && metadata[end] !== 0) end++;
    if (end > pos) {
      strings.push(decoder.decode(metadata.slice(pos, end)));
    } else {
      strings.push('');
    }
    pos = end + 1;
  }
  return strings;
}

function parseClassInfo(metadata: Uint8Array, startOffset: number, endOffset: number): ClassInfo[] {
  const view = new DataView(metadata.buffer, metadata.byteOffset, metadata.byteLength);
  const records: ClassInfo[] = [];
  for (let pos = startOffset; pos + 16 <= endOffset; pos += 16) {
    records.push({
      numProperties: view.getUint32(pos, true),
      classNameStringIndex: view.getUint32(pos + 4, true),
    });
  }
  return records;
}

function findCellArrayInOpaque(
  view: DataView,
  opaqueContentOffset: number,
  opaqueContentLength: number,
): { offset: number; length: number } | null {
  let offset = opaqueContentOffset;
  const end = opaqueContentOffset + opaqueContentLength;

  const flagsSub = readSubelement(view, offset);
  offset += flagsSub.totalSize;

  while (offset < end) {
    const sub = readSubelement(view, offset);
    if (sub.type === MI_MATRIX) {
      return { offset: sub.dataOffset, length: sub.bytes };
    }
    offset += sub.totalSize;
  }
  return null;
}

function isObjectHandle(cell: MatVariable): boolean {
  if (cell.className !== 'uint32') return false;
  const val = cell.value;
  if (Array.isArray(val) && val.length >= 1 && val[0] === MCOS_HANDLE_MAGIC) return true;
  if (val === MCOS_HANDLE_MAGIC) return true;
  return false;
}

function extractCellValue(cell: MatVariable | null): unknown {
  if (!cell) return null;
  return cell.value;
}

// Known leaf-class property definitions with types.
// Extras appear in string-table order but may skip default-valued properties.
const KNOWN_CLASS_PROPERTIES: Record<string, { name: string; type: 'char' | 'numeric' }[]> = {
  'Simulink.Parameter': [
    { name: 'Description', type: 'char' },
    { name: 'DataType', type: 'char' },
    { name: 'Min', type: 'numeric' },
    { name: 'Max', type: 'numeric' },
    { name: 'DocUnits', type: 'char' },
  ],
  'Simulink.Signal': [
    { name: 'Description', type: 'char' },
    { name: 'DataType', type: 'char' },
    { name: 'Min', type: 'numeric' },
    { name: 'Max', type: 'numeric' },
    { name: 'DocUnits', type: 'char' },
  ],
};

function assignPropertyNames(
  extras: { value: unknown; cellClass: string }[],
  fullClassName: string,
  classInfo: ClassInfo | null,
  strings: string[],
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  if (extras.length === 0) return properties;

  const known = KNOWN_CLASS_PROPERTIES[fullClassName];
  if (known) {
    // All extras present → 1:1 assignment
    if (extras.length === known.length) {
      for (let i = 0; i < extras.length; i++) {
        properties[known[i].name] = extras[i].value;
      }
      return properties;
    }

    // Type-based assignment: count char/numeric extras and match against candidates
    const charExtras = extras.filter((e) => e.cellClass === 'char');
    const numExtras = extras.filter((e) => e.cellClass !== 'char');
    const charProps = known.filter((p) => p.type === 'char');
    const numProps = known.filter((p) => p.type === 'numeric');

    // If char count matches exactly, assign 1:1 within type
    // If numeric count matches exactly, assign 1:1 within type
    const charAssignable = charExtras.length === charProps.length;
    const numAssignable = numExtras.length === numProps.length;

    if (charAssignable || numAssignable) {
      let charIdx = 0;
      let numIdx = 0;
      for (const extra of extras) {
        if (extra.cellClass === 'char') {
          if (charAssignable && charIdx < charProps.length) {
            properties[charProps[charIdx].name] = extra.value;
          } else {
            properties[charIdx < charProps.length ? charProps[charIdx].name : `charProp${charIdx}`] = extra.value;
          }
          charIdx++;
        } else {
          if (numAssignable && numIdx < numProps.length) {
            properties[numProps[numIdx].name] = extra.value;
          } else {
            properties[numIdx < numProps.length ? numProps[numIdx].name : `numProp${numIdx}`] = extra.value;
          }
          numIdx++;
        }
      }
      return properties;
    }

    // Fallback: type-based assignment with first-available names
    let charIdx = 0;
    let numIdx = 0;
    for (const extra of extras) {
      if (extra.cellClass === 'char') {
        const name = charIdx < charProps.length ? charProps[charIdx].name : `charProp${charIdx}`;
        properties[name] = extra.value;
        charIdx++;
      } else {
        const name = numIdx < numProps.length ? numProps[numIdx].name : `numProp${numIdx}`;
        properties[name] = extra.value;
        numIdx++;
      }
    }
    return properties;
  }

  // Unknown class: use string table if available
  if (classInfo) {
    const startIdx = classInfo.classNameStringIndex;
    for (let i = 0; i < extras.length; i++) {
      const idx = startIdx + i;
      const propName = idx < strings.length ? strings[idx] : `prop${i}`;
      properties[propName] = extras[i].value;
    }
  } else {
    for (let i = 0; i < extras.length; i++) {
      properties[`prop${i}`] = extras[i].value;
    }
  }
  return properties;
}

function findObjectAnchors(cells: (MatVariable | null)[], packageName: string, shortClassName: string): number[] {
  const anchors: number[] = [];
  for (let i = 2; i < cells.length - 2; i++) {
    const pkgCell = cells[i];
    const clsCell = cells[i + 1];
    if (
      pkgCell &&
      pkgCell.className === 'char' &&
      pkgCell.value === packageName &&
      clsCell &&
      clsCell.className === 'char' &&
      clsCell.value === shortClassName
    ) {
      anchors.push(i);
    }
  }
  return anchors;
}

function getAllAnchors(
  cells: (MatVariable | null)[],
  varsByClass: Map<string, { name: string; className: string }[]>,
): number[] {
  const valuePositions: number[] = [];
  varsByClass.forEach((_vars, fullClassName) => {
    const { packageName, shortClassName } = splitClassName(fullClassName);
    const anchors = findObjectAnchors(cells, packageName, shortClassName);
    for (const anchor of anchors) {
      valuePositions.push(anchor - 2);
    }
  });
  valuePositions.sort((a, b) => a - b);
  return valuePositions;
}

function splitClassName(fullClassName: string): { packageName: string; shortClassName: string } {
  const lastDot = fullClassName.lastIndexOf('.');
  if (lastDot === -1) {
    return { packageName: '', shortClassName: fullClassName };
  }
  return {
    packageName: fullClassName.substring(0, lastDot),
    shortClassName: fullClassName.substring(lastDot + 1),
  };
}

export function decodeMcosBlob(
  anonRawBytes: Uint8Array,
  opaqueVars: { name: string; className: string }[],
): Map<string, McosObjectData> {
  const result = new Map<string, McosObjectData>();
  if (!anonRawBytes || anonRawBytes.length === 0 || opaqueVars.length === 0) {
    return result;
  }

  const outerView = new DataView(anonRawBytes.buffer, anonRawBytes.byteOffset, anonRawBytes.byteLength);

  // Parse the outer MI_MATRIX tag to get the uint8 payload
  const outerType = outerView.getUint32(0, true);
  const outerBytes = outerView.getUint32(4, true);
  if (outerType !== MI_MATRIX) {
    return result;
  }

  const outerMatrix = parseMatrix(outerView, 8, outerBytes);
  let blobBytes: Uint8Array;
  if (outerMatrix.className === 'uint8' && outerMatrix.value) {
    const val = outerMatrix.value;
    if (val instanceof Uint8Array) {
      blobBytes = val;
    } else if (Array.isArray(val)) {
      blobBytes = new Uint8Array(val as number[]);
    } else {
      return result;
    }
  } else {
    return result;
  }

  // The blob has an 8-byte header: 2-byte version + 2-byte endian + 4 bytes padding
  if (blobBytes.length < 16) {
    return result;
  }

  const blobView = new DataView(blobBytes.buffer, blobBytes.byteOffset, blobBytes.byteLength);

  // Parse the MI_MATRIX at offset 8 within the blob (the struct with field "MCOS")
  const structSub = readSubelement(blobView, 8);
  if (structSub.type !== MI_MATRIX) {
    return result;
  }

  const structMatrix = parseMatrix(blobView, structSub.dataOffset, structSub.bytes);

  // The struct should have an "MCOS" field which is opaque
  let mcosField: MatVariable | null = null;
  if (structMatrix.fields && structMatrix.fields['MCOS']) {
    mcosField = structMatrix.fields['MCOS'] as MatVariable;
  }

  if (!mcosField || !mcosField.isOpaque) {
    return result;
  }

  // Navigate the opaque MCOS field to find the inner cell array.
  // The MCOS field's _rawBytes contain its full MI_MATRIX element (tag + content).
  // We need to find the cell array inside the opaque structure.
  let cellArray: MatVariable | null = null;

  if (mcosField._rawBytes) {
    const opaqueBytes = mcosField._rawBytes;
    const opaqueView = new DataView(opaqueBytes.buffer, opaqueBytes.byteOffset, opaqueBytes.byteLength);
    const opaqueTag = readSubelement(opaqueView, 0);
    if (opaqueTag.type === MI_MATRIX) {
      const cellLoc = findCellArrayInOpaque(opaqueView, opaqueTag.dataOffset, opaqueTag.bytes);
      if (cellLoc) {
        cellArray = parseMatrix(opaqueView, cellLoc.offset, cellLoc.length);
      }
    }
  }

  if (!cellArray || cellArray.className !== 'cell' || !Array.isArray(cellArray.value)) {
    return result;
  }

  const cells = cellArray.value as (MatVariable | null)[];
  if (cells.length < 1 || !cells[0]) {
    return result;
  }

  // Cell[0] is the metadata (uint8 array)
  const metadataCell = cells[0];
  let metadata: Uint8Array;
  if (metadataCell.className === 'uint8' && metadataCell.value) {
    const val = metadataCell.value;
    if (val instanceof Uint8Array) {
      metadata = val;
    } else if (Array.isArray(val)) {
      metadata = new Uint8Array(val as number[]);
    } else {
      return result;
    }
  } else {
    return result;
  }

  if (metadata.length < 40) {
    return result;
  }

  // Parse the 10-uint32 header of the metadata
  const metaView = new DataView(metadata.buffer, metadata.byteOffset, metadata.byteLength);
  const sectionOffsets: number[] = [];
  for (let i = 0; i < 10; i++) {
    sectionOffsets.push(metaView.getUint32(i * 4, true));
  }

  const section2Start = sectionOffsets[2];
  const section3Start = sectionOffsets[3];

  // Parse string table (from byte 40 to section2Start)
  const strings = parseStringTable(metadata, section2Start);

  // Parse class info (section 2 to section 3)
  const classInfos = parseClassInfo(metadata, section2Start, section3Start);

  // Group opaque vars by className
  const varsByClass = new Map<string, { name: string; className: string }[]>();
  for (const v of opaqueVars) {
    const existing = varsByClass.get(v.className) || [];
    existing.push(v);
    varsByClass.set(v.className, existing);
  }

  // For each class, try anchor pattern first, fall back to heap-based
  varsByClass.forEach((vars, fullClassName) => {
    const { packageName, shortClassName } = splitClassName(fullClassName);
    const anchors = findObjectAnchors(cells, packageName, shortClassName);

    // Find the class info record for this class
    let leafClassInfo: ClassInfo | null = null;
    for (let i = 0; i < classInfos.length; i++) {
      const ci = classInfos[i];
      if (ci.classNameStringIndex < strings.length && strings[ci.classNameStringIndex] === fullClassName) {
        leafClassInfo = ci;
        break;
      }
    }

    if (anchors.length >= vars.length) {
      // Anchor pattern found — use for precise extraction
      const allAnchors = getAllAnchors(cells, varsByClass);
      const count = Math.min(anchors.length, vars.length);
      for (let objIdx = 0; objIdx < count; objIdx++) {
        const anchor = anchors[objIdx];
        const opaqueVar = vars[objIdx];

        const valueCell = cells[anchor - 2] || null;
        const dimsCell = cells[anchor - 1] || null;
        let dimensions: number[] = [1, 1];
        if (dimsCell && dimsCell.className === 'double') {
          const dv = dimsCell.value;
          if (Array.isArray(dv)) {
            dimensions = dv as number[];
          } else if (typeof dv === 'number') {
            dimensions = [dv];
          }
        }

        let propStart = anchor + 3;
        while (propStart < cells.length && cells[propStart] && isObjectHandle(cells[propStart]!)) {
          propStart++;
        }

        const nextAnchorIdx = allAnchors.indexOf(anchor - 2) + 1;
        const cellEnd = nextAnchorIdx < allAnchors.length ? allAnchors[nextAnchorIdx] : cells.length;

        const extras: { value: unknown; cellClass: string }[] = [];
        for (let cellIdx = propStart; cellIdx < cellEnd; cellIdx++) {
          const cell = cells[cellIdx];
          if (!cell) break;
          if (isObjectHandle(cell)) break;
          extras.push({ value: extractCellValue(cell), cellClass: cell.className });
        }

        const properties = assignPropertyNames(extras, fullClassName, leafClassInfo, strings);
        result.set(opaqueVar.name, {
          name: opaqueVar.name,
          className: fullClassName,
          packageName,
          shortClassName,
          properties,
          dimensions,
          value: extractCellValue(valueCell),
        });
      }
    }
  });

  return result;
}
