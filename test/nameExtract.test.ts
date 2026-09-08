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

  it('contributes nothing for a parse that yielded no variables array at all', () => {
    // nameIndex feeds this whatever parseMat returned for every .mat in the
    // workspace, and parseMat comes from the separately versioned
    // data-explorer-core. One .mat missing the field must cost that file its names,
    // not abort the scan and leave the WHOLE Used By column empty.
    for (const parsed of [{}, null, undefined] as any[]) {
      expect(namesFromMat(parsed, 'file:///w/d.mat')).toEqual([]);
    }
  });
});

describe('namesFromSlx', () => {
  it('extracts workspace vars (kind workspace) and block names (kind block)', () => {
    // No SID in this parse, as a `.mdl` written before R2010b has none: the block's key
    // falls back to its name, and its path is that name with no system in front of it.
    const parsed = {
      workspace: [{ name: 'Ts' }],
      blockParamUsages: [{ blockName: 'Gain1' }, { blockName: 'Sum1' }],
    };
    const records = namesFromSlx(parsed, 'file:///w/plant.slx');
    expect(records).toEqual<NameRecord[]>([
      { name: 'Ts', sourceUri: 'file:///w/plant.slx', sourceLabel: 'plant.slx', kind: 'workspace' },
      {
        name: 'Gain1',
        sourceUri: 'file:///w/plant.slx',
        sourceLabel: 'plant.slx',
        kind: 'block',
        selectName: 'Gain1',
        blockPath: 'Gain1',
      },
      {
        name: 'Sum1',
        sourceUri: 'file:///w/plant.slx',
        sourceLabel: 'plant.slx',
        kind: 'block',
        selectName: 'Sum1',
        blockPath: 'Sum1',
      },
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

  // A block name is unique inside its own system and nowhere else, so the name is the
  // wrong thing to key a block record on — and it was: f14.slx's four blocks named
  // `Gain` deduped to a single hit that could reveal only whichever one came first,
  // and its nameless Constant was dropped for having no name to search for. Both are
  // core's rules (blockKey / blockLabel / joinBlockPath), applied here.
  describe('one record per BLOCK, not per name', () => {
    const uri = 'file:///w/f14.slx';
    // Two `Gain` blocks in two subsystems and one whose label the file leaves blank —
    // f14.slx's shape, which is where this came from.
    const parsed = {
      blockParamUsages: [
        { blockName: 'Gain', sid: '15', systemPath: '' },
        { blockName: 'Gain', sid: '24', systemPath: 'Controller' },
        { blockName: 'Gain', sid: '24', systemPath: 'Controller' },
        { blockName: '', sid: '65', systemPath: 'Pilot G-force calculation' },
      ],
    };

    it('keeps two same-named blocks apart, each revealed by its own SID', () => {
      const blocks = namesFromSlx(parsed, uri).filter((r) => r.kind === 'block');
      expect(blocks.map((r) => r.name)).toEqual(['Gain', 'Gain', '<SID: 65>']);
      // What travels to the editor: the SID, which is what the row publishes as
      // `_blockKey`. Keyed by name there was one record for the first two.
      expect(blocks.map((r) => r.selectName)).toEqual(['15', '24', '65']);
    });

    it('says which subsystem each hit is in, so the list is readable', () => {
      expect(namesFromSlx(parsed, uri).map((r) => r.blockPath)).toEqual([
        'Gain',
        'Controller/Gain',
        'Pilot G-force calculation/<SID: 65>',
      ]);
    });

    it('makes a block whose label the file leaves blank searchable at all', () => {
      // It used to be dropped: an empty name cannot be searched for. Its stand-in label
      // can, and its SID is what selects it.
      const nameless = namesFromSlx(parsed, uri).find((r) => r.selectName === '65');
      expect(nameless).toMatchObject({ name: '<SID: 65>', kind: 'block' });
    });

    it('drops a block with neither a name nor a SID', () => {
      // Nothing to search for AND nothing to select if it were found — the one case
      // where a block still contributes no record.
      const records = namesFromSlx({ blockParamUsages: [{ blockName: '', sid: '' }, {}] }, uri);
      expect(records).toEqual([]);
    });
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
