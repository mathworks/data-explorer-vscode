// Copyright 2026 The MathWorks, Inc.
// Unit tests for the shared path utilities in src/common/pathUtil.ts.
import { describe, it, expect } from 'vitest';
import { basename, dirname, refBasename, uriBasename } from '../src/common/pathUtil.js';

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

  describe('refBasename', () => {
    it('lowercases the basename', () => {
      expect(refBasename('/some/Dir/MyFile.SLDD')).toBe('myfile.sldd');
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
