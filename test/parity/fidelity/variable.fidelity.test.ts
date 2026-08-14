// Copyright 2026 The MathWorks, Inc.
//
// Fidelity round-trip tests for MatlabVariableNode (plain MATLAB variables) and
// ConstantNode (scalar-numeric gate). Exercises every value shape stored in
// params.sldd (JSON and binary): scalar double, vector, matrix, logical, complex,
// typed-int, char, string, string-array, cell, struct, empty. Then verifies the
// Constant scalar-numeric gate rejects arrays, char, and string.
//
// The live MATLAB gate (gated on DEX_MATLAB_CMD) writes the serialized .sldd to a
// temp file, opens it in MATLAB, and asserts value+type equality for representative
// shapes. Shapes that the verify_roundtrip scalar-path cannot express (cell, struct,
// complex, string-array) are tested in-process only.
import { describe, it, expect } from 'vitest';
import {
  loadModel,
  entryByName,
  serializeModel,
  reparseEntry,
  matlabAvailable,
  matlabAssertRoundTrip,
  type SlddFormat,
} from './roundTripHarness.js';
import MatlabVariableNode from '../../../src/dex/datamodel/node/data/MatlabVariableNode.js';
import ConstantNode from '../../../src/dex/datamodel/node/data/ConstantNode.js';
import '../../../src/dex/datamodel/node/NodeClassMap.js';

const FORMATS: SlddFormat[] = ['json', 'binary'];
const FIXTURE = 'params.sldd';

// MATLAB launches are slow (~20-30s each); increase timeout for live-gated tests.
const MATLAB_TIMEOUT = matlabAvailable() ? 60_000 : 5_000;

// ---------------------------------------------------------------------------
// Helper: load, find entry, edit Value, serialize, re-parse, return fresh node
// ---------------------------------------------------------------------------
function editAndRoundTrip(format: SlddFormat, entryName: string, newValue: string) {
  const uri = `test://var-fid-${format}-${entryName}.sldd`;
  const model = loadModel(format, FIXTURE, uri);
  const node = entryByName(model, uri, entryName);
  const result = node.setProperty('Value', newValue);
  expect(result, `setProperty should accept '${newValue}' for ${entryName}`).toBe(true);
  const bytes = serializeModel(model, format);
  const fresh = reparseEntry(bytes, format, FIXTURE, entryName);
  return { node, fresh, bytes };
}

