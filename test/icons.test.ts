// Copyright 2026 The MathWorks, Inc.
// Regression guard: every icon id the extension statically references must ship
// as an SVG in media/icons/. Missing files silently fall back to a generic icon
// (tree) or render as a broken image (webview), which is hard to catch by eye.
// This test pins the known-critical ids so a future edit that references a new
// icon without adding the file fails fast.
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function iconPath(id: string): string {
  return fileURLToPath(new URL(`../media/icons/${id}.svg`, import.meta.url));
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

const ALL_REQUIRED = [...new Set([...TREE_KIND_ICONS, ...SLDD_ICONS, ...MODEL_ICONS, ...DATA_NODE_ICONS])];

describe('icon assets', () => {
  it.each(ALL_REQUIRED)('media/icons/%s.svg exists', (id) => {
    expect(existsSync(iconPath(id)), `missing media/icons/${id}.svg`).toBe(true);
  });

  it('the generic fallback icon exists (svgIconFor default)', () => {
    expect(existsSync(iconPath('typeGeneric'))).toBe(true);
  });
});
