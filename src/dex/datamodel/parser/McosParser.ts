// Copyright 2026 The MathWorks, Inc.

import { parseMatrix, MatVariable } from './MatParser';

// Decodes the binary MCOS (MATLAB Class Object System) blob embedded in .slx and
// .mat files into per-variable property bags shaped EXACTLY like the SLDD (JSON)
// path's `_properties`, so the same Simulink object resolves to the same typed
// data-model node with the same values regardless of source format.
//
// The metadata table (`cell[0]`) layout was reverse-engineered and validated
// against controlled fixtures (see docs/deep-work/mcos-property-decode.md):
//   • Header: 10 uint32 words at [0,40); w[2..] are segment END offsets.
//   • String table: null-terminated ASCII [40, w[2]); index 0 is the empty string.
//   • Class table: [w[2], w[3]) 16-byte rows [pkgStrIdx, clsStrIdx, 0, 0], 0-based.
//   • Object table: [w[4], w[5]) 24-byte rows; word0 = classId (0-based). Row 0 is
//     the synthetic null object.
//   • Property blocks: [w[5], w[6)); ONE block per object in object order (the
//     null object included), each [nProps, (nameStrIdx, flag, value)*nProps] then
//     padded to an 8-byte boundary. The i-th block belongs to obj[i] — positional,
//     no indirection.
//   • flag 1 → value is a heap-cell index; the mxArray is cells[value + 2].
//     flag 0 → value is a string-table index (enum/string literal).
//     flag 2 → value is an inline boolean (value !== 0).
//   • Object-handle heap cells are uint32 arrays with v[0] == 0xDD000000; v[4] is
//     the referenced object id (nested objects / children recurse through this).
//
// A named opaque variable's OWN raw bytes carry an object handle whose v[4] is its
// ROOT object id in the object table — this is how one blob with many objects maps
// each named variable to its own object graph.
//
// Correctness over coverage: anything that cannot be resolved with confidence is
// left out rather than guessed.

export interface McosObjectData {
  name: string;
  className: string;
  packageName: string;
  shortClassName: string;
  // Reconstructed `_properties` bag in the same shape the SLDD path produces:
  // scalars as numbers/strings/booleans, matrices as a Matrix(r,c) value object,
  // nested objects as { _object_class, _properties }.
  properties: Record<string, unknown>;
  dimensions: number[];
  // Convenience mirror of properties.Value for the opaque-fallback display path.
  value: unknown;
}

interface SubElement {
  type: number;
  bytes: number;
  dataOffset: number;
  totalSize: number;
}

interface ClassRow {
  fullName: string;
}

interface ObjectRow {
  classId: number;
}

type Triple = [nameIdx: number, flag: number, value: number];

interface MetaTable {
  strings: string[];
  classes: ClassRow[];
  objects: ObjectRow[];
  blocks: Triple[][];
}

interface DecodeContext {
  cells: (MatVariable | null)[];
  meta: MetaTable;
}

const MI_MATRIX = 14;
const MCOS_HANDLE_MAGIC = 3707764736; // 0xDD000000
const MAX_RECURSION_DEPTH = 32;

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

function toUint8(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return new Uint8Array(value as number[]);
  return null;
}

// ---- Navigation: raw element bytes -> the MCOS cell array (cells[]) -----------

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

// Walk the anonymous FileWrapper element: outer uint8 matrix -> inner struct with
// an opaque "MCOS" field -> that field's cell array. Returns cells[] or null.
function extractCells(anonRawBytes: Uint8Array): (MatVariable | null)[] | null {
  const outerView = new DataView(anonRawBytes.buffer, anonRawBytes.byteOffset, anonRawBytes.byteLength);
  if (outerView.getUint32(0, true) !== MI_MATRIX) return null;

  const outerMatrix = parseMatrix(outerView, 8, outerView.getUint32(4, true));
  const blobBytes = outerMatrix.className === 'uint8' ? toUint8(outerMatrix.value) : null;
  if (!blobBytes || blobBytes.length < 16) return null;

  const blobView = new DataView(blobBytes.buffer, blobBytes.byteOffset, blobBytes.byteLength);
  const structSub = readSubelement(blobView, 8);
  if (structSub.type !== MI_MATRIX) return null;

  const structMatrix = parseMatrix(blobView, structSub.dataOffset, structSub.bytes);
  const mcosField =
    structMatrix.fields && structMatrix.fields['MCOS'] ? (structMatrix.fields['MCOS'] as MatVariable) : null;
  if (!mcosField || !mcosField.isOpaque || !mcosField._rawBytes) return null;

  const opaqueView = new DataView(mcosField._rawBytes.buffer, mcosField._rawBytes.byteOffset, mcosField._rawBytes.byteLength);
  const opaqueTag = readSubelement(opaqueView, 0);
  if (opaqueTag.type !== MI_MATRIX) return null;

  const cellLoc = findCellArrayInOpaque(opaqueView, opaqueTag.dataOffset, opaqueTag.bytes);
  if (!cellLoc) return null;

  const cellArray = parseMatrix(opaqueView, cellLoc.offset, cellLoc.length);
  if (cellArray.className !== 'cell' || !Array.isArray(cellArray.value)) return null;
  return cellArray.value as (MatVariable | null)[];
}

