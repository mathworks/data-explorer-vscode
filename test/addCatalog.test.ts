// Copyright 2026 The MathWorks, Inc.
//
// The Add gallery's guard test: every tile, created for real through core.
//
// The gallery is a wall of buttons, and a button carries three claims that live on
// different sides of the boundary — the class it names, the section it writes to, and
// the glyph it draws. Core owns whether that class may be created in that section and
// what the resulting entry looks like; the catalog only asserts. Neither side can
// catch a disagreement alone, and a disagreement is invisible in the UI: the tile
// renders, the click is swallowed or writes something else, and nothing says so.
//
// So this test crosses the boundary. For each tile it builds a real dictionary, asks
// the real section to add the entry, and compares what came back against what the tile
// promised. Six real defects were found this way while the catalog was being written:
// four tiles whose class and section disagreed with core, one tile that silently
// created a different class, and one tile whose art differed from the row it produced.
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SlddNode } from 'data-explorer-core';
import { ADD_CATALOG, OMITTED, SECTION_BADGE, allTiles, badgeOf, categorySection } from '../src/common/addCatalog.js';
import type { GalleryTile, SectionKey } from '../src/common/addCatalog.js';

/** Every section of a fresh, empty dictionary — one per tile, so names never collide. */
function sectionsOf(): Record<string, any> {
  const dict: any = new SlddNode('guard.sldd');
  const byName: Record<string, any> = {};
  for (const s of dict.children) {
    byName[s.name] = s;
  }
  return byName;
}

function sectionFor(key: SectionKey): any {
  return sectionsOf()[key];
}

// Joined with a space, which neither a section key nor a class name contains — and which,
// unlike the NUL byte that was here, leaves this file greppable: git and grep both call a
// file with one NUL in it binary, so its diffs go unreviewable and a search across `test/`
// silently skips it.
function pairKey(className: string, section: string): string {
  return `${section} ${className}`;
}

const SECTION_KEYS = ['design', 'arch', 'config', 'other'];

/** Every `(className, section)` core will admit, across all four sections. */
function corePairs(): Set<string> {
  const sections = sectionsOf();
  const pairs = new Set<string>();
  for (const key of SECTION_KEYS) {
    for (const className of sections[key].getAllowedTypes()) {
      pairs.add(pairKey(className, key));
    }
  }
  return pairs;
}

function tileName(tile: GalleryTile): string {
  return `${tile.label} (${tile.className} → ${tile.section})`;
}

/**
 * Whether a tile's class name is a MATLAB class, or one of core's registry keys.
 *
 * A dotted name (`Simulink.Parameter`) is a real MATLAB class, and the created entry
 * reports it back — that is the `$class` the file will carry. A bare name is a key into
 * core's class map naming a *shape of MATLAB value*, not a class: a plain variable and a
 * struct have no `$class` in the file at all, and a Constant is a plain variable in a
 * derived section. Those three report `className` as their MATLAB data type instead
 * (`double`, `struct`), correctly, so the round-trip check below does not apply to them.
 */
function isMatlabClass(className: string): boolean {
  return className.includes('.');
}

/**
 * The node class core's registry maps each bare key to — what those three tiles claim
 * instead of a `$class`. Written out rather than derived, because the names do not follow
 * one rule (`MatlabStruct` is modelled by `StructNode`) and because a closed list of
 * three is what makes the exception auditable.
 */
const MODEL_CLASS_OF: Record<string, string> = {
  MatlabVariable: 'MatlabVariableNode',
  MatlabStruct: 'StructNode',
  Constant: 'ConstantNode',
};

describe('the Add gallery catalog agrees with core', () => {
  for (const tile of allTiles()) {
    describe(tileName(tile), () => {
      // Check 1. Catches the whole class of bug where a tile's declared class is not
      // one the declared section admits — the add silently returns null, so the tile
      // is a button that does nothing.
      it('names a class the section admits', () => {
        expect(sectionFor(tile.section).allowsType(tile.className)).toBe(true);
      });

      // Check 2. `addEntry` returning a node is not enough: NodeClassMap can point two
      // class names at one node class whose createDefault hardcodes the other one, so
      // the entry appears and carries the wrong $class. Compare what came back.
      it('creates an entry of exactly that class', () => {
        const node: any = sectionFor(tile.section).addEntry(tile.className);
        expect(node).not.toBeNull();
        if (isMatlabClass(tile.className)) {
          expect(node.className).toBe(tile.className);
        } else {
          expect(node.constructor.name).toBe(MODEL_CLASS_OF[tile.className]);
        }
      });

      // Check 3. The tile's art has to be the row's art. A tile drawing a glyph the
      // created row does not use puts two different pictures of one thing a pixel-row
      // apart, and the section is the only thing that decides which glyph core picks.
      it('draws the glyph core gives that entry', () => {
        const node: any = sectionFor(tile.section).addEntry(tile.className);
        expect(node.icon).toBe(tile.iconId);
      });

      it('draws a glyph this extension ships', () => {
        const file = fileURLToPath(new URL(`../media/icons/${tile.iconId}.svg`, import.meta.url));
        expect(existsSync(file)).toBe(true);
      });
    });
  }
});

