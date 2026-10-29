// Copyright 2026 The MathWorks, Inc.
// When an open tab reposts its Usage column because a model appeared or went away.
//
// The column names, for each variable a data file defines, the blocks that use it — and only a
// model can add or remove such a block, so a model file created or deleted in the workspace is
// the event that can leave an open dictionary's column wrong. The fix reposts every open data
// tab when that happens (usageRepost.ts), and the two things that make that affordable are what
// this file pins: one repost per tab per BURST, however many files the burst holds (a branch
// switch can create or delete hundreds of models at once, and each repost rebuilds the tab's
// rows and its usage graph), and no repost for a file that is not a model.
//
// Over vitest's fake timers rather than a timer stub, so that the default timers the extension
// actually runs on are the ones under test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createUsageRepostBus,
  repostsUsageOn,
  USAGE_REPOST_DEBOUNCE_MS,
  USAGE_REPOST_MAX_WAITS,
} from '../src/host/usageRepost.js';

const DELAY = USAGE_REPOST_DEBOUNCE_MS;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the repost bus', () => {
  it('turns a burst of changes into one repost per tab, after the window', () => {
    const bus = createUsageRepostBus(DELAY);
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe(a);
    bus.subscribe(b);

    // Fifty creates and deletes, each inside the window the one before opened: what a branch
    // switch over a folder of models looks like to the watcher.
    for (let i = 0; i < 50; i++) {
      bus.schedule();
      vi.advanceTimersByTime(DELAY / 10);
    }
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();

    // Trailing: the window is measured from the LAST change, so a tab never reposts in the
    // middle of a burst and then again at its end.
    vi.advanceTimersByTime(DELAY - DELAY / 10 - 1);
    expect(a).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(DELAY * 10);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('reposts again for a change after the burst has fired', () => {
    const bus = createUsageRepostBus(DELAY);
    const a = vi.fn();
    bus.subscribe(a);
    bus.schedule();
    vi.advanceTimersByTime(DELAY);
    expect(a).toHaveBeenCalledTimes(1);

    bus.schedule();
    vi.advanceTimersByTime(DELAY);
    expect(a).toHaveBeenCalledTimes(2);
  });

  it('does nothing when nothing changed', () => {
    const bus = createUsageRepostBus(DELAY);
    const a = vi.fn();
    bus.subscribe(a);
    vi.advanceTimersByTime(DELAY * 10);
    expect(a).not.toHaveBeenCalled();
  });

  it('never reposts a closed tab', () => {
    const bus = createUsageRepostBus(DELAY);
    const open = vi.fn();
    const closed = vi.fn();
    bus.subscribe(open);
    const sub = bus.subscribe(closed);
    bus.schedule();
    sub.dispose();
    vi.advanceTimersByTime(DELAY);
    expect(closed).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);

    // Disposing twice is not an error: VS Code can dispose a panel's subscriptions in any order.
    sub.dispose();
    bus.schedule();
    vi.advanceTimersByTime(DELAY);
    expect(closed).not.toHaveBeenCalled();
  });

  it('does not owe a repost to a tab that opened after the change', () => {
    // A tab resolved inside the window builds its rows from the graph as it is by then, which
    // the change already dropped — so its own first post is the fresh one.
    const bus = createUsageRepostBus(DELAY);
    const before = vi.fn();
    const after = vi.fn();
    bus.subscribe(before);
    bus.schedule();
    bus.subscribe(after);
    vi.advanceTimersByTime(DELAY);
    expect(before).toHaveBeenCalledTimes(1);
    expect(after).not.toHaveBeenCalled();
  });

  it('cancels a pending repost when it is disposed, and ignores changes afterwards', () => {
    const bus = createUsageRepostBus(DELAY);
    const a = vi.fn();
    bus.subscribe(a);
    bus.schedule();
    bus.dispose();
    vi.advanceTimersByTime(DELAY * 10);
    expect(a).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    bus.schedule();
    vi.advanceTimersByTime(DELAY * 10);
    expect(a).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps reposting the other tabs when one of them throws', () => {
    const bus = createUsageRepostBus(DELAY);
    const after = vi.fn();
    bus.subscribe(() => {
      throw new Error('this tab could not repost');
    });
    bus.subscribe(after);
    bus.schedule();
    expect(() => vi.advanceTimersByTime(DELAY)).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
  });
});

describe('a tab with a write in flight', () => {
  // The JSON dictionary paints an edit before it writes it, and the write's own change event is
  // then recognised and skipped. A full repost landing between the two would re-read the text
  // from before the write and put the edit back off screen, so a tab can say it is busy, and is
  // reposted when it is not.
  it('is reposted once it is free, and not while it is busy', () => {
    const bus = createUsageRepostBus(DELAY);
    let busy = true;
    const editing = vi.fn();
    const idle = vi.fn();
    bus.subscribe(editing, () => busy);
    bus.subscribe(idle);
    bus.schedule();

    vi.advanceTimersByTime(DELAY);
    expect(idle).toHaveBeenCalledTimes(1);
    expect(editing).not.toHaveBeenCalled();

    busy = false;
    vi.advanceTimersByTime(DELAY);
    expect(editing).toHaveBeenCalledTimes(1);
    expect(idle).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(DELAY * 10);
    expect(editing).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is reposted anyway once it has waited the bound', () => {
    // A write whose change event never arrives leaves the provider's flag set until the next
    // change, so a tab can look busy for ever. Waiting without a bound would leave its column
    // stale for as long; the bound costs, at worst, the race the wait exists for.
    const bus = createUsageRepostBus(DELAY);
    const stuck = vi.fn();
    bus.subscribe(stuck, () => true);
    bus.schedule();

    vi.advanceTimersByTime(DELAY * (USAGE_REPOST_MAX_WAITS + 1) - 1);
    expect(stuck).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(stuck).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(DELAY * 10);
    expect(stuck).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is owed one repost, not one per change it waited through', () => {
    const bus = createUsageRepostBus(DELAY);
    let busy = true;
    const editing = vi.fn();
    bus.subscribe(editing, () => busy);
    bus.schedule();
    vi.advanceTimersByTime(DELAY);
    bus.schedule();
    vi.advanceTimersByTime(DELAY / 2);
    busy = false;
    vi.advanceTimersByTime(DELAY * 10);
    expect(editing).toHaveBeenCalledTimes(1);
  });

  it('is not waited for once it has closed', () => {
    const bus = createUsageRepostBus(DELAY);
    const editing = vi.fn();
    const sub = bus.subscribe(editing, () => true);
    bus.schedule();
    vi.advanceTimersByTime(DELAY);
    sub.dispose();
    vi.advanceTimersByTime(DELAY * (USAGE_REPOST_MAX_WAITS + 2));
    expect(editing).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('which files repost', () => {
  // Only a model can originate a usage edge (core's `usageScope`), so only a model appearing or going
  // away can change what an open data file's Usage column says. Everything else in a burst is
  // free — which is most of a branch switch.
  it.each([
    ['/ws/a.slx', true],
    ['/ws/sub/b.mdl', true],
    ['/ws/Upper.SLX', true],
    ['C:\\ws\\win.MDL', true],
    ['/ws/data.sldd', false],
    ['/ws/data.mat', false],
    ['/ws/proj.prj', false],
    ['/ws/matlab.toml', false],
    ['/ws/a.slx.bak', false],
    ['/ws/notes.slx.d/readme', false],
  ])('%s -> %s', (path, expected) => {
    expect(repostsUsageOn(path)).toBe(expected);
  });
});
