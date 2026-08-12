// Copyright 2026 The MathWorks, Inc.

export interface ParsedValue {
    type: string;
    value: unknown;
    dims?: number[];
}

function parse(str: string): ParsedValue | null {
    str = str.trim();
    if (str === '') { return null; }

    const ch = str.charAt(0);
    if (ch === '[') { return parseArray(str); }
    if (ch === '{') { return parseCell(str); }
    if (ch === "'") { return parseChar(str); }
    if (ch === '"') { return parseString(str); }
    if (str === 'true') { return { type: 'logical', value: true }; }
    if (str === 'false') { return { type: 'logical', value: false }; }

    const n = Number(str);
    if (!isNaN(n)) { return { type: 'double', value: n }; }

    const complexResult = parseComplex(str);
    if (complexResult) { return complexResult; }

    return null;
}

function parseChar(str: string): ParsedValue | null {
    if (str.length < 2 || str.charAt(0) !== "'" || str.charAt(str.length - 1) !== "'") {
        return null;
    }
    return { type: 'char', value: str.slice(1, -1) };
}

function parseString(str: string): ParsedValue | null {
    if (str.length < 2 || str.charAt(0) !== '"' || str.charAt(str.length - 1) !== '"') {
        return null;
    }
    return { type: 'string', value: str.slice(1, -1) };
}

function parseComplex(str: string): ParsedValue | null {
    const m = str.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([+-](?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)i$/);
    if (m) {
        const re = parseFloat(m[1]);
        const im = parseFloat(m[2]);
        const formatted = im >= 0 ? re + '+' + im + 'i' : re + '' + im + 'i';
        return { type: 'complex', value: formatted };
    }
    const mi = str.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)i$/);
    if (mi) {
        const im = parseFloat(mi[1]);
        const formatted = '0' + (im >= 0 ? '+' + im + 'i' : '' + im + 'i');
        return { type: 'complex', value: formatted };
    }
    return null;
}

function parseArray(str: string): ParsedValue | null {
    str = str.trim();
    if (str.length < 2 || str.charAt(0) !== '[' || str.charAt(str.length - 1) !== ']') {
        return null;
    }
    const inner = str.slice(1, -1).trim();
    if (inner === '') {
        return { type: 'double', value: [], dims: [0, 0] };
    }

    const rows = splitRows(inner);
    const matrix: unknown[][] = [];
    let cols = -1;
    let isStringArray = false;
    for (let r = 0; r < rows.length; r++) {
        const rowStr = rows[r].trim();
        if (rowStr === '') { continue; }
        const nums = tokenizeNumbers(rowStr);
        if (nums === null) {
            const strings = tokenizeStrings(rowStr);
            if (strings === null) { return null; }
            isStringArray = true;
            if (cols < 0) {
                cols = strings.length;
            } else if (strings.length !== cols) {
                return null;
            }
            matrix.push(strings);
        } else {
            if (isStringArray) { return null; }
            if (cols < 0) {
                cols = nums.length;
            } else if (nums.length !== cols) {
                return null;
            }
            matrix.push(nums);
        }
    }
    if (matrix.length === 0) {
        return { type: 'double', value: [], dims: [0, 0] };
    }

    const elements: unknown[] = [];
    for (let r = 0; r < matrix.length; r++) {
        for (let c = 0; c < cols; c++) {
            elements.push(matrix[r][c]);
        }
    }
    if (isStringArray) {
        return { type: 'string-array', value: elements, dims: [matrix.length, cols] };
    }
    return { type: 'double', value: elements, dims: [matrix.length, cols] };
}

function tokenizeStrings(rowStr: string): string[] | null {
    const elements: string[] = [];
    let i = 0;
    const len = rowStr.length;
    while (i < len) {
        while (i < len && (rowStr.charAt(i) === ' ' || rowStr.charAt(i) === ',')) { i++; }
        if (i >= len) { break; }
        const ch = rowStr.charAt(i);
        if (ch === '"') {
            const end = rowStr.indexOf('"', i + 1);
            if (end < 0) { return null; }
            elements.push(rowStr.slice(i + 1, end));
            i = end + 1;
        } else if (ch === "'") {
            const end = rowStr.indexOf("'", i + 1);
            if (end < 0) { return null; }
            elements.push(rowStr.slice(i + 1, end));
            i = end + 1;
        } else {
            return null;
        }
    }
    return elements.length > 0 ? elements : null;
}

function parseCell(str: string): ParsedValue | null {
    str = str.trim();
    if (str.length < 2 || str.charAt(0) !== '{' || str.charAt(str.length - 1) !== '}') {
        return null;
    }
    const inner = str.slice(1, -1).trim();
    if (inner === '') {
        return { type: 'cell', value: [], dims: [0, 0] };
    }

    const rows = splitRows(inner);
    const matrix: unknown[][] = [];
    let cols = -1;
    for (let r = 0; r < rows.length; r++) {
        const rowStr = rows[r].trim();
        if (rowStr === '') { continue; }
        const elems = tokenizeCellElements(rowStr);
        if (elems === null) { return null; }
        if (cols < 0) {
            cols = elems.length;
        } else if (elems.length !== cols) {
            return null;
        }
        matrix.push(elems);
    }
    if (matrix.length === 0) {
        return { type: 'cell', value: [], dims: [0, 0] };
    }

    const elements: unknown[] = [];
    for (let r = 0; r < matrix.length; r++) {
        for (let c = 0; c < cols; c++) {
            elements.push(matrix[r][c]);
        }
    }
    return { type: 'cell', value: elements, dims: [matrix.length, cols] };
}

