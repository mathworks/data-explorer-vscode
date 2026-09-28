// Copyright 2026 The MathWorks, Inc.
//
// What the Add gallery offers: the tiles, grouped the way the domain names them.
//
// Shared rather than webview-local because two very different readers need the SAME
// answer. The gallery draws from it, and the guard test (test/addCatalog.test.ts)
// walks it against core, creating every tile's entry for real and comparing the
// class and the glyph that come back. A catalog the renderer alone owned would be a
// catalog nothing could check.
//
// The list is deliberately a SUBSET of core's `ALLOWED_TYPES`, not a mirror of it.
// The allow-list answers "what may be pasted into this section"; the gallery answers
// "what may be created from nothing", and the second is necessarily smaller — see
// OMITTED below, which the guard test holds to exactly.

/** The dictionary sections a tile can write into. Core spells them this way too. */
export type SectionKey = 'design' | 'arch' | 'config';

/** One tile: a button that creates one entry of one class in one section. */
export interface GalleryTile {
  /**
   * What the tile says. Domain wording, not the class name.
   *
   * One line, always — this is the canonical name, and it is what the accessible name
   * and the title reach for. How the label is BROKEN across lines on the face of a tile
   * is a drawing question, answered by `labelLinesOf` below.
   */
  label: string;
  /** The `$class` core is asked to create. */
  className: string;
  /** The section the new entry joins. Per-tile, so there is no "current section". */
  section: SectionKey;
  /**
   * The glyph the tile draws — which must be the glyph core gives the entry this
   * tile creates. Not a convention: the guard test creates the node and compares.
   * A tile whose art differs from the row it produces is a tile that lies.
   */
  iconId: string;
  /**
   * How to break the label across the tile's lines, where one word per line is wrong.
   *
   * Needed by exactly one tile today (see `labelLinesOf`), so it is an exception rather
   * than data every tile repeats. The guard test holds it to spelling the same label:
   * joined with spaces it must equal `label`, or the tile would draw a name nothing else
   * in the extension knows.
   */
  labelLines?: readonly string[];
}

/** One heading and the tiles under it. */
export interface GalleryCategory {
  title: string;
  /**
   * The section every tile here lands in, or null when they disagree.
   *
   * This is what decides where the destination is stated. A uniform category says it
   * once in its heading and badges nothing; a mixed one badges the tiles that depart
   * from its majority. Derived rather than declared, so it cannot fall out of step
   * with the tiles (see `categorySection`).
   */
  readonly uniformSection: SectionKey | null;
  readonly tiles: readonly GalleryTile[];
}

/** The section's own name, as the dictionary tree spells it. */
export const SECTION_LABEL: Record<SectionKey, string> = {
  design: 'Design Data',
  arch: 'Architectural Data',
  config: 'Configurations',
};

/** The short form a badge carries, where a full section name would not fit. */
export const SECTION_BADGE: Record<SectionKey, string> = {
  design: 'Design',
  arch: 'Arch',
  config: 'Config',
};

function category(title: string, tiles: GalleryTile[]): GalleryCategory {
  const first = tiles[0].section;
  const uniform = tiles.every((t) => t.section === first) ? first : null;
  return { title, uniformSection: uniform, tiles };
}

/**
 * The gallery, in display order.
 *
 * Grouped by KIND — Parameters, Signals and Buses, Interfaces, Types, Variants,
 * Configurations — because those six are the vocabulary of the domain: you look for a
 * bus under "Signals and Buses" without being told to. Grouping by destination section
 * would have been self-documenting but longer, since a class legal in two sections
 * would appear under two headings instead of once with a badge.
 *
 * 22 distinct classes make 28 tiles. The three types and the two buses that both
 * Design and Architectural Data admit each appear twice, because they mean different
 * things in each — an arch `Simulink.Bus` is a Data Interface, and it draws with the
 * arch palette.
 */
