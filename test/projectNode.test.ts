// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import ProjectNode from '../src/dex/datamodel/node/container/ProjectNode.js';
import { buildRows } from '../src/host/rowBuilder.js';
import type { ParsedProject } from '../src/dex/datamodel/parser/ProjectParser.js';

function makeParsed(): ParsedProject {
  return {
    name: 'MyProj',
    files: [
      { path: 'models', isFolder: true, labels: [] },
      { path: 'models/controller.slx', isFolder: false, labels: ['Design'] },
    ],
    pathFolders: ['utils'],
    labels: [
      { category: 'Classification', name: 'Design' },
      { category: 'Classification', name: 'Test' },
    ],
    references: [{ id: 'ref-uuid-1', name: 'SharedLib' }],
  };
}

describe('ProjectNode.fromParsed', () => {
  it('builds a named node with the four expected sections', () => {
    const node = ProjectNode.fromParsed(makeParsed(), 'MyProj.prj');
    expect(node.name).toBe('MyProj.prj');
    expect(node.getSection('files')).not.toBeNull();
    expect(node.getSection('path')).not.toBeNull();
    expect(node.getSection('labels')).not.toBeNull();
    expect(node.getSection('references')).not.toBeNull();
  });

  it('populates the files section and maps Name/Type/Location/Labels columns', () => {
    const node = ProjectNode.fromParsed(makeParsed(), 'MyProj.prj');
    const files = node.getSection('files')!;
    expect(files.children.length).toBe(2);

    const slx = files.children.find((c) => c.name === 'controller.slx')!;
    expect(slx).toBeDefined();
    const row: any = slx.toRow();
    expect(row.Name.label).toBe('controller.slx');
    expect(row.Name.iconId).toBe('simulinkModel_FT');
    expect(row.Type).toBe('File');
    expect(row.Location).toBe('models/controller.slx');
    expect(row.Labels).toBe('Design');
  });

  it('populates path, labels, and references sections', () => {
    const node = ProjectNode.fromParsed(makeParsed(), 'MyProj.prj');
    expect(node.getSection('path')!.children.length).toBe(1);
    expect(node.getSection('labels')!.children.length).toBe(2);
    const ref = node.getSection('references')!.children[0];
    expect(ref.name).toBe('SharedLib');
    expect((ref as any).location).toBe('ref-uuid-1');
    expect(node.NumberOfEntries).toBe(6);
  });

  it('buildRows emits section header rows plus item rows without throwing', () => {
    const node = ProjectNode.fromParsed(makeParsed(), 'MyProj.prj');
    const rows = buildRows(node as any);

    // Section headers for non-empty sections.
    const filesHeader = rows.find((r: any) => r.ID === 'section:files');
    expect(filesHeader).toBeDefined();
    expect(filesHeader.parent).toBeNull();

    // Item rows reparented under their section.
    const itemRows = rows.filter((r: any) => r.parent === 'section:files');
    expect(itemRows.length).toBe(2);

    // Every row's parent is null or references a real row (valid tree).
    const ids = new Set(rows.map((r: any) => r.ID));
    for (const r of rows as any[]) {
      if (r.parent != null) {
        expect(ids.has(r.parent)).toBe(true);
      }
    }
  });

  // ProjectItemNode reports nameEditable:false but is a real entry (disabled:false).
  // The .prj view is read-only, so buildRows(..., true) must render its items in
  // the normal color. Regression guard for the "grayed-out entries" bug via the
  // real node type (not a synthetic stand-in).
  it('renders project items in normal color under read-only coloring', () => {
    const node = ProjectNode.fromParsed(makeParsed(), 'MyProj.prj');
    const rows = buildRows(node as any, undefined, true);
    const itemRows = rows.filter(
      (r: any) => !String(r.ID).startsWith('section:') && r.Name && typeof r.Name === 'object',
    );
    expect(itemRows.length).toBeGreaterThan(0);
    for (const r of itemRows as any[]) {
      expect(r.Name.disabled).toBe(false); // real entries, not derived
      expect(r.Name.editable).toBe(true);  // therefore NOT grayed
    }
  });
});
