// Copyright 2026 The MathWorks, Inc.
//
// The Node the workflows install, held against the Node the packager needs.
//
// `@vscode/vsce` declares the Node it runs on in its own `engines.node`, and 4.0.0 raises
// that floor from 20 to 22. Nothing in the build reads it: npm only warns on an engines
// mismatch, and until ci.yml packaged too, the one workflow that ran `vsce package` was
// release.yml, on a tag. So a packager that needs a newer Node than CI's would have been
// found on the release, after the version was already tagged. These tests read both sides
// from where they actually live (the installed packager and the two workflow files), so
// the next bump of either one goes red here, on the PR that makes it.
//
// ci.yml also packages the .vsix now, the same way release.yml does. Without that step a
// green PR says nothing about whether the release would package.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const CI = '.github/workflows/ci.yml';
const RELEASE = '.github/workflows/release.yml';

/** Every `node-version:` value in a workflow, with YAML quotes removed. */
const nodeVersions = (file: string): string[] =>
  [...read(file).matchAll(/^\s*node-version:\s*(.+?)\s*$/gm)].map((m) =>
    m[1].replace(/^(['"])(.*)\1$/, '$2'),
  );

/** The lines of a workflow that are not comments. */
const codeLines = (file: string): string[] =>
  read(file)
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'));

// The installed packager, not the range in package.json: `engines.node` is a property of
// the version npm actually resolved, and that is the one CI runs.
const vscePkgPath = join(root, 'node_modules/@vscode/vsce/package.json');
const vsce = JSON.parse(readFileSync(vscePkgPath, 'utf8')) as {
  version: string;
  engines: { node: string };
};
// vsce's own semver dependency, resolved from vsce's location, so it is present
// whenever vsce is.
const semver = createRequire(vscePkgPath)('semver') as {
  validRange(r: string): string | null;
  subset(sub: string, dom: string): boolean;
};

describe('the Node the workflows install', () => {
  for (const file of [CI, RELEASE]) {
    it(`${file} sets node-version exactly once, to a version range`, () => {
      const versions = nodeVersions(file);
      expect(versions).toHaveLength(1);
      expect(semver.validRange(versions[0]), versions[0]).not.toBeNull();
    });
  }

  // A PR is checked on the Node the release is built on. If the two differ, a green PR
  // says nothing about the release.
  it('is the same in ci.yml and release.yml', () => {
    expect(nodeVersions(CI)).toEqual(nodeVersions(RELEASE));
  });

  // Every Node the range can install, not just one of them: setup-node picks a version
  // inside `node-version`, so the whole range has to fall inside vsce's floor.
  for (const file of [CI, RELEASE]) {
    it(`${file} installs a Node that @vscode/vsce supports`, () => {
      const [version] = nodeVersions(file);
      expect(
        semver.subset(version, vsce.engines.node),
        `${file}: node-version ${version} can install a Node outside @vscode/vsce ` +
          `${vsce.version}'s engines.node "${vsce.engines.node}"`,
      ).toBe(true);
    });
  }
});

describe('ci.yml packages the .vsix', () => {
  // release.yml is the reference here: a `vsce package` line in it is what makes this
  // a check on the release's packaging step rather than on some other one.
  it('as release.yml does', () => {
    const packages = (file: string) => codeLines(file).some((l) => /\bvsce package\b/.test(l));
    expect(packages(RELEASE), `${RELEASE} runs vsce package`).toBe(true);
    expect(packages(CI), `${CI} runs vsce package`).toBe(true);
  });
});
