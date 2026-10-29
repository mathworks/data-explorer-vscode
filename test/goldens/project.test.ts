// Copyright 2026 The MathWorks, Inc.
//
// What every project fixture's page is sent, pinned as a golden payload (see tables.test.ts for
// why these exist). A `.prj` or a `matlab.toml` opens on a page rather than a table, so its whole
// first paint is one `setProject` message, built here by the route BinaryEditorProvider takes.
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { isProjectFile, isTomlProjectFile } from 'data-explorer-core';
import { MSP_CONFIG, projectPageMessage } from 'data-explorer-view/model';
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
      // mirrors BinaryEditorProvider.ts's project route: view's projectPageMessage over the
      // store, the marker's path (the one the view was opened under, which names a
      // `matlab.toml` after its folder), the root, and msp_config.json beside the marker. The
      // root is the project's OS path (`root.fsPath`), which names the checkout; the page only
      // resolves links against it, so its spelling is no part of what is pinned.
      const message = projectPageMessage(
        files,
        fakeFile(rel).path,
        '<root>',
        readTextIfPresent(join(REPO, dirname(rel), MSP_CONFIG)),
      );
      await expectGolden(message, rel, 'project');
    });
  }
});
