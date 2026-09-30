// Copyright 2026 The MathWorks, Inc.
// Unit tests for the shared path utilities in src/common/pathUtil.ts.
import { describe, it, expect } from 'vitest';
import { basename, dirname, projectPathSegments, uriBasename } from '../src/common/pathUtil.js';

describe('pathUtil', () => {
  describe('basename', () => {
    it('returns last segment of a posix path', () => {
      expect(basename('/usr/local/file.txt')).toBe('file.txt');
    });

    it('returns last segment of a windows path with backslashes', () => {
      expect(basename('C:\\Users\\me\\doc.sldd')).toBe('doc.sldd');
    });

    it('returns the string itself when no separator is present', () => {
      expect(basename('bare.slx')).toBe('bare.slx');
    });
  });

  describe('dirname', () => {
    it('returns directory of a nested path', () => {
      expect(dirname('/a/b/c.txt')).toBe('/a/b');
    });

    it('returns empty string for top-level path (single leading slash)', () => {
      expect(dirname('/file.txt')).toBe('');
    });

    it('returns empty string when there is no slash', () => {
      expect(dirname('file.txt')).toBe('');
    });
  });

  // refBasename lives in core now and is tested there (test/fileKinds.test.ts), because
  // it is the key core's usage index matches a model's recorded reference through. The
  // host reaches it via slddRefs.ts; test/sectionsTree.test.ts covers that seam.

  describe('projectPathSegments', () => {
    // What a `.prj` page's hyperlinks are resolved through: the store records paths
    // relative to the project root, and the host joins these onto the root's Uri.
    it('splits a relative path into its segments', () => {
      expect(projectPathSegments('models/gain.slx')).toEqual(['models', 'gain.slx']);
    });

    it('splits a path a Windows-authored store spells with backslashes', () => {
      // The same store opens on macOS, where one unsplit segment would join as a single
      // literal filename containing backslashes and resolve to nothing.
      expect(projectPathSegments('models\\gain.slx')).toEqual(['models', 'gain.slx']);
    });

    it('keeps `..`, because a reference legitimately lives outside the project', () => {
      // `../OtherProject/other.prj` is what MATLAB writes, so a guard against escaping
      // the root would break the one section that needs to.
      expect(projectPathSegments('../Lib/Lib.prj')).toEqual(['..', 'Lib', 'Lib.prj']);
    });

    it('drops empty segments, so a doubled or trailing separator resolves the same', () => {
      expect(projectPathSegments('work//cache/')).toEqual(['work', 'cache']);
      expect(projectPathSegments('/work/cache')).toEqual(['work', 'cache']);
    });

    it('is empty for the project root itself', () => {
      // The Project Path list spells the root as '', and joining nothing onto the root
      // Uri is exactly right.
      expect(projectPathSegments('')).toEqual([]);
    });
  });

  describe('uriBasename', () => {
    it('strips ?query before extracting basename', () => {
      expect(uriBasename('file:///a/b/c.sldd?version=2')).toBe('c.sldd');
    });

    it('strips #hash before extracting basename', () => {
      expect(uriBasename('file:///a/b/c.mat#section')).toBe('c.mat');
    });
  });
});