export const ADD_CATALOG: readonly GalleryCategory[] = [
  category('Parameters', [
    { label: 'MATLAB Variable', className: 'MatlabVariable', section: 'design', iconId: 'wsDefault' },
    { label: 'MATLAB Structure', className: 'MatlabStruct', section: 'design', iconId: 'wsTree' },
    { label: 'Simulink Parameter', className: 'Simulink.Parameter', section: 'design', iconId: 'wsParameters' },
    { label: 'LookUp Table', className: 'Simulink.LookupTable', section: 'design', iconId: 'wsLookup' },
    { label: 'Breakpoint', className: 'Simulink.Breakpoint', section: 'design', iconId: 'wsSimulinkBreakpoint' },
    // Not Simulink.Parameter, which arch does not admit at all: the internal app's
    // catalog mapped this tile to that class, and the add would have been refused.
    { label: 'Constant', className: 'Constant', section: 'arch', iconId: 'typeConstant' },
  ]),
  category('Signals and Buses', [
    { label: 'Simulink Signal', className: 'Simulink.Signal', section: 'design', iconId: 'wsSignal' },
    { label: 'Simulink Bus', className: 'Simulink.Bus', section: 'design', iconId: 'wsBus' },
    { label: 'Connection Bus', className: 'Simulink.ConnectionBus', section: 'design', iconId: 'wsConnectionBus' },
  ]),
  // The same two bus classes again, under the names architectural data gives them.
  category('Interfaces', [
    { label: 'Data Interface', className: 'Simulink.Bus', section: 'arch', iconId: 'typeBus' },
    { label: 'Physical Interface', className: 'Simulink.ConnectionBus', section: 'arch', iconId: 'typeConnection' },
    { label: 'Service Interface', className: 'Simulink.ServiceBus', section: 'arch', iconId: 'serviceInterfaces' },
  ]),
  category('Types', [
    { label: 'Numeric Type', className: 'Simulink.NumericType', section: 'design', iconId: 'wsNumeric' },
    { label: 'Alias Type', className: 'Simulink.AliasType', section: 'design', iconId: 'wsAlias' },
    { label: 'Value Type', className: 'Simulink.ValueType', section: 'design', iconId: 'wsValue' },
    {
      label: 'Enum Type',
      className: 'Simulink.data.dictionary.EnumTypeDefinition',
      section: 'design',
      iconId: 'wsEnum',
    },
    { label: 'Numeric Type', className: 'Simulink.NumericType', section: 'arch', iconId: 'typeNumeric' },
    { label: 'Alias Type', className: 'Simulink.AliasType', section: 'arch', iconId: 'typeAlias' },
    // typeSignalUI, not a typeValue that does not exist: an arch ValueType is the
    // interface's signal, and core draws it that way.
    { label: 'Value Type', className: 'Simulink.ValueType', section: 'arch', iconId: 'typeSignalUI' },
    {
      label: 'Enum Type',
      className: 'Simulink.data.dictionary.EnumTypeDefinition',
      section: 'arch',
      iconId: 'typeEnum',
    },
  ]),
  // Variant Config sits here, not under Configurations, because the word you search for
  // is "variant". Its badge tells the truth about where the row lands — and makes the
  // shorter label safe, since the "Data" this drops is the part the badge already implies.
  // The name was shortened from `Variant Config Data` when a tile ellipsed its label and
  // this one read as `Variant Co…` two rows under `Variant Control`. Labels now break at
  // their spaces instead, so nothing is clipped, but the shorter name stays: a third line
  // for a word the badge already says would make its whole grid row taller.
  category('Variants', [
    { label: 'Variant Expression', className: 'Simulink.VariantExpression', section: 'design', iconId: 'wsVariant' },
    { label: 'Variant Control', className: 'Simulink.VariantControl', section: 'design', iconId: 'twoConnected_wsDefault' },
    { label: 'Variant Variable', className: 'Simulink.VariantVariable', section: 'design', iconId: 'variant_wsParameters' },
    { label: 'Variant Bank', className: 'Simulink.VariantBank', section: 'design', iconId: 'wsParameters_bank' },
    {
      label: 'Bank Coder Info',
      // The only three-word label, and the only tile that states its own break. One word
      // per line would make this tile three lines tall and, since a grid row is as tall as
      // its tallest tile, the whole row with it. "Coder Info" is the noun — it is one
      // property name in MATLAB (`CoderInfo`) — and "Bank" is what qualifies it, so this is
      // also where the label reads best broken.
      labelLines: ['Bank', 'Coder Info'],
      className: 'Simulink.VariantBankCoderInfo',
      section: 'design',
      iconId: 'wsParameters_bankCoderInfo',
    },
    {
      label: 'Variant Config',
      className: 'Simulink.VariantConfigurationData',
      section: 'config',
      iconId: 'variantSettings',
    },
  ]),
  // Both glyphs here are the INACTIVE ones, and correctly so: the check-marked
  // variants come from an `active` flag only the .slx parser sets, and the gallery
  // only ever writes into a .sldd.
  category('Configurations', [
    { label: 'Config Set', className: 'Simulink.ConfigSet', section: 'config', iconId: 'settings' },
    { label: 'Config Reference', className: 'Simulink.ConfigSetRef', section: 'config', iconId: 'configurationReference' },
  ]),
];

