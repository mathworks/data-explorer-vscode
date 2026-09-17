// Copyright 2026 The MathWorks, Inc.
//
// The row-filter grammar, tested directly against parseFilterExpression/filterRows
// rather than through the DOM. The DOM-level behaviour (dex-tree-table's search
// box) is already pinned in treeTableFilter.test.ts and must keep passing
// unchanged — these tests exist to reach the grammar's edge cases without paying
// for a happy-dom component mount per case, and to cover the module in isolation.
import { describe, it, expect } from 'vitest';
import {
  parseFilterExpression, filterRows, formatToken, removeToken, SUBSTRING_FILTER_COLUMNS,
  type ColumnVocabulary,
} from '../src/webview/rowFilter.js';

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
function ids(
  rows: Row[],
  text: string,
  stickyRowIds: Set<string> = new Set(),
  vocabulary?: ColumnVocabulary,
): string[] {
  return filterRows(rows, text, COLUMNS, getCellText, stickyRowIds, vocabulary).map((r) => r.ID);
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

  it('a quoted value groups, it does not mean exact — = is what does', () => {
    // The one grammar exception that used to live here: `value:"5"` was exact AND
    // case-sensitive while its five sibling prefixes were neither. Now quoting only
    // holds a phrase together, and `=` is the operator that means exactly.
    const { predicates: quoted } = parseFilterExpression('value:"5"', COLUMNS, getCellText);
    expect(quoted[0](row('a', null, { Value: '15' }))).toBe(true);

    const VOCAB = { labels: { Value: 'Value' }, keys: COLUMNS };
    const { predicates: exact } = parseFilterExpression('Value=5', COLUMNS, getCellText, VOCAB);
    expect(exact[0](row('a', null, { Value: '5' }))).toBe(true);
    expect(exact[0](row('a', null, { Value: '15' }))).toBe(false);
    // Numeric, so a differently-spelled 5 still counts.
    expect(exact[0](row('a', null, { Value: '5.0' }))).toBe(true);
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

// A user types the prefix off the header they are looking at, and that header says
// `Data Type`, not `"Data Type"`. Without this the space split the label in two and
// `Data Type:double` silently became `Data` AND `Type:double` — two conditions, one
// of them a stray word, which reads as the filter being broken.
describe('a header label with a space, unquoted', () => {
  const VOCAB = {
    labels: { Name: 'Name', Value: 'Value', DataType: 'Data Type', lastModified: 'Last Modified', lastModifiedBy: 'Last Modified By' },
    keys: [...COLUMNS, 'lastModified', 'lastModifiedBy'],
  };

  it('reads the whole label as the prefix', () => {
    const { tokens } = parseFilterExpression('Data Type:double', COLUMNS, getCellText, VOCAB);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ column: 'DataType', op: 'contains', value: 'double', raw: 'Data Type:double' });
  });

  it('works for every operator, and case-insensitively', () => {
    for (const [text, op] of [['Data Type=double', '='], ['data type!=double', '!='], ['DATA TYPE:double', 'contains']] as const) {
      const { tokens } = parseFilterExpression(text, COLUMNS, getCellText, VOCAB);
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({ column: 'DataType', op });
    }
  });

  it('prefers the longest label, so Last Modified By is not Last Modified + By', () => {
    const { tokens } = parseFilterExpression('Last Modified By:ww', COLUMNS, getCellText, VOCAB);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ column: 'lastModifiedBy', value: 'ww' });
  });

  it('keeps a quoted value together after an unquoted label', () => {
    const { tokens } = parseFilterExpression('Data Type="fixed point"', COLUMNS, getCellText, VOCAB);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ column: 'DataType', op: '=', value: 'fixed point' });
  });

  it('leaves the same words alone when no operator follows them', () => {
    const { tokens } = parseFilterExpression('Data Type', COLUMNS, getCellText, VOCAB);
    expect(tokens).toHaveLength(2);
    expect(tokens.map((t) => t.column)).toEqual([null, null]);
    expect(tokens.map((t) => t.value)).toEqual(['Data', 'Type']);
  });

  it('records one span covering the label, so its chip removes in one go', () => {
    const text = 'abc Data Type:double Value>1';
    const { tokens } = parseFilterExpression(text, COLUMNS, getCellText, VOCAB);
    expect(tokens.map((t) => text.slice(t.start, t.end))).toEqual(['abc', 'Data Type:double', 'Value>1']);
    expect(removeToken(text, tokens[1])).toBe('abc Value>1');
  });

  it('tolerates a double space inside the label', () => {
    const { tokens } = parseFilterExpression('Data  Type:double', COLUMNS, getCellText, VOCAB);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ column: 'DataType', value: 'double' });
  });

  it('is not fooled by a quoted phrase that happens to start with a label', () => {
    const { tokens } = parseFilterExpression('"Data Type: double"', COLUMNS, getCellText, VOCAB);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ column: null, value: 'Data Type: double' });
  });
});

