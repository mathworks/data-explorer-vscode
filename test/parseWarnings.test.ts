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

// Two siblings with one name (F1-50). Core's session warns at open, with the code
// `duplicate-id`, because it refuses to edit or delete either of them by id. Nothing was
// lost: both are read and both are on screen. So the banner must not count them as parts
// that could not be read, and the file must still open.
describe('warningBanner and duplicate-id', () => {
  const SHARED = 'Some items in this file share a name, so they cannot be edited or deleted here.';
  const twins = (part: string, where = 'Design Data'): ParseWarning => ({
    code: 'duplicate-id',
    message:
      `Two entries in ${where} are named '${part}'. ` +
      'Neither can be edited or deleted until the file gives one of them another name.',
    part,
  });

  it('has a headline of its own when the only warnings are shared names, and core’s messages below it', () => {
    const banner = warningBanner([twins('K'), twins('S')])!;
    expect(banner.headline).toBe(SHARED);
    expect(banner.details).toEqual([twins('K').message, twins('S').message]);
    // And the file opens: a shared name is never a reason to refuse it.
    expect(() => refuseIfUnreadable([twins('K')])).not.toThrow();
  });

  it('counts only the parts that could not be read when both kinds are present', () => {
    const banner = warningBanner([part('Skipped a part.', 'data/chunk1.xml'), twins('K'), twins('S')])!;
    expect(banner.headline).toBe('One part of this file could not be read, so what you see below is incomplete.');
    // Every message is still listed: the shared names are worth saying, just not as a loss.
    expect(banner.details).toEqual(['Skipped a part.', twins('K').message, twins('S').message]);
  });

  it('dedupes a repeated shared-name warning, and keeps one name shared in two sections apart', () => {
    // One group reported twice is one line. One name doubled in Design Data and again in
    // Other Data is two groups: `part` is the same and the message says where.
    const banner = warningBanner([twins('K'), twins('K'), twins('K', 'Other Data')])!;
    expect(banner.headline).toBe(SHARED);
    expect(banner.details).toEqual([twins('K').message, twins('K', 'Other Data').message]);
  });
});

// A `.mat` file past the node ceiling (core #142). Core builds its tree up to a ceiling and
// adds ONE warning, coded `part-not-expanded`, naming the first value it left without rows
// and how many others there are. Nothing was lost: the file was read in full, those values
// show their summary or literal, and they copy whole. So the banner must not count it as a
// part that could not be read, whether it is alone or beside real losses.
describe('warningBanner and part-not-expanded', () => {
  const NOT_EXPANDED = 'This file was read in full, but some values are shown without the rows under them.';
  // Core's own message, in the shape MatNode.fromParsed writes it.
  const notExpanded: ParseWarning = {
    code: 'part-not-expanded',
    message:
      '"song{3}.events" and 36 other values are shown without their contents: ' +
      'this file holds more than 500,000 values to show. Copying one copies it whole.',
    part: 'song{3}.events',
  };

  it('has a headline of its own when it is the only warning, and core’s message below it', () => {
    const banner = warningBanner([notExpanded])!;
    expect(banner.headline).toBe(NOT_EXPANDED);
    expect(banner.headline).not.toMatch(/could not be read|incomplete/);
    expect(banner.details).toEqual([notExpanded.message]);
    // And the file opens: a tree built short of the whole file is never a reason to refuse it.
    expect(() => refuseIfUnreadable([notExpanded])).not.toThrow();
  });

  it('is not counted as a lost part when a part could not be read', () => {
    const banner = warningBanner([part('Skipped a variable that could not be decoded.', 'alpha'), notExpanded])!;
    expect(banner.headline).toBe('One part of this file could not be read, so what you see below is incomplete.');
    // Still listed, below the loss: it explains rows the user would otherwise take for lost.
    expect(banner.details).toEqual(['Skipped a variable that could not be decoded.', notExpanded.message]);
  });

  it('stays on screen when the list of losses is capped, and is not counted among the withheld', () => {
    // Core adds it after the reader's warnings, so it arrives last: the place a cap cuts.
    const losses = Array.from({ length: MAX_BANNER_DETAILS + 3 }, (_, i) => part(`lost ${i}`, `p${i}`));
    const banner = warningBanner([...losses, notExpanded])!;
    expect(banner.headline).toBe(
      `${MAX_BANNER_DETAILS + 3} parts of this file could not be read, so what you see below is incomplete.`,
    );
    expect(banner.details).toEqual([
      ...losses.slice(0, MAX_BANNER_DETAILS).map((w) => w.message),
      '…and 3 more.',
      notExpanded.message,
    ]);
  });

  it('beside shared names alone, counts nothing as lost', () => {
    const twins: ParseWarning = {
      code: 'duplicate-id',
      message: "Two entries in Design Data are named 'K'. Neither can be edited or deleted until the file gives one of them another name.",
      part: 'K',
    };
    const banner = warningBanner([notExpanded, twins])!;
    // The shared-name headline stays, because it is the one that says what cannot be done here.
    expect(banner.headline).toBe('Some items in this file share a name, so they cannot be edited or deleted here.');
    expect(banner.details).toEqual([twins.message, notExpanded.message]);
  });
});
