// Copyright 2026 The MathWorks, Inc.
//
// The row-filter grammar behind the tree table's search box: bare terms,
// `col:value` prefixes, quoted phrases, and `value:` comparisons. Extracted out
// of dex-tree-table.ts (3481 lines) so the grammar can be tested directly,
// without instantiating the Lit component under happy-dom for every edge case.
//
// It looks presentation-independent, and it is pure, but it stays in vscode
// rather than moving to core: it filters ROW objects (display cells rowBuilder
// produces), and SUBSTRING_FILTER_COLUMNS is keyed by DISPLAY column — not
// anything core's model knows about. Core's comparable thing (findQuery.ts,
// compileCriteria over live INodes) is a structured query over the model: a
// different input and a different job. Purity is not the test for moving to
// core; this fails the real one (a property of the data, or of a UI interaction?).
//
// Three things the grammar itself does not own, and so takes as arguments
// rather than reaching for `this`:
//   - `searchColumns`: which columns a bare term matches, i.e. the columns the
//     user currently has visible;
//   - `getCellText`: how to read a column's display text off a row — depends on
//     cell shape, which is the component's concern (`_getCellText`, kept there);
//   - `stickyRowIds` (filterRows only): rows the component is holding visible
//     since an edit moved them out of match — the component's edit-tracking
//     state, not part of the grammar.
// Keeping these as parameters is what makes this module have no `this` and no
// DOM, so it is coverage-measured and unit-testable directly.

/** The subset of a table row this module needs in order to walk the tree. */
export interface FilterableRow {
  ID: string;
  parent: string | null;
}

// One term the user typed, with the column it was restricted to (null = any
// visible column). Both the row predicates and the <mark> highlighting are built
// from this one list, so the table can never filter by one thing and highlight
// another.
export type FilterTerm = { column: string | null; text: string };

/** Every comparison the box understands. `~=` is normalized to `!=`. */
export type FilterOp = 'contains' | '=' | '!=' | '>' | '<' | '>=' | '<=';

/**
 * One condition the user typed. Emitted alongside the predicates so the chip
 * strip, the highlighter and the header popup all read the same answer.
 */
export interface FilterToken {
  /** Exactly as typed, so Backspace can round-trip a chip back into the input. */
  raw: string;
  /** Span in the source text. Removing a chip is a splice, not a re-serialize. */
  start: number;
  end: number;
  /** Resolved column key; null means "every visible column" (a bare term). */
  column: string | null;
  /** What the chip shows. Null for a bare term. */
  columnLabel: string | null;
  op: FilterOp;
  /** Unquoted, as typed. Empty is legal: `Unit=` asks for empty cells. */
  value: string;
  /**
   * Why this token is not doing what its text appears to ask.
   *   'unknown-column'    — `notacol:abc`; DOES filter, but as ordinary text
   *   'non-numeric-bound' — `Value>abc`; contributes no predicate at all
   */
  warning?: 'unknown-column' | 'non-numeric-bound';
}

/** The columns a table has, and the label each one prints in its header. */
export interface ColumnVocabulary {
  labels: Record<string, string> | null;
  /** Every column the table has, visible or not. Null = do not restrict. */
  keys: string[] | null;
}

// Search prefixes that mean "substring-match this ONE column", and the column
// each names. `type:` deliberately reads DataType — the prefix is what the user
// types, the column is what the table calls it, and they are not the same word.
//
// `value:` is absent on purpose: it is the only prefix with its own grammar
// (exact `value:"..."` and numeric `value:>10` comparisons), so it stays a
// separate branch rather than being forced into this table.
//
// A Map, not an object literal: a plain object inherits from Object.prototype, so
// a lookup of `constructor:` or `toString:` returns an inherited function instead
// of undefined and the search would treat those words as real column prefixes.
// Unknown prefixes must fall through to a whole-token text search — `constructor:`
// is ordinary text a user may well be looking for in a .sldd.
export const SUBSTRING_FILTER_COLUMNS = new Map<string, string>([
  ['name', 'Name'],
  ['type', 'DataType'],
  ['class', 'Class'],
  ['kind', 'Kind'],
  ['status', 'Status'],
]);

// Header label (lowercased) → column key. Built per parse from the table's own
// columns, so a prefix is always the name printed on the header the user is
// looking at — and so a `.prj` table resolves `Type` to its own Type column
// rather than to the dictionary's DataType.
function buildLabelMap(vocab?: ColumnVocabulary): Map<string, string> {
  const map = new Map<string, string>();
  if (!vocab) return map;
  const keys = vocab.keys ?? (vocab.labels ? Object.keys(vocab.labels) : []);
  for (const key of keys) {
    map.set((vocab.labels?.[key] ?? key).toLowerCase(), key);
  }
  return map;
}

