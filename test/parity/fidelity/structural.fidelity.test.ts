// Copyright 2026 The MathWorks, Inc.
//
// Structural add/remove round-trip fidelity tests for Bus, ConnectionBus,
// ServiceBus, and Struct nodes. Verifies that adding or removing a child
// (element/field), serializing in both formats, re-parsing, and optionally
// re-opening in MATLAB produces the correct child count and values.
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
import { ServiceBusNode } from '../../../src/dex/datamodel/node/data/ServiceBusNode.js';
import '../../../src/dex/datamodel/node/NodeClassMap.js';

const FORMATS: SlddFormat[] = ['json', 'binary'];
const FIXTURE = 'params.sldd';

// MATLAB launches are slow (~20-30s each); increase timeout for live-gated tests.
const MATLAB_TIMEOUT = matlabAvailable() ? 120_000 : 10_000;

// ---------------------------------------------------------------------------
// Simulink.Bus — add / remove element
// ---------------------------------------------------------------------------
describe('Simulink.Bus structural round-trip', () => {
  for (const format of FORMATS) {
    describe(`[${format}]`, () => {
      it('add element: child count N+1 and new name present after re-parse', { timeout: MATLAB_TIMEOUT }, () => {
        const uri = `test://bus-add-${format}-${Date.now()}.sldd`;
        const model = loadModel(format, FIXTURE, uri);
        const node = entryByName(model, uri, 'MyBus');
        const N = node.children.length;
        expect(N).toBeGreaterThan(0);

        // Add a new element via the structural API
        const result = node.execAddChild();
        expect(result).not.toBeNull();
        expect(node.children.length).toBe(N + 1);
        const newName = result.node.name;

        // Serialize and re-parse
        const bytes = serializeModel(model, format);
        const fresh = reparseEntry(bytes, format, FIXTURE, 'MyBus');
        expect(fresh.children.length).toBe(N + 1);
        const freshNames = fresh.children.map((c: any) => c.name);
        expect(freshNames).toContain(newName);

        // MATLAB live gate: verify count AND the new element's Name via indexed path
        if (matlabAvailable()) {
          const expected: Record<string, unknown> = {
            __count__: N + 1,
            __class__: 'Simulink.Bus',
          };
          expected[`Elements(${N + 1}).Name`] = newName;
          const out = matlabAssertRoundTrip(bytes, 'MyBus', expected);
          expect(out).toMatch(/RESULT PASS/);
        }
      });

      it('remove element: child count N-1 and removed name gone after re-parse', { timeout: MATLAB_TIMEOUT }, () => {
        const uri = `test://bus-rm-${format}-${Date.now()}.sldd`;
        const model = loadModel(format, FIXTURE, uri);
        const node = entryByName(model, uri, 'MyBus');
        const N = node.children.length;
        expect(N).toBeGreaterThan(0);
        const removedName = node.children[0].name;
        // After removing the first, the surviving element is the second original
        const survivingName = node.children[N - 1].name;

        // Remove the first element
        const result = node.execRemoveChild(node.children[0]);
        expect(result).not.toBeNull();
        expect(node.children.length).toBe(N - 1);

        // Serialize and re-parse
        const bytes = serializeModel(model, format);
        const fresh = reparseEntry(bytes, format, FIXTURE, 'MyBus');
        expect(fresh.children.length).toBe(N - 1);
        const freshNames = fresh.children.map((c: any) => c.name);
        expect(freshNames).not.toContain(removedName);

        // MATLAB live gate: verify count AND surviving element's Name
        if (matlabAvailable()) {
          const expected: Record<string, unknown> = {
            __count__: N - 1,
            __class__: 'Simulink.Bus',
          };
          expected['Elements(1).Name'] = survivingName;
          const out = matlabAssertRoundTrip(bytes, 'MyBus', expected);
          expect(out).toMatch(/RESULT PASS/);
        }
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Simulink.ConnectionBus — add / remove element
// ---------------------------------------------------------------------------
describe('Simulink.ConnectionBus structural round-trip', () => {
  for (const format of FORMATS) {
    describe(`[${format}]`, () => {
      it('add element: child count increases and new name present', { timeout: MATLAB_TIMEOUT }, () => {
        const uri = `test://connbus-add-${format}-${Date.now()}.sldd`;
        const model = loadModel(format, FIXTURE, uri);
        const node = entryByName(model, uri, 'MyConnBus');
        const N = node.children.length;

        const result = node.execAddChild();
        expect(result).not.toBeNull();
        expect(node.children.length).toBe(N + 1);
        const newName = result.node.name;

        const bytes = serializeModel(model, format);
        const fresh = reparseEntry(bytes, format, FIXTURE, 'MyConnBus');
        expect(fresh.children.length).toBe(N + 1);
        const freshNames = fresh.children.map((c: any) => c.name);
        expect(freshNames).toContain(newName);

        if (matlabAvailable()) {
          const expected: Record<string, unknown> = {
            __count__: N + 1,
            __class__: 'Simulink.ConnectionBus',
          };
          expected[`Elements(${N + 1}).Name`] = newName;
          const out = matlabAssertRoundTrip(bytes, 'MyConnBus', expected);
          expect(out).toMatch(/RESULT PASS/);
        }
      });

      it('remove element: child count decreases and removed name gone', { timeout: MATLAB_TIMEOUT }, () => {
        const uri = `test://connbus-rm-${format}-${Date.now()}.sldd`;
        const model = loadModel(format, FIXTURE, uri);
        const node = entryByName(model, uri, 'MyConnBus');
        const N = node.children.length;
        expect(N).toBeGreaterThan(0);
        const removedName = node.children[0].name;

        const result = node.execRemoveChild(node.children[0]);
        expect(result).not.toBeNull();
        expect(node.children.length).toBe(N - 1);

        const bytes = serializeModel(model, format);
        const fresh = reparseEntry(bytes, format, FIXTURE, 'MyConnBus');
        expect(fresh.children.length).toBe(N - 1);
        const freshNames = fresh.children.map((c: any) => c.name);
        expect(freshNames).not.toContain(removedName);

        if (matlabAvailable()) {
          const out = matlabAssertRoundTrip(bytes, 'MyConnBus', {
            __count__: N - 1,
            __class__: 'Simulink.ConnectionBus',
          });
          expect(out).toMatch(/RESULT PASS/);
        }
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Struct — add / remove field
// ---------------------------------------------------------------------------
describe('Struct structural round-trip', () => {
  for (const format of FORMATS) {
    describe(`[${format}]`, () => {
      it('add field: new field present with value 0 after re-parse', { timeout: MATLAB_TIMEOUT }, () => {
        const uri = `test://struct-add-${format}-${Date.now()}.sldd`;
        const model = loadModel(format, FIXTURE, uri);
        const node = entryByName(model, uri, 'myStruct');
        const N = node.children.length;
        expect(N).toBeGreaterThan(0);

        const result = node.execAddChild();
        expect(result).not.toBeNull();
        expect(node.children.length).toBe(N + 1);
        const newFieldName = result.node.name;
        // The new field defaults to value 0
        expect(result.node.displayValue).toBe('0');

        const bytes = serializeModel(model, format);
        const fresh = reparseEntry(bytes, format, FIXTURE, 'myStruct');
        expect(fresh.children.length).toBe(N + 1);
        const freshNames = fresh.children.map((c: any) => c.name);
        expect(freshNames).toContain(newFieldName);
        // Original fields intact
        expect(freshNames).toContain('a');
        expect(freshNames).toContain('b');
        expect(freshNames).toContain('c');

        // MATLAB gate: for a struct entry, getValue(e) returns the struct itself.
        // We assert the added field's value (default 0). fieldnames-based __count__
        // does not apply — we use the field path directly.
        if (matlabAvailable()) {
          const expected: Record<string, unknown> = {};
          expected[newFieldName] = 0;
          const out = matlabAssertRoundTrip(bytes, 'myStruct', expected);
          expect(out).toMatch(/RESULT PASS/);
        }
      });

      it('remove field: removed field gone, siblings intact after re-parse', { timeout: MATLAB_TIMEOUT }, () => {
        const uri = `test://struct-rm-${format}-${Date.now()}.sldd`;
        const model = loadModel(format, FIXTURE, uri);
        const node = entryByName(model, uri, 'myStruct');
        const N = node.children.length;
        expect(N).toBeGreaterThan(1);
        // Remove field 'a' (the first one)
        const target = node.children.find((c: any) => c.name === 'a');
        expect(target).toBeDefined();

        const result = node.execRemoveChild(target);
        expect(result).not.toBeNull();
        expect(node.children.length).toBe(N - 1);

        const bytes = serializeModel(model, format);
        const fresh = reparseEntry(bytes, format, FIXTURE, 'myStruct');
        expect(fresh.children.length).toBe(N - 1);
        const freshNames = fresh.children.map((c: any) => c.name);
        expect(freshNames).not.toContain('a');
        // Siblings survived
        expect(freshNames).toContain('b');
        expect(freshNames).toContain('c');

        // MATLAB gate: assert surviving field 'c' has value 'txt' (char).
        // NOTE: cannot use field 'b' ([2,3]) because jsondecode converts JSON
        // arrays to column vectors while MATLAB stores them as row vectors.
        if (matlabAvailable()) {
          const out = matlabAssertRoundTrip(bytes, 'myStruct', { c: 'txt' });
          expect(out).toMatch(/RESULT PASS/);
        }
      });

      it('nestedStruct add field: new field on nested struct round-trips', { timeout: MATLAB_TIMEOUT }, () => {
        const uri = `test://nested-add-${format}-${Date.now()}.sldd`;
        const model = loadModel(format, FIXTURE, uri);
        const node = entryByName(model, uri, 'nestedStruct');
        const N = node.children.length;

        const result = node.execAddChild();
        expect(result).not.toBeNull();
        expect(node.children.length).toBe(N + 1);
        const newFieldName = result.node.name;

        const bytes = serializeModel(model, format);
        const fresh = reparseEntry(bytes, format, FIXTURE, 'nestedStruct');
        expect(fresh.children.length).toBe(N + 1);
        const freshNames = fresh.children.map((c: any) => c.name);
        expect(freshNames).toContain(newFieldName);
        expect(freshNames).toContain('inner');
        expect(freshNames).toContain('name');

        if (matlabAvailable()) {
          const expected: Record<string, unknown> = {};
          expected[newFieldName] = 0;
          const out = matlabAssertRoundTrip(bytes, 'nestedStruct', expected);
          expect(out).toMatch(/RESULT PASS/);
        }
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Struct array — canAddChild guard (dims not 1x1)
// ---------------------------------------------------------------------------
describe('Struct array guard', () => {
  for (const format of FORMATS) {
    it(`[${format}] structArray canAddChild is false (dims 1x2)`, () => {
      const uri = `test://struct-arr-guard-${format}.sldd`;
      const model = loadModel(format, FIXTURE, uri);
      const node = entryByName(model, uri, 'structArray');
      expect(node.canAddChild()).toBe(false);
      expect(node.canRemoveChild()).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// ServiceBus — add function element (in-process, no fixture entry)
// ---------------------------------------------------------------------------
describe('Simulink.ServiceBus structural round-trip (in-process)', () => {
  it('add function element: FunctionElement has Prototype and Arguments', () => {
    const node = ServiceBusNode.createDefault('TestSvc', null);
    expect(node.children.length).toBe(0);

    // Add first function element
    const result = node.execAddChild() as { node: any; undo: () => void; redo: () => void };
    expect(result).not.toBeNull();
    expect(node.children.length).toBe(1);

    const fn = result.node;
    expect(fn.name).toBe('f0');
    expect(fn.Prototype).toBe('y = f0(u,v)');
    expect(fn.className).toBe('Simulink.FunctionElement');

    // Verify arguments in the serial data
    const args = (fn.serial._properties as Record<string, unknown>).Arguments as Record<string, unknown>;
    expect(args).toBeDefined();
    expect((args._elements as unknown[]).length).toBe(3);
    const argNames = (args._elements as { _properties: { Name: string } }[]).map(
      (a) => a._properties.Name,
    );
    expect(argNames).toEqual(['u', 'v', 'y']);
  });

  it('add multiple function elements: unique names and ids', () => {
    const node = ServiceBusNode.createDefault('Svc2', null);
    node.execAddChild();
    const r2 = node.execAddChild() as { node: any };
    expect(node.children.length).toBe(2);
    expect(r2.node.name).toBe('f1');
    expect(r2.node.Prototype).toBe('y = f1(u,v)');

    // All element ids must be unique
    const ids = new Set<string>();
    for (const child of node.children) {
      const raw = (child as any).serial._rawElem as Record<string, unknown>;
      ids.add(raw._id as string);
      const args = ((child as any).serial._properties as Record<string, unknown>).Arguments as Record<string, unknown>;
      for (const ae of (args._elements as { _id: string }[])) {
        ids.add(ae._id);
      }
    }
    // 2 functions * (1 elem + 3 args) = 8 unique ids
    expect(ids.size).toBe(8);
  });

  it('remove function element: child count decreases', () => {
    const node = ServiceBusNode.createDefault('Svc3', null);
    node.execAddChild();
    node.execAddChild();
    expect(node.children.length).toBe(2);

    const result = node.execRemoveChild(node.children[0]);
    expect(result).not.toBeNull();
    expect(node.children.length).toBe(1);
    expect(node.children[0].name).toBe('f1');
  });

  it('ServiceBus serialize round-trip: added element survives re-serialize', () => {
    const node = ServiceBusNode.createDefault('SvcRT', null);
    node.execAddChild();

    // Serialize and verify shape
    const serialized = node.serializeValue() as Record<string, unknown>;
    const props = ((serialized._elements as unknown[])[0] as Record<string, unknown>)._properties as Record<string, unknown>;
    const elemInternal = props.Elements_internal as Record<string, unknown>;
    expect(elemInternal).toBeDefined();
    expect((elemInternal._elements as unknown[]).length).toBe(1);
    expect(elemInternal._dimensions).toEqual([1, 1]);

    // The element's properties include Prototype and Arguments
    const fnElem = (elemInternal._elements as Record<string, unknown>[])[0];
    const fnProps = fnElem._properties as Record<string, unknown>;
    expect(fnProps.Name).toBe('f0');
    expect(fnProps.Prototype).toBe('y = f0(u,v)');
    expect(fnProps.Arguments).toBeDefined();
    expect(((fnProps.Arguments as Record<string, unknown>)._elements as unknown[]).length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Add-then-undo / add-then-remove idempotence
// ---------------------------------------------------------------------------
describe('Structural undo/redo idempotence', () => {
  it('Bus: execAddChild then undo restores original child count', () => {
    const uri = 'test://bus-undo-add.sldd';
    const model = loadModel('json', FIXTURE, uri);
    const node = entryByName(model, uri, 'MyBus');
    const N = node.children.length;

    const result = node.execAddChild();
    expect(node.children.length).toBe(N + 1);
    result.undo();
    expect(node.children.length).toBe(N);
  });

  it('Bus: execRemoveChild then undo restores original child count and position', () => {
    const uri = 'test://bus-undo-rm.sldd';
    const model = loadModel('json', FIXTURE, uri);
    const node = entryByName(model, uri, 'MyBus');
    const N = node.children.length;
    const firstName = node.children[0].name;

    const result = node.execRemoveChild(node.children[0]);
    expect(node.children.length).toBe(N - 1);
    result.undo();
    expect(node.children.length).toBe(N);
    expect(node.children[0].name).toBe(firstName);
  });

  it('Struct: execAddChild then undo restores original field count', () => {
    const uri = 'test://struct-undo-add.sldd';
    const model = loadModel('json', FIXTURE, uri);
    const node = entryByName(model, uri, 'myStruct');
    const N = node.children.length;

    const result = node.execAddChild();
    expect(node.children.length).toBe(N + 1);
    result.undo();
    expect(node.children.length).toBe(N);
  });

  it('Struct: execAddChild undo then redo restores the added child', () => {
    const uri = 'test://struct-redo-add.sldd';
    const model = loadModel('json', FIXTURE, uri);
    const node = entryByName(model, uri, 'myStruct');
    const N = node.children.length;

    const result = node.execAddChild();
    const addedName = result.node.name;
    expect(node.children.length).toBe(N + 1);
    result.undo();
    expect(node.children.length).toBe(N);
    result.redo();
    expect(node.children.length).toBe(N + 1);
    expect(node.children[node.children.length - 1].name).toBe(addedName);
  });

  it('Bus: add then remove yields original child count (idempotent)', () => {
    const uri = 'test://bus-add-rm-idem.sldd';
    const model = loadModel('json', FIXTURE, uri);
    const node = entryByName(model, uri, 'MyBus');
    const N = node.children.length;
    const originalNames = node.children.map((c: any) => c.name);

    const addResult = node.execAddChild();
    expect(node.children.length).toBe(N + 1);
    node.execRemoveChild(addResult.node);
    expect(node.children.length).toBe(N);
    const finalNames = node.children.map((c: any) => c.name);
    expect(finalNames).toEqual(originalNames);
  });
});

// ---------------------------------------------------------------------------
// Bus-container contract locks — pin className + read-only Value status so a
// regression that made a container value-editable would fail. Docs:
// Simulink.Bus.md, Simulink.ConnectionBus.md, Simulink.ServiceBus.md.
// ---------------------------------------------------------------------------
describe('Bus container contract locks', () => {
  for (const format of FORMATS) {
    it(`Simulink.Bus [${format}]: className + valueEditable=false`, () => {
      const uri = `test://bus-lock-${format}.sldd`;
      const model = loadModel(format, FIXTURE, uri);
      const node = entryByName(model, uri, 'MyBus');
      expect(node.className).toBe('Simulink.Bus');
      expect(node.valueEditable).toBe(false);
    });

    it(`Simulink.ConnectionBus [${format}]: className + valueEditable=false`, () => {
      const uri = `test://connbus-lock-${format}.sldd`;
      const model = loadModel(format, FIXTURE, uri);
      const node = entryByName(model, uri, 'MyConnBus');
      expect(node.className).toBe('Simulink.ConnectionBus');
      expect(node.valueEditable).toBe(false);
    });
  }

  it('Simulink.ServiceBus (createDefault): className + valueEditable=false + empty value', () => {
    const node = ServiceBusNode.createDefault('svc', null);
    expect(node.className).toBe('Simulink.ServiceBus');
    expect(node.valueEditable).toBe(false);
    expect(node.displayValue).toBe('');
  });

  it('Simulink.Bus: Description edit round-trips (json)', () => {
    const uri = 'test://bus-desc-rt.sldd';
    const model = loadModel('json', FIXTURE, uri);
    const node = entryByName(model, uri, 'MyBus');
    expect(node.setProperty('Description', 'edited bus description')).toBe(true);
    const bytes = serializeModel(model, 'json');
    const fresh = reparseEntry(bytes, 'json', FIXTURE, 'MyBus');
    expect(fresh.Description).toBe('edited bus description');
  });
});