// ---- Metadata table parse -----------------------------------------------------

function parseMetaTable(cells: (MatVariable | null)[]): MetaTable | null {
  if (cells.length < 1 || !cells[0]) return null;
  const metadata = cells[0].className === 'uint8' ? toUint8(cells[0].value) : null;
  if (!metadata || metadata.length < 40) return null;

  const view = new DataView(metadata.buffer, metadata.byteOffset, metadata.byteLength);
  const u32 = (o: number) => view.getUint32(o, true);
  const w: number[] = [];
  for (let i = 0; i < 10; i++) w.push(u32(i * 4));

  // Segment offsets must be monotonic and within bounds to be trustworthy.
  if (!(40 <= w[2] && w[2] <= w[3] && w[3] <= w[4] && w[4] <= w[5] && w[5] <= w[6] && w[6] <= metadata.length)) {
    return null;
  }

  // String table: index 0 is the synthetic empty string; real strings are 1-based.
  const decoder = new TextDecoder();
  const strings: string[] = [''];
  for (let p = 40; p < w[2]; ) {
    let e = p;
    while (e < w[2] && metadata[e] !== 0) e++;
    strings.push(decoder.decode(metadata.slice(p, e)));
    p = e + 1;
  }

  // Class table: 0-based rows. fullName = "pkg.cls" (or just "cls" when no package).
  const classes: ClassRow[] = [];
  for (let p = w[2]; p + 16 <= w[3]; p += 16) {
    const pkg = strings[u32(p)] || '';
    const cls = strings[u32(p + 4)] || '';
    classes.push({ fullName: pkg ? pkg + '.' + cls : cls });
  }

  // Object table: 0-based rows; word0 = classId. Row 0 is the null object.
  const objects: ObjectRow[] = [];
  for (let p = w[4]; p + 24 <= w[5]; p += 24) {
    objects.push({ classId: u32(p) });
  }

  // Property blocks: one per object in order, each 8-byte aligned.
  const blocks: Triple[][] = [];
  for (let p = w[5]; p < w[6]; ) {
    const start = p;
    const nProps = u32(p);
    p += 4;
    // Defensive: a wildly large count means we lost alignment — stop rather than
    // fabricate. Empty (nProps == 0) blocks are real per-object placeholders.
    if (nProps > 1000 || p + nProps * 12 > w[6]) break;
    const triples: Triple[] = [];
    for (let k = 0; k < nProps; k++) {
      triples.push([u32(p), u32(p + 4), u32(p + 8)]);
      p += 12;
    }
    blocks.push(triples);
    p = start + align8(p - start);
  }

  return { strings, classes, objects, blocks };
}

// ---- Value resolution ---------------------------------------------------------

function isObjectHandle(cell: MatVariable): boolean {
  if (cell.className !== 'uint32') return false;
  const v = cell.value;
  return Array.isArray(v) && v.length >= 5 && v[0] === MCOS_HANDLE_MAGIC;
}

function buildMatrixValue(dims: number[], elements: number[]): unknown {
  const rows = dims[0];
  const cols = dims[1];
  const rowStrs: string[] = [];
  for (let r = 0; r < rows; r++) {
    const vals: string[] = [];
    for (let c = 0; c < cols; c++) {
      vals.push(String(elements[r * cols + c]));
    }
    rowStrs.push('[' + vals.join(', ') + ']');
  }
  // Same shape the SLDD path emits, so displayValue formats identically.
  return { _type: 'double', _value: 'Matrix(' + rows + ',' + cols + ')\n' + rowStrs.join('\n') };
}

