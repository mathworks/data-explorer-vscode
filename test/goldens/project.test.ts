// Copyright 2026 The MathWorks, Inc.
//
// What every project fixture's page is sent, pinned as a golden payload (see tables.test.ts for
// why these exist). A `.prj` or a `matlab.toml` opens on a page rather than a table, so its whole
// first paint is one `setProject` message, built here by the route BinaryEditorProvider takes.
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { buildProjectPage, isProjectFile, isTomlProjectFile, parseProject, projectFallbackName } from 'data-explorer-core';
import { warningBanner } from '../../src/view/model/rows/parseWarnings.js';
import { detectMsp, MSP_CONFIG } from '../../src/host/mspProject.js';
import { expectGolden, fakeFile, fixtureFiles, nameOf, REPO } from './fixtures.js';
import { readProjectStore, readTextIfPresent } from './nodeReads.js';

const PROJECTS = fixtureFiles().filter((rel) => isProjectFile(nameOf(rel)));

describe('golden project pages', () => {
  it('finds both project formats', () => {
    expect(PROJECTS.some((rel) => rel.endsWith('.prj'))).toBe(true);
    expect(PROJECTS.some((rel) => isTomlProjectFile(rel))).toBe(true);
  });

  for (const rel of PROJECTS) {
    it(rel, async () => {
      const files = readProjectStore(join(REPO, rel));
      // The fallback name from the PATH (a `matlab.toml` is named after its folder), and the
      // path is the one the view was opened under.
      const parsed = parseProject(files, projectFallbackName(fakeFile(rel).path));
      // mirrors BinaryEditorProvider.ts:423-437, the payload literal.
      const message = {
        type: 'setProject',
        page: buildProjectPage(parsed),
        // The project root's OS path (`root.fsPath`), which names the checkout; the page only
        // resolves links against it, so its spelling is no part of what is pinned.
        root: '<root>',
        msp: detectMsp(parsed, readTextIfPresent(join(REPO, dirname(rel), MSP_CONFIG))),
        warnings: warningBanner(parsed.warnings),
      };
      await expectGolden(message, rel, 'project');
    });
  }
});