describe('the catalog partitions what core allows', () => {
  // One-directional on purpose. Every pair core admits is either a tile or a stated
  // omission, so losing a tile by accident fails here while dropping one on purpose is
  // a line moved from ADD_CATALOG to OMITTED. Widening core's allow-list without doing
  // either also fails, which is the point: a new allowed class should be a decision
  // about the gallery, not a silent gap in it.
  it('offers or explicitly omits every allowed (class, section) pair', () => {
    const accounted = new Set<string>();
    for (const tile of allTiles()) {
      accounted.add(pairKey(tile.className, tile.section));
    }
    for (const o of OMITTED) {
      accounted.add(pairKey(o.className, o.section));
    }
    const unaccounted = [...corePairs()].filter((p) => !accounted.has(p));
    expect(unaccounted).toEqual([]);
  });

  it('omits nothing core does not allow in the first place', () => {
    const allowed = corePairs();
    const stale = OMITTED.filter((o) => !allowed.has(pairKey(o.className, o.section)));
    expect(stale.map((o) => `${o.className} → ${o.section}`)).toEqual([]);
  });

  it('gives every omission a reason', () => {
    for (const o of OMITTED) {
      expect(o.why.length).toBeGreaterThan(0);
    }
  });

  it('offers no tile twice', () => {
    const seen = allTiles().map((t) => pairKey(t.className, t.section));
    expect(new Set(seen).size).toBe(seen.length);
  });

  // Keeps the exception above honest in both directions: a new tile named by a bare
  // registry key has to state which node class it means, and a mapping left behind after
  // its tile is gone has to go with it.
  it('names a model class for every bare-keyed tile, and only those', () => {
    const bare = new Set(allTiles().map((t) => t.className).filter((c) => !isMatlabClass(c)));
    expect([...bare].sort()).toEqual(Object.keys(MODEL_CLASS_OF).sort());
  });

  it('never offers anything in Other Data', () => {
    expect(allTiles().filter((t) => (t.section as string) === 'other')).toEqual([]);
  });
});

describe('how the catalog states a destination', () => {
  it('leaves a uniform category unbadged and names its section once', () => {
    for (const category of ADD_CATALOG) {
      if (!category.uniformSection) continue;
      for (const tile of category.tiles) {
        expect(tile.section).toBe(category.uniformSection);
        expect(badgeOf(category, tile)).toBeNull();
      }
    }
  });

  it('badges exactly the tiles that depart from their category', () => {
    const badged: string[] = [];
    for (const category of ADD_CATALOG) {
      for (const tile of category.tiles) {
        const badge = badgeOf(category, tile);
        if (badge === null) continue;
        // A badge only ever appears on a tile whose section differs from the heading's,
        // and it always spells that tile's own section.
        expect(tile.section).not.toBe(categorySection(category));
        expect(badge).toBe(SECTION_BADGE[tile.section]);
        badged.push(tileName(tile));
      }
    }
    expect(badged).toEqual([
      'Constant (Constant → arch)',
      'Numeric Type (Simulink.NumericType → arch)',
      'Alias Type (Simulink.AliasType → arch)',
      'Value Type (Simulink.ValueType → arch)',
      'Enum Type (Simulink.data.dictionary.EnumTypeDefinition → arch)',
      'Variant Config (Simulink.VariantConfigurationData → config)',
    ]);
  });

  it('holds the six categories the design names, in order', () => {
    expect(ADD_CATALOG.map((c) => c.title)).toEqual([
      'Parameters',
      'Signals and Buses',
      'Interfaces',
      'Types',
      'Variants',
      'Configurations',
    ]);
  });

  it('holds 28 tiles', () => {
    expect(allTiles().length).toBe(28);
  });

  it('keeps every label short enough for the tile that has to draw it', () => {
    // A proxy for a pixel measurement this environment cannot take. happy-dom lays
    // nothing out, so a label that does not fit its tile shows up only in the browser
    // harness (`scenarios/add-gallery.mjs`, which reports `truncatedLabels`, `labelLines`
    // and `wrappedLabels`) — and it showed up there once already, as `Variant Config Data`
    // rendered `Variant Co…` two rows under `Variant Control` and indistinguishable
    // from it.
    //
    // The numbers come from that harness run: three columns make a tile 118px wide, so
    // its label box is 108px, and at the ~5.8px/char the shipped 12px font measured that
    // is about 18 characters per line. A tile's label now WRAPS instead of ellipsing, so
    // the two failures left are a word too long for one line (`overflow-wrap: break-word`
    // chops it mid-word) and a label needing a third line (its whole grid row grows with
    // it). Hence two crude limits rather than one: 14 characters for the longest word and
    // 30 for the label, both with slack, because a `W` is wider than an `i` and this is a
    // fence a new tile trips over, not a layout engine. If a label has to exceed either,
    // widen the popover and re-measure with the harness rather than raising a constant
    // here. Current worst cases: `Variant Expression` (18 characters, longest word 10).
    const LIMIT = { label: 30, word: 14 };
    const tooLong: string[] = [];
    for (const tile of allTiles()) {
      if (tile.label.length > LIMIT.label) {
        tooLong.push(`${tileName(tile)} — label ${tile.label.length} > ${LIMIT.label}`);
      }
      for (const word of tile.label.split(' ')) {
        if (word.length > LIMIT.word) {
          tooLong.push(`${tileName(tile)} — word "${word}" ${word.length} > ${LIMIT.word}`);
        }
      }
    }
    expect(tooLong).toEqual([]);
  });
});