// Turn a heap cell into a property value. Object handles recurse into nested
// { _object_class, _properties }. Unresolvable cells return undefined (dropped).
function resolveCellValue(cell: MatVariable | null, ctx: DecodeContext, path: Set<number>, depth: number): unknown {
  if (!cell) return undefined;

  if (isObjectHandle(cell)) {
    const refId = (cell.value as number[])[4];
    return buildObjectValue(refId, ctx, path, depth + 1);
  }

  const cls = cell.className;
  const val = cell.value;

  if (cls === 'char') {
    return typeof val === 'string' ? val : '';
  }
  if (cls === 'logical') {
    if (Array.isArray(val)) return val.map((x) => !!x);
    return !!val;
  }
  // Numeric classes (double, single, intN, uintN).
  if (typeof val === 'number') {
    return val;
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return [];
    const dims = cell.dimensions || [1, val.length];
    if (dims.length >= 2 && dims[0] > 1 && dims[1] > 1) {
      return buildMatrixValue(dims, val as number[]);
    }
    return val;
  }
  return undefined;
}

// Build the _properties bag for an object id, resolving each triple. Nested calls
// wrap the result as { _object_class, _properties }; the caller for a root object
// takes .properties directly.
function buildProperties(objId: number, ctx: DecodeContext, path: Set<number>, depth: number): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  if (depth > MAX_RECURSION_DEPTH || path.has(objId)) return props;
  const obj = ctx.meta.objects[objId];
  if (!obj) return props;

  path.add(objId);
  const block = ctx.meta.blocks[objId] || [];
  for (const [nameIdx, flag, value] of block) {
    const name = ctx.meta.strings[nameIdx];
    if (!name) continue;
    let resolved: unknown;
    if (flag === 1) {
      resolved = resolveCellValue(ctx.cells[value + 2] || null, ctx, path, depth);
    } else if (flag === 0) {
      resolved = ctx.meta.strings[value] ?? '';
    } else if (flag === 2) {
      resolved = value !== 0;
    } else {
      continue; // unknown flag — never guess
    }
    if (resolved !== undefined) {
      props[name] = resolved;
    }
  }
  path.delete(objId);
  return props;
}

function buildObjectValue(objId: number, ctx: DecodeContext, path: Set<number>, depth: number): unknown {
  const obj = ctx.meta.objects[objId];
  if (!obj) return undefined;
  const cls = ctx.meta.classes[obj.classId];
  const properties = buildProperties(objId, ctx, path, depth);
  return { _object_class: cls ? cls.fullName : '', _properties: properties };
}

// ---- Named-variable -> root object id -----------------------------------------

function splitClassName(fullClassName: string): { packageName: string; shortClassName: string } {
  const lastDot = fullClassName.lastIndexOf('.');
  if (lastDot === -1) return { packageName: '', shortClassName: fullClassName };
  return { packageName: fullClassName.substring(0, lastDot), shortClassName: fullClassName.substring(lastDot + 1) };
}

// A named opaque variable's own element bytes contain an object handle; the word
// at (magic + 4) is its root object id. Returns 0 (not found) if absent.
function rootObjectIdFromRaw(rawBytes: Uint8Array | null | undefined): number {
  if (!rawBytes || rawBytes.length < 4) return 0;
  const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
  for (let o = 0; o + 24 <= rawBytes.length; o += 4) {
    if (view.getUint32(o, true) === MCOS_HANDLE_MAGIC) {
      return view.getUint32(o + 16, true); // magic is v[0]; v[4] is 16 bytes on
    }
  }
  return 0;
}

export interface OpaqueVarRef {
  name: string;
  className: string;
  rawBytes?: Uint8Array | null;
}

export function decodeMcosBlob(anonRawBytes: Uint8Array, opaqueVars: OpaqueVarRef[]): Map<string, McosObjectData> {
  const result = new Map<string, McosObjectData>();
  if (!anonRawBytes || anonRawBytes.length === 0 || opaqueVars.length === 0) return result;

  const cells = extractCells(anonRawBytes);
  if (!cells) return result;
  const meta = parseMetaTable(cells);
  if (!meta) return result;

  const ctx: DecodeContext = { cells, meta };

  for (const v of opaqueVars) {
    const rootId = rootObjectIdFromRaw(v.rawBytes);
    if (rootId <= 0 || rootId >= meta.objects.length) continue;

    // Confidence check: the root object's class must match the variable's declared
    // class. If it doesn't, we located the wrong object — skip rather than guess.
    const rootClass = meta.classes[meta.objects[rootId].classId];
    if (!rootClass || rootClass.fullName !== v.className) continue;

    const properties = buildProperties(rootId, ctx, new Set<number>(), 0);
    const { packageName, shortClassName } = splitClassName(v.className);
    result.set(v.name, {
      name: v.name,
      className: v.className,
      packageName,
      shortClassName,
      properties,
      dimensions: [1, 1],
      value: properties.Value,
    });
  }

  return result;
}
