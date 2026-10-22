// Copyright 2026 The MathWorks, Inc.
//
// The MAT-file Add gallery's guard test, the counterpart of addCatalog.test.ts for a `.mat`.
//
// A MAT-file's gallery is not a catalog of its own: it is the dictionary catalog's Design Data
// tiles of the classes core says the file can take a new variable of (MatNode.getAllowedTypes),
// plus the tiles only a MAT-file has (a `string`). So what this holds is the same three claims a
// dictionary tile makes, across the same boundary — for each tile the gallery shows a real file,
// core creates the variable for real, and the class and the glyph that come back are the tile's —
// and two of its own: the gallery shows a tile for every class core lists and for nothing else,
// and the dictionary's gallery is exactly the one it was.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DataModel, MAT_CREATABLE_CLASSES } from 'data-explorer-core';
import { ADD_CATALOG, MAT_ONLY_TILES, allTiles, matCatalog } from '../src/common/addCatalog.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fixture = (path: string): Uint8Array => new Uint8Array(readFileSync(fileURLToPath(new URL(path, import.meta.url))));

/** A Level-5 file of one double, `x` = 1, and nothing else: a MAT-file with no objects at all. */
function plainMat(): Uint8Array {
  const header = new Uint8Array(128).fill(0x20);
  header.set(new TextEncoder().encode('MATLAB 5.0 MAT-file, written by a test'), 0);
  header.fill(0, 116, 124);
  header.set([0x00, 0x01, 0x49, 0x4d], 124);
  const el = new DataView(new ArrayBuffer(64));
  const words: [number, number][] = [
    [0, 14], [4, 56], // miMATRIX, 56 bytes
    [8, 6], [12, 8], [16, 6], [20, 0], // flags: double
    [24, 5], [28, 8], [32, 1], [36, 1], // dims [1 1]
    [40, (1 << 16) | 1], // name 'x' (small form)
    [48, 9], [52, 8], // miDOUBLE, 8 bytes
  ];
  for (const [at, v] of words) el.setUint32(at, v, true);
  el.setUint8(44, 0x78);
  el.setFloat64(56, 1, true);
  const out = new Uint8Array(128 + 64);
  out.set(header);
  out.set(new Uint8Array(el.buffer), 128);
  return out;
}

// The files a gallery is shown for: one with objects (strings among them), one of Simulink
// Parameters, one of function handles, -v6, and one with no objects at all, whose first object
// creates its subsystem.
const FILES: Record<string, () => Uint8Array> = {
  'cases.mat': () => fixture('../test-integration/fixtures/mat/cases.mat'),
  'pv_basic.mat': () => fixture('../test-integration/fixtures/mat/pv_basic.mat'),
  'nested_handles.mat': () => fixture('../test-integration/fixtures/mat/nested_handles.mat'),
  'plain.mat': plainMat,
};

let opened = 0;
/** `run` on a fresh MatNode of `file`, its source dropped after. */
function withMat<T>(file: string, run: (mat: any) => T): T {
  const bytes = FILES[file]();
  const srcId = `mat-add-catalog:${opened++}`;
  const mat: any = DataModel.addMatSource(srcId, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { path: file });
  try {
    return run(mat);
  } finally {
    DataModel.removeDataSource(srcId);
  }
}

// The class a MAT-file variable reports for a tile's: a plain variable is the double 0, a
// structure a struct; every object is of the class itself.
const STORED_CLASS_OF: Record<string, string> = { MatlabVariable: 'double', MatlabStruct: 'struct' };

