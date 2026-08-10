// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { parseNavTarget, parseFileTarget } from '../src/host/navTarget.js';

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
