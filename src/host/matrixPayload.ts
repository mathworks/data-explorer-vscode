// Copyright 2026 The MathWorks, Inc.
//
// Decides whether a node's value is worth showing as a 2-D grid and, if so, lays
// its elements out in a canonical buffer. Called by rowBuilder, matRowBuilder and
// piBuilder, so the table and the Property Inspector cannot disagree about a
// matrix — one rule, three call sites.
//
// Node access is duck-typed (node.dims / node.children / node.displayValue /
// node.className / node.displayName / node.displayElements()), like every other
// host builder here: MatlabVariableNode is not on the data-explorer-core barrel
// and must not be added to it.
//
// See docs/superpowers/specs/2026-09-02-variable-editor-design.md.
import { effectiveDims as coreEffectiveDims } from 'data-explorer-core';

/**
 * What a ROW carries: everything the glyph and the panel's title line need, and no
 * cells. Every griddable row in the table holds one of these, so it has to be
 * cheap — a 1000x1000 entry's cells are 4 MB, which is 4 MB per row stamped for a
 * panel the user may never open. `nodeId` is how the webview asks for the cells
 * when it does open one (see matrixRequest.ts).
 */
export interface MatrixDescriptor {
  /** Panel title name — 'Kp', or 'ParamMat.Value' when the matrix is a property. */
  name: string;
  /** MATLAB class for the title ('double', 'cell', 'logical'). NOT arrayType. */
  className: string;
  /** effectiveDims: trailing singletons past the 2nd dropped.
   *  dims[0]xdims[1] is the grid; dims[2..] page. */
  dims: number[];
  /** The ROW's own node, not the matrix owner's: a property row's matrix lives on
   *  its `Value` child, and `matrixForRow` is the single rule that resolves that.
   *  The fetch re-runs that same rule rather than a second one agreeing with it. */
  nodeId: string;
}

/** A descriptor plus the cells — what a fetch answers with, never what a row holds. */
export interface MatrixPayload extends MatrixDescriptor {
  /** Element display strings in CANONICAL order — row-major within a page, pages
   *  in trailing-dim column-major order. Placed by each element's own subscript
   *  label, NOT by its position in the element list, which is row-major for
   *  numerics and column-major for cell/string/struct/object. See Data fact 3. */
  cells: string[];
}

/**
 * 1000x1000 — the shape a customer dictionary actually held, and the one that
 * prompted all of this.
 *
 * This is the RENDERER's budget and nothing else. Measured against the shipped
 * dex-matrix-grid in real Chromium, in the 640x420 scrolling popup the panel uses:
 * 4,096 cells build in 25 ms for 7 MB of renderer heap, 99,856 in 581 ms for 63 MB,
 * 1,000,000 in ~6 s for ~594 MB. Scroll latency is FLAT at 21-28 ms across that
 * whole range, which is the measurement that matters: the panel is read-only, so
 * once it is built nothing about it degrades with size, and the only cost of a high
 * cap is the one-off build on an explicit open.
 *
 * It used to have to stay below core's MAX_EXPANDED_ELEMENTS (10,000), because the
 * cells were read off element child nodes and core stops creating those past that
 * count. It no longer does: the cells come from `displayElements()`, which answers
 * over the element data whether or not the array was ever expanded. That is the
 * whole point of the accessor — the TABLE's limit and the PANEL's limit are
 * decisions about different things, and they are now independent.
 */
export const MAX_MATRIX_ELEMENTS = 1_000_000;

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
// a 2x3x1 IS a 2x3. Core owns that rule and now exports it, so what is left here is
// only the COERCION: node access in this file is duck-typed, so `dims` arrives as
// `unknown`, while core's `effectiveDims` takes `number[]`. Narrowing at the one
// call boundary that has the problem is right — a library's types should not be
// loosened to `unknown` for a single consumer.
//
// The rule itself still has to be applied here, and this is why: a [2,3,1] node's
// 3-entry dims disagree with the 2-subscript labels core wrote for its elements, so
// without it `canonicalIndex` sees a rank mismatch and the payload fails closed on a
// perfectly good matrix. Applying core's own function is what keeps the shape we lay
// out in and the labels we place by from being two different answers to size().
export function effectiveDims(dims: unknown): number[] {
  return coreEffectiveDims(Array.isArray(dims) ? dims.map(Number) : null);
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
  // Can it list its elements? NOT "has it been expanded into one child per
  // element" — that clause is deliberately gone. It counted children, which tied
  // this gate to core's MAX_EXPANDED_ELEMENTS and meant a matrix past that count
  // passed every other clause and had nothing to draw. The feature-detect is what
  // replaces it: a node with no `displayElements` is not a MatlabVariableNode, or
  // comes from a core pin older than the accessor, and either way the affordance
  // disappears rather than this file growing a second element formatter. The
  // element list being the RIGHT LENGTH is buildCells' job, which fails closed on
  // a slot left unfilled exactly as it does on a duplicate subscript.
  return typeof node.displayElements === 'function';
}

