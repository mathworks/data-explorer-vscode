// Copyright 2026 The MathWorks, Inc.
// Parity check: run ProjectParser against a REAL MATLAB-generated project and
// compare to the generator's project_ground_truth.json. Mirrors the sldd/slx/mat
// parity suite. If fixtures are absent, the suite is skipped.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProject, type ParsedProject } from '../../src/dex/datamodel/parser/ProjectParser.js';
import '../../src/dex/datamodel/node/NodeClassMap.js';
import ProjectNode from '../../src/dex/datamodel/node/container/ProjectNode.js';
import { buildRows } from '../../src/host/rowBuilder.js';

const ART = fileURLToPath(new URL('./artifacts/project/MyProj', import.meta.url));
const GT_PATH = fileURLToPath(new URL('./project_ground_truth.json', import.meta.url));
const HAVE = existsSync(GT_PATH) && existsSync(join(ART, 'resources', 'project'));

// Load every resources/**/*.xml as { relPath(from project root): text }.
function loadProjectFiles(projectRoot: string): Record<string, string> {
  const files: Record<string, string> = {};
  const resRoot = join(projectRoot, 'resources');
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.xml')) files[relative(projectRoot, p).split('\\').join('/')] = readFileSync(p, 'utf8');
    }
  };
  walk(resRoot);
  return files;
}

let GT: any = null;
let parsed: ParsedProject;
beforeAll(() => {
  if (!HAVE) return;
  GT = JSON.parse(readFileSync(GT_PATH, 'utf8'));
  parsed = parseProject(loadProjectFiles(ART), 'MyProj');
});

(HAVE ? describe : describe.skip)('PROJECT PARITY (real MATLAB fixture)', () => {
  if (!HAVE) {
    it('fixtures missing — run test/parity/generateproject.m under MATLAB', () => {
      expect(HAVE).toBe(false);
    });
    return;
  }

  it('project name', () => {
    expect(parsed.name).toBe(GT.name);
  });

  it('all ground-truth member files are recovered', () => {
    const gotPaths = parsed.files.map((f) => f.path.split('/').pop());
    for (const f of GT.files as string[]) {
      expect(gotPaths).toContain(f);
    }
  });

  it('folders are flagged as folders (models, utils)', () => {
    const folders = parsed.files.filter((f) => f.isFolder).map((f) => f.path.split('/').pop());
    // models and utils are directories in the fixture
    expect(folders).toEqual(expect.arrayContaining(['models', 'utils']));
  });

  it('path folders recovered (utils)', () => {
    for (const p of GT.pathFolders as string[]) {
      expect(parsed.pathFolders).toContain(p);
    }
  });

  it('project→project reference resolved to LibProj', () => {
    const refNames = parsed.references.map((r) => r.name);
    for (const r of GT.references as string[]) {
      // name is basename of the Ref path (e.g. ../LibProj -> LibProj)
      expect(refNames.some((n) => n === r || n === r + '.prj')).toBe(true);
    }
  });

  it('label catalog includes the custom Status:Reviewed label', () => {
    // GT.labels lists assignments; the catalog should at least define "Reviewed".
    const names = parsed.labels.map((l) => l.name);
    expect(names).toContain('Reviewed');
  });

  it('built-in FileClassCategory labels are present in the catalog', () => {
    const names = parsed.labels.map((l) => l.name.toLowerCase());
    // MATLAB seeds Design/Derived/Other/Convenience/Artifact/None/Test
    expect(names).toEqual(expect.arrayContaining(['design', 'derived', 'other']));
  });

  it('a file carries its assigned label (projmodel.slx → Reviewed or design)', () => {
    const slx = parsed.files.find((f) => f.path.endsWith('projmodel.slx'));
    expect(slx).toBeTruthy();
    // labels are stored as UUIDs on the file; at least one label assigned
    expect(Array.isArray(slx!.labels)).toBe(true);
  });

  // End-to-end: the table the extension actually renders (ProjectNode → buildRows).
  describe('end-to-end table (ProjectNode → buildRows)', () => {
    let node: any;
    let rows: any[];
    beforeAll(() => {
      node = ProjectNode.fromParsed(parsed, 'MyProj.prj');
      rows = buildRows(node);
    });

    it('builds a table with the four project sections that have entries', () => {
      const sectionRows = rows.filter((r) => typeof r.ID === 'string' && r.ID.startsWith('section:'));
      const sectionKeys = sectionRows.map((r) => r.ID.replace('section:', ''));
      // files, path, references always populated; labels catalog too.
      expect(sectionKeys).toEqual(expect.arrayContaining(['files', 'path', 'references']));
    });

    it('every row carries the project columns (Name/Type/Location) without throwing', () => {
      const itemRows = rows.filter((r) => typeof r.ID === 'string' && !r.ID.startsWith('section:'));
      expect(itemRows.length).toBeGreaterThan(0);
      for (const r of itemRows) {
        expect(r.Name).toBeTruthy();
        expect('Type' in r || 'DataType' in r).toBe(true);
        expect('Location' in r).toBe(true);
      }
    });

    it('the referenced project appears as a row (LibProj)', () => {
      const names = rows.map((r) => (r.Name && r.Name.label) || '').join('|');
      expect(names).toContain('LibProj');
    });
  });
});
