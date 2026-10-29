// Copyright 2026 The MathWorks, Inc.
// Regression guard: every icon id the extension statically references must ship
// as an SVG in dist/webview/icons/, which copy:icons fills from data-explorer-view's
// icons/ (tools/shippedIcons.ts). Missing files silently fall
// back to a generic icon (tree) or render as a broken image (webview), which is hard
// to catch by eye. This test pins the known-critical ids so a future edit that
// references a new icon without adding the file fails fast.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HIERARCHY_ICONS } from 'data-explorer-view/model';
import { ICON_DIR } from '../src/host/iconAssets.js';
import { ICON_SOURCES, iconsIn, shippedIcon } from './tools/shippedIcons.js';

function repoFile(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
}

// Tree node-kind icons (view's FolderHierarchy, which names a row's icon for SectionsTreeProvider).
const TREE_KIND_ICONS = ['simulink', 'simulink_database', 'matlabWorkspaceFile', 'link_database'];

// SLDD dictionary + section icons (SlddNode: file icon + SECTION_DEFS).
const SLDD_ICONS = [
  'simulink_database', // JSON .sldd file
  'simulink_server',   // XML-format .sldd file
  'databaseFolderDesign',
  'databaseFolderArchitecture',
  'databaseFolderConfiguration',
  'databaseFolder',
];

// Model section + entry icons (ModelNode SECTION_DEFS + entry node getters).
const MODEL_ICONS = [
  'blocks',              // Model Elements section
  'block',               // block entries
  'databaseFolderWorkspace',
  'databaseFolderConfiguration',
  'modelReference',      // Model References section + entries
  'link_database',       // External Data section
  'matlabWorkspaceFile', // mat data-source entries
  'simulinkDataDictionary_FT', // .sldd data-source entries
  'simulinkModel_FT',    // .slx data-source entries
];

// Design Data entry-node icons whose ids are referenced only from node getters
// (bus/connection elements, enum items, variant entries). These render in the
// webview, so a missing file shows a broken image rather than a fallback.
const DATA_NODE_ICONS = [
  'ws3d',                    // any object whose class has no icon of its own (core's OBJECT_ICON)
  'wsBusElement',            // Design Data Simulink.Bus element
  'typeBusElement',          // Architectural Data DataInterface element
  'typeStructElement',       // StructType element
  'wsConnectionElement',     // Design Data Simulink.ConnectionBus element
  'typeConnectionElement',   // Architectural Data PhysicalInterface element
  'wsElement',               // Design Data enum "current" item
  'typeElement',             // Architectural Data enum "current" item
  'busElement',              // non-current enum item
  'variantSettings',         // Simulink.VariantConfigurationData
  'twoConnected_wsDefault',  // Simulink.VariantControl
  'variant_wsParameters',    // Simulink.VariantVariable
];

// Icons the webview components name directly, rather than through a row's
// iconId. A missing asset here is a blank glyph, not a fallback.
const WEBVIEW_GLYPH_ICONS = [
  'wsTable',                 // dex-matrix-open: open the Variable Editor
];

const ALL_REQUIRED = [
  ...new Set([...TREE_KIND_ICONS, ...SLDD_ICONS, ...MODEL_ICONS, ...DATA_NODE_ICONS, ...WEBVIEW_GLYPH_ICONS]),
];

describe('icon assets', () => {
  it.each(ALL_REQUIRED)('%s.svg ships', (id) => {
    expect(shippedIcon(id), `${id}.svg is in none of ${ICON_SOURCES.join(', ')}`).toBeDefined();
  });

  it('the generic fallback icon exists (svgIconFor default)', () => {
    expect(shippedIcon('typeGeneric')).toBeDefined();
  });
});