// Resolves the text before an operator to a column, label first and legacy alias
// second. A legacy alias must also EXIST in this table: `type:` means DataType in
// a dictionary, and in a project table (Name/Type/Location/Labels) it must not
// silently match nothing while naming a column that is on screen.
function resolveColumn(prefix: string, labelMap: Map<string, string>, vocab?: ColumnVocabulary): string | null {
  const byLabel = labelMap.get(prefix);
  if (byLabel) return byLabel;
  const alias = prefix === 'value' ? 'Value' : SUBSTRING_FILTER_COLUMNS.get(prefix);
  if (!alias) return null;
  if (vocab?.keys && !vocab.keys.includes(alias)) return null;
  return alias;
}

// The tokenizer keeps a "quoted phrase" together as ONE token specifically so its
// spaces don't split it into separate terms; the quotes themselves are syntax, not
// text to match, so they must come off before comparing. Leaving them on makes
// every quoted search silently match nothing.
function unquote(s: string): string {
  return s.length > 1 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

const OP_CHARS = new Set([':', '=', '<', '>', '!', '~']);

interface OpHit {
  /** Where the prefix ends, i.e. the operator's first character. */
  prefixEnd: number;
  op: FilterOp;
  valueStart: number;
}

// Finds the operator inside ONE token, skipping anything inside quotes so that
// `type:"Bus: myBus"` splits at its first colon and not at the one in the value.
// Returns null when the token holds no operator at all — then the whole token is
// ordinary text, which is also how `a>b` and `~foo` keep working.
function findOperator(raw: string): OpHit | null {
  let inQuote = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    // A leading operator is not an empty prefix: `:abc` is text (and `:` alone
    // must never resolve to a column, or every row would match).
    if (inQuote || !OP_CHARS.has(ch) || i === 0) continue;

    const two = raw.slice(i, i + 2);
    if (two === '!=' || two === '~=') return { prefixEnd: i, op: '!=', valueStart: i + 2 };
    if (two === '>=' || two === '<=') return { prefixEnd: i, op: two as FilterOp, valueStart: i + 2 };
    // `!` and `~` mean nothing on their own — `Name!abc` is text.
    if (ch === '!' || ch === '~') continue;
    if (ch === '=') return { prefixEnd: i, op: '=', valueStart: i + 1 };
    if (ch === '>' || ch === '<') return { prefixEnd: i, op: ch as FilterOp, valueStart: i + 1 };

    // ':' — contains, unless the value opens with an operator. That is the legacy
    // `value:>10` spelling, now accepted on every column.
    const legacy = raw.slice(i + 1).match(/^(>=|<=|!=|~=|=|>|<)/);
    if (legacy) {
      const g = legacy[1];
      return { prefixEnd: i, op: g === '~=' ? '!=' : (g as FilterOp), valueStart: i + 1 + g.length };
    }
    return { prefixEnd: i, op: 'contains', valueStart: i + 1 };
  }
  return null;
}

// `=` on a table whose cells are all strings. Numbers compare as numbers so that
// `Value=10` finds a cell holding `10.0`; anything else compares as trimmed,
// case-insensitive text, because one case rule for the whole box is worth more
// than an exception nobody can see. An empty wanted value asks for empty cells,
// which is the only way to ask "which entries have no Unit?".
function valuesEqual(cell: string, wanted: string): boolean {
  const c = cell.trim();
  const w = wanted.trim();
  if (c !== '' && w !== '') {
    const cn = Number(c);
    const wn = Number(w);
    if (Number.isFinite(cn) && Number.isFinite(wn)) return cn === wn;
  }
  return c.toLowerCase() === w.toLowerCase();
}

