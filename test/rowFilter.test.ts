// Copyright 2026 The MathWorks, Inc.
//
// The row-filter grammar, tested directly against parseFilterExpression/filterRows
// rather than through the DOM. The DOM-level behaviour (dex-tree-table's search
// box) is already pinned in treeTableFilter.test.ts and must keep passing
// unchanged — these tests exist to reach the grammar's edge cases without paying
// for a happy-dom component mount per case, and to cover the module in isolation.
import { describe, it, expect } from 'vitest';
import { parseFilterExpression, filterRows, SUBSTRING_FILTER_COLUMNS } from '../src/webview/rowFilter.js';

interface Row {
  ID: string;
  parent: string | null;
  Name?: string;
  Value?: string;
  DataType?: string;
  Class?: string;
  Kind?: string;
  Status?: string;
}

const COLUMNS = ['Name', 'Value', 'DataType', 'Class', 'Kind', 'Status'];

function getCellText(row: Row, col: string): string {
  return (row as unknown as Record<string, string | undefined>)[col] ?? '';
}

function row(id: string, parent: string | null, extra: Partial<Row> = {}): Row {
  return { ID: id, parent, ...extra };
}

// Runs the whole pipeline `filterRows` exercises: parse + filter, returning just
// the surviving ids in original order — the shape most of these tests care about.
function ids(rows: Row[], text: string, stickyRowIds: Set<string> = new Set()): string[] {
  return filterRows(rows, text, COLUMNS, getCellText, stickyRowIds).map((r) => r.ID);
}

