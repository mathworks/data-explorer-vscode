// Copyright 2026 The MathWorks, Inc.
//
// Fidelity tests for the three bus ELEMENT node classes:
//   - BusElementNode (Simulink.BusElement) — Name, Min, Max, Description editable
//   - ConnectionBusElementNode (Simulink.ConnectionElement) — Name, Description editable
//   - FunctionElementNode (Simulink.FunctionElement) — Name editable
//
// Verifies that property edits round-trip through both sldd formats and that
// MATLAB-mirroring rejects fire correctly. Also locks the read-only contract on
// non-editable props (DataType, Dimensions, Complexity, DimensionsMode, Unit).
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

for (const format of ['json', 'binary'] as SlddFormat[]) {
  // =========================================================================
  // Simulink.BusElement
  // =========================================================================
  describe(`Simulink.BusElement fidelity (${format})`, () => {
    function freshBusEntry() {
      const uri = `test://buselem-fid-${format}-${Date.now()}.sldd`;
      const model = loadModel(format, 'params.sldd', uri);
      const entry = entryByName(model, uri, 'MyBus');
      return { model, uri, entry };
    }

    it('loads MyBus with BusElement children', () => {
      const { entry } = freshBusEntry();
      expect(entry.className).toBe('Simulink.Bus');
      expect(entry.children.length).toBeGreaterThanOrEqual(2);
      const elem = entry.children[0];
      expect(elem.className).toBe('Simulink.BusElement');
      expect(elem.name).toBe('x');
    });

    // --- Min/Max editing ---

    it('edits element Min=5 and Max=99, round-trips through serialize/re-parse', () => {
      const { model, entry } = freshBusEntry();
      const elem = entry.children[0];

      expect(elem.setProperty('Min', '5')).toBe(true);
      expect(elem.setProperty('Max', '99')).toBe(true);
      expect(elem.Min).toBe(5);
      expect(elem.Max).toBe(99);

      const bytes = serializeModel(model, format);
      const fresh = reparseEntry(bytes, format, 'params.sldd', 'MyBus');
      const freshElem = fresh.children[0];
      expect(freshElem.Min).toBe(5);
      expect(freshElem.Max).toBe(99);

      if (matlabAvailable()) {
        const out = matlabAssertRoundTrip(bytes, 'MyBus', {
          'Elements(1).Min': 5,
          'Elements(1).Max': 99,
          __class__: 'Simulink.Bus',
        });
        expect(out).toMatch(/RESULT PASS/);
      }
    }, 60_000);

    it('rejects Min="Inf" with finite-real-scalar reason, does not mutate', () => {
      const { entry } = freshBusEntry();
      const elem = entry.children[0];
      const originalMin = elem.Min;

      const result = elem.setProperty('Min', 'Inf');
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(result.reason).toBe('Minimum must be a finite real double scalar value');
      expect(result.invalidValue).toBe('Inf');
      expect(elem.Min).toBe(originalMin);
    });

    it('rejects Min="[1 2 3]" with finite-real-scalar reason, does not mutate', () => {
      const { entry } = freshBusEntry();
      const elem = entry.children[0];
      const originalMin = elem.Min;

      const result = elem.setProperty('Min', '[1 2 3]');
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(result.reason).toBe('Minimum must be a finite real double scalar value');
      expect(elem.Min).toBe(originalMin);
    });

    it('rejects Min="abc" with finite-real-scalar reason, does not mutate', () => {
      const { entry } = freshBusEntry();
      const elem = entry.children[0];
      const originalMin = elem.Min;

      const result = elem.setProperty('Min', 'abc');
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(result.reason).toBe('Minimum must be a finite real double scalar value');
      expect(elem.Min).toBe(originalMin);
    });

    it('rejects Max="NaN" with finite-real-scalar reason', () => {
      const { entry } = freshBusEntry();
      const elem = entry.children[0];

      const result = elem.setProperty('Max', 'NaN');
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(result.reason).toBe('Maximum must be a finite real double scalar value');
    });

    it('clears Min with empty string', () => {
      const { entry } = freshBusEntry();
      const elem = entry.children[0];

      // Set a value first
      expect(elem.setProperty('Min', '7')).toBe(true);
      expect(elem.Min).toBe(7);

      // Clear it
      expect(elem.setProperty('Min', '')).toBe(true);
      expect(elem.Min).toBeUndefined();
    });

    it('clears Min with "[]"', () => {
      const { entry } = freshBusEntry();
      const elem = entry.children[0];

      expect(elem.setProperty('Min', '10')).toBe(true);
      expect(elem.Min).toBe(10);

      expect(elem.setProperty('Min', '[]')).toBe(true);
      expect(elem.Min).toBeUndefined();
    });

    // --- Name editing ---

    it('edits element Name and round-trips', () => {
      const { model, entry } = freshBusEntry();
      const elem = entry.children[0];
      expect(elem.name).toBe('x');

      expect(elem.setProperty('Name', 'speed')).toBe(true);
      expect(elem.name).toBe('speed');

      const bytes = serializeModel(model, format);
      const fresh = reparseEntry(bytes, format, 'params.sldd', 'MyBus');
      expect(fresh.children[0].name).toBe('speed');

      if (matlabAvailable()) {
        const out = matlabAssertRoundTrip(bytes, 'MyBus', {
          'Elements(1).Name': 'speed',
          __class__: 'Simulink.Bus',
        });
        expect(out).toMatch(/RESULT PASS/);
      }
    }, 60_000);

    it('rejects empty Name', () => {
      const { entry } = freshBusEntry();
      const elem = entry.children[0];

      const result = elem.setProperty('Name', '');
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(result.reason).toMatch(/[Nn]ame.*empty/);
      expect(elem.name).toBe('x');
    });

    it('rejects Name with invalid characters', () => {
      const { entry } = freshBusEntry();
      const elem = entry.children[0];

      const result = elem.setProperty('Name', '1abc');
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(elem.name).toBe('x');
    });

    it('rejects duplicate sibling Name', () => {
      const { entry } = freshBusEntry();
      const elem = entry.children[0];
      // Second element is named 'y'
      expect(entry.children[1].name).toBe('y');

      const result = elem.setProperty('Name', 'y');
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(elem.name).toBe('x');
    });

    // --- Description editing ---

    it('edits element Description and round-trips', () => {
      const { model, entry } = freshBusEntry();
      const elem = entry.children[0];

      expect(elem.setProperty('Description', 'Speed signal in m/s')).toBe(true);
      expect(elem.Description).toBe('Speed signal in m/s');

      const bytes = serializeModel(model, format);
      const fresh = reparseEntry(bytes, format, 'params.sldd', 'MyBus');
      expect(fresh.children[0].Description).toBe('Speed signal in m/s');

      if (matlabAvailable()) {
        const out = matlabAssertRoundTrip(bytes, 'MyBus', {
          'Elements(1).Description': 'Speed signal in m/s',
          __class__: 'Simulink.Bus',
        });
        expect(out).toMatch(/RESULT PASS/);
      }
    }, 60_000);

    it('accepts empty Description', () => {
      const { entry } = freshBusEntry();
      const elem = entry.children[0];

      expect(elem.setProperty('Description', 'temp')).toBe(true);
      expect(elem.setProperty('Description', '')).toBe(true);
      expect(elem.Description).toBe('');
    });

    // --- Read-only contract ---

    it('DataType prop has editor=label (read-only)', () => {
      const { entry } = freshBusEntry();
      const elem = entry.children[0];
      const props = elem.getProperties();
      const dtProp = props.find((p: any) => p.key === 'DataType');
      expect(dtProp).toBeDefined();
      expect(dtProp.editor).toBe('label');
    });

    it('Complexity prop has editor=label (read-only)', () => {
      const { entry } = freshBusEntry();
      const elem = entry.children[0];
      const props = elem.getProperties();
      const cxProp = props.find((p: any) => p.key === 'complexity');
      expect(cxProp).toBeDefined();
      expect(cxProp.editor).toBe('label');
    });

    it('DimensionsMode prop has editor=label (read-only)', () => {
      const { entry } = freshBusEntry();
      const elem = entry.children[0];
      const props = elem.getProperties();
      const dmProp = props.find((p: any) => p.key === 'dimensionsMode');
      expect(dmProp).toBeDefined();
      expect(dmProp.editor).toBe('label');
    });

    it('Dimensions prop has editor=label (read-only)', () => {
      const { entry } = freshBusEntry();
      const elem = entry.children[0];
      const props = elem.getProperties();
      const dimProp = props.find((p: any) => p.key === 'dimensions');
      expect(dimProp).toBeDefined();
      expect(dimProp.editor).toBe('label');
    });

    it('Unit prop has editor=label (read-only)', () => {
      const { entry } = freshBusEntry();
      const elem = entry.children[0];
      const props = elem.getProperties();
      const unitProp = props.find((p: any) => p.key === 'Unit');
      expect(unitProp).toBeDefined();
      expect(unitProp.editor).toBe('label');
    });
  });

  // =========================================================================
  // Simulink.ConnectionElement
  // =========================================================================
  describe(`Simulink.ConnectionElement fidelity (${format})`, () => {
    function freshConnBusEntry() {
      const uri = `test://connelem-fid-${format}-${Date.now()}.sldd`;
      const model = loadModel(format, 'params.sldd', uri);
      const entry = entryByName(model, uri, 'MyConnBus');
      return { model, uri, entry };
    }

    it('loads MyConnBus with ConnectionElement children', () => {
      const { entry } = freshConnBusEntry();
      expect(entry.className).toBe('Simulink.ConnectionBus');
      expect(entry.children.length).toBeGreaterThanOrEqual(1);
      const elem = entry.children[0];
      expect(elem.className).toBe('Simulink.ConnectionElement');
      expect(elem.name).toBe('c1');
    });

    // --- Name editing ---

    it('edits element Name and round-trips', () => {
      const { model, entry } = freshConnBusEntry();
      const elem = entry.children[0];
      expect(elem.name).toBe('c1');

      expect(elem.setProperty('Name', 'port1')).toBe(true);
      expect(elem.name).toBe('port1');

      const bytes = serializeModel(model, format);
      const fresh = reparseEntry(bytes, format, 'params.sldd', 'MyConnBus');
      expect(fresh.children[0].name).toBe('port1');

      if (matlabAvailable()) {
        const out = matlabAssertRoundTrip(bytes, 'MyConnBus', {
          'Elements(1).Name': 'port1',
          __class__: 'Simulink.ConnectionBus',
        });
        expect(out).toMatch(/RESULT PASS/);
      }
    }, 60_000);

    it('rejects empty Name', () => {
      const { entry } = freshConnBusEntry();
      const elem = entry.children[0];

      const result = elem.setProperty('Name', '');
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(result.reason).toMatch(/[Nn]ame.*empty/);
      expect(elem.name).toBe('c1');
    });

    it('rejects Name starting with digit', () => {
      const { entry } = freshConnBusEntry();
      const elem = entry.children[0];

      const result = elem.setProperty('Name', '9port');
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(elem.name).toBe('c1');
    });

    // --- Description editing ---

    it('edits element Description and round-trips', () => {
      const { model, entry } = freshConnBusEntry();
      const elem = entry.children[0];

      expect(elem.setProperty('Description', 'Hydraulic port')).toBe(true);
      expect(elem.Description).toBe('Hydraulic port');

      const bytes = serializeModel(model, format);
      const fresh = reparseEntry(bytes, format, 'params.sldd', 'MyConnBus');
      expect(fresh.children[0].Description).toBe('Hydraulic port');

      if (matlabAvailable()) {
        const out = matlabAssertRoundTrip(bytes, 'MyConnBus', {
          'Elements(1).Description': 'Hydraulic port',
          __class__: 'Simulink.ConnectionBus',
        });
        expect(out).toMatch(/RESULT PASS/);
      }
    }, 60_000);

    it('accepts empty Description', () => {
      const { entry } = freshConnBusEntry();
      const elem = entry.children[0];

      expect(elem.setProperty('Description', 'temp')).toBe(true);
      expect(elem.setProperty('Description', '')).toBe(true);
      expect(elem.Description).toBe('');
    });

    // --- Read-only contract ---

    it('DataType (Type) prop has editor=label (read-only)', () => {
      const { entry } = freshConnBusEntry();
      const elem = entry.children[0];
      const props = elem.getProperties();
      const dtProp = props.find((p: any) => p.key === 'DataType');
      expect(dtProp).toBeDefined();
      expect(dtProp.editor).toBe('label');
    });

    it('only exposes Name, DataType, Description props', () => {
      const { entry } = freshConnBusEntry();
      const elem = entry.children[0];
      const props = elem.getProperties();
      const keys = props.map((p: any) => p.key);
      expect(keys).toEqual(['Name', 'DataType', 'Description']);
    });
  });

  // =========================================================================
  // Simulink.FunctionElement (in-process — no fixture entry)
  // =========================================================================
  describe(`Simulink.FunctionElement fidelity (${format})`, () => {
    function freshServiceBus() {
      // No ServiceBus entry in the fixture, so construct one in-process.
      const bus = ServiceBusNode.createDefault('MySvcBus', null);
      const elem = bus.addChildNode();
      return { bus, elem };
    }

    it('creates ServiceBus with FunctionElement child', () => {
      const { bus, elem } = freshServiceBus();
      expect(bus.className).toBe('Simulink.ServiceBus');
      expect(bus.children.length).toBe(1);
      expect(elem.className).toBe('Simulink.FunctionElement');
      expect(elem.name).toBe('f0');
      expect(elem.Prototype).toMatch(/f0/);
    });

    it('FunctionElement exposes only PropName', () => {
      const { elem } = freshServiceBus();
      const props = elem.getProperties();
      const keys = props.map((p: any) => p.key);
      expect(keys).toEqual(['Name']);
    });

    it('Prototype is shown via displayValue, not via an editable prop', () => {
      const { elem } = freshServiceBus();
      expect(elem.displayValue).toMatch(/f0/);
      // Prototype is not in the editable properties list
      const props = elem.getProperties();
      const protoP = props.find((p: any) => p.key === 'Prototype');
      expect(protoP).toBeUndefined();
    });

    // --- Name editing (in-process) ---

    it('rejects empty Name', () => {
      const { elem } = freshServiceBus();

      const result = elem.setProperty('Name', '');
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(result.reason).toMatch(/[Nn]ame.*empty/);
      expect(elem.name).toBe('f0');
    });

    it('rejects Name with invalid characters', () => {
      const { elem } = freshServiceBus();

      const result = elem.setProperty('Name', 'foo bar');
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(elem.name).toBe('f0');
    });

    it('accepts a valid identifier Name (in-process only)', () => {
      const { elem } = freshServiceBus();
      // NOTE: In MATLAB, this would fail if the name doesn't match the Prototype.
      // Our code does NOT enforce Prototype-coupling (documented gap). The
      // in-process rename succeeds; MATLAB gate is skipped for FunctionElement.
      expect(elem.setProperty('Name', 'compute')).toBe(true);
      expect(elem.name).toBe('compute');
    });

    it('rejects duplicate sibling Name', () => {
      const { bus } = freshServiceBus();
      // Add a second function element
      const elem2 = bus.addChildNode();
      expect(elem2.name).toBe('f1');

      // Try to rename f1 to f0 (duplicate)
      const result = elem2.setProperty('Name', 'f0');
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(elem2.name).toBe('f1');
    });
  });
}
