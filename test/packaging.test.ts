// Copyright 2026 The MathWorks, Inc.
//
// What ships in the .vsix, held against what git refuses to track.
//
// `vsce package` walks the WORKING TREE. It does not consult git, so `.gitignore`
// has no effect on the package at all: a local-only file is shipped to every user
// unless `.vscodeignore` names it too. That is one rule — "this file is local, it
// stays here" — spelled in two files, which is the bug class this repo keeps
// hitting, and it went wrong the quietest possible way. Nothing failed, nothing
// warned; `CLAUDE.md` (internal hostnames, the internal registry, the publishing
// credentials) was simply inside every locally built .vsix from v1.5.0 through
// v1.7.0, alongside a pile of local scratch HTML.
//
// A leak grep over the SOURCE cannot catch this, because the file it must not
// find is deliberately in the working tree. The invariant is between the two
// ignore lists, so that is what these tests read.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const lines = (file: string): string[] =>
  read(file)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

/**
 * The top-level path each .gitignore pattern reaches into: `docs/deep-work/` and
 * `test/parity/out.txt` are both a claim about one root entry (`docs`, `test`), and
 * .vscodeignore excludes whole trees, so that is the granularity the two lists can
 * actually be compared at.
 */
const gitignoredRoots = (): string[] => {
  const roots = lines('.gitignore')
    .filter((l) => !l.startsWith('!')) // a re-inclusion is not a local-only claim
    .map((l) => l.replace(/^\//, '').split('/')[0]);
  return [...new Set(roots)];
};

/** True if a .vscodeignore pattern excludes the root entry `entry`. */
const covers = (pattern: string, entry: string): boolean => {
  const bare = pattern.replace(/^\*\*\//, '').replace(/\/\*\*$/, '').replace(/\/$/, '');
  const re = new RegExp(`^${bare.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);
  return re.test(entry);
};

describe('.vscodeignore covers everything .gitignore does', () => {
  const patterns = lines('.vscodeignore');

  // `dist/` is gitignored because it is generated, and packaged because it IS the
  // extension. It is the one path where the two files must disagree, so it is
  // named here rather than allowed to hide inside a looser rule.
  const SHIPPED_BUILD_OUTPUT = new Set(['dist']);

  for (const entry of gitignoredRoots()) {
    if (SHIPPED_BUILD_OUTPUT.has(entry)) continue;
    it(`does not ship ${entry}`, () => {
      const matched = patterns.filter((p) => covers(p, entry));
      expect(matched, `${entry} is gitignored but nothing in .vscodeignore excludes it`)
        .not.toEqual([]);
    });
  }

  it('ships dist/, the one gitignored path that is the product', () => {
    expect(patterns.some((p) => covers(p, 'dist'))).toBe(false);
    // ...and its test sibling is NOT the product.
    expect(patterns.some((p) => covers(p, 'dist-test'))).toBe(true);
  });

  it('excludes the local notes by name, whatever else changes', () => {
    // Named directly, not just derived from the loop above, because this is the
    // file that actually leaked: CLAUDE.md documents the internal upstream remote,
    // the internal package registry and how the Marketplace credential is minted.
    expect(patterns).toContain('CLAUDE.md');
    expect(patterns.some((p) => covers(p, '.superpowers'))).toBe(true);
  });

  it('keeps the sources and both test trees out of the package', () => {
    // Not gitignored, so the loop above says nothing about them; a .vsix carrying
    // src/ and the fixtures would roughly triple in size and publish the test
    // models.
    for (const dir of ['src', 'test', 'test-integration']) {
      expect(patterns.some((p) => covers(p, dir)), `${dir} must not ship`).toBe(true);
    }
  });
});
