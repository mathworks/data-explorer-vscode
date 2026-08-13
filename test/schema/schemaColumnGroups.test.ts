// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { schemaColumnGroups } from '../../src/dex/datamodel/node/schemaBridge.js';
import { getSchemaClasses } from '../../src/dex/datamodel/schema/index.js';

describe('getSchemaClasses', () => {
  it('enumerates the classes that have a schema', () => {
    const classes = getSchemaClasses();
    expect(classes).toContain('Simulink.Parameter');
    expect(classes).toContain('Simulink.Signal');
  });
});

describe('schemaColumnGroups', () => {
  it('maps each schema column key to its group name', () => {
    const groups = schemaColumnGroups();
    expect(groups.dimensions).toBe('Data Object');
    expect(groups.complexity).toBe('Data Object');
    expect(groups.storageClass).toBe('Code Generation');
    expect(groups.alignment).toBe('Code Generation');
  });

  it('does not include ungrouped or non-label props (value, dataType, min)', () => {
    const groups = schemaColumnGroups();
    expect('value' in groups).toBe(false);
    expect('dataType' in groups).toBe(false);
    expect('min' in groups).toBe(false);
  });
});

import { COLUMN_GROUPS } from '../../src/host/rowBuilder.js';

describe('rowBuilder COLUMN_GROUPS', () => {
  it('exposes the schema-derived group map for the picker', () => {
    expect(COLUMN_GROUPS.storageClass).toBe('Code Generation');
    expect(COLUMN_GROUPS.dimensions).toBe('Data Object');
    expect('Name' in COLUMN_GROUPS).toBe(false);
    expect('DataType' in COLUMN_GROUPS).toBe(false);
  });
});
