// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { parseNavTarget } from '../src/host/navTarget.js';

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
