// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { getSchemaClasses } from '../../src/dex/datamodel/schema/index.js';

describe('getSchemaClasses', () => {
  it('enumerates the classes that have a schema', () => {
    const classes = getSchemaClasses();
    expect(classes).toContain('Simulink.Parameter');
    expect(classes).toContain('Simulink.Signal');
  });
});

import { COLUMN_GROUPS } from '../../src/host/rowBuilder.js';

// Column grouping is a global table concern owned by rowBuilder.COLUMN_GROUPS
// (hand-authored), NOT derived from the per-prop schema `group` (which was
// removed). These assertions lock the picker headers for the schema-driven
// read-only columns.
describe('rowBuilder COLUMN_GROUPS', () => {
  it('groups the schema-driven read-only columns for the picker', () => {
    expect(COLUMN_GROUPS.storageClass).toBe('Code Generation');
    expect(COLUMN_GROUPS.headerFile).toBe('Code Generation');
    expect(COLUMN_GROUPS.alignment).toBe('Code Generation');
    expect(COLUMN_GROUPS.dimensions).toBe('Data Object');
    expect(COLUMN_GROUPS.complexity).toBe('Data Object');
    expect(COLUMN_GROUPS.dimensionsMode).toBe('Data Object');
    // Core computed columns carry no picker group header.
    expect('Name' in COLUMN_GROUPS).toBe(false);
    expect('DataType' in COLUMN_GROUPS).toBe(false);
  });

  it('groups the node-owned value props (Min/Max/Unit) under Data Object', () => {
    // These are not schema props, so the host adds their grouping; the schema
    // is still the single source of truth for its own columns' groups.
    expect(COLUMN_GROUPS.Min).toBe('Data Object');
    expect(COLUMN_GROUPS.Max).toBe('Data Object');
    expect(COLUMN_GROUPS.Unit).toBe('Data Object');
  });

  it('groups the host-owned metadata columns under Data Dictionary', () => {
    expect(COLUMN_GROUPS.lastModified).toBe('Data Dictionary');
    expect(COLUMN_GROUPS.lastModifiedBy).toBe('Data Dictionary');
  });
});
