// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel } from '../src/host/SlddModel.js';
import { buildPropertyGroups } from '../src/host/piBuilder.js';

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

describe('buildPropertyGroups', () => {
  it('returns [] for a node without toPIObject', () => {
    expect(buildPropertyGroups(null)).toEqual([]);
    expect(buildPropertyGroups({})).toEqual([]);
  });

  it('builds property groups for an entry node from the fixture', () => {
    const path = fixturePath('numeric_json.sldd');
    const text = readFileSync(path, 'utf8');
    const sldd = getModel('test://pi_numeric_json.sldd', 'numeric_json.sldd', text);

    const flat: any[] = typeof sldd.flatten === 'function' ? sldd.flatten() : [];
    const candidates = flat.filter((n) => typeof n?.toPIObject === 'function');
    expect(candidates.length).toBeGreaterThan(0);

    // Every candidate must transform to a valid (possibly empty) array with the
    // correct shape (defensive: container nodes may yield []).
    let sawProps = false;
    for (const entry of candidates) {
      const groups = buildPropertyGroups(entry);
      expect(Array.isArray(groups)).toBe(true);
      for (const g of groups) {
        expect(typeof g.title).toBe('string');
        expect(Array.isArray(g.properties)).toBe(true);
        for (const p of g.properties) {
          sawProps = true;
          expect(typeof p.name).toBe('string');
          expect(typeof p.value).toBe('string');
          expect(['text', 'link']).toContain(p.type);
          expect(p.editable).toBe(false);
        }
      }
    }

    // The fixture has at least one leaf entry with real properties.
    expect(sawProps).toBe(true);
  });
});
