// Copyright 2026 The MathWorks, Inc.
// The data-explorer-core this extension is pinned to, as the committed files say it:
// package.json names a git ref — a release tag, or a commit of core's main between releases —
// and package-lock.json resolves that ref to a commit, which is what `npm ci` installs.
//
// Each pin bump changes the three constants below, and only those. The ref and its commit
// are a pair: for a tag, the commit is the one `git ls-remote` gives for the tag's `^{}` line;
// for a commit, it is the ref itself.
//
// The lockfile half is the one a bump can get wrong without any other test noticing.
// Editing the ref in package.json and running `npm install` moves only the lockfile's root
// spec; its node_modules entry keeps the old commit and version, `npm ci` goes on installing
// the old core, and every other test still passes against it. Installing the ref by name,
// `npm install "data-explorer-core@github:mathworks/data-explorer-core#<ref>"`, moves both.
//
// What is installed is not checked here: a core tarball installed over the pin to try a core
// change is meant to be what the other tests run against.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// A commit of core's main, between releases: the release that carries it is tagged later.
const REF = 'v1.46.1';
const COMMIT = 'd2b1ba8a2902dc97647733e488fecfa6fb23f486';
const VERSION = '1.46.1';

const SPEC = `github:mathworks/data-explorer-core#${REF}`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function json(name: string): any {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8'));
}

describe('the data-explorer-core pin', () => {
  it(`package.json pins core at ${REF}`, () => {
    expect(json('package.json').dependencies['data-explorer-core']).toBe(SPEC);
  });

  it(`package-lock.json resolves ${REF} to its commit and version`, () => {
    const lock = json('package-lock.json');
    expect(lock.packages[''].dependencies['data-explorer-core']).toBe(SPEC);
    const core = lock.packages['node_modules/data-explorer-core'];
    expect({ version: core.version, resolved: core.resolved }).toEqual({
      version: VERSION,
      resolved: `git+ssh://git@github.com/mathworks/data-explorer-core.git#${COMMIT}`,
    });
  });
});
