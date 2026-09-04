// Copyright 2026 The MathWorks, Inc.
//
// Decides whether a node's value is worth showing as a 2-D grid and, if so, lays
// its elements out in a canonical buffer. Called by rowBuilder, matRowBuilder and
// piBuilder, so the table and the Property Inspector cannot disagree about a
// matrix — one rule, three call sites.
//
// Node access is duck-typed (node.dims / node.children / node.displayValue /
// node.className / node.displayName), like every other host builder here:
// MatlabVariableNode is not on the data-explorer-core barrel and must not be
// added to it.
//
// See docs/superpowers/specs/2026-09-02-variable-editor-design.md.

export interface MatrixPayload {
  /** Panel title name — 'Kp', or 'ParamMat.Value' when the matrix is a property. */
  name: string;
  /** MATLAB class for the title ('double', 'cell', 'logical'). NOT arrayType. */
  className: string;
  /** effectiveDims: trailing singletons past the 2nd dropped.
   *  dims[0]xdims[1] is the grid; dims[2..] page. */
  dims: number[];
  /** Element display strings in CANONICAL order — row-major within a page, pages
   *  in trailing-dim column-major order. Placed by each element's own subscript
   *  label, NOT by its position in node.children, which is row-major for numerics
   *  and column-major for cell/string/struct/object. See the spec, Data fact 3. */
  cells: string[];
}

/** 64x64. One page is then at most 4,096 DOM cells, which needs no virtualization. */
export const MAX_MATRIX_ELEMENTS = 4096;

// An ALLOW-list, deliberately, not a deny-list. Core v1.0.0 gave ObjectNode and
// StructNode a `dims` getter (finding C7), so a 2x2 struct array now satisfies
// every STRUCTURAL clause below — `test/fixtures/numeric_json.sldd`'s structMatrix
// does — and would render as four identical `<1x1 struct>` boxes. A gate that
// breaks when an upstream dependency improves is the wrong gate. `char` is absent
// pending a fixture showing what its element children look like.
export const GRIDDABLE_CLASSES = new Set([
  'double', 'single',
  'int8', 'int16', 'int32', 'int64',
  'uint8', 'uint16', 'uint32', 'uint64',
  'logical', 'cell', 'string',
]);

// MATLAB's size(): trailing singleton dimensions past the second do not exist, so
// a 2x3x1 IS a 2x3. Mirrors core's display/DisplayConvention.ts:effectiveDims,
// which is not on the core barrel and must not be added to it. Without this, a
// [2,3,1] node's 3-entry dims disagree with its 2-subscript labels and the
// payload fails closed on a perfectly good matrix.
export function effectiveDims(dims: unknown): number[] {
  if (!Array.isArray(dims) || dims.length === 0) return [1, 1];
  if (dims.length === 1) return [1, Number(dims[0])];
  const d = dims.map(Number);
  while (d.length > 2 && d[d.length - 1] === 1) d.pop();
  return d;
}

function product(dims: number[]): number {
  return dims.reduce((a, b) => a * b, 1);
}

/**
 * The 1-based MATLAB subscripts in an element's displayName, or null if the label
 * is not `<parentName>(i,j,...)` / `<parentName>{i,j,...}`. Core builds every
 * element label exactly that way (BaseNode.displayName -> subscriptLabel), so a
 * label that does not parse means core changed and we must not guess.
 */
export function subsOf(parentName: string, label: unknown): number[] | null {
  if (typeof label !== 'string' || !label.startsWith(parentName)) return null;
  const rest = label.slice(parentName.length);
  const open = rest.charAt(0);
  const close = rest.charAt(rest.length - 1);
  const bracketed = (open === '(' && close === ')') || (open === '{' && close === '}');
  if (rest.length < 3 || !bracketed) return null;
  const subs: number[] = [];
  for (const part of rest.slice(1, -1).split(',')) {
    if (!/^[0-9]+$/.test(part)) return null;
    subs.push(Number(part));
  }
  return subs;
}

/**
 * The canonical slot for 1-based subscripts in a dims-shaped buffer: row-major
 * within a page, pages in trailing-dim column-major order (dimension 3 varying
 * fastest, which is MATLAB's own page order). -1 when the rank disagrees or any
 * subscript is out of range.
 */
