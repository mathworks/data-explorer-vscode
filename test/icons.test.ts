// Copyright 2026 The MathWorks, Inc.
// Regression guard: every icon id the extension statically references must ship
// as an SVG in media/icons/. Missing files silently fall back to a generic icon
// (tree) or render as a broken image (webview), which is hard to catch by eye.
// This test pins the known-critical ids so a future edit that references a new
// icon without adding the file fails fast.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ICON_DIR } from '../src/host/iconAssets.js';

function iconPath(id: string): string {
  return fileURLToPath(new URL(`../media/icons/${id}.svg`, import.meta.url));
}

function repoFile(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
}

// Tree node-kind icons (SectionsTreeProvider.ICON_BY_KIND).
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
  it.each(ALL_REQUIRED)('media/icons/%s.svg exists', (id) => {
    expect(existsSync(iconPath(id)), `missing media/icons/${id}.svg`).toBe(true);
  });

  it('the generic fallback icon exists (svgIconFor default)', () => {
    expect(existsSync(iconPath('typeGeneric'))).toBe(true);
  });
});

// The assertions above check the SOURCES in media/icons, which is the right place
// for them — that directory is what `copy:icons` copies wholesale, so an id with no
// source has no shipped file either. What they cannot see is whether the directory
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
    expect(pkg.scripts['copy:icons']).toContain(dir);
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
    // dex-icon builds `${BASE_URL}icons/<id>.svg`, and the webview's base is the vite
    // outDir — dist/webview. Shipping a second copy for the host would be the state
    // this fix removed.
    expect(dir).toBe('dist/webview/icons');
  });
});
