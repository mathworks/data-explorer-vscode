// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect, vi } from 'vitest';
import { parseNavTarget, parseFileTarget, resolveNavSource } from '../src/host/navTarget.js';

describe('parseNavTarget — Usage-link target grammar', () => {
  it('parses a bare <name>@<basename> (block -> dictionary variable)', () => {
    expect(parseNavTarget('Kp@controller.sldd')).toEqual({ name: 'Kp', source: 'controller.sldd' });
  });

  it('strips the blocks: prefix (data variable -> model block)', () => {
    expect(parseNavTarget('blocks:Gain1@file:///w/plant.slx')).toEqual({
      name: 'Gain1',
      source: 'file:///w/plant.slx',
    });
  });

  it('strips the workspace: prefix (block -> model-workspace param)', () => {
    expect(parseNavTarget('workspace:Ts@model.slx')).toEqual({ name: 'Ts', source: 'model.slx' });
  });

  it('splits on the LAST @ so a uriString source survives', () => {
    // A uriString never contains '@', but names never do either; lastIndexOf is
    // the safe split point regardless.
    expect(parseNavTarget('blocks:Sum@file:///path/to/my.slx')).toEqual({
      name: 'Sum',
      source: 'file:///path/to/my.slx',
    });
  });

  it('returns null when there is no @ separator', () => {
    expect(parseNavTarget('Kp')).toBeNull();
    expect(parseNavTarget('blocks:Gain1')).toBeNull();
  });

  it('returns null when name or source is empty', () => {
    expect(parseNavTarget('@controller.sldd')).toBeNull();
    expect(parseNavTarget('Kp@')).toBeNull();
    expect(parseNavTarget('blocks:@x')).toBeNull();
  });
});

describe('parseFileTarget — Model Reference / External Data bare-file links', () => {
  it('accepts a bare model-reference basename (no @, no prefix)', () => {
    // ModelReferenceNode / DataSourceNode set linkTarget to the bare filename.
    expect(parseFileTarget('plant.slx')).toBe('plant.slx');
    expect(parseFileTarget('signals.mat')).toBe('signals.mat');
    expect(parseFileTarget('common.sldd')).toBe('common.sldd');
  });

  it('returns null for a Usage-link target (has @source) so it does not hijack it', () => {
    expect(parseFileTarget('Kp@controller.sldd')).toBeNull();
    expect(parseFileTarget('blocks:Gain1@file:///w/plant.slx')).toBeNull();
    expect(parseFileTarget('workspace:Ts@model.slx')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseFileTarget('')).toBeNull();
  });
});

// The source half of a link — a Usage link's `@source`, or a whole bare-file target —
// turned into the document to open. A bare name is what Simulink records for a Model
// Reference or an External Data file, and the same name can sit in more than one folder
// of the workspace: the answer has to be the one the tree shows under the referrer, not
// whichever file the workspace search happens to list first.
describe('resolveNavSource — which file a link source names', () => {
  const REFERRER = 'file:///w/b/model.slx';
  function deps(scopedAnswer?: string | Error, firstAnswer?: string) {
    return {
      scoped: vi.fn(async (_ref: string, _referrer: string) => {
        if (scopedAnswer instanceof Error) throw scopedAnswer;
        return scopedAnswer;
      }),
      firstMatch: vi.fn(async (_ref: string) => firstAnswer),
    };
  }

  it('a full uri names its document, and neither lookup runs', async () => {
    const d = deps('file:///w/b/params.sldd', 'file:///w/a/params.sldd');
    expect(await resolveNavSource('file:///w/plant.slx', REFERRER, d)).toBe('file:///w/plant.slx');
    expect(d.scoped).not.toHaveBeenCalled();
    expect(d.firstMatch).not.toHaveBeenCalled();
  });

  it('a bare name with a referrer takes the referrer-scoped answer, not the first match', async () => {
    const d = deps('file:///w/b/params.sldd', 'file:///w/a/params.sldd');
    expect(await resolveNavSource('params.sldd', REFERRER, d)).toBe('file:///w/b/params.sldd');
    expect(d.scoped).toHaveBeenCalledWith('params.sldd', REFERRER);
    expect(d.firstMatch).not.toHaveBeenCalled();
  });

  it('a scoped miss falls back to the first workspace match', async () => {
    const d = deps(undefined, 'file:///w/a/params.sldd');
    expect(await resolveNavSource('params.sldd', REFERRER, d)).toBe('file:///w/a/params.sldd');
    expect(d.scoped).toHaveBeenCalledWith('params.sldd', REFERRER);
    expect(d.firstMatch).toHaveBeenCalledWith('params.sldd');
  });

  it('a scoped lookup that fails falls back to the first workspace match', async () => {
    // The tree's graph is a convenience here, not a precondition: a link must still open
    // something when the graph could not be built.
    const d = deps(new Error('graph build failed'), 'file:///w/a/params.sldd');
    expect(await resolveNavSource('params.sldd', REFERRER, d)).toBe('file:///w/a/params.sldd');
    expect(d.firstMatch).toHaveBeenCalledWith('params.sldd');
  });

  it('with no referrer there is no scope to prefer, so the first match is the answer', async () => {
    const d = deps('file:///w/b/params.sldd', 'file:///w/a/params.sldd');
    expect(await resolveNavSource('params.sldd', undefined, d)).toBe('file:///w/a/params.sldd');
    expect(d.scoped).not.toHaveBeenCalled();
    expect(d.firstMatch).toHaveBeenCalledWith('params.sldd');
  });

  it('with no scoped lookup supplied, a referrer changes nothing', async () => {
    const firstMatch = vi.fn(async () => 'file:///w/a/params.sldd');
    expect(await resolveNavSource('params.sldd', REFERRER, { firstMatch })).toBe('file:///w/a/params.sldd');
    expect(firstMatch).toHaveBeenCalledWith('params.sldd');
  });

  it('nothing found anywhere is undefined', async () => {
    const d = deps(undefined, undefined);
    expect(await resolveNavSource('missing.sldd', REFERRER, d)).toBeUndefined();
  });
});
