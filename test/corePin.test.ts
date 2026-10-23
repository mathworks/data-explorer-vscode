// Copyright 2026 The MathWorks, Inc.
// The data-explorer-core this extension is pinned to, as the committed files say it:
// package.json names a release tag, and package-lock.json resolves that tag to a commit,
// which is what `npm ci` installs.
//
// Each pin bump changes the three constants below, and only those. The tag and its commit
// are a pair: the commit is the one `git ls-remote` gives for the tag's `^{}` line.
//
// The lockfile half is the one a bump can get wrong without any other test noticing.
// Editing the tag in package.json and running `npm install` moves only the lockfile's root
// spec; its node_modules entry keeps the old commit and version, `npm ci` goes on installing
// the old core, and every other test still passes against it. Installing the tag by name,
// `npm install "data-explorer-core@github:mathworks/data-explorer-core#<tag>"`, moves both.
//
// What is installed is not checked here: a core tarball installed over the pin to try a core
// change is meant to be what the other tests run against.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TAG = 'v1.45.4';
const COMMIT = '1c40379d7457baee7c435cdeeb07853003a4c3b8';
const VERSION = '1.45.4';

const SPEC = `github:mathworks/data-explorer-core#${TAG}`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function json(name: string): any {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8'));
}

describe('the data-explorer-core pin', () => {
  it(`package.json pins core at ${TAG}`, () => {
    expect(json('package.json').dependencies['data-explorer-core']).toBe(SPEC);
  });

  it(`package-lock.json resolves ${TAG} to its commit and version`, () => {
    const lock = json('package-lock.json');
    expect(lock.packages[''].dependencies['data-explorer-core']).toBe(SPEC);
    const core = lock.packages['node_modules/data-explorer-core'];
    expect({ version: core.version, resolved: core.resolved }).toEqual({
      version: VERSION,
      resolved: `git+ssh://git@github.com/mathworks/data-explorer-core.git#${COMMIT}`,
    });
  });
});