describe('parseFilterExpression', () => {
  it('an empty string produces no predicates and no terms', () => {
    const { predicates, terms } = parseFilterExpression('', COLUMNS, getCellText);
    expect(predicates).toEqual([]);
    expect(terms).toEqual([]);
  });

  it('whitespace-only input tokenizes to nothing', () => {
    const { predicates, terms } = parseFilterExpression('   ', COLUMNS, getCellText);
    expect(predicates).toEqual([]);
    expect(terms).toEqual([]);
  });

  it('a bare quoted phrase is one term, matched against every visible column', () => {
    const { terms } = parseFilterExpression('"my param"', COLUMNS, getCellText);
    expect(terms).toEqual([{ column: null, text: 'my param' }]);
    const r = row('a', null, { Name: 'my param' });
    expect(parseFilterExpression('"my param"', COLUMNS, getCellText).predicates.every((p) => p(r))).toBe(true);
  });

  it('an unknown col: prefix is searched as ordinary text, colon included', () => {
    // "ns" is not in SUBSTRING_FILTER_COLUMNS and is not "value", so the whole
    // token — colon included — becomes one generic (any-column) term.
    expect(SUBSTRING_FILTER_COLUMNS.has('ns')).toBe(false);
    const { terms } = parseFilterExpression('ns:thing', COLUMNS, getCellText);
    expect(terms).toEqual([{ column: null, text: 'ns:thing' }]);
    const hit = row('a', null, { Name: 'ns:thing' });
    const miss = row('b', null, { Name: 'thing' });
    const { predicates } = parseFilterExpression('ns:thing', COLUMNS, getCellText);
    expect(predicates[0](hit)).toBe(true);
    expect(predicates[0](miss)).toBe(false);
  });

  it('>= is tried before > so it is not read as > followed by a stray "="', () => {
    const geTerm = row('a', null, { Value: '50' });
    const { predicates: ge } = parseFilterExpression('value:>=50', COLUMNS, getCellText);
    expect(ge).toHaveLength(1);
    expect(ge[0](geTerm)).toBe(true); // 50 >= 50
    expect(ge[0](row('b', null, { Value: '49' }))).toBe(false);

    // Plain > must still exclude the boundary value once >= is out of the way.
    const { predicates: gt } = parseFilterExpression('value:>50', COLUMNS, getCellText);
    expect(gt[0](geTerm)).toBe(false); // 50 > 50 is false
    expect(gt[0](row('c', null, { Value: '51' }))).toBe(true);
  });

  it('<= is tried before <', () => {
    const { predicates: le } = parseFilterExpression('value:<=50', COLUMNS, getCellText);
    expect(le[0](row('a', null, { Value: '50' }))).toBe(true);
    const { predicates: lt } = parseFilterExpression('value:<50', COLUMNS, getCellText);
    expect(lt[0](row('a', null, { Value: '50' }))).toBe(false);
  });

  it('= compares numerically', () => {
    const { predicates } = parseFilterExpression('value:=50', COLUMNS, getCellText);
    expect(predicates[0](row('a', null, { Value: '50' }))).toBe(true);
    // Numeric, not lexical: '50.0' parses to the same number as '50' and must
    // still match, while a genuinely different number must not.
    expect(predicates[0](row('a', null, { Value: '50.0' }))).toBe(true);
    expect(predicates[0](row('a', null, { Value: '51' }))).toBe(false);
  });

  it('a non-numeric comparison bound is ignored rather than matching or throwing', () => {
    const { predicates } = parseFilterExpression('value:>abc', COLUMNS, getCellText);
    expect(predicates).toEqual([]);
  });

  it('a non-numeric cell is excluded from a numeric comparison, not treated as zero', () => {
    const { predicates } = parseFilterExpression('value:<10', COLUMNS, getCellText);
    expect(predicates[0](row('a', null, { Value: 'auto' }))).toBe(false);
    expect(predicates[0](row('a', null, { Value: '' }))).toBe(false);
    expect(predicates[0](row('a', null, { Value: '5' }))).toBe(true);
  });

  it('value:"..." is an exact match, distinct from the substring form', () => {
    const { predicates: exact } = parseFilterExpression('value:"5"', COLUMNS, getCellText);
    expect(exact[0](row('a', null, { Value: '5' }))).toBe(true);
    expect(exact[0](row('a', null, { Value: '15' }))).toBe(false);
    expect(exact[0](row('a', null, { Value: '5.0' }))).toBe(false);

    const { predicates: sub } = parseFilterExpression('value:5', COLUMNS, getCellText);
    expect(sub[0](row('a', null, { Value: '15' }))).toBe(true);
  });

  it('col: prefixes resolve through SUBSTRING_FILTER_COLUMNS, case-insensitively', () => {
    const { predicates, terms } = parseFilterExpression('TYPE:double', COLUMNS, getCellText);
    expect(terms).toEqual([{ column: 'DataType', text: 'double' }]);
    expect(predicates[0](row('a', null, { DataType: 'double' }))).toBe(true);
    expect(predicates[0](row('a', null, { DataType: 'single' }))).toBe(false);
  });

  it('mismatched quotes: an unclosed quote is dropped, not treated as literal text', () => {
    // The tokenizer's quote alternative only matches a BALANCED "..." pair; a lone
    // quote with nothing to close it matches neither alternative and is skipped,
    // so `"my` searches for the bare word "my" rather than failing to match ever.
    const { terms } = parseFilterExpression('"my', COLUMNS, getCellText);
    expect(terms).toEqual([{ column: null, text: 'my' }]);
  });

  it('mismatched quotes inside a col:value still drop the stray quote', () => {
    // The stray quote breaks the token stream exactly as a leading stray quote
    // does: "value:" tokenizes on its own (rawValue "" — an empty, unrecorded
    // term matching every row) and the un-tokenizable quote is skipped, leaving
    // "5" as a second, separate bare term.
    const { terms, predicates } = parseFilterExpression('value:"5', COLUMNS, getCellText);
    expect(terms).toEqual([{ column: null, text: '5' }]);
    expect(predicates).toHaveLength(2);
  });

  it('an empty term is never recorded, for a bare token or a col: prefix', () => {
    expect(parseFilterExpression('name:', COLUMNS, getCellText).terms).toEqual([]);
    // name: with no value still yields a predicate — it must match every row.
    const { predicates } = parseFilterExpression('name:', COLUMNS, getCellText);
    expect(predicates[0](row('a', null, { Name: 'anything' }))).toBe(true);
  });

  it('two terms both have to hold — predicates are ANDed by the caller', () => {
    const { predicates } = parseFilterExpression('double gain', COLUMNS, getCellText);
    expect(predicates).toHaveLength(2);
    const r = row('a', null, { Name: 'gain', DataType: 'double' });
    expect(predicates.every((p) => p(r))).toBe(true);
    expect(predicates.every((p) => p(row('b', null, { Name: 'gain' })))).toBe(false);
  });

  it('a leading colon is not read as an empty prefix', () => {
    const { terms } = parseFilterExpression(':leading', COLUMNS, getCellText);
    expect(terms).toEqual([{ column: null, text: ':leading' }]);
  });
});