// Every id the sidebar tree hands svgIconFor, read off the code rather than listed, so a new
// group kind or file kind is checked the day it is written: every icon a hierarchy row can name
// (view's HIERARCHY_ICONS — the kind map, the group icons, the fallback for a kind the map
// lacks), any id the provider names itself, and svgIconFor's own default.
describe("the sidebar tree's icons", () => {
  const tree = repoFile('src/host/SectionsTreeProvider.ts');
  const TREE_ICONS = [
    ...new Set([
      ...HIERARCHY_ICONS,
      ...[...tree.matchAll(/\bicon\s*=\s*'([\w-]+)'/g)].map((m) => m[1]),
      ...[...tree.matchAll(/svgIconFor\([^)]*?'([\w-]+)'\s*\)/g)].map((m) => m[1]),
      ...[...repoFile('src/host/iconMap.ts').matchAll(/dexIconId \|\| '([\w-]+)'/g)].map((m) => m[1]),
    ]),
  ].sort();

  it('reads the ids the provider names', () => {
    // A reshaped provider that hid them from these patterns would leave the check below empty. The
    // provider draws every row with the icon its hierarchy item names, so that is checked too.
    expect(tree).toContain('svgIconFor(this.extensionUri, el.icon)');
    for (const id of ['simulink', 'simulink_folder', 'simulink_project', 'typeGeneric']) expect(TREE_ICONS).toContain(id);
  });

  it('ships every one of them', () => {
    expect(TREE_ICONS.filter((id) => !shippedIcon(id))).toEqual([]);
  });

  it('are all data-explorer-view\'s, with no copy kept here', () => {
    // A copy here as well would be two sets of the same art that can drift apart: the tree's
    // own two (the folder group, the generic fallback) ship in view since its hierarchy did.
    const view = new Set(iconsIn('node_modules/data-explorer-view/icons'));
    expect(TREE_ICONS.filter((id) => !view.has(`${id}.svg`))).toEqual([]);
    expect(existsSync(fileURLToPath(new URL('../media/icons', import.meta.url))), 'media/icons').toBe(false);
  });
});

// The assertions above check the SOURCES copy:icons copies wholesale, which is the
// right place for them — an id with no source has no shipped file either. What they cannot see is whether the directory
// the HOST resolves against is one the VSIX actually contains. It was not: the tree
// asked for `media/icons/<id>.svg`, a path present in every dev checkout and every
// integration run and excluded from the package, so the Simulink Data tree shipped
// with no icons while looking correct to everyone who could have noticed.
//
// Existence on this machine can never catch that. These three places have to agree
// instead: where the host reads (ICON_DIR), where the build writes (copy:icons), and
// what the package keeps (.vscodeignore).
describe('the shipped icon directory', () => {
  const dir = ICON_DIR.join('/');

  it('is the directory copy:icons writes the SVGs to', () => {
    const pkg = JSON.parse(repoFile('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['copy:icons']).toBe('node scripts/copy-icons.mjs');
    const script = repoFile('scripts/copy-icons.mjs');
    expect(script).toContain(`const OUT = '${dir}';`);
    expect(script).toContain(`const SOURCES = [${ICON_SOURCES.map((d) => `'${d}'`).join(', ')}];`);
  });

  it('is not excluded from the VSIX by .vscodeignore', () => {
    // Only the exclusions matter, and only as path prefixes: a pattern is a problem
    // exactly when it names ICON_DIR or an ancestor of it ('dist/**', 'dist/webview').
    const excluded = repoFile('.vscodeignore')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'))
      .map((line) => line.replace(/\/?\*\*?$/, '').replace(/\/$/, ''))
      .filter((prefix) => prefix && (dir === prefix || dir.startsWith(prefix + '/')));
    expect(excluded, `.vscodeignore excludes ${dir} via ${excluded.join(', ')}`).toEqual([]);
  });

  it('is where the webview loads its icons from, so one copy serves both', () => {
    // dex-icon builds `<base><id>.svg` from the base the webview entries set, `./icons/`
    // (iconComponent.test.ts), which resolves against the shell's <base href>: the vite
    // outDir, dist/webview. Shipping a second copy for the host would be the state this
    // fix removed.
    expect(dir).toBe('dist/webview/icons');
    expect(new URL('./icons/', 'https://host/ext/dist/webview/').href).toBe(`https://host/ext/${dir}/`);
  });
});