function splitRows(inner: string): string[] {
    const rows: string[] = [];
    let depth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let start = 0;
    for (let i = 0; i < inner.length; i++) {
        const ch = inner.charAt(i);
        if (inSingleQuote) {
            if (ch === "'") { inSingleQuote = false; }
            continue;
        }
        if (inDoubleQuote) {
            if (ch === '"') { inDoubleQuote = false; }
            continue;
        }
        if (ch === "'") { inSingleQuote = true; continue; }
        if (ch === '"') { inDoubleQuote = true; continue; }
        if (ch === '[' || ch === '{') {
            depth++;
        } else if (ch === ']' || ch === '}') {
            depth--;
        } else if (ch === ';' && depth === 0) {
            rows.push(inner.slice(start, i));
            start = i + 1;
        }
    }
    rows.push(inner.slice(start));
    return rows;
}

function tokenizeNumbers(rowStr: string): number[] | null {
    const parts = rowStr.trim().split(/[,\s]+/);
    const nums: number[] = [];
    for (let i = 0; i < parts.length; i++) {
        if (parts[i] === '') { continue; }
        const n = Number(parts[i]);
        if (isNaN(n)) { return null; }
        nums.push(n);
    }
    return nums.length > 0 ? nums : null;
}

function tokenizeCellElements(rowStr: string): unknown[] | null {
    const elements: unknown[] = [];
    let i = 0;
    const len = rowStr.length;

    while (i < len) {
        while (i < len && (rowStr.charAt(i) === ' ' || rowStr.charAt(i) === ',')) { i++; }
        if (i >= len) { break; }

        const ch = rowStr.charAt(i);
        if (ch === "'") {
            const end = rowStr.indexOf("'", i + 1);
            if (end < 0) { return null; }
            elements.push(rowStr.slice(i + 1, end));
            i = end + 1;
        } else if (ch === '"') {
            const end = rowStr.indexOf('"', i + 1);
            if (end < 0) { return null; }
            elements.push(rowStr.slice(i + 1, end));
            i = end + 1;
        } else if (ch === '[') {
            const end = findMatchingBracket(rowStr, i, '[', ']');
            if (end < 0) { return null; }
            const nested = parseArray(rowStr.slice(i, end + 1));
            if (nested === null) { return null; }
            elements.push(nested.value);
            i = end + 1;
        } else if (ch === '{') {
            const end = findMatchingBracket(rowStr, i, '{', '}');
            if (end < 0) { return null; }
            const nested = parseCell(rowStr.slice(i, end + 1));
            if (nested === null) { return null; }
            elements.push({
                _array_type: 'Cell',
                _dimensions: nested.dims,
                _elements: nested.value,
                _mw_element_type: 'MATLABArray'
            });
            i = end + 1;
        } else {
            let end = i;
            while (end < len && rowStr.charAt(end) !== ',' && rowStr.charAt(end) !== ' ' && rowStr.charAt(end) !== ';') {
                end++;
            }
            const token = rowStr.slice(i, end);
            elements.push(parseLiteral(token));
            i = end;
        }
    }
    return elements.length > 0 ? elements : null;
}

function parseLiteral(token: string): unknown {
    if (token === 'true') { return true; }
    if (token === 'false') { return false; }
    const n = Number(token);
    if (!isNaN(n)) { return n; }
    return token;
}

function findMatchingBracket(str: string, start: number, open: string, close: string): number {
    let depth = 0;
    for (let i = start; i < str.length; i++) {
        if (str.charAt(i) === open) { depth++; }
        if (str.charAt(i) === close) {
            depth--;
            if (depth === 0) { return i; }
        }
    }
    return -1;
}

// True when a freshly-parsed value is a SCALAR NUMERIC value — the rule a
// Constant's Value must satisfy. Admits a plain number, a logical (true/false),
// a complex scalar, and a 1-element numeric array (the parser yields a bare
// number for `5`, but `[5]` parses to a 1-length double array — both are 1x1).
// Rejects multi-element arrays/matrices, cells, char, and string. Kept next to
// the parser so both the model (edit-time validation) and the paste/drop gate
// can share one definition. `null` (unparseable) is never scalar-numeric.
function parsedIsScalarNumeric(parsed: ParsedValue | null): boolean {
    if (!parsed) { return false; }
    if (parsed.type === 'double') {
        if (Array.isArray(parsed.value)) { return parsed.value.length === 1; }
        return true;
    }
    return parsed.type === 'logical' || parsed.type === 'complex';
}

export { parsedIsScalarNumeric };
export default { parse, parseArray, parseCell, parsedIsScalarNumeric };