describe('filterRows', () => {
  it('an empty filter returns the rows unchanged', () => {
    const rows = [row('a', null), row('b', null)];
    expect(filterRows(rows, '', COLUMNS, getCellText, new Set())).toBe(rows);
  });

  it('a filter matching only a deep descendant keeps every ancestor up to the root', () => {
    const rows = [
      row('bus', null, { Name: 'myBus' }),
      row('bus/e1', 'bus', { Name: 'speed' }),
      row('bus/e1/u', 'bus/e1', { Name: 'units' }),
      row('bus/e1/u/deep', 'bus/e1/u', { Name: 'target' }),
      row('bus/e2', 'bus', { Name: 'torque' }),
      row('other', null, { Name: 'unrelated' }),
    ];
    expect(ids(rows, 'target')).toEqual(['bus', 'bus/e1', 'bus/e1/u', 'bus/e1/u/deep']);
  });

  it('a matching ancestor keeps its whole subtree, including a grandchild', () => {
    const rows = [
      row('bus', null, { Name: 'myBus' }),
      row('bus/e1', 'bus', { Name: 'speed' }),
      row('bus/e1/u', 'bus/e1', { Name: 'units' }),
    ];
    expect(ids(rows, 'myBus')).toEqual(['bus', 'bus/e1', 'bus/e1/u']);
  });

  it('a non-matching branch is dropped entirely', () => {
    const rows = [
      row('bus', null, { Name: 'myBus' }),
      row('bus/e1', 'bus', { Name: 'speed' }),
      row('bus/e2', 'bus', { Name: 'torque' }),
    ];
    expect(ids(rows, 'speed')).toEqual(['bus', 'bus/e1']);
  });

  it('a dangling parent id stops the ancestor walk instead of throwing', () => {
    const rows = [row('orphan', 'missing', { Name: 'gain' })];
    expect(ids(rows, 'gain')).toEqual(['orphan']);
  });

  it('a parent cycle does not hang the walk', () => {
    const rows = [
      row('a', 'b', { Name: 'gain' }),
      row('b', 'a', { Name: 'other' }),
    ];
    expect(ids(rows, 'gain')).toEqual(['a', 'b']);
  });

  it('sticky rows are kept but do not count as matches — they do not re-admit their section', () => {
    const rows = [
      row('sec', null, { Name: 'Parameters' }),
      row('a', 'sec', { Name: 'gainA' }),
      row('b', 'sec', { Name: 'unrelated' }),
    ];
    // 'b' is sticky (e.g. edited out of a prior match) but must not pull the rest
    // of the section back in — only its own ancestors.
    expect(ids(rows, 'gain', new Set(['b']))).toEqual(['sec', 'a', 'b']);
  });

  it('with no sticky rows, keepSet is exactly the hit set', () => {
    const rows = [row('a', null, { Name: 'gain' }), row('b', null, { Name: 'other' })];
    expect(ids(rows, 'gain', new Set())).toEqual(['a']);
  });
});

describe('the operator scanner', () => {
  const VOCAB = { labels: { Name: 'Name', Value: 'Value', DataType: 'Data Type' }, keys: COLUMNS };

  it('reads a header label as the prefix, quoted when it has a space', () => {
    const { tokens } = parseFilterExpression('"Data Type"=double', COLUMNS, getCellText, VOCAB);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].column).toBe('DataType');
    expect(tokens[0].op).toBe('=');
    expect(tokens[0].value).toBe('double');
  });

  it('normalizes ~= to != while keeping the raw text the user typed', () => {
    const { tokens } = parseFilterExpression('Name~=abc', COLUMNS, getCellText, VOCAB);
    expect(tokens[0].op).toBe('!=');
    expect(tokens[0].raw).toBe('Name~=abc');
  });

  it('reads the two-character operators before the one-character ones', () => {
    for (const [text, op] of [['Value>=1', '>='], ['Value<=1', '<='], ['Value!=1', '!=']] as const) {
      expect(parseFilterExpression(text, COLUMNS, getCellText, VOCAB).tokens[0].op).toBe(op);
    }
  });

  it('still accepts the legacy colon-then-operator form on any column', () => {
    const { tokens } = parseFilterExpression('Value:>10', COLUMNS, getCellText, VOCAB);
    expect(tokens[0].op).toBe('>');
    expect(tokens[0].value).toBe('10');
  });

  it('leaves a bare word containing an operator character as ordinary text', () => {
    const { tokens } = parseFilterExpression('a>b', COLUMNS, getCellText, VOCAB);
    expect(tokens[0].column).toBeNull();
    expect(tokens[0].op).toBe('contains');
    expect(tokens[0].value).toBe('a>b');
  });

  it('does not read a lone ! or ~ as an operator', () => {
    expect(parseFilterExpression('Name!abc', COLUMNS, getCellText, VOCAB).tokens[0].column).toBeNull();
    expect(parseFilterExpression('~abc', COLUMNS, getCellText, VOCAB).tokens[0].value).toBe('~abc');
  });

  it('records the span so removing a token is a splice', () => {
    const text = 'abc Name=x Value>1';
    const { tokens } = parseFilterExpression(text, COLUMNS, getCellText, VOCAB);
    expect(tokens.map((t) => text.slice(t.start, t.end))).toEqual(['abc', 'Name=x', 'Value>1']);
  });
});