describe('the MAT-file gallery agrees with core', () => {
  for (const file of Object.keys(FILES)) {
    describe(file, () => {
      const classes: string[] = withMat(file, (mat) => mat.getAllowedTypes());
      const tiles = matCatalog(classes).flatMap((c) => c.tiles);

      it('is a file core lets take objects, as well as plain variables', () => {
        expect(classes).toEqual(expect.arrayContaining(['MatlabVariable', 'MatlabStruct', 'Simulink.Parameter', 'string']));
      });

      it('shows one tile for every class core lists, and none for anything else', () => {
        expect(tiles.map((t) => t.className).sort()).toEqual([...classes].sort());
      });

      for (const tile of tiles) {
        describe(tile.label, () => {
          it('creates a variable of exactly that class, drawn with the tile\'s glyph', () => {
            withMat(file, (mat) => {
              const added = mat.execAddEntry(tile.className);
              expect(added, `core creates a ${tile.className}`).not.toBeNull();
              expect(added.node.className).toBe(STORED_CLASS_OF[tile.className] ?? tile.className);
              expect(added.node.icon).toBe(tile.iconId);
              expect(added.node.status).toBe('New');
            });
          });

          it('draws a glyph this extension ships', () => {
            expect(existsSync(fileURLToPath(new URL(`../media/icons/${tile.iconId}.svg`, import.meta.url)))).toBe(true);
          });
        });
      }
    });
  }
});

describe("core's list of what an Add creates in a MAT-file", () => {
  it('has a tile for every class in it, so the gallery can offer each where a file takes it', () => {
    const offered = matCatalog(['MatlabVariable', 'MatlabStruct', ...MAT_CREATABLE_CLASSES]).flatMap((c) => c.tiles).map((t) => t.className);
    expect([...offered].sort()).toEqual(['MatlabVariable', 'MatlabStruct', ...MAT_CREATABLE_CLASSES].sort());
  });

  it('bounds what any file is told it can take: a plain variable, a struct, and those classes', () => {
    const bound = new Set(['MatlabVariable', 'MatlabStruct', ...MAT_CREATABLE_CLASSES]);
    for (const file of Object.keys(FILES)) {
      expect(withMat(file, (mat) => mat.getAllowedTypes()).filter((c: string) => !bound.has(c)), file).toEqual([]);
    }
  });
});

describe('matCatalog', () => {
  const EVERY = ['MatlabVariable', 'MatlabStruct', 'Simulink.Parameter', 'Simulink.Signal', 'Simulink.Bus', 'Simulink.LookupTable',
    'Simulink.Breakpoint', 'Simulink.NumericType', 'Simulink.AliasType', 'Simulink.ValueType', 'string'];

  it('offers Design Data tiles only, so no class twice, and no Architectural, Enum, Variant or Config tile', () => {
    const cats = matCatalog([...EVERY, 'Simulink.ConnectionBus', 'Simulink.data.dictionary.EnumTypeDefinition', 'Simulink.VariantControl', 'Simulink.ConfigSet', 'Constant']);
    const offered = cats.flatMap((c) => c.tiles);
    expect(offered.every((t) => t.section === 'design')).toBe(true);
    expect(new Set(offered.map((t) => t.className)).size).toBe(offered.length);
    // Listed classes with a Design tile are offered (a host only lists what core does)...
    expect(offered.map((t) => t.className)).toContain('Simulink.ConnectionBus');
    // ...and none of the arch-only, enumeration, variant or configuration classes core never lists.
    const narrow = matCatalog(EVERY);
    expect(narrow.map((c) => c.title)).toEqual(['Parameters', 'Signals and Buses', 'Types']);
    expect(narrow.flatMap((c) => c.tiles).map((t) => t.label)).toEqual([
      'MATLAB Variable', 'MATLAB Structure', 'MATLAB String', 'Simulink Parameter', 'LookUp Table', 'Breakpoint',
      'Simulink Signal', 'Simulink Bus', 'Numeric Type', 'Alias Type', 'Value Type',
    ]);
    expect(narrow.every((c) => c.uniformSection === 'design')).toBe(true);
  });

  it('follows the list it is given: a class core drops is a tile gone, a category emptied is gone', () => {
    const without = matCatalog(EVERY.filter((c) => c !== 'Simulink.LookupTable' && c !== 'Simulink.Breakpoint'));
    expect(without.flatMap((c) => c.tiles).map((t) => t.className)).not.toContain('Simulink.LookupTable');
    expect(without.flatMap((c) => c.tiles).map((t) => t.className)).not.toContain('Simulink.Breakpoint');
    expect(matCatalog(['MatlabVariable', 'MatlabStruct']).map((c) => c.title)).toEqual(['Parameters']);
    expect(matCatalog(['string']).flatMap((c) => c.tiles).map((t) => t.label)).toEqual(['MATLAB String']);
    expect(matCatalog([])).toEqual([]);
  });

  it("puts each MAT-file-only tile in its category, and never in a dictionary's gallery", () => {
    for (const extra of MAT_ONLY_TILES) {
      const cat = matCatalog(EVERY).find((c) => c.title === extra.category)!;
      const labels = cat.tiles.map((t) => t.className);
      expect(labels.indexOf(extra.tile.className)).toBe(labels.indexOf(extra.after) + 1);
      expect(allTiles().some((t) => t.className === extra.tile.className)).toBe(false);
    }
  });
});

