// Copyright 2026 The MathWorks, Inc.

import { unzlibSync } from 'fflate';

const CLASS_NAMES: Record<number, string> = {
    1: 'cell', 2: 'struct', 3: 'object', 4: 'char',
    5: 'sparse', 6: 'double', 7: 'single', 8: 'int8',
    9: 'uint8', 10: 'int16', 11: 'uint16', 12: 'int32',
    13: 'uint32', 14: 'int64', 15: 'uint64'
};

const MI_INT8 = 1;
const MI_UINT8 = 2;
const MI_INT16 = 3;
const MI_UINT16 = 4;
const MI_INT32 = 5;
const MI_UINT32 = 6;
const MI_SINGLE = 7;
const MI_DOUBLE = 9;
const MI_INT64 = 12;
const MI_UINT64 = 13;
const MI_MATRIX = 14;
const MI_COMPRESSED = 15;
const MI_UTF8 = 16;
const MI_UTF16 = 17;

export interface MatVariable {
    name: string;
    className: string;
    dimensions: number[];
    isComplex: boolean;
    isLogical: boolean;
    value: unknown;
    fields: Record<string, unknown> | null;
    _rawBytes?: Uint8Array;
    _modified?: boolean;
    _anonymous?: boolean;
    isOpaque?: boolean;
}

export interface ParsedMat {
    header: string;
    variables: MatVariable[];
}

interface SubElement {
    type: number;
    bytes: number;
    dataOffset: number;
    totalSize: number;
}

function align8(n: number): number {
    return n + ((8 - (n % 8)) % 8);
}

function readSubelement(view: DataView, offset: number): SubElement {
    const tag = view.getUint32(offset, true);
    const hi = (tag >>> 16) & 0xFFFF;
    const lo = tag & 0xFFFF;

    if (hi !== 0 && lo !== 0) {
        return { type: lo, bytes: hi, dataOffset: offset + 4, totalSize: 8 };
    }
    const type = view.getUint32(offset, true);
    const bytes = view.getUint32(offset + 4, true);
    return { type, bytes, dataOffset: offset + 8, totalSize: 8 + align8(bytes) };
}

function readNumericArray(view: DataView, sub: SubElement, count: number): number[] {
    const values: number[] = [];
    const off = sub.dataOffset;
    for (let i = 0; i < count; i++) {
        switch (sub.type) {
        case MI_DOUBLE: values.push(view.getFloat64(off + i * 8, true)); break;
        case MI_SINGLE: values.push(view.getFloat32(off + i * 4, true)); break;
        case MI_INT8: values.push(view.getInt8(off + i)); break;
        case MI_UINT8: values.push(view.getUint8(off + i)); break;
        case MI_INT16: values.push(view.getInt16(off + i * 2, true)); break;
        case MI_UINT16: values.push(view.getUint16(off + i * 2, true)); break;
        case MI_INT32: values.push(view.getInt32(off + i * 4, true)); break;
        case MI_UINT32: values.push(view.getUint32(off + i * 4, true)); break;
        case MI_INT64: values.push(Number(view.getBigInt64(off + i * 8, true))); break;
        case MI_UINT64: values.push(Number(view.getBigUint64(off + i * 8, true))); break;
        default: values.push(0);
        }
    }
    return values;
}

function readString(view: DataView, sub: SubElement): string {
    const bytes = new Uint8Array(view.buffer, view.byteOffset + sub.dataOffset, sub.bytes);
    return new TextDecoder().decode(bytes).replace(/\0/g, '');
}

function transposeFromColMajor(values: unknown[], dimensions: number[]): unknown[] {
    if (values.length <= 1) { return values; }
    const rows = dimensions[0];
    const cols = dimensions[1];
    if (rows <= 1 || cols <= 1) { return values; }
    const result = new Array(values.length);
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            result[r * cols + c] = values[c * rows + r];
        }
    }
    return result;
}

