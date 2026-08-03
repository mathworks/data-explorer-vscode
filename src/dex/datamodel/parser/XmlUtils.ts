// Copyright 2026 The MathWorks, Inc.

'use strict';

export function escapeXml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function formatDoubleXml(num: number): string {
    const s = String(num);
    if (!s.includes('.') && !s.includes('e') && !s.includes('E') && isFinite(num)) {
        return s + '.0';
    }
    return s;
}

export function formatNumericXml(num: number, type: string): string {
    if (type === 'double' || type === 'single') {
        return formatDoubleXml(num);
    }
    return String(Math.round(num));
}

export function formatComplexXml(complexStr: string): string {
    return complexStr.replace(/(?<![.\d])(\d+)(?=[+\-i])/g, '$1.0');
}

export function transposeToColumnMajor<T>(rowMajor: T[], rows: number, cols: number): T[] {
    if (rows <= 1) { return rowMajor; }
    const result = new Array<T>(rowMajor.length);
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            result[c * rows + r] = rowMajor[r * cols + c];
        }
    }
    return result;
}

export function buildAttrs(attrs: Record<string, unknown> | undefined): string {
    let s = '';
    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
            if (v !== undefined && v !== null) {
                s += ' ' + k + '="' + escapeXml(String(v)) + '"';
            }
        }
    }
    return s;
}

export function pad(indent: number): string {
    return '    '.repeat(indent);
}