// Compiles the search box text into the row predicates AND the terms to
// highlight, in one pass over the tokens. Highlighting used to re-derive its
// term from the raw filter text, which held for a single word and broke for
// everything else: `var abc` went looking for the literal string "var abc" and
// marked nothing, so a query that filtered perfectly gave the user no clue
// which of their words each row had matched. Anything that decides what a token
// MEANS belongs here, emitted to both consumers together, rather than being
// guessed a second time at render.
export function parseFilterExpression<T extends FilterableRow>(
  text: string,
  searchColumns: string[],
  getCellText: (row: T, col: string) => string,
  vocabulary?: ColumnVocabulary,
): {
  tokens: FilterToken[];
  predicates: Array<(row: T) => boolean>;
  terms: FilterTerm[];
} {
  const tokens: FilterToken[] = [];
  const predicates: Array<(row: T) => boolean> = [];
  const terms: FilterTerm[] = [];
  const labelMap = buildLabelMap(vocabulary);

  // An EMPTY term must never be recorded: as a highlight term it would match at
  // every offset of every cell, and the scan advances by the term's length, so a
  // zero-length one never advances and hangs the webview mid-keystroke.
  const addTerm = (column: string | null, term: string): void => {
    if (term) terms.push({ column, text: term });
  };

  for (const m of text.matchAll(/(?:[^\s"]+|"[^"]*")+/g)) {
    const raw = m[0];
    const start = m.index;
    const end = start + raw.length;
    const hit = findOperator(raw);
    const column = hit ? resolveColumn(unquote(raw.slice(0, hit.prefixEnd)).toLowerCase(), labelMap, vocabulary) : null;

    // No operator, or a prefix that names no column: the whole token is text,
    // colon included. `constructor:` is ordinary text a user may well look for.
    if (!hit || !column) {
      const value = unquote(raw);
      const lower = value.toLowerCase();
      tokens.push({
        raw,
        start,
        end,
        column: null,
        columnLabel: null,
        op: 'contains',
        value,
        ...(hit ? { warning: 'unknown-column' as const } : {}),
      });
      addTerm(null, lower);
      predicates.push((row) => searchColumns.some((col) => getCellText(row, col).toLowerCase().includes(lower)));
      continue;
    }

    const value = unquote(raw.slice(hit.valueStart));
    const label = vocabulary?.labels?.[column] ?? column;
    const token: FilterToken = { raw, start, end, column, columnLabel: label, op: hit.op, value };
    tokens.push(token);

    if (hit.op === 'contains') {
      const lower = value.toLowerCase();
      addTerm(column, lower);
      predicates.push((row) => getCellText(row, column).toLowerCase().includes(lower));
    } else if (hit.op === '=' || hit.op === '!=') {
      // `=` highlights (its value IS in the cell); `!=` cannot — nothing matched.
      if (hit.op === '=') addTerm(column, value.toLowerCase());
      const want = hit.op === '=';
      predicates.push((row) => valuesEqual(getCellText(row, column), value) === want);
    } else {
      // A bound that is not a number contributes NO predicate — a half-typed
      // `Value>` must not blank the table. Surfaced on the chip instead.
      const bound = parseFloat(value);
      if (!Number.isFinite(bound)) {
        token.warning = 'non-numeric-bound';
        continue;
      }
      const op = hit.op;
      predicates.push((row) => {
        const n = parseFloat(getCellText(row, column));
        if (!Number.isFinite(n)) return false;
        return op === '>' ? n > bound : op === '<' ? n < bound : op === '>=' ? n >= bound : n <= bound;
      });
    }
  }

  return { tokens, predicates, terms };
}

export function filterRows<T extends FilterableRow>(
  rows: T[],
  text: string,
  searchColumns: string[],
  getCellText: (row: T, col: string) => string,
  stickyRowIds: Set<string>,
): T[] {
  const { predicates } = parseFilterExpression(text, searchColumns, getCellText);
  if (predicates.length === 0) return rows;

  const rowById = new Map<string, T>();
  for (const r of rows) rowById.set(r.ID, r);

  const hitSet = new Set<string>();
  for (const row of rows) {
    if (predicates.every((pred) => pred(row))) {
      hitSet.add(row.ID);
    }
  }

  // Rows the user has edited out of the match since they last searched (see
  // nextStickyIds). Kept in the list — with their ancestors, since the flatten
  // DROPS a row whose parent is missing rather than merely unindenting it — but
  // deliberately NOT counted as matches: a match pulls in its whole subtree
  // below, and every visible row's section header is sticky, so treating these as
  // matches would re-admit entire sections on the first edit and blow the filter
  // wide open. The cost of that choice is narrow: renaming a matched PARENT keeps
  // the parent but not the children it was showing, since a rename re-keys them
  // and only the parent's new id reaches us.
  const keepSet = stickyRowIds.size === 0 ? hitSet : new Set([...hitSet, ...stickyRowIds]);

  // Every ancestor walk below is cycle-guarded: a malformed document can give
  // two rows each other as parent, and an unguarded walk would spin forever,
  // freezing the webview mid-search with no error shown.
  const includeSet = new Set<string>();
  for (const row of rows) {
    if (keepSet.has(row.ID)) {
      includeSet.add(row.ID);
      let parentId = row.parent;
      const seen = new Set<string>([row.ID]);
      while (parentId && rowById.has(parentId) && !seen.has(parentId)) {
        seen.add(parentId);
        includeSet.add(parentId);
        parentId = rowById.get(parentId)!.parent;
      }
    }
  }

  for (const row of rows) {
    if (includeSet.has(row.ID)) continue;
    let parentId = row.parent;
    const seen = new Set<string>([row.ID]);
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      if (hitSet.has(parentId)) {
        includeSet.add(row.ID);
        let mid = row.parent;
        const midSeen = new Set<string>([row.ID]);
        while (mid && mid !== parentId && !midSeen.has(mid)) {
          midSeen.add(mid);
          includeSet.add(mid);
          mid = rowById.get(mid)?.parent || null;
        }
        break;
      }
      parentId = rowById.get(parentId)?.parent || null;
    }
  }

  return rows.filter((r) => includeSet.has(r.ID));
}