describe("a dictionary's gallery", () => {
  it('is exactly the one it was: 28 tiles, in this order, with these classes, sections, labels and glyphs', () => {
    expect(allTiles().map((t) => `${t.section} ${t.className} | ${t.label} | ${t.iconId}`)).toEqual([
      'design MatlabVariable | MATLAB Variable | wsDefault',
      'design MatlabStruct | MATLAB Structure | wsTree',
      'design Simulink.Parameter | Simulink Parameter | wsParameters',
      'design Simulink.LookupTable | LookUp Table | wsLookup',
      'design Simulink.Breakpoint | Breakpoint | wsSimulinkBreakpoint',
      'arch Constant | Constant | typeConstant',
      'design Simulink.Signal | Simulink Signal | wsSignal',
      'design Simulink.Bus | Simulink Bus | wsBus',
      'design Simulink.ConnectionBus | Connection Bus | wsConnectionBus',
      'arch Simulink.Bus | Data Interface | typeBus',
      'arch Simulink.ConnectionBus | Physical Interface | typeConnection',
      'arch Simulink.ServiceBus | Service Interface | serviceInterfaces',
      'design Simulink.NumericType | Numeric Type | wsNumeric',
      'design Simulink.AliasType | Alias Type | wsAlias',
      'design Simulink.ValueType | Value Type | wsValue',
      'design Simulink.data.dictionary.EnumTypeDefinition | Enum Type | wsEnum',
      'arch Simulink.NumericType | Numeric Type | typeNumeric',
      'arch Simulink.AliasType | Alias Type | typeAlias',
      'arch Simulink.ValueType | Value Type | typeSignalUI',
      'arch Simulink.data.dictionary.EnumTypeDefinition | Enum Type | typeEnum',
      'design Simulink.VariantExpression | Variant Expression | wsVariant',
      'design Simulink.VariantControl | Variant Control | twoConnected_wsDefault',
      'design Simulink.VariantVariable | Variant Variable | variant_wsParameters',
      'design Simulink.VariantBank | Variant Bank | wsParameters_bank',
      'design Simulink.VariantBankCoderInfo | Bank Coder Info | wsParameters_bankCoderInfo',
      'design Simulink.VariantConfigurationData | Variant Config | variantSettings',
      'config Simulink.ConfigSet | Config Set | settings',
      'config Simulink.ConfigSetRef | Config Reference | configurationReference',
    ]);
    expect(ADD_CATALOG.map((c) => c.title)).toEqual(['Parameters', 'Signals and Buses', 'Interfaces', 'Types', 'Variants', 'Configurations']);
  });

  it('is left as it was by building a MAT-file one', () => {
    const before = JSON.stringify(ADD_CATALOG);
    matCatalog(['MatlabVariable', 'string', 'Simulink.Bus']);
    expect(JSON.stringify(ADD_CATALOG)).toBe(before);
  });
});