// `Value > 5` and `Name: abc` are how a person writes a condition. Whitespace around
// the operator used to split one condition into two or three junk terms that matched
// nothing. It is insignificant now — but ONLY once the prefix has resolved to a real
// column, which is what keeps `a > b` ordinary text.
describe('whitespace around the operator', () => {
  const VOCAB = {
    labels: { Name: 'Name', Value: 'Value', DataType: 'Data Type', Unit: 'Unit' },
    keys: [...COLUMNS, 'Unit'],
  };
  const one = (text: string) => {
    const { tokens } = parseFilterExpression(text, COLUMNS, getCellText, VOCAB);
    expect(tokens).toHaveLength(1);
    return tokens[0];
  };

  it('accepts a space after the colon, multi-word label included', () => {
    expect(one('data type: double')).toMatchObject({ column: 'DataType', op: 'contains', value: 'double' });
    expect(one('Name: abc')).toMatchObject({ column: 'Name', op: 'contains', value: 'abc' });
  });

  it('accepts spaces on both sides of any operator', () => {
    expect(one('Value > 5')).toMatchObject({ column: 'Value', op: '>', value: '5' });
    expect(one('Value >= 5')).toMatchObject({ column: 'Value', op: '>=', value: '5' });
    expect(one('Name != abc')).toMatchObject({ column: 'Name', op: '!=', value: 'abc' });
    expect(one('Data Type = double')).toMatchObject({ column: 'DataType', op: '=', value: 'double' });
    expect(one('Value< 5')).toMatchObject({ column: 'Value', op: '<', value: '5' });
    expect(one('Value :5')).toMatchObject({ column: 'Value', op: 'contains', value: '5' });
  });

  it('reads the legacy colon-then-operator form across a space too', () => {
    expect(one('Value: >10')).toMatchObject({ op: '>', value: '10' });
    expect(one('Value: > 10')).toMatchObject({ op: '>', value: '10' });
  });

  it('takes a quoted value from after the space', () => {
    expect(one('Data Type: "fixed point"')).toMatchObject({ column: 'DataType', value: 'fixed point' });
  });

  it('does not swallow the NEXT condition as a value', () => {
    const { tokens } = parseFilterExpression('Unit= Value>5', COLUMNS, getCellText, VOCAB);
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toMatchObject({ column: 'Unit', op: '=', value: '' });
    expect(tokens[1]).toMatchObject({ column: 'Value', op: '>', value: '5' });
  });

  it('still reads a trailing operator as an empty value, which asks for empty cells', () => {
    expect(one('Unit=')).toMatchObject({ column: 'Unit', op: '=', value: '' });
    expect(one('Unit= ')).toMatchObject({ column: 'Unit', op: '=', value: '' });
  });

  it('leaves an operator between two non-columns as ordinary text', () => {
    const { tokens } = parseFilterExpression('a > b', COLUMNS, getCellText, VOCAB);
    expect(tokens).toHaveLength(3);
    expect(tokens.map((t) => t.column)).toEqual([null, null, null]);
  });

  it('leaves a column name followed by an ordinary word alone', () => {
    const { tokens } = parseFilterExpression('Name gain', COLUMNS, getCellText, VOCAB);
    expect(tokens).toHaveLength(2);
    expect(tokens.map((t) => t.value)).toEqual(['Name', 'gain']);
  });

  it('spans the whole condition, so the chip removes every part of it', () => {
    const text = 'abc Data Type: double Value>1';
    const { tokens } = parseFilterExpression(text, COLUMNS, getCellText, VOCAB);
    expect(tokens.map((t) => text.slice(t.start, t.end))).toEqual(['abc', 'Data Type: double', 'Value>1']);
    expect(removeToken(text, tokens[1])).toBe('abc Value>1');
  });

  it('filters the rows it says it does', () => {
    const rows = [
      row('a', null, { Name: 'gain', Value: '10', DataType: 'double' }),
      row('b', null, { Name: 'other', Value: '2', DataType: 'single' }),
    ];
    expect(ids(rows, 'Value > 5', new Set(), VOCAB)).toEqual(['a']);
    expect(ids(rows, 'data type: single', new Set(), VOCAB)).toEqual(['b']);
  });

  it('reads every spelling of one condition the same way', () => {
    // Two code paths now: one that scans a bare label across whitespace, and the
    // per-chunk one that still handles a QUOTED prefix (which no bare label can
    // match). Pin the invariant BETWEEN them — a user who quotes, spaces, or does
    // neither is asking the same question and must get the same answer.
    const want = { column: 'DataType', op: '=' as const, value: 'double' };
    for (const text of ['Data Type=double', 'Data Type = double', 'Data Type =double', '"Data Type"=double']) {
      expect(one(text), text).toMatchObject(want);
    }
  });

  it('takes the word after the operator as the value, so Unit= abc is not two conditions', () => {
    // The cost of crossing whitespace: `Unit= abc` used to mean "no Unit, and abc
    // somewhere". It now means Unit equals abc, which is what the spacing looks
    // like. Asking for empty cells still works — leave nothing after the operator.
    expect(one('Unit= abc')).toMatchObject({ column: 'Unit', op: '=', value: 'abc' });
    expect(one('Unit=')).toMatchObject({ column: 'Unit', op: '=', value: '' });
  });
});

