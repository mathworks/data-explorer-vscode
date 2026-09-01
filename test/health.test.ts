// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { encode, decode, DECORATIONS, HEALTH_QUERY, type HealthState } from '../src/host/health.js';

describe('health encode/decode', () => {
  const states: HealthState[] = ['cycle', 'modified'];

  it('round-trips every state', () => {
    for (const s of states) {
      expect(decode(encode(s))).toBe(s);
    }
  });

  it('encodes as dexHealth=<state>', () => {
    expect(encode('cycle')).toBe(`${HEALTH_QUERY}=cycle`);
  });

  it('decodes null for empty / unknown / non-health queries', () => {
    expect(decode(undefined)).toBeNull();
    expect(decode('')).toBeNull();
    expect(decode('foo=bar')).toBeNull();
    expect(decode(`${HEALTH_QUERY}=bogus`)).toBeNull();
  });

  it('decodes when dexHealth is among other query params', () => {
    expect(decode(`x=1&${HEALTH_QUERY}=modified&y=2`)).toBe('modified');
  });

  it('skips a valueless query param instead of misreading it', () => {
    // A resourceUri query is not always our own: a valueless flag (`?readonly`)
    // has no '=' at all, so slicing at index -1 would yield a bogus key and the
    // real dexHealth pair further along would never be reached — the row would
    // silently lose its badge. Both orders must still decode.
    expect(decode(`readonly&${HEALTH_QUERY}=cycle`)).toBe('cycle');
    expect(decode(`${HEALTH_QUERY}=cycle&readonly`)).toBe('cycle');
    expect(decode('readonly')).toBeNull();
  });
});

describe('DECORATIONS table', () => {
  it('defines every state with a <=2-char badge, a colorId, and a tooltip', () => {
    for (const state of ['cycle', 'modified'] as HealthState[]) {
      const d = DECORATIONS[state];
      expect(d).toBeTruthy();
      expect(d.badge.length).toBeGreaterThan(0);
      expect(d.badge.length).toBeLessThanOrEqual(2);
      expect(d.colorId).toMatch(/\w/);
      expect(d.tooltip.length).toBeGreaterThan(0);
    }
  });
});
