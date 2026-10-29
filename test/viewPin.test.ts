// Copyright 2026 The MathWorks, Inc.
// The data-explorer-view this extension is pinned to, as the committed files say it — the same
// pair corePin.test.ts holds for core. package.json names a git ref — a release tag, or a commit
// of view's main between releases — and package-lock.json resolves that ref to a commit, which
// is what `npm ci` installs.
//
// Each pin bump changes the three constants below, and only those. The ref and its commit are a
// pair: for a tag, the commit is the one `git ls-remote` gives for the tag's `^{}` line; for a
// commit, it is the ref itself. Installing the ref by name,
// `npm install "data-explorer-view@github:mathworks/data-explorer-view#<ref>"`, moves both the
// lockfile's root spec and its node_modules entry; editing package.json alone moves only the
// first, and `npm ci` goes on installing the old view.
//
// View is unlike core in one way, and the last test is about it. View does not bring core: it
// names the core range it works with as a peer dependency, and this extension pins core itself.
// That is deliberate — `instanceof` against a core class is silently false across two copies of
// core in one bundle — so the one thing a view bump can break without a type error is that range
// no longer accepting the core pinned here.
//
// What is installed is not checked here: a view tarball installed over the pin to try a view
// change is meant to be what the other tests run against.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// A release tag, and the commit it points at.
const REF = 'v0.2.0';
const COMMIT = '4d88e89e461b266b3e4f24e674f4250e9d9d3b06';
const VERSION = '0.2.0';

const SPEC = `github:mathworks/data-explorer-view#${REF}`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function json(name: string): any {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8'));
}

/**
 * Whether `version` satisfies a caret range, the only form view states its peers in. Any other
 * form throws rather than guessing, so a range written differently fails here and gets read.
 */
function caretAccepts(range: string, version: string): boolean {
  const r = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
  const v = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!r || !v) throw new Error(`expected ^X.Y.Z and X.Y.Z, got ${range} and ${version}`);
  const [want, have] = [r.slice(1).map(Number), v.slice(1).map(Number)];
  // ^1.47.0 is >=1.47.0 <2.0.0; below 1.0.0 the caret holds the minor instead (^0.3.1 is <0.4.0),
  // and below 0.1.0 the patch too (^0.0.3 is 0.0.3 alone).
  const fixed = want[0] > 0 ? 1 : want[1] > 0 ? 2 : 3;
  for (let i = 0; i < fixed; i++) if (have[i] !== want[i]) return false;
  for (let i = fixed; i < 3; i++) if (have[i] !== want[i]) return have[i] > want[i];
  return true;
}

describe('the data-explorer-view pin', () => {
  it(`package.json pins view at ${REF}`, () => {
    expect(json('package.json').dependencies['data-explorer-view']).toBe(SPEC);
  });

  it(`package-lock.json resolves ${REF} to its commit and version`, () => {
    const lock = json('package-lock.json');
    expect(lock.packages[''].dependencies['data-explorer-view']).toBe(SPEC);
    const view = lock.packages['node_modules/data-explorer-view'];
    expect({ version: view.version, resolved: view.resolved }).toEqual({
      version: VERSION,
      resolved: `git+ssh://git@github.com/mathworks/data-explorer-view.git#${COMMIT}`,
    });
  });

  it('accepts, as its core peer, the core pinned here', () => {
    const lock = json('package-lock.json');
    const range = lock.packages['node_modules/data-explorer-view'].peerDependencies['data-explorer-core'];
    const core = lock.packages['node_modules/data-explorer-core'].version;
    expect(caretAccepts(range, core), `view wants core ${range}; this extension pins ${core}`).toBe(true);
  });

  it('reads a caret range the way npm does', () => {
    // The check above is only as good as this reading of it.
    expect(caretAccepts('^1.47.0', '1.47.0')).toBe(true);
    expect(caretAccepts('^1.47.0', '1.48.2')).toBe(true);
    expect(caretAccepts('^1.47.0', '1.46.9')).toBe(false);
    expect(caretAccepts('^1.47.0', '2.0.0')).toBe(false);
    expect(caretAccepts('^0.3.1', '0.3.4')).toBe(true);
    expect(caretAccepts('^0.3.1', '0.4.0')).toBe(false);
    expect(caretAccepts('^0.0.3', '0.0.4')).toBe(false);
    expect(() => caretAccepts('>=1.47.0', '1.47.0')).toThrow();
  });
});
