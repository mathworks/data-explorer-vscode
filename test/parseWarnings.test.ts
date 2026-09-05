// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import type { ParseWarning } from 'data-explorer-core';
import {
  refuseIfUnreadable,
  sourceWarnings,
  warningBanner,
  MAX_BANNER_DETAILS,
} from '../src/host/parseWarnings.js';

const part = (message: string, name?: string): ParseWarning => ({
  code: 'part-unreadable',
  message,
  ...(name ? { part: name } : {}),
});

// The host's half of core's diagnostics channel. Core decides WHAT was lost; this
// module decides what this extension does about it, and it is one module precisely
// so the three table views cannot answer that three ways.
describe('refuseIfUnreadable', () => {
  it('throws for source-unreadable, carrying core’s own sentence', () => {
    // The message matters as much as the throw: providers render it as
    // "Failed to parse <file>: <message>", and core's sentence is the only place
    // that says WHAT could not be read.
    expect(() =>
      refuseIfUnreadable([
        { code: 'source-unreadable', message: 'The project store could not be read (bad zip), so this project reads as empty.' },
      ]),
    ).toThrow(/could not be read \(bad zip\)/);
  });

  it('does not throw for source-empty', () => {
    // The line core drew, mirrored here: nothing was found to read, as opposed to
    // something found and refused. Core's sentence over an empty table says more
    // than "Failed to parse" would, so this opens and warns.
    expect(() =>
      refuseIfUnreadable([{ code: 'source-empty', message: 'reads as empty' }]),
    ).not.toThrow();
  });

  it('does not throw for part-unreadable, however many there are', () => {
    // Refusing a whole `.mat` because one variable of forty did not decode would
    // lose the thirty-nine that did — strictly more than the warning reports.
    expect(() => refuseIfUnreadable([part('a'), part('b'), part('c')])).not.toThrow();
  });

  it('finds the fatal warning wherever it sits in the list', () => {
    // The `.sldd` path threads ONE array through two readers, so a source-level
    // warning can arrive after several part-level ones. A check that looked only at
    // the first would pass every test above and still save an empty dictionary.
    expect(() =>
      refuseIfUnreadable([part('a'), { code: 'source-unreadable', message: 'nothing was read' }, part('b')]),
    ).toThrow(/nothing was read/);
  });

  it('accepts no warnings and an absent list alike', () => {
    expect(() => refuseIfUnreadable([])).not.toThrow();
    expect(() => refuseIfUnreadable(undefined)).not.toThrow();
  });
});

describe('sourceWarnings', () => {
  it('answers an empty list for a node with no warnings field', () => {
    // ISourceNode.warnings is ABSENT on a clean read, never `[]` — core's choice, so
    // a host cannot read silence from a channel-less reader as proof of wholeness.
    // Every consumer therefore meets a missing field, and this is where that is
    // handled once.
    expect(sourceWarnings({ name: 'clean' })).toEqual([]);
  });

  it('answers an empty list for a null or undefined node', () => {
    expect(sourceWarnings(null)).toEqual([]);
    expect(sourceWarnings(undefined)).toEqual([]);
  });

  it('passes the warnings through when the node carries them', () => {
    const warnings = [part('lost a part')];
    expect(sourceWarnings({ warnings })).toBe(warnings);
  });

  it('answers an empty list when the field is not an array', () => {
    // Defensive rather than reachable: the node is `any` all the way from core
    // through the row builders, so nothing type-checks this field at the boundary.
    expect(sourceWarnings({ warnings: 'oops' })).toEqual([]);
  });
});

describe('warningBanner', () => {
  it('is undefined for a clean read, so a clean file shows no banner', () => {
    expect(warningBanner(undefined)).toBeUndefined();
    expect(warningBanner([])).toBeUndefined();
  });

  it('makes a source-level message the headline, verbatim', () => {
    const banner = warningBanner([
      { code: 'source-empty', message: '"d.sldd" holds no dictionary content part, so it reads as empty.' },
    ])!;
    expect(banner.headline).toBe('"d.sldd" holds no dictionary content part, so it reads as empty.');
    // It is the headline INSTEAD of a detail, not as well as one — the same sentence
    // twice in one banner reads like two problems.
    expect(banner.details).toEqual([]);
  });

  it('promotes the source-level warning over the part-level ones', () => {
    // "nothing was found to read" is the larger fact than "this piece was not read",
    // and the `.sldd` path can produce both from one file: the zip reader reports its
    // parts, then SlddNode reports the missing content part into the same array.
    const banner = warningBanner([
      part('Skipped an unreadable project entry.', 'resources/project/a.xml'),
      { code: 'source-empty', message: 'No readable project entries were found.' },
    ])!;
    expect(banner.headline).toBe('No readable project entries were found.');
    expect(banner.details).toEqual(['Skipped an unreadable project entry.']);
  });

  it('counts the parts when nothing source-level was reported', () => {
    expect(warningBanner([part('a')])!.headline).toMatch(/^One part of this file/);
    expect(warningBanner([part('a'), part('b')])!.headline).toMatch(/^2 parts of this file/);
  });

  it('deduplicates identical warnings so one loss reads as one line', () => {
    // A record-chain walk can reach the same undecoded variable through two paths.
    const banner = warningBanner([part('same message'), part('same message')])!;
    expect(banner.details).toEqual(['same message']);
    expect(banner.headline).toMatch(/^One part/);
  });

  it('keeps two warnings that share a message but name different parts', () => {
    // The counterpart to dedup, and the reason `part` is in the key: a `.mat` whose
    // records both failed the same way lost TWO variables, and collapsing them to one
    // line would understate it.
    const banner = warningBanner([
      part('Skipped a variable that could not be decoded.', 'alpha'),
      part('Skipped a variable that could not be decoded.', 'beta'),
    ])!;
    expect(banner.headline).toMatch(/^2 parts/);
    expect(banner.details).toHaveLength(2);
  });

  it('caps the details and says how many it withheld', () => {
    const many = Array.from({ length: MAX_BANNER_DETAILS + 3 }, (_, i) => part(`lost ${i}`, `p${i}`));
    const banner = warningBanner(many)!;
    expect(banner.details).toHaveLength(MAX_BANNER_DETAILS + 1);
    expect(banner.details.at(-1)).toBe('…and 3 more.');
    // The headline's count is never capped, so the shortened list cannot understate
    // the loss: the total is still on screen.
    expect(banner.headline).toContain(String(MAX_BANNER_DETAILS + 3));
  });
});
