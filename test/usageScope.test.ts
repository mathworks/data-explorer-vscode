// Copyright 2026 The MathWorks, Inc.
//
// Which files can affect ONE file's Usage column — the set a tab has to parse before it
// can answer, as opposed to the folder it happens to sit in.
//
// The rule being pinned is not "fewer files": it is that the scoped set gives the SAME
// answers as the whole folder. Two ways that goes wrong, both here:
//
//   - a shadowing file left out. A model reading `Kp` through `first.sldd` credits the
//     usage to `first.sldd`; drop that file and core moves the usage down the order to
//     `second.sldd` (pinned in core's usageIndex.test.ts). So the scope must carry every
//     file in a needed model's chain, not just the one being opened.
//   - a basename collision resolved differently. `slddByName` is keyed by refBasename and
//     the LAST assignment wins, so a scope holding only one of two `types.sldd` picks a
//     different winner than the folder does. The scope is therefore computed over
//     BASENAMES and keeps every file that has one, in folder order.
//
// The end-to-end equality of the two paths is pinned in usageEndToEnd.test.ts; this file
// pins the set itself, which is where the reasoning is.
import { describe, it, expect } from 'vitest';
import { usageScope, type ChainSource } from '../src/host/usageScope.js';

const src = (path: string, kind: ChainSource['kind'], chain: string[] = []): ChainSource => ({
  uriString: `file://${path}`,
  path,
  kind,
  chain,
});

const u = (path: string): string => `file://${path}`;