export function canonicalIndex(subs: number[], dims: number[]): number {
  if (subs.length !== dims.length) return -1;
  for (let k = 0; k < subs.length; k++) {
    if (!Number.isInteger(subs[k]) || subs[k] < 1 || subs[k] > dims[k]) return -1;
  }
  let page = 0;
  let stride = 1;
  for (let k = 2; k < dims.length; k++) {
    page += (subs[k] - 1) * stride;
    stride *= dims[k];
  }
  return page * dims[0] * dims[1] + (subs[0] - 1) * dims[1] + (subs[1] - 1);
}

/**
 * The gate. `spread >= 2` is core's own test for when it emits full subscripts
 * (Subscript.ts:74-79), so the gate and the label form the placement rule needs
 * are one condition — and it excludes every vector, including a 1x1x4, which a
 * `dims.length >= 3` clause would have let through as a 1x1 grid with four pages.
 */
export function isGriddable(node: any): boolean {
  if (!node || !GRIDDABLE_CLASSES.has(node.className)) return false;
  if (!Array.isArray(node.dims)) return false;
  const dims = effectiveDims(node.dims);
  if (dims.filter((d) => d > 1).length < 2) return false;
  const count = product(dims);
  if (count > MAX_MATRIX_ELEMENTS) return false;
  return Array.isArray(node.children) && node.children.length === count;
}

/**
 * The canonical cells, or null. Fails closed on every anomaly: an unparseable
 * label, an out-of-range subscript, a slot written twice, a slot left empty. The
 * payload is therefore either correct or absent — never confidently wrong.
 */
function buildCells(node: any, dims: number[]): string[] | null {
  const parentName = node.displayName;
  if (typeof parentName !== 'string' || parentName === '') return null;
  const count = product(dims);
  const cells: string[] = new Array(count);
  const filled: boolean[] = new Array(count).fill(false);
  for (const child of node.children as any[]) {
    const subs = subsOf(parentName, child?.displayName);
    if (!subs) return null;
    const i = canonicalIndex(subs, dims);
    if (i < 0 || filled[i]) return null;
    filled[i] = true;
    cells[i] = String(child.displayValue ?? '');
  }
  for (let i = 0; i < count; i++) if (!filled[i]) return null;
  return cells;
}

/**
 * The node that OWNS the row's matrix: the node itself when it is one, else its
 * `Value` child — but only when the row is already displaying that child's value.
 * An object property row (`ParamMat`) shows the literal while the matrix lives one
 * level down, so without this the affordance would sit on a row the user has to
 * expand and hunt for. The displayValue check is what keeps it off a struct row
 * that merely happens to have a field named `Value`: that row shows
 * `<1x1 struct>`, not the field's literal.
 */
export function matrixForRow(node: any): any | null {
  if (isGriddable(node)) return node;
  const children = node?.children;
  if (!Array.isArray(children)) return null;
  const value = children.find((c: any) => c?.name === 'Value');
  if (!value || !isGriddable(value)) return null;
  return value.displayValue === node.displayValue ? value : null;
}

/** null when this row has no grid-worthy matrix. Total: never throws. */
export function matrixPayload(node: any): MatrixPayload | null {
  try {
    const owner = matrixForRow(node);
    if (!owner) return null;
    const dims = effectiveDims(owner.dims);
    const cells = buildCells(owner, dims);
    if (!cells) return null;
    const ownerName = String(owner.displayName);
    // Qualify when the matrix lives on a child: 'ParamMat.Value' says which
    // property is on screen where a bare 'Value' would not.
    const name = owner === node ? ownerName : `${String(node.displayName)}.${ownerName}`;
    return { name, className: String(owner.className), dims, cells };
  } catch {
    return null;
  }
}

/**
 * Stamp `_matrix` onto a row when its node owns a grid-worthy matrix. A sibling
 * `_`-prefixed key, NOT `row.Value.matrix`: core emits Value as a bare string and
 * puts editability on the sibling `_valueEditable`, and the table's Value branch
 * switches on that shape, so promoting Value to an object would silently change
 * which field supplies `editable`. Matches `_canCopy` / `_canDelete` /
 * `_valueEditable`, the established convention for host-computed row extras.
 */
export function stampMatrix<T extends object>(row: T, node: any): T {
  const matrix = matrixPayload(node);
  return matrix ? { ...row, _matrix: matrix } : row;
}
