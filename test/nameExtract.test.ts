// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import {
  namesFromSldd,
  namesFromMat,
  namesFromSlx,
  type NameRecord,
} from '../src/host/nameExtract.js';

// Build the in-memory .sldd content shape (__MW_TEXT_PARTS__ ... entries[]).
function slddContent(entries: { name?: string }[]): Record<string, unknown> {
  return {
    __MW_TEXT_PARTS__: {
      '__MW_TEXT_PART__/data/chunk0': {
        __MW_TEXT_content: { entries },
      },
    },
  };
}

describe('namesFromSldd', () => {
  it('extracts entry names with kind sldd and the uri basename as sourceLabel', () => {
    const content = slddContent([{ name: 'Kp' }, { name: 'Ts' }]);
    const records = namesFromSldd(content, 'file:///w/dict.sldd');
    expect(records).toEqual<NameRecord[]>([
      { name: 'Kp', sourceUri: 'file:///w/dict.sldd', sourceLabel: 'dict.sldd', kind: 'sldd' },
      { name: 'Ts', sourceUri: 'file:///w/dict.sldd', sourceLabel: 'dict.sldd', kind: 'sldd' },
    ]);
  });

  it('drops empty/missing names', () => {
    const content = slddContent([{ name: 'Keep' }, { name: '' }, {}, { name: undefined }]);
    const records = namesFromSldd(content, 'file:///w/dict.sldd');
    expect(records.map((r) => r.name)).toEqual(['Keep']);
  });

  it('returns [] for empty / malformed content', () => {
    expect(namesFromSldd({}, 'file:///w/dict.sldd')).toEqual([]);
    expect(namesFromSldd(slddContent([]), 'file:///w/dict.sldd')).toEqual([]);
  });
});

describe('namesFromMat', () => {
  it('extracts variable names with kind mat', () => {
    const records = namesFromMat({ variables: [{ name: 'Mv' }, { name: 'Gain' }] }, 'file:///w/data.mat');
    expect(records).toEqual<NameRecord[]>([
      { name: 'Mv', sourceUri: 'file:///w/data.mat', sourceLabel: 'data.mat', kind: 'mat' },
      { name: 'Gain', sourceUri: 'file:///w/data.mat', sourceLabel: 'data.mat', kind: 'mat' },
    ]);
  });

  it('drops empty/missing names and tolerates empty input', () => {
    expect(namesFromMat({ variables: [{ name: '' }, {}, { name: 'X' }] }, 'file:///w/d.mat').map((r) => r.name)).toEqual([
      'X',
    ]);
    expect(namesFromMat({ variables: [] }, 'file:///w/d.mat')).toEqual([]);
  });
});

describe('namesFromSlx', () => {
  it('extracts workspace vars (kind workspace) and block names (kind block)', () => {
    const parsed = {
      workspace: [{ name: 'Ts' }],
      blockParamUsages: [{ blockName: 'Gain1' }, { blockName: 'Sum1' }],
    };
    const records = namesFromSlx(parsed, 'file:///w/plant.slx');
    expect(records).toEqual<NameRecord[]>([
      { name: 'Ts', sourceUri: 'file:///w/plant.slx', sourceLabel: 'plant.slx', kind: 'workspace' },
      { name: 'Gain1', sourceUri: 'file:///w/plant.slx', sourceLabel: 'plant.slx', kind: 'block' },
      { name: 'Sum1', sourceUri: 'file:///w/plant.slx', sourceLabel: 'plant.slx', kind: 'block' },
    ]);
  });

  it('emits ONE record for a block that appears in multiple param usages', () => {
    const parsed = {
      blockParamUsages: [
        { blockName: 'Gain1' },
        { blockName: 'Gain1' },
        { blockName: 'Gain1' },
      ],
    };
    const records = namesFromSlx(parsed, 'file:///w/plant.slx');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ name: 'Gain1', kind: 'block' });
  });

  it('drops empty/missing names in both workspace and blocks', () => {
    const parsed = {
      workspace: [{ name: '' }, { name: 'Keep' }, {}],
      blockParamUsages: [{ blockName: '' }, { blockName: 'B' }, {}],
    };
    const records = namesFromSlx(parsed, 'file:///w/plant.slx');
    expect(records.map((r) => r.name)).toEqual(['Keep', 'B']);
  });

  it('returns [] for empty input', () => {
    expect(namesFromSlx({}, 'file:///w/plant.slx')).toEqual([]);
    expect(namesFromSlx({ workspace: [], blockParamUsages: [] }, 'file:///w/plant.slx')).toEqual([]);
  });
});

describe('dup-preserving across sources', () => {
  it('the same entry name in two different sources yields two distinct records', () => {
    const a = namesFromSldd(slddContent([{ name: 'Shared' }]), 'file:///w/a.sldd');
    const b = namesFromSldd(slddContent([{ name: 'Shared' }]), 'file:///w/b.sldd');
    const all = [...a, ...b];
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.sourceUri)).toEqual(['file:///w/a.sldd', 'file:///w/b.sldd']);
    expect(new Set(all.map((r) => r.name))).toEqual(new Set(['Shared']));
  });
});