// ---------------------------------------------------------------------------
// MatlabVariableNode round-trip: every value shape, both formats
// ---------------------------------------------------------------------------
describe('MatlabVariable round-trip fidelity', () => {
  for (const format of FORMATS) {
    describe(`[${format}]`, () => {
      // --- Scalar double ---
      it('scalarD: edit to new double, round-trips', () => {
        const { fresh, bytes } = editAndRoundTrip(format, 'scalarD', '2.718');
        expect(fresh.displayValue).toBe('2.718');
        expect(fresh._scalarType).toBe('double');
        expect(fresh._kind).toBe('scalar');
        if (matlabAvailable()) {
          matlabAssertRoundTrip(bytes, 'scalarD', { __value__: 2.718, __class__: 'double' });
        }
      }, MATLAB_TIMEOUT);

      it('negD: edit to negative double, round-trips', () => {
        const { fresh, bytes } = editAndRoundTrip(format, 'negD', '-42.5');
        expect(fresh.displayValue).toBe('-42.5');
        expect(fresh._kind).toBe('scalar');
        if (matlabAvailable()) {
          matlabAssertRoundTrip(bytes, 'negD', { __value__: -42.5, __class__: 'double' });
        }
      }, MATLAB_TIMEOUT);

      // --- Column vector ---
      it('colVec: edit to new column vector, round-trips', () => {
        const { fresh, bytes } = editAndRoundTrip(format, 'colVec', '[10; 20; 30]');
        expect(fresh._kind).toBe('array');
        expect(fresh._dims).toEqual([3, 1]);
        const elems = fresh.children.length > 0
          ? fresh.children.map((c: any) => c._scalarValue)
          : fresh._elements;
        expect(elems).toEqual([10, 20, 30]);
        if (matlabAvailable()) {
          // For vectors/matrices, just assert class — shape comparison via
          // __value__ requires transposing to match jsondecode's column-major
          // default, which is out of scope for this round-trip check.
          matlabAssertRoundTrip(bytes, 'colVec', { __class__: 'double' });
        }
      }, MATLAB_TIMEOUT);

      // --- Row vector ---
      it('rowVec: edit to new row vector, round-trips', () => {
        const { fresh, bytes } = editAndRoundTrip(format, 'rowVec', '[5 6 7 8]');
        expect(fresh._kind).toBe('array');
        expect(fresh._dims).toEqual([1, 4]);
        const elems = fresh.children.length > 0
          ? fresh.children.map((c: any) => c._scalarValue)
          : fresh._elements;
        expect(elems).toEqual([5, 6, 7, 8]);
        if (matlabAvailable()) {
          matlabAssertRoundTrip(bytes, 'rowVec', { __class__: 'double' });
        }
      }, MATLAB_TIMEOUT);

      // --- 2x2 matrix ---
      it('mat2x2: edit to new matrix, round-trips', () => {
        const { fresh, bytes } = editAndRoundTrip(format, 'mat2x2', '[5 6; 7 8]');
        expect(fresh._kind).toBe('array');
        expect(fresh._dims).toEqual([2, 2]);
        const elems = fresh.children.length > 0
          ? fresh.children.map((c: any) => c._scalarValue)
          : fresh._elements;
        expect(elems).toEqual([5, 6, 7, 8]);
        if (matlabAvailable()) {
          matlabAssertRoundTrip(bytes, 'mat2x2', { __class__: 'double' });
        }
      }, MATLAB_TIMEOUT);

      // --- Logical (boolean) scalar ---
      it('boolFlag: edit to false, round-trips', () => {
        const { fresh, bytes } = editAndRoundTrip(format, 'boolFlag', 'false');
        expect(fresh._kind).toBe('scalar');
        expect(fresh._scalarType).toBe('logical');
        expect(fresh._scalarValue).toBe(false);
        expect(fresh.displayValue).toBe('false');
        if (matlabAvailable()) {
          matlabAssertRoundTrip(bytes, 'boolFlag', { __value__: false, __class__: 'logical' });
        }
      }, MATLAB_TIMEOUT);

      // --- Typed integer: int16 ---
      // NOTE: MatlabValueParser.parse('500') produces type='double' — our editor
      // does NOT preserve the int16 type when the user types a new value. This is
      // a known limitation: the parser has no int16(...) cast syntax. After edit,
      // the entry becomes a double. The in-process round-trip verifies the numeric
      // value is preserved; the MATLAB gate confirms the value reads back (as double).
      it('i16Scalar: edit to new value, round-trips (type becomes double)', () => {
        const { fresh, bytes } = editAndRoundTrip(format, 'i16Scalar', '500');
        expect(fresh._kind).toBe('scalar');
        expect(fresh.displayValue).toBe('500');
        if (matlabAvailable()) {
          // After edit, the stored type becomes double (parser limitation).
          matlabAssertRoundTrip(bytes, 'i16Scalar', { __value__: 500, __class__: 'double' });
        }
      }, MATLAB_TIMEOUT);

      // --- String scalar ---
      it('strScalar: edit to new string, round-trips', () => {
        const { fresh } = editAndRoundTrip(format, 'strScalar', '"newValue"');
        // String scalars display as "..."
        expect(fresh.displayValue).toBe('"newValue"');
        expect(fresh._kind).toBe('string');
        // NOTE: Live MATLAB gate for string requires saveobj/loadobj path in
        // verify_roundtrip.m which compares as char — exercised here in-process only.
      });

      // --- Char scalar ---
      it('charStr: edit to new char, round-trips', () => {
        const { fresh } = editAndRoundTrip(format, 'charStr', "'world'");
        expect(fresh.displayValue).toBe("'world'");
        expect(fresh._kind).toBe('scalar');
        expect(fresh._scalarType).toBe('char');
        // NOTE: char scalars verified via MATLAB for scalarD/colVec/boolFlag/i16Scalar above;
        // char's class assertion works but value comparison needs special handling.
      });

      // --- Complex scalar (in-process only: binary cdata encoding) ---
      it('cplxScalar: edit to new complex, round-trips in-process', () => {
        const { fresh } = editAndRoundTrip(format, 'cplxScalar', '3+4i');
        expect(fresh._kind).toBe('scalar');
        expect(fresh._scalarType).toBe('complex');
        expect(fresh.displayValue).toBe('3+4i');
        // Complex cdata encoding is not trivially verified via the scalar path in
        // verify_roundtrip.m — tested in-process only. Documented in the fidelity doc.
      });

      // --- Empty double ---
      it('emptyD: loads as empty array, round-trips without edit', () => {
        const uri = `test://var-fid-empty-${format}.sldd`;
        const model = loadModel(format, FIXTURE, uri);
        const node = entryByName(model, uri, 'emptyD');
        expect(node._kind).toBe('array');
        expect(node._elements).toEqual([]);
        // Serialize and re-read to verify empty survives
        const bytes = serializeModel(model, format);
        const fresh = reparseEntry(bytes, format, FIXTURE, 'emptyD');
        expect(fresh._kind).toBe('array');
        expect(fresh._elements).toEqual([]);
      });

      // --- Cell (in-process only) ---
      it('myCell: loads as cell, round-trips without edit', () => {
        const uri = `test://var-fid-cell-${format}.sldd`;
        const model = loadModel(format, FIXTURE, uri);
        const node = entryByName(model, uri, 'myCell');
        expect(node._kind).toBe('cell');
        expect(node._dims).toEqual([1, 3]);
        const bytes = serializeModel(model, format);
        const fresh = reparseEntry(bytes, format, FIXTURE, 'myCell');
        expect(fresh._kind).toBe('cell');
        expect(fresh._dims).toEqual([1, 3]);
      });

      // --- Struct (top-level _array_type:"Struct" entries parse as StructNode,
      //     not MatlabVariableNode — tested via the struct-child path instead) ---
      it('struct-as-child: MatlabVariableNode struct child is non-editable', () => {
        // A struct stored as a MatlabVariableNode child (e.g. via setProperty or
        // parse of a struct field) is _kind='scalar', _scalarType='struct' and
        // valueEditable=false.
        const n = MatlabVariableNode.parse(0, 's', null);
        n._kind = 'scalar';
        n._scalarType = 'struct';
        expect(n.valueEditable).toBe(false);
        expect(n.icon).toBe('wsTree');
        expect(n.className).toBe('struct');
      });

      // --- String array (in-process only) ---
      it('strArray: loads as string array, round-trips without edit', () => {
        const uri = `test://var-fid-strArr-${format}.sldd`;
        const model = loadModel(format, FIXTURE, uri);
        const node = entryByName(model, uri, 'strArray');
        expect(node._kind).toBe('string');
        expect(node._dims).toEqual([1, 3]);
        expect(node._elements).toEqual(['a', 'bb', 'ccc']);
        const bytes = serializeModel(model, format);
        const fresh = reparseEntry(bytes, format, FIXTURE, 'strArray');
        expect(fresh._kind).toBe('string');
        expect(fresh._elements).toEqual(['a', 'bb', 'ccc']);
      });

      // --- Logical vector ---
      it('boolVec: loads as logical array, round-trips without edit', () => {
        const uri = `test://var-fid-boolVec-${format}.sldd`;
        const model = loadModel(format, FIXTURE, uri);
        const node = entryByName(model, uri, 'boolVec');
        expect(node._kind).toBe('array');
        expect(node._scalarType).toBe('logical');
        const bytes = serializeModel(model, format);
        const fresh = reparseEntry(bytes, format, FIXTURE, 'boolVec');
        expect(fresh._kind).toBe('array');
        expect(fresh._scalarType).toBe('logical');
      });
    });
  }
});

