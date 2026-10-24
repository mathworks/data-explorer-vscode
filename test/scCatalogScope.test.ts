// Copyright 2026 The MathWorks, Inc.
//
// WHICH ENTRIES THE SYSTEM COMPOSER CATALOG NAMES: ONE RULE, IN CORE AND IN THE HOST.
//
// The catalog lists the definitions of a dictionary's Design namespace — Design Data and
// Architectural Data — by name, and a name is unique only within a namespace: Other Data and
// Configurations are each their own. So an Other Data entry called `StructType` is not the
// struct type of that name, and renaming it must not rename the definition.
//
// Two code paths answer that question for one dictionary. Core answers it when it reads an
// entry (is it classified by the catalog?) and when one is renamed (is the definition renamed in
// the model?). The host answers it when it writes a rename into the FILE, which it does itself in
// both formats (scRename.ts: `catalogRenameOf` gates the extra range replacements in a text
// dictionary and the member swap in a binary one). The host's gate carried every entry of the
// name, so renaming that Other Data double rewrote the catalog's definition in the file and the
// architectural entry that really holds the name read back unclassified.
//
// This pins the two paths AGREEING, entry by entry, over a catalog that has both kinds: the
// architecture fixture plus an Other Data and a Configurations entry named after two of its
// definitions (the same two entries core's own test of the rule adds).
//
// The full agreement waits on the core pin. The scope was added to core after the version this
// repo pins (v1.45.4), which still classifies and renames by bare name in every section — so the
// host, now scoped, disagrees with it on exactly the two outside entries, and the test is marked
// as failing. It FLIPS to a plain `it` when the pin moves to a core with the scope: the test then
// passes, `it.fails` reports that as a failure, and the flip is owed. The half that holds on both
// cores — the Design-namespace entries, where the two always agreed — runs as a plain test, so the
// fixture and the comparison are proven to work today.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession, getSectionMetadata } from 'data-explorer-core';
import { catalogRenameOf, scJsonRenameEdits } from '../src/host/scRename.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const archText = readFileSync(fileURLToPath(new URL('./fixtures/arch.sldd', import.meta.url)), 'utf8');

// Outside the Design namespace, each named after a definition of the catalog: a modeled data
// type and an interface.
const OUTSIDE: [name: string, section: string][] = [
  ['StructType', 'other'],
  ['DataInterface', 'config'],
];

// arch.sldd, with OUTSIDE added as plain doubles.
function catalogFixture(): string {
  const json = JSON.parse(archText);
  const entries = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
  OUTSIDE.forEach(([name, section], i) => {
    entries.push({
      name,
      metadata: {
        uuid: `00000000-0000-4000-8000-00000000000${i + 1}`,
        ...getSectionMetadata(section),
        lastmod: '20261023T000000.000000',
        modifiedby: 'user',
      },
      value: i + 5,
    });
  });
  return JSON.stringify(json, null, '\t');
}

const text = catalogFixture();

/** A fresh tree of the fixture, in a session of its own so no case sees another's rename. */
function tree(): any {
  return createSession().addDataSource('test://sc-catalog-scope.sldd', JSON.parse(text), { path: 'arch.sldd' });
}

/** Every name the catalog defines, across its kinds of definition. */
const catalogNames = (root: any): string[] =>
  Object.values(root.systemComposer ?? {}).flatMap((kind: any) => (kind && typeof kind === 'object' ? Object.keys(kind) : []));

interface Verdict {
  where: string;
  host: boolean;
  coreClassifies: boolean;
  coreRenames: boolean;
}

/**
 * For every entry the catalog has a definition of that name for: does the host carry its rename
 * into the file's catalog, does core classify it by the catalog, and does core rename the
 * definition when it is renamed?
 */
function verdicts(): Verdict[] {
  const defined = new Set(catalogNames(tree()));
  const out: Verdict[] = [];
  for (const section of tree().children as any[]) {
    for (const { name } of section.children as any[]) {
      if (!defined.has(name)) continue;
      const root = tree();
      const entry = (root.children as any[]).find((s) => s.name === section.name).children.find((e: any) => e.name === name);
      const newName = `${name}Renamed`;
      // The host: the gate, and the sites the file's catalog has for the name — what applyEdit
      // adds to the WorkspaceEdit.
      const carry = catalogRenameOf('Name', newName, entry, entry);
      const host = carry !== null && scJsonRenameEdits(text, carry.oldName, carry.newName).length > 0;
      const coreClassifies = entry.classification != null;
      expect(entry.setProperty('Name', newName), `core takes the rename of ${section.name}/${name}`).toBe(true);
      const coreRenames = catalogNames(root).includes(newName);
      out.push({ where: `${section.name}/${name}`, host, coreClassifies, coreRenames });
    }
  }
  return out;
}

describe('the host and core agree on which entries the System Composer catalog names', () => {
  it('the fixture has entries of the name inside and outside the Design namespace', () => {
    const where = verdicts().map((v) => v.where);
    expect(where).toEqual(expect.arrayContaining(['arch/StructType', 'arch/DataInterface', 'other/StructType', 'config/DataInterface']));
  });

  it('agree on every Design-namespace entry: carried, classified and renamed alike', () => {
    const inside = verdicts().filter((v) => v.where.startsWith('arch/') || v.where.startsWith('design/'));
    expect(inside.length).toBeGreaterThan(4);
    for (const v of inside) {
      expect({ ...v, coreClassifies: v.host, coreRenames: v.host }, v.where).toEqual(v);
      expect(v.host, `${v.where} is carried`).toBe(true);
    }
  });

  it('the host carries no outside entry', () => {
    for (const v of verdicts().filter((v) => v.where.startsWith('other/') || v.where.startsWith('config/'))) {
      expect(v.host, v.where).toBe(false);
    }
  });

  // Flip to `it` when the pinned core scopes the catalog to the Design namespace (see header).
  it.fails('agree on every entry, outside the Design namespace too (needs a core pin with the scope)', () => {
    for (const v of verdicts()) {
      expect({ ...v, coreClassifies: v.host, coreRenames: v.host }, v.where).toEqual(v);
    }
  });
});
