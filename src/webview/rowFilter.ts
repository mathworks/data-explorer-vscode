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
): {
  predicates: Array<(row: T) => boolean>;
  terms: FilterTerm[];
} {
  const predicates: Array<(row: T) => boolean> = [];
  const terms: FilterTerm[] = [];
  const tokens = text.match(/(?:[^\s"]+|"[^"]*")+/g) || [];

  // The tokenizer keeps a "quoted phrase" together as ONE token specifically so
  // its spaces don't split it into separate terms; the quotes themselves are
  // syntax, not text to match, so they must come off before comparing. Leaving
  // them on makes every quoted search silently match nothing.
  const unquote = (s: string): string => (s.length > 1 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s);
  // An EMPTY term must never be recorded. `name:` on its own is a half-typed
  // query that matches every row, but as a highlight term it would match at
  // every offset of every cell — and the scan advances by the term's length, so
  // a zero-length one never advances and hangs the webview mid-keystroke.
  const addTerm = (column: string | null, term: string): void => {
    if (term) terms.push({ column, text: term });
  };
  const makeGenericPredicate = (term: string): ((row: T) => boolean) => {
    const lower = unquote(term).toLowerCase();
    addTerm(null, lower);
    return (row) => searchColumns.some((col) => getCellText(row, col).toLowerCase().includes(lower));
  };

  for (const token of tokens) {
    const colonIdx = token.indexOf(':');
    if (colonIdx > 0) {
      const prefix = token.slice(0, colonIdx).toLowerCase();
      const rawValue = token.slice(colonIdx + 1);

      const column = SUBSTRING_FILTER_COLUMNS.get(prefix);
      if (column) {
        const term = unquote(rawValue).toLowerCase();
        addTerm(column, term);
        predicates.push((row) => getCellText(row, column).toLowerCase().includes(term));
      } else if (prefix === 'value') {
        if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
          const exact = rawValue.slice(1, -1);
          addTerm('Value', exact.toLowerCase());
          predicates.push((row) => {
            return getCellText(row, 'Value') === exact;
          });
        } else if (/^(>=|<=|>|<|=)/.test(rawValue)) {
          const opMatch = rawValue.match(/^(>=|<=|>|<|=)/);
          const op = opMatch![0];
          const numStr = rawValue.slice(op.length);
          const num = parseFloat(numStr);
          if (!isNaN(num)) {
            predicates.push((row) => {
              const val = getCellText(row, 'Value');
              const rowNum = parseFloat(val);
              if (isNaN(rowNum)) return false;
              switch (op) {
                case '>':
                  return rowNum > num;
                case '<':
                  return rowNum < num;
                case '>=':
                  return rowNum >= num;
                case '<=':
                  return rowNum <= num;
                case '=':
                  return rowNum === num;
                default:
                  return false;
              }
            });
          }
        } else {
          const term = unquote(rawValue).toLowerCase();
          addTerm('Value', term);
          predicates.push((row) => {
            return getCellText(row, 'Value').toLowerCase().includes(term);
          });
        }
      } else {
        predicates.push(makeGenericPredicate(token));
      }
    } else {
      predicates.push(makeGenericPredicate(token));
    }
  }

  return { predicates, terms };
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
