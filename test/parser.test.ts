import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../src/dex/datamodel/node/NodeClassMap.js';
import DataModel from '../src/dex/core/DataModel.js';

function loadFixture(name: string): Record<string, unknown> {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('textual .sldd parse via DataModel.addDataSource', () => {
  it('parses the sample dictionary into a SlddNode tree', () => {
    const content = loadFixture('numeric_json.sldd');
    const node = DataModel.addDataSource('numeric_json.sldd', content) as any;

    expect(node.name).toBe('numeric_json.sldd');
    expect(node.Release).toBe('R2026b');
    expect(node.NumberOfEntries).toBe(20);

    const design = node.getSection('design');
    expect(design).not.toBeNull();
    expect(design.children.length).toBe(20);
  });
});