/**
 * The canonical cells, or null. Fails closed on every anomaly: an unparseable
 * label, an out-of-range subscript, a slot written twice, a slot left empty. The
 * payload is therefore either correct or absent — never confidently wrong.
 */
function buildCells(node: any, dims: number[]): string[] | null {
  const parentName = node.displayName;
  if (typeof parentName !== 'string' || parentName === '') return null;
  // `displayElements()`, not `node.children`: the same {label, value} pairs an
  // element child row shows, derived over the element data where the array was
  // never expanded. Core pins the agreement between the two in its own
  // test/displayElements.test.ts, which is what lets this read one of them and
  // trust it for both.
  const elements = node.displayElements();
  if (!Array.isArray(elements)) return null;
  const count = product(dims);
  const cells: string[] = new Array(count);
  const filled: boolean[] = new Array(count).fill(false);
  for (const el of elements as any[]) {
    const subs = subsOf(parentName, el?.label);
    if (!subs) return null;
    const i = canonicalIndex(subs, dims);
    if (i < 0 || filled[i]) return null;
    filled[i] = true;
    cells[i] = String(el.value ?? '');
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

/**
 * The owner and the descriptor, or null. The shared half of the two exports below,
 * so the glyph and the grid cannot disagree about WHICH node is the matrix or what
 * the title says — the only difference between them is whether the cells are built.
 */
function describeMatrix(node: any): { owner: any; descriptor: MatrixDescriptor } | null {
  const owner = matrixForRow(node);
  if (!owner) return null;
  const nodeId = node?.id;
  // Nothing could ever ask about an id-less node, so a glyph on it would open a
  // panel that cannot be filled. Refuse at the gate instead.
  if (typeof nodeId !== 'string' || nodeId === '') return null;
  const ownerName = String(owner.displayName);
  // Qualify when the matrix lives on a child: 'ParamMat.Value' says which
  // property is on screen where a bare 'Value' would not.
  const name = owner === node ? ownerName : `${String(node.displayName)}.${ownerName}`;
  return {
    owner,
    descriptor: { name, className: String(owner.className), dims: effectiveDims(owner.dims), nodeId },
  };
}

/**
 * What a row carries: the title and shape, no cells. null when this row has no
 * grid-worthy matrix. Total: never throws.
 *
 * This is NOT a promise that the cells will build — a label anomaly is only
 * discoverable by building them, which is the cost this function exists to avoid.
 * The fetch is therefore allowed to come back empty-handed, and the panel says so
 * rather than showing a blank grid.
 */
export function matrixDescriptor(node: any): MatrixDescriptor | null {
  try {
    return describeMatrix(node)?.descriptor ?? null;
  } catch {
    return null;
  }
}

/**
 * The descriptor AND the cells — what a fetch answers with. null when this row has
 * no grid-worthy matrix, or when the cells fail to lay out. Total: never throws.
 */
export function matrixPayload(node: any): MatrixPayload | null {
  try {
    const described = describeMatrix(node);
    if (!described) return null;
    const cells = buildCells(described.owner, described.descriptor.dims);
    if (!cells) return null;
    return { ...described.descriptor, cells };
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
 *
 * The DESCRIPTOR, not the payload: a row is built for every node in the table, and
 * stamping cells meant building and shipping every griddable matrix in the file
 * whether or not a panel was ever opened.
 */
export function stampMatrix<T extends object>(row: T, node: any): T {
  const matrix = matrixDescriptor(node);
  return matrix ? { ...row, _matrix: matrix } : row;
}