function parseOpaque(view: DataView, offset: number, _end: number): MatVariable {
    const nameSub = readSubelement(view, offset);
    offset += nameSub.totalSize;
    const name = readString(view, nameSub);

    const markerSub = readSubelement(view, offset);
    offset += markerSub.totalSize;

    const classSub = readSubelement(view, offset);
    const className = readString(view, classSub);

    return { name, className, dimensions: [1, 1], isComplex: false, isLogical: false, value: null, fields: null, isOpaque: true };
}

export function parseMatrix(view: DataView, baseOffset: number, length: number): MatVariable {
    let offset = baseOffset;
    const end = baseOffset + length;

    const flagsSub = readSubelement(view, offset);
    offset += flagsSub.totalSize;
    const arrayClass = view.getUint8(flagsSub.dataOffset) & 0xFF;
    const flags = view.getUint8(flagsSub.dataOffset + 1);
    const isComplex = !!(flags & 0x08);
    const isLogical = !!(flags & 0x02);

    if (arrayClass === 17) {
        return parseOpaque(view, offset, end);
    }

    const dimsSub = readSubelement(view, offset);
    offset += dimsSub.totalSize;
    const ndims = dimsSub.bytes / 4;
    const dimensions: number[] = [];
    for (let i = 0; i < ndims; i++) {
        dimensions.push(view.getInt32(dimsSub.dataOffset + i * 4, true));
    }

    const nameSub = readSubelement(view, offset);
    offset += nameSub.totalSize;
    const nameBytes = new Uint8Array(view.buffer, view.byteOffset + nameSub.dataOffset, nameSub.bytes);
    const name = new TextDecoder().decode(nameBytes);

    const totalElements = dimensions.reduce((a, b) => a * b, 1);
    const className = CLASS_NAMES[arrayClass] || 'unknown';
    const result: MatVariable = { name, className, dimensions, isComplex, isLogical, value: null, fields: null };

    if (arrayClass >= 6 && arrayClass <= 15) {
        if (offset < end) {
            const realSub = readSubelement(view, offset);
            offset += realSub.totalSize;
            const realValues = readNumericArray(view, realSub, totalElements);

            if (isComplex && offset < end) {
                const imagSub = readSubelement(view, offset);
                offset += imagSub.totalSize;
                const imagValues = readNumericArray(view, imagSub, totalElements);
                const colMajor = realValues.map((r, i) => ({ re: r, im: imagValues[i] }));
                result.value = transposeFromColMajor(colMajor, dimensions);
            } else {
                const rowMajor = transposeFromColMajor(realValues, dimensions) as number[];
                result.value = rowMajor.length === 1 ? rowMajor[0] : rowMajor;
            }
        }
    } else if (arrayClass === 4) {
        if (offset < end) {
            const charSub = readSubelement(view, offset);
            offset += charSub.totalSize;
            const charBytes = new Uint8Array(view.buffer, view.byteOffset + charSub.dataOffset, charSub.bytes);
            if (charSub.type === MI_UTF8 || charSub.type === MI_UINT8 || charSub.type === MI_INT8) {
                result.value = new TextDecoder().decode(charBytes);
            } else if (charSub.type === MI_UTF16 || charSub.type === MI_UINT16) {
                result.value = new TextDecoder('utf-16le').decode(charBytes);
            } else {
                result.value = new TextDecoder().decode(charBytes);
            }
        }
    } else if (arrayClass === 2) {
        // Struct
        if (offset < end) {
            const fieldNameLenSub = readSubelement(view, offset);
            offset += fieldNameLenSub.totalSize;
            const fieldNameLen = view.getInt32(fieldNameLenSub.dataOffset, true);

            const fieldNamesSub = readSubelement(view, offset);
            offset += fieldNamesSub.totalSize;
            const fieldNames: string[] = [];
            const fnBytes = new Uint8Array(view.buffer, view.byteOffset + fieldNamesSub.dataOffset, fieldNamesSub.bytes);
            for (let i = 0; i < fnBytes.length; i += fieldNameLen) {
                let str = '';
                for (let j = i; j < i + fieldNameLen && fnBytes[j] !== 0; j++) {
                    str += String.fromCharCode(fnBytes[j]);
                }
                if (str) { fieldNames.push(str); }
            }

            const fields: Record<string, unknown> = {};
            for (let e = 0; e < totalElements; e++) {
                for (const fn of fieldNames) {
                    if (offset >= end) { break; }
                    const fieldStart = offset;
                    const fieldMatrixSub = readSubelement(view, offset);
                    if (fieldMatrixSub.type === MI_MATRIX) {
                        const child = parseMatrix(view, offset + 8, fieldMatrixSub.bytes);
                        child._rawBytes = new Uint8Array(view.buffer, view.byteOffset + fieldStart, fieldMatrixSub.totalSize);
                        if (totalElements === 1) {
                            fields[fn] = child;
                        } else {
                            if (!fields[fn]) { fields[fn] = []; }
                            (fields[fn] as MatVariable[]).push(child);
                        }
                    }
                    offset += fieldMatrixSub.totalSize;
                }
            }
            result.fields = fields;
        }
    } else if (arrayClass === 1) {
        // Cell array
        const cells: (MatVariable | null)[] = [];
        for (let i = 0; i < totalElements && offset < end; i++) {
            const cellSub = readSubelement(view, offset);
            if (cellSub.type === MI_MATRIX) {
                const child = parseMatrix(view, offset + 8, cellSub.bytes);
                cells.push(child);
            } else {
                cells.push(null);
            }
            offset += cellSub.totalSize;
        }
        result.value = cells;
    }

    return result;
}