// ---------------------------------------------------------------------------
// MatlabVariableNode constrained-child editing rules
// ---------------------------------------------------------------------------
describe('MatlabVariable constrained-child rules', () => {
  it('array element rejects non-scalar-number edit', () => {
    const uri = 'test://var-fid-constraint-array.sldd';
    const model = loadModel('json', FIXTURE, uri);
    const node = entryByName(model, uri, 'rowVec');
    expect(node.children.length).toBeGreaterThan(0);
    const child = node.children[0];
    const result = child.setProperty('Value', "'text'");
    expect(result).not.toBe(true);
    expect((result as any).reason).toBe('Array elements must be scalar numbers');
  });

  it('string-array element rejects non-string edit', () => {
    const uri = 'test://var-fid-constraint-str.sldd';
    const model = loadModel('json', FIXTURE, uri);
    const node = entryByName(model, uri, 'strArray');
    expect(node.children.length).toBeGreaterThan(0);
    const child = node.children[0];
    const result = child.setProperty('Value', '42');
    expect(result).not.toBe(true);
    expect((result as any).reason).toBe('String elements must be character or string values');
  });
});

// ---------------------------------------------------------------------------
// ConstantNode scalar-numeric gate (direct validation)
// ---------------------------------------------------------------------------
describe('Constant scalar-numeric gate', () => {
  function makeConst(name: string, value: unknown): ConstantNode {
    const base = MatlabVariableNode.parse(value, name, null);
    return ConstantNode.fromVariable(base);
  }

  it('accepts a scalar numeric edit', () => {
    const c = makeConst('K', 0);
    expect(c.setProperty('Value', '5')).toBe(true);
    expect(c.displayValue).toBe('5');
  });

  it('accepts a logical edit', () => {
    const c = makeConst('K', 0);
    expect(c.setProperty('Value', 'true')).toBe(true);
    expect(c.displayValue).toBe('true');
  });

  it('accepts a complex scalar', () => {
    const c = makeConst('K', 0);
    expect(c.setProperty('Value', '1+2i')).toBe(true);
    expect(c.displayValue).toBe('1+2i');
  });

  it('rejects an array with the exact error message', () => {
    const c = makeConst('MyC', 0);
    const result = c.setProperty('Value', '[1 2 3]');
    expect(result).not.toBe(true);
    expect((result as any).error).toBe(true);
    expect((result as any).reason).toBe("The value for constant 'MyC' must be scalar and numeric.");
  });

  it('rejects a char value', () => {
    const c = makeConst('C1', 0);
    const result = c.setProperty('Value', "'txt'");
    expect(result).not.toBe(true);
    expect((result as any).reason).toBe("The value for constant 'C1' must be scalar and numeric.");
  });

  it('rejects a string value', () => {
    const c = makeConst('C2', 0);
    const result = c.setProperty('Value', '"hello"');
    expect(result).not.toBe(true);
    expect((result as any).reason).toBe("The value for constant 'C2' must be scalar and numeric.");
  });

  it('rejects a matrix', () => {
    const c = makeConst('Km', 0);
    const result = c.setProperty('Value', '[1 2; 3 4]');
    expect(result).not.toBe(true);
    expect((result as any).reason).toBe("The value for constant 'Km' must be scalar and numeric.");
  });

  it('rejects a cell', () => {
    const c = makeConst('Kc', 0);
    const result = c.setProperty('Value', '{1, 2}');
    expect(result).not.toBe(true);
    expect((result as any).reason).toBe("The value for constant 'Kc' must be scalar and numeric.");
  });

  it('rejects unparseable input as Invalid MATLAB expression', () => {
    const c = makeConst('K', 0);
    const result = c.setProperty('Value', 'int8(5)');
    expect(result).not.toBe(true);
    expect((result as any).reason).toBe('Invalid MATLAB expression');
  });

  it('a non-scalar-numeric Constant from file is read-only (defensive)', () => {
    // Simulate a corrupt file: a derived entry whose value is an array
    const base = MatlabVariableNode.parse([1, 2, 3], 'BadConst', null);
    const c = ConstantNode.fromVariable(base);
    expect(c.isScalarNumeric).toBe(false);
    expect(c.valueEditable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Constant round-trip via the full fixture (edit a derived entry or create one)
// ---------------------------------------------------------------------------
describe('Constant round-trip (via ConstantNode.createDefault)', () => {
  for (const format of FORMATS) {
    it(`[${format}] create, edit, serialize, re-parse preserves value`, () => {
      const c = ConstantNode.createDefault('TestConst', null);
      expect(c.setProperty('Value', '99.5')).toBe(true);
      expect(c.displayValue).toBe('99.5');
      // We can't round-trip through the fixture easily since createDefault is standalone,
      // but we verify parse(serialize()) identity
      const serialized = c.serializeValue();
      const reparsed = MatlabVariableNode.parse(serialized, 'TestConst', null);
      const rc = ConstantNode.fromVariable(reparsed);
      expect(rc.displayValue).toBe('99.5');
      expect(rc.isScalarNumeric).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// MatlabVariableNode property accessors (icon, className, dataType, kind)
// ---------------------------------------------------------------------------
describe('MatlabVariable property accessors', () => {
  it('scalar double: icon=wsDefault, className=double, dataType=double, kind=MATLAB Variable', () => {
    const n = MatlabVariableNode.parse(3.14, 'x', null);
    expect(n.icon).toBe('wsDefault');
    expect(n.className).toBe('double');
    expect(n.dataType).toBe('double');
    expect(n.kind).toBe('MATLAB Variable');
  });

  it('logical scalar: icon=wsCheck, className=logical', () => {
    const n = MatlabVariableNode.parse(true, 'b', null);
    expect(n.icon).toBe('wsCheck');
    expect(n.className).toBe('logical');
  });

  it('char scalar: icon=wsCharacter, className=char', () => {
    const n = MatlabVariableNode.parse('hi', 'c', null);
    expect(n.icon).toBe('wsCharacter');
    expect(n.className).toBe('char');
  });

  it('string: icon=wsString', () => {
    const n = MatlabVariableNode.parsePlainStringArray(['a', 'b'], 's', null);
    expect(n.icon).toBe('wsString');
  });

  it('cell: icon=wsBrackets, className=cell', () => {
    const raw = { _array_type: 'Cell', _dimensions: [1, 2], _elements: [1, 2], _mw_element_type: 'MATLABArray' };
    const n = MatlabVariableNode.parse(raw, 'c', null);
    expect(n.icon).toBe('wsBrackets');
    expect(n.className).toBe('cell');
  });

  it('struct: icon=wsTree, className=struct, valueEditable=false', () => {
    const n = MatlabVariableNode.parse(0, 's', null);
    n._kind = 'scalar';
    n._scalarType = 'struct';
    expect(n.icon).toBe('wsTree');
    expect(n.className).toBe('struct');
    expect(n.valueEditable).toBe(false);
  });

  it('derived variable gets kind="Constant" and icon=typeConstant', () => {
    const n = MatlabVariableNode.parse(5, 'x', null);
    (n as any).metadata = { isderived: '1' };
    Object.defineProperty(n, 'isDerived', { get() { return true; } });
    expect(n.icon).toBe('typeConstant');
    expect(n.kind).toBe('Constant');
  });
});
