// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { schemaColumnLabels } from '../../src/dex/datamodel/node/schemaBridge.js';

describe('schemaColumnLabels', () => {
  it('maps each schema column key to its display label', () => {
    const labels = schemaColumnLabels();
    expect(labels.dimensions).toBe('Dimensions');
    expect(labels.complexity).toBe('Complexity');
    expect(labels.storageClass).toBe('Storage Class');
    expect(labels.alignment).toBe('Alignment');
  });

  it('does not include ungrouped or non-label props (value, dataType, min)', () => {
    const labels = schemaColumnLabels();
    expect('value' in labels).toBe(false);
    expect('dataType' in labels).toBe(false);
    expect('min' in labels).toBe(false);
  });
});

import { COLUMN_LABELS } from '../../src/host/rowBuilder.js';

describe('rowBuilder COLUMN_LABELS', () => {
  it('carries the schema-derived labels for schema-driven columns', () => {
    expect(COLUMN_LABELS.storageClass).toBe('Storage Class');
    expect(COLUMN_LABELS.alignment).toBe('Alignment');
    expect(COLUMN_LABELS.dimensions).toBe('Dimensions');
    expect(COLUMN_LABELS.complexity).toBe('Complexity');
  });

  it('keeps the host-owned base labels', () => {
    expect(COLUMN_LABELS.Name).toBe('Name');
    expect(COLUMN_LABELS.DataType).toBe('Data Type');
    expect(COLUMN_LABELS.UsedBy).toBe('Usage');
  });
});