describe('usageScope', () => {
  it('keeps only the models that can reach the opened dictionary', () => {
    const sources = [
      src('/w/uses.slx', 'model', ['params.sldd']),
      src('/w/ignores.slx', 'model', ['other.sldd']),
      src('/w/params.sldd', 'sldd'),
      src('/w/other.sldd', 'sldd'),
    ];
    expect(usageScope(u('/w/params.sldd'), sources)).toEqual([u('/w/uses.slx'), u('/w/params.sldd')]);
  });

  it('keeps every file in a needed model’s chain, not just the opened one', () => {
    // The shadowing case. `m.slx` resolves through `first.sldd` then `second.sldd`; both
    // define `Kp`, and only the first collects the usage. Opening `second.sldd` must still
    // carry `first.sldd`, or core answers as though the shadowing file did not exist and
    // credits `second.sldd` with a usage the folder gives to `first.sldd`.
    const sources = [
      src('/w/m.slx', 'model', ['first.sldd', 'second.sldd']),
      src('/w/first.sldd', 'sldd'),
      src('/w/second.sldd', 'sldd'),
    ];
    expect(usageScope(u('/w/second.sldd'), sources)).toEqual([
      u('/w/m.slx'),
      u('/w/first.sldd'),
      u('/w/second.sldd'),
    ]);
  });

  it('follows a dictionary chain transitively, however deep', () => {
    const sources = [
      src('/w/m.slx', 'model', ['top.sldd']),
      src('/w/top.sldd', 'sldd', ['mid.sldd']),
      src('/w/mid.sldd', 'sldd', ['leaf.sldd']),
      src('/w/leaf.sldd', 'sldd'),
      src('/w/elsewhere.sldd', 'sldd'),
    ];
    expect(usageScope(u('/w/leaf.sldd'), sources)).toEqual([
      u('/w/m.slx'),
      u('/w/top.sldd'),
      u('/w/mid.sldd'),
      u('/w/leaf.sldd'),
    ]);
  });

  it('terminates on a cyclic dictionary hierarchy', () => {
    const sources = [
      src('/w/m.slx', 'model', ['a.sldd']),
      src('/w/a.sldd', 'sldd', ['b.sldd']),
      src('/w/b.sldd', 'sldd', ['a.sldd']),
    ];
    expect(usageScope(u('/w/b.sldd'), sources)).toEqual([u('/w/m.slx'), u('/w/a.sldd'), u('/w/b.sldd')]);
  });

  it('treats a MAT-file as a leaf, because it inherits nothing', () => {
    const sources = [
      src('/w/m.slx', 'model', ['data.mat']),
      // A `.mat` that names something is still a leaf: core's DataSummary.slddRefs is
      // empty for one, so nothing here may chase a reference out of it.
      src('/w/data.mat', 'mat', ['never.sldd']),
      src('/w/never.sldd', 'sldd'),
    ];
    expect(usageScope(u('/w/data.mat'), sources)).toEqual([u('/w/m.slx'), u('/w/data.mat')]);
  });

  it('does NOT follow model references', () => {
    // `parent.slx` references `child.slx`, and `child.slx` links the dictionary. A
    // referenced model's blocks resolve through its OWN chain and are summarised under its
    // own srcId, so the parent contributes nothing to the dictionary's Usage — and it is
    // tested on its own chain like every other model.
    const sources = [
      src('/w/parent.slx', 'model', []),
      src('/w/child.slx', 'model', ['params.sldd']),
      src('/w/params.sldd', 'sldd'),
    ];
    expect(usageScope(u('/w/params.sldd'), sources)).toEqual([u('/w/child.slx'), u('/w/params.sldd')]);
  });

  it('needs no other model when a MODEL is what was opened', () => {
    // A model's Usage is its own blocks' origins and its own workspace variables' users.
    // No other model can contribute either: a workspace variable resolves only for the
    // model that owns it, so no foreign block can key a usage to this model's srcId. Its
    // chain still comes along — that is what names a parameter's origin, and what shadows.
    const sources = [
      src('/w/mine.slx', 'model', ['params.sldd']),
      src('/w/theirs.slx', 'model', ['params.sldd']),
      src('/w/params.sldd', 'sldd'),
      src('/w/unrelated.mat', 'mat'),
    ];
    expect(usageScope(u('/w/mine.slx'), sources)).toEqual([u('/w/mine.slx'), u('/w/params.sldd')]);
  });

  it('keeps BOTH files of a colliding basename, in folder order', () => {
    // The collision rule. Core keys `slddByName` by refBasename and the last assignment
    // wins, so a scope that carried only `a/types.sldd` would make it the winner where the
    // folder makes `b/types.sldd` one. Keeping both, in folder order, resolves the
    // collision exactly as a scan of the whole folder does.
    const sources = [
      src('/w/m.slx', 'model', ['types.sldd']),
      src('/w/a/types.sldd', 'sldd'),
      src('/w/b/types.sldd', 'sldd'),
    ];
    expect(usageScope(u('/w/a/types.sldd'), sources)).toEqual([
      u('/w/m.slx'),
      u('/w/a/types.sldd'),
      u('/w/b/types.sldd'),
    ]);
  });

  it('matches a reference across a difference of case, as the file systems do', () => {
    const sources = [src('/w/m.slx', 'model', ['PARAMS.SLDD']), src('/w/params.sldd', 'sldd')];
    expect(usageScope(u('/w/params.sldd'), sources)).toEqual([u('/w/m.slx'), u('/w/params.sldd')]);
  });

  it('scopes a dictionary no model reaches to itself, not to nothing', () => {
    // An unused dictionary answers "no usages", and it has to be IN the set to answer at
    // all — a set that dropped it would leave the query asking about a file the index
    // never heard of, which is the same empty answer for a different reason.
    const sources = [src('/w/m.slx', 'model', ['other.sldd']), src('/w/lonely.sldd', 'sldd')];
    expect(usageScope(u('/w/lonely.sldd'), sources)).toEqual([u('/w/lonely.sldd')]);
  });

  it('falls back to every file for a uri it does not hold', () => {
    // An untitled or unreadable document: there is no chain to scope by, so narrowing
    // would be a guess. The whole set is the answer that cannot be wrong.
    const sources = [src('/w/m.slx', 'model', ['params.sldd']), src('/w/params.sldd', 'sldd')];
    expect(usageScope(u('/w/absent.sldd'), sources)).toEqual([u('/w/m.slx'), u('/w/params.sldd')]);
  });

  it('returns the files in the order it was given them', () => {
    // Folder order is load-bearing twice over: it decides which file wins a basename
    // collision, and the blocks in a Usage cell are listed in the order their models were
    // summarised. A scope that reordered would make the same cell render differently.
    const sources = [
      src('/w/z.slx', 'model', ['params.sldd']),
      src('/w/params.sldd', 'sldd'),
      src('/w/a.slx', 'model', ['params.sldd']),
    ];
    expect(usageScope(u('/w/params.sldd'), sources)).toEqual([
      u('/w/z.slx'),
      u('/w/params.sldd'),
      u('/w/a.slx'),
    ]);
  });
});