describe('the = rule', () => {
  const VOCAB = { labels: { Name: 'Name', Value: 'Value' }, keys: COLUMNS };
  const match = (text: string, r: Row) =>
    parseFilterExpression(text, COLUMNS, getCellText, VOCAB).predicates.every((p) => p(r));

  it('compares as numbers when both sides are numbers, so 10 equals 10.0', () => {
    expect(match('Value=10', row('a', null, { Value: '10.0' }))).toBe(true);
    expect(match('Value=10', row('a', null, { Value: '1e1' }))).toBe(true);
    expect(match('Value=10', row('a', null, { Value: '100' }))).toBe(false);
  });

  it('compares as text, case-insensitively, when either side is not a number', () => {
    expect(match('Name=MYVAR', row('a', null, { Name: 'myVar' }))).toBe(true);
    expect(match('Name=myVa', row('a', null, { Name: 'myVar' }))).toBe(false);
  });

  it('an empty value asks for empty cells', () => {
    expect(match('Value=', row('a', null, { Value: '' }))).toBe(true);
    expect(match('Value=', row('a', null, { Value: '0' }))).toBe(false);
  });

  it('!= includes a row whose cell is empty', () => {
    expect(match('Value!=5', row('a', null, { Value: '' }))).toBe(true);
    expect(match('Value!=5', row('a', null, { Value: '5' }))).toBe(false);
    expect(match('Value~=5', row('a', null, { Value: '5' }))).toBe(false);
  });

  it('a comparison with a non-numeric bound is ignored, not empty-matching', () => {
    const { predicates, tokens } = parseFilterExpression('Value>abc', COLUMNS, getCellText, VOCAB);
    expect(predicates).toEqual([]);
    expect(tokens[0].warning).toBe('non-numeric-bound');
  });
});

describe('formatToken and removeToken', () => {
  it('quotes a label or value only when it needs quoting', () => {
    expect(formatToken('Name', 'contains', 'abc')).toBe('Name:abc');
    expect(formatToken('Data Type', '=', 'double')).toBe('"Data Type"=double');
    expect(formatToken('Name', '=', 'my var')).toBe('Name="my var"');
    expect(formatToken('Value', '>', '10')).toBe('Value>10');
  });

  it('round-trips through the parser to the same column, op and value', () => {
    const VOCAB = { labels: { DataType: 'Data Type' }, keys: ['DataType'] };
    const text = formatToken('Data Type', '!=', 'my type');
    const { tokens } = parseFilterExpression(text, ['DataType'], getCellText, VOCAB);
    expect(tokens[0]).toMatchObject({ column: 'DataType', op: '!=', value: 'my type' });
  });

  it('removes one token and leaves the rest re-parsing unchanged', () => {
    const text = 'abc Name=x Value>1';
    const { tokens } = parseFilterExpression(text, COLUMNS, getCellText);
    expect(removeToken(text, tokens[1])).toBe('abc Value>1');
    expect(removeToken(text, tokens[0])).toBe('Name=x Value>1');
    expect(removeToken(text, tokens[2])).toBe('abc Name=x');
  });

  it('does not disturb whitespace inside a quoted value', () => {
    const text = 'Name="my  var" abc';
    const { tokens } = parseFilterExpression(text, COLUMNS, getCellText);
    expect(removeToken(text, tokens[1])).toBe('Name="my  var"');
  });
});