/**
 * The `(className, section)` pairs core allows but the gallery will not offer.
 *
 * Stated rather than implied, and checked one-directionally by the guard test: with
 * this list, losing a tile by accident fails a test, while dropping one on purpose is
 * a line moved from ADD_CATALOG to here. Widening core's allow-list without doing
 * either also fails.
 */
export const OMITTED: readonly { className: string; section: string; why: string }[] = [
  { className: 'CustomObject', section: 'design', why: 'not a real dotted MATLAB class; instantiating one needs MATLAB' },
  { className: 'CustomObject', section: 'other', why: 'same, and Other Data gets no tiles' },
  { className: 'MatlabVariable', section: 'other', why: 'Other Data is a holding area, not an add target' },
  { className: 'Simulink.VariantExpression', section: 'other', why: 'same' },
  { className: 'Simulink.VariantVariable', section: 'other', why: 'same' },
  {
    className: 'Simulink.VariantConfigurations',
    section: 'config',
    // NodeClassMap points this spelling and Simulink.VariantConfigurationData at one
    // node class, whose createDefault hardcodes the latter — so the tile would create
    // a differently-classed entry and say nothing. Fixing that needs core to thread
    // the requested class through createDefault, and needs MATLAB to answer whether a
    // standalone entry of this class is even valid on disk.
    why: 'addEntry returns a Simulink.VariantConfigurationData instead',
  },
];

/** Every tile, flat, in display order — the order a keyboard walk follows. */
export function allTiles(): GalleryTile[] {
  return ADD_CATALOG.flatMap((c) => c.tiles as GalleryTile[]);
}

/**
 * The lines this tile's label draws on — one word per line, unless the tile says otherwise.
 *
 * The break is chosen here rather than left to the text box, and that is what lets a tile be
 * narrow. A wrapping box has to be as wide as the longest LABEL before it breaks anywhere
 * sensible ("Simulink Parameter" is 18 characters); breaking at the space ourselves means a
 * tile only has to be as wide as the widest WORD, which is "Connection" at 65px measured. The
 * popover went from 380px to 300px as a direct result, and no label is at the mercy of where
 * its box happened to run out.
 *
 * Deliberately not `white-space: pre-line` over a label with a newline in it: `label` is the
 * name the accessible name, the title and the event all carry, and a newline inside it would
 * travel with them into a tooltip and a screen reader.
 */
export function labelLinesOf(tile: GalleryTile): readonly string[] {
  return tile.labelLines ?? tile.label.split(' ');
}

/**
 * The badge this tile needs under this category, or null when it needs none.
 *
 * A uniform category states its destination in the heading, so nothing is badged. In a
 * mixed one the badge goes on the tiles that depart from the majority, which keeps the
 * count of badges at the 6 that carry information rather than 14 that repeat each other.
 */
export function badgeOf(category: GalleryCategory, tile: GalleryTile): string | null {
  if (category.uniformSection) {
    return null;
  }
  return tile.section === majoritySection(category) ? null : SECTION_BADGE[tile.section];
}

/** The section most of a mixed category's tiles land in — what its heading says. */
export function majoritySection(category: GalleryCategory): SectionKey {
  const counts = new Map<SectionKey, number>();
  for (const t of category.tiles) {
    counts.set(t.section, (counts.get(t.section) ?? 0) + 1);
  }
  let best: SectionKey = category.tiles[0].section;
  for (const [section, n] of counts) {
    if (n > (counts.get(best) ?? 0)) {
      best = section;
    }
  }
  return best;
}

/**
 * The section a category's heading names: its uniform destination, or the majority one
 * that the badges are read against.
 */
export function categorySection(category: GalleryCategory): SectionKey {
  return category.uniformSection ?? majoritySection(category);
}