export function parseMat(arrayBuffer: ArrayBuffer): ParsedMat {
    const buf = new Uint8Array(arrayBuffer);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

    const headerBytes = new Uint8Array(buf.buffer, buf.byteOffset, 116);
    const header = new TextDecoder().decode(headerBytes).trim();

    const endianIndicator = String.fromCharCode(buf[126]) + String.fromCharCode(buf[127]);
    if (endianIndicator !== 'IM') {
        throw new Error('Big-endian MAT files not supported');
    }

    const variables: MatVariable[] = [];
    let offset = 128;

    while (offset < buf.length) {
        if (offset + 8 > buf.length) { break; }
        const dataType = view.getUint32(offset, true);
        const numBytes = view.getUint32(offset + 4, true);

        if (dataType === 0 && numBytes === 0) { break; }

        if (dataType === MI_COMPRESSED) {
            const compressed = buf.slice(offset + 8, offset + 8 + numBytes);
            const pako = decompressZlib(compressed);
            const deView = new DataView(pako.buffer, pako.byteOffset, pako.byteLength);
            const innerType = deView.getUint32(0, true);
            const innerBytes = deView.getUint32(4, true);
            if (innerType === MI_MATRIX) {
                const variable = parseMatrix(deView, 8, innerBytes);
                if (variable.name) {
                    variable._rawBytes = new Uint8Array(pako.buffer, pako.byteOffset, pako.byteLength);
                    variables.push(variable);
                } else {
                    variables.push({ name: '', className: '', dimensions: [], isComplex: false, isLogical: false, value: null, fields: null, _rawBytes: new Uint8Array(pako.buffer, pako.byteOffset, pako.byteLength), _anonymous: true });
                }
            }
        } else if (dataType === MI_MATRIX) {
            const variable = parseMatrix(view, offset + 8, numBytes);
            if (variable.name) {
                variable._rawBytes = buf.slice(offset, offset + 8 + numBytes);
                variables.push(variable);
            } else {
                variables.push({ name: '', className: '', dimensions: [], isComplex: false, isLogical: false, value: null, fields: null, _rawBytes: buf.slice(offset, offset + 8 + numBytes), _anonymous: true });
            }
        }

        offset += 8 + numBytes;
    }

    return { header, variables };
}

function decompressZlib(compressed: Uint8Array): Uint8Array {
    return unzlibSync(compressed);
}
