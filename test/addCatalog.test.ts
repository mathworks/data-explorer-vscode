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
import {
  ADD_CATALOG,
  OMITTED,
  SECTION_BADGE,
  allTiles,
  badgeOf,
  categorySection,
  labelLinesOf,
} from '../src/common/addCatalog.js';
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
    ]);
  });

  // The one exception to the rule above, and the maintainer's ask (F6 2026-09-29): remove the
  // `Config` badge from `Variant Config`. The badge exists to say where a departing tile's row
  // lands, and this tile's own label says it — so the badge was the word `Config` drawn twice on
  // one tile, which reads as a warning about nothing.
  //
  // Two things keep the exception honest rather than making it a way to hide a badge. It has to
  // be dead-weight-free: a flag on a tile that was never going to be badged says nothing and
  // would read as a decision. And it has to be TRUE — the label must actually carry the word the
  // badge would have — because the destination is the one fact about a tile that is not otherwise
  // on its face, and a tile that drops the badge without saying the word loses it. (The
  // accessible name carries it either way; that is `addGallery.test.ts`'s claim, not this one.)
  it('drops a badge only where the label itself names the section', () => {
    const stated: string[] = [];
    for (const category of ADD_CATALOG) {
      for (const tile of category.tiles) {
        if (!tile.labelStatesSection) continue;
        expect(tile.section).not.toBe(categorySection(category));
        expect(tile.label).toContain(SECTION_BADGE[tile.section]);
        expect(badgeOf(category, tile)).toBeNull();
        stated.push(tileName(tile));
      }
    }
    expect(stated).toEqual(['Variant Config (Simulink.VariantConfigurationData → config)']);
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

  it('breaks every label into lines that spell it and fit a tile', () => {
    // Three claims, and the first is the one that matters most: the lines a tile draws have
    // to say the label. A break is the only place in this file where a tile's name is
    // written twice, and a tile drawing `Simulnk` / `Parameter` would be a name nothing else
    // in the extension — the title, the accessible name, the event — has ever heard of.
    //
    // The other two are a proxy for a pixel measurement this environment cannot take.
    // happy-dom lays nothing out, so a line that does not fit shows up only in the browser
    // harness (`scenarios/add-gallery.mjs`: `truncatedLabels`, `labelLines`, `wrappedLines`)
    // — and it showed up there once already, as `Variant Config Data` clipped to
    // `Variant Co…` two rows under `Variant Control` and indistinguishable from it.
    //
    // The numbers come from that harness run. Every tile is 96px wide (the
    // `--dex-add-gallery-tile-width` token on the gallery's `:host`) — a fixed
    // size the row wraps rather than stretches, so there is one width to fear instead of a
    // range — which leaves a label line 86px. The widest line in the catalog (`Connection`, 10
    // characters) inks 65 of them — 6.5px per character, so 86 holds 13, and the fence keeps a
    // character back. A third line is the other failure, because a row is as tall as its tallest
    // tile, so one three-line label makes its whole row grow. Both limits are deliberately
    // crude: a `W` is wider than an `i`, and this is a fence a new tile trips over rather than
    // a layout engine. A label that cannot fit should be broken differently (see `labelLines`)
    // or shortened; widening the tile is the last resort, and it means re-measuring with the
    // harness rather than raising a constant here.
    //
    // 12 where it was 14, because the tile is 16px narrower than it was (maintainer, F6
    // 2026-09-29) and this fence is derived from the tile rather than chosen: the 21px of slack
    // between `Connection` and the room a line gets is what those two characters are. Nothing in
    // the catalog is over 10.
    const LIMIT = { chars: 12, lines: 2 };
    const problems: string[] = [];
    for (const tile of allTiles()) {
      const lines = labelLinesOf(tile);
      if (lines.join(' ') !== tile.label) {
        problems.push(`${tileName(tile)} — lines spell "${lines.join(' ')}"`);
      }
      if (lines.length > LIMIT.lines) {
        problems.push(`${tileName(tile)} — ${lines.length} lines > ${LIMIT.lines}`);
      }
      for (const line of lines) {
        if (line.length > LIMIT.chars) {
          problems.push(`${tileName(tile)} — line "${line}" ${line.length} > ${LIMIT.chars}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  // An override that agrees with the default is dead weight that reads as a decision, and
  // the next person to change the label would have to notice both halves.
  it('states a break only where one word per line is wrong', () => {
    const stated = allTiles().filter((t) => t.labelLines);
    expect(stated.map(tileName)).toEqual(['Bank Coder Info (Simulink.VariantBankCoderInfo → design)']);
    for (const tile of stated) {
      expect(tile.labelLines).not.toEqual(tile.label.split(' '));
    }
  });
});
