// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { parseProject, type ParsedProject } from '../src/dex/datamodel/parser/ProjectParser.js';

const DECL = '<?xml version="1.0" encoding="UTF-8"?>';

function info(body: string): string {
  return `${DECL}\n${body}`;
}

/** Build the REAL example store (MyProj) as a project-relative files map. */
function myProjStore(): Record<string, string> {
  const p = (rel: string): string => `resources/project/${rel}`;
  const store: Record<string, string> = {};

  // root/ entry pointers + defs
  store[p('root/GiiBklLgTxteCEmomM8RCvWT0nQd.xml')] = info('<Info Name="MyProj"/>');
  store[p('root/GiiBklLgTxteCEmomM8RCvWT0nQp.xml')] = info('<Info location="ProjectData" type="Info"/>');
  store[p('root/qaw0eS1zuuY1ar9TdPn1GMfrjbQp.xml')] = info('<Info location="Root" type="Files"/>');
  store[p('root/EEtUlUb-dLAdf0KpMVivaUlztwAp.xml')] = info('<Info location="Root" type="ProjectPath"/>');
  store[p('root/fjRQtWiSIy7hIlj-Kmk87M7s21kp.xml')] = info('<Info location="Root" type="Categories"/>');
  store[p('rootp.xml')] = info('<Info/>');
  store[p('Project.xml')] = info('<Info MetadataType="fixedPathV2"/>');

  // Files collection dir (hash = qaw0eS1zuuY1ar9TdPn1GMfrjbQ)
  const files = 'qaw0eS1zuuY1ar9TdPn1GMfrjbQ';
  store[p(`${files}/-V17xoKMQuak4-chxc1ixTLv0tAp.xml`)] = info('<Info location="utils" type="File"/>');
  store[p(`${files}/-V17xoKMQuak4-chxc1ixTLv0tAd.xml`)] = info('<Info/>');
  store[p(`${files}/aPSZTDXRjCsxkLD0Rd1_fiBDTLQp.xml`)] = info('<Info location="models" type="File"/>');
  store[p(`${files}/aPSZTDXRjCsxkLD0Rd1_fiBDTLQd.xml`)] = info('<Info/>');

  // utils File entity's own dir (hash = -V17xoKMQuak4-chxc1ixTLv0tA)
  const utils = '-V17xoKMQuak4-chxc1ixTLv0tA';
  store[p(`${utils}/8AEHllJDJXphBkrgA4Qqq-Hbo_sp.xml`)] = info('<Info location="helper.m" type="File"/>');
  store[p(`${utils}/8AEHllJDJXphBkrgA4Qqq-Hbo_sd.xml`)] = info(
    '<Info><Category UUID="FileClassCategory"><Label UUID="design"/></Category></Info>',
  );
  store[p(`${utils}/QJOBPzj8Qgmn1nMVM7YX0Z_g6ysp.xml`)] = info('<Info location="1" type="DIR_SIGNIFIER"/>');
  store[p(`${utils}/QJOBPzj8Qgmn1nMVM7YX0Z_g6ysd.xml`)] = info('<Info/>');

  // models File entity's own dir (hash = aPSZTDXRjCsxkLD0Rd1_fiBDTLQ)
  const models = 'aPSZTDXRjCsxkLD0Rd1_fiBDTLQ';
  store[p(`${models}/xAPbjHwzmXYjO5A4yMgoSh3c6fwp.xml`)] = info('<Info location="projmodel.slx" type="File"/>');
  store[p(`${models}/xAPbjHwzmXYjO5A4yMgoSh3c6fwd.xml`)] = info(
    '<Info><Category UUID="FileClassCategory"><Label UUID="design"/></Category></Info>',
  );
  store[p(`${models}/dCH3sRzeKdhf0RKOhtZCvQWzhW0p.xml`)] = info('<Info location="1" type="DIR_SIGNIFIER"/>');

  // ProjectPath collection dir (hash = EEtUlUb-dLAdf0KpMVivaUlztwA)
  const path = 'EEtUlUb-dLAdf0KpMVivaUlztwA';
  store[p(`${path}/nl_xHEu2T28pQPegRCeBLV7lu6Up.xml`)] = info(
    '<Info location="9b447c9e-6062-4c9d-b0b9-bb73ea7a6cd2" type="Reference"/>',
  );
  store[p(`${path}/nl_xHEu2T28pQPegRCeBLV7lu6Ud.xml`)] = info('<Info Ref="utils" Type="Relative"/>');

  // Categories collection dir (hash = fjRQtWiSIy7hIlj-Kmk87M7s21k)
  const cats = 'fjRQtWiSIy7hIlj-Kmk87M7s21k';
  store[p(`${cats}/NjSPEMsIuLUyIpr2u1Js5bVPsOsp.xml`)] = info('<Info location="FileClassCategory" type="Category"/>');
  store[p(`${cats}/NjSPEMsIuLUyIpr2u1Js5bVPsOsd.xml`)] = info(
    '<Info DataType="None" Name="Classification" ReadOnly="1" SingleValued="1"/>',
  );

  // FileClassCategory's dir holds Labels (hash = NjSPEMsIuLUyIpr2u1Js5bVPsOs)
  const labelDir = 'NjSPEMsIuLUyIpr2u1Js5bVPsOs';
  const labels: Array<[string, string, string]> = [
    // [hashSeed, labelId, displayName]
    ['j4xwF_j8iFTVayUMfxLgMnTbenc', 'design', 'Design'],
    ['aaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'derived', 'Derived'],
    ['bbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'other', 'Other'],
    ['cccccccccccccccccccccccccccc', 'convenience', 'Convenience'],
    ['dddddddddddddddddddddddddddd', 'none', 'None'],
    ['eeeeeeeeeeeeeeeeeeeeeeeeeeee', 'artifact', 'Artifact'],
    ['ffffffffffffffffffffffffffff', 'test', 'Test'],
  ];
  for (const [seed, id, display] of labels) {
    store[p(`${labelDir}/${seed}p.xml`)] = info(`<Info location="${id}" type="Label"/>`);
    store[p(`${labelDir}/${seed}d.xml`)] = info(`<Info Name="${display}" ReadOnly="READ_ONLY"/>`);
  }

  // An unrelated file OUTSIDE resources/project/ that must be ignored.
  store['MyProj.prj'] = 'not xml';
  store['models/projmodel.slx'] = 'binary';

  return store;
}

describe('parseProject', () => {
  it('parses the real MyProj example store', () => {
    const parsed: ParsedProject = parseProject(myProjStore(), 'fallback');

    expect(parsed.name).toBe('MyProj');

    const byPath = new Map(parsed.files.map((f) => [f.path, f]));

    // helper.m: a File with the 'design' label.
    const helper = byPath.get('helper.m');
    expect(helper).toBeDefined();
    expect(helper?.isFolder).toBe(false);
    expect(helper?.labels).toContain('design');

    // projmodel.slx: a File.
    const model = byPath.get('projmodel.slx');
    expect(model).toBeDefined();
    expect(model?.isFolder).toBe(false);

    // models + utils are folders (their dirs carry a DIR_SIGNIFIER child).
    expect(byPath.get('models')?.isFolder).toBe(true);
    expect(byPath.get('utils')?.isFolder).toBe(true);

    // Files are returned sorted by path.
    const paths = parsed.files.map((f) => f.path);
    expect(paths).toEqual([...paths].sort((a, b) => a.localeCompare(b)));

    // Path folders include 'utils'.
    expect(parsed.pathFolders).toContain('utils');

    // Label catalog includes the FileClassCategory labels.
    const labelNames = parsed.labels.map((l) => l.name);
    expect(labelNames).toContain('Design');
    expect(labelNames).toContain('Derived');
    expect(labelNames).toContain('Other');
    expect(labelNames).toContain('Test');
    // The category display name is resolved from the Category def.
    expect(parsed.labels.every((l) => l.category === 'Classification')).toBe(true);
  });

  it('returns fallback name and empty arrays for an empty store (no throw)', () => {
    const parsed = parseProject({}, 'EmptyProj');
    expect(parsed.name).toBe('EmptyProj');
    expect(parsed.files).toEqual([]);
    expect(parsed.pathFolders).toEqual([]);
    expect(parsed.labels).toEqual([]);
    expect(parsed.references).toEqual([]);
  });

  it('skips a malformed XML file and parses the rest (no throw)', () => {
    const store = myProjStore();
    // Corrupt the helper.m pointer; the rest of the store should survive.
    store['resources/project/-V17xoKMQuak4-chxc1ixTLv0tA/8AEHllJDJXphBkrgA4Qqq-Hbo_sp.xml'] =
      '<Info location="helper.m" type=BROKEN <<<';

    const parsed = parseProject(store, 'fallback');
    expect(parsed.name).toBe('MyProj');
    // The other file (projmodel.slx) and folders still parse.
    const paths = parsed.files.map((f) => f.path);
    expect(paths).toContain('projmodel.slx');
    expect(paths).toContain('models');
    // Label catalog is unaffected.
    expect(parsed.labels.map((l) => l.name)).toContain('Design');
  });

  it('yields an empty label catalog when the Categories collection is missing', () => {
    const store = myProjStore();
    // Drop the Categories collection pointer and its dir contents.
    for (const key of Object.keys(store)) {
      if (
        key.includes('fjRQtWiSIy7hIlj-Kmk87M7s21k') ||
        key.includes('NjSPEMsIuLUyIpr2u1Js5bVPsOs')
      ) {
        delete store[key];
      }
    }

    const parsed = parseProject(store, 'fallback');
    expect(parsed.labels).toEqual([]);
    // Other sections still parse.
    expect(parsed.name).toBe('MyProj');
    expect(parsed.files.map((f) => f.path)).toContain('helper.m');
    expect(parsed.pathFolders).toContain('utils');
    // Per-file label assignments (UUIDs) are still surfaced.
    const helper = parsed.files.find((f) => f.path === 'helper.m');
    expect(helper?.labels).toContain('design');
  });

  it('resolves a genuine project->project reference by Ref basename', () => {
    const store = myProjStore();
    const p = (rel: string): string => `resources/project/${rel}`;

    // Add a top-level References collection in root.
    store[p('root/RefsCollHash0000000000000000p.xml')] = info('<Info location="Root" type="References"/>');
    // Its dir holds a type="Reference" entry (a real cross-project ref).
    const refDir = 'RefsCollHash0000000000000000';
    store[p(`${refDir}/ref1hash000000000000000000p.xml`)] = info(
      '<Info location="uuid-1234" type="Reference"/>',
    );
    store[p(`${refDir}/ref1hash000000000000000000d.xml`)] = info(
      '<Info Ref="../LibProj/LibProj.prj" Type="Relative"/>',
    );

    const parsed = parseProject(store, 'fallback');
    const ref = parsed.references.find((r) => r.id === 'uuid-1234');
    expect(ref).toBeDefined();
    expect(ref?.name).toBe('LibProj.prj');
    // The ProjectPath 'Reference' entries must NOT be misread as project refs.
    expect(parsed.references.some((r) => r.name === 'utils')).toBe(false);
  });
});
