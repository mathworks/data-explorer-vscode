// Copyright 2026 The MathWorks, Inc.
//
// What a paste or a drop MEANS (transfer.ts), every branch of it, with a fake document.
//
// The providers that run this policy import `vscode` and are only reachable from the
// integration suite, which is where each branch used to live — twice per provider, once per
// register, and drifting. Here the document is an adapter that records what it was asked, the
// registers are the real clipboard and drag singletons (transferRegisters.ts), and the source
// delete is a stub, so each rule is asked directly: which register is let go of and when, what
// a no-op is, what a same-document move asks the adapter for, and what each way of failing
// tells the user.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  runTransfer,
  isNoopMove,
  fileNameOf,
  sourceKeptMessage,
  sharedNameRefusal,
  TransferRefused,
  type SourceDeleteResult,
  type TransferAdapter,
  type TransferCommit,
  type TransferDeps,
  type TransferRegister,
  type TransferTarget,
} from '../src/host/transfer.js';
import { clipboardRegister, dragRegister } from '../src/host/transferRegisters.js';
import { setClipboard, getClipboard, clearClipboard, type ClipboardItem } from '../src/host/clipboard.js';
import { setDrag, getDrag, clearDrag } from '../src/host/dragState.js';

const HERE = 'file:///work/here.sldd';
const THERE = 'file:///work/my%20other.sldd';

function item(name: string, sourceSection: string, uuid = `u-${name}`): ClipboardItem {
  return {
    payload: { name, metadata: { uuid }, value: 1 },
    sourceSection,
    className: 'Simulink.Parameter',
    arrayClass: '',
    kind: 'Parameter',
    isMatlabVariable: true,
    isScalarNumeric: true,
  };
}

/** A document that records every question the policy asks it. */
function fakeAdapter(opts: {
  docUri?: string;
  /** The section a row resolves to; null for "names nothing". */
  section?: string | null;
  guard?: boolean;
  takesRemoveFirst?: boolean;
  validate?: (payloads: readonly Record<string, unknown>[]) => void;
  commit?: (plan: TransferCommit<TransferTarget>) => Promise<void> | void;
  resolveThrows?: unknown;
} = {}) {
  const log = {
    commits: [] as TransferCommit<TransferTarget>[],
    failures: [] as unknown[],
    reports: [] as string[],
    validated: 0,
  };
  const adapter: TransferAdapter<TransferTarget> = {
    docUri: opts.docUri ?? HERE,
    takesRemoveFirst: opts.takesRemoveFirst,
    guard: opts.guard === undefined ? undefined : () => opts.guard!,
    resolveTarget: () => {
      if (opts.resolveThrows) throw opts.resolveThrows;
      const section = opts.section === undefined ? 'design' : opts.section;
      return section === null ? null : { sectionName: section };
    },
    validate: (_target, payloads) => {
      log.validated++;
      opts.validate?.(payloads);
    },
    commit: (plan) => {
      log.commits.push(plan);
      return opts.commit?.(plan);
    },
    onFailure: (err) => log.failures.push(err),
    report: (message) => log.reports.push(message),
  };
  return { adapter, log };
}

/** A source delete that records its calls and answers `result` (or throws it), and a warn that records. */
function fakeDeps(result: SourceDeleteResult | Error = { removed: true }) {
  const calls: { uri: string; selectors: unknown[] }[] = [];
  const warnings: string[] = [];
  const deps: TransferDeps = {
    deleteFromSource: async (uri, selectors) => {
      calls.push({ uri, selectors });
      if (result instanceof Error) throw result;
      return result;
    },
    warn: (message) => void warnings.push(message),
  };
  return { deps, calls, warnings };
}

let broadcasts = 0;
const countBroadcast = () => void broadcasts++;
const paste = () => clipboardRegister(countBroadcast);
const drop = (mode: 'copy' | 'move') => dragRegister(mode, countBroadcast);
const ROW = { rowId: 'some-row' };

beforeEach(() => {
  clearClipboard();
  clearDrag();
  broadcasts = 0;
});

describe('an empty register', () => {
  it('a paste says the clipboard is empty, and asks the document nothing', async () => {
    const { adapter, log } = fakeAdapter();
    const out = await runTransfer(ROW, paste(), adapter, fakeDeps().deps);
    expect(out).toEqual({ kind: 'empty' });
    expect(log.reports).toEqual(['Nothing to paste — the clipboard is empty.']);
    expect(log.commits).toEqual([]);
    expect(broadcasts).toBe(0);
  });

  it('a drop says there is nothing to drop, and still ends the drag', async () => {
    setDrag(HERE, []);
    const { adapter, log } = fakeAdapter();
    const out = await runTransfer(ROW, drop('move'), adapter, fakeDeps().deps);
    expect(out).toEqual({ kind: 'empty' });
    expect(log.reports).toEqual(['Nothing to drop.']);
    expect(getDrag()).toBeNull();
    expect(broadcasts).toBe(1);
  });
});

describe('the guard', () => {
  it('stops the transfer before the register is read, and the drop still ends', async () => {
    setDrag(HERE, [item('A', 'design')]);
    const { adapter, log } = fakeAdapter({ guard: false });
    const out = await runTransfer(ROW, drop('copy'), adapter, fakeDeps().deps);
    expect(out).toEqual({ kind: 'guarded' });
    expect(log.reports).toEqual([]);
    expect(log.commits).toEqual([]);
    expect(getDrag()).toBeNull();
  });

  it('leaves a cut on the clipboard', async () => {
    setClipboard([item('A', 'design')], 'cut', HERE);
    const { adapter } = fakeAdapter({ guard: false });
    await runTransfer(ROW, paste(), adapter, fakeDeps().deps);
    expect(getClipboard()?.mode).toBe('cut');
  });
});

describe('the target is resolved before anything changes', () => {
  it('a row that names no section is reported, and the cut is left where it was', async () => {
    setClipboard([item('A', 'design')], 'cut', HERE);
    const held = getClipboard();
    const { adapter, log } = fakeAdapter({ section: null });
    const out = await runTransfer(ROW, paste(), adapter, fakeDeps().deps);
    expect(out).toEqual({ kind: 'no-target' });
    expect(log.reports).toEqual(['Could not resolve the target section.']);
    expect(log.commits).toEqual([]);
    expect(getClipboard()).toBe(held);
    expect(broadcasts).toBe(0);
  });

  it('a refusal while resolving is a message and nothing else', async () => {
    setClipboard([item('A', 'design')], 'cut', HERE);
    const { adapter, log } = fakeAdapter({ resolveThrows: new TransferRefused('No.') });
    const out = await runTransfer(ROW, paste(), adapter, fakeDeps().deps);
    expect(out).toEqual({ kind: 'refused', message: 'No.' });
    expect(log.failures).toEqual([]);
    expect(getClipboard()?.mode).toBe('cut');
  });
});

describe('the row the gesture landed on', () => {
  // A whole-file document (a MAT-file) has no row to aim at when its table is empty, and a
  // paste there arrives with `rowId: ''`, meaning "the document itself". That is the adapter's
  // to read — the policy passes the row through and never takes '' for "no row".
  it("passes '' through to the adapter, which may resolve it", async () => {
    setClipboard([item('Kp', 'design')], 'copy', THERE);
    const asked: string[] = [];
    const { adapter, log } = fakeAdapter({ section: '' });
    const resolve = adapter.resolveTarget;
    adapter.resolveTarget = (rowId) => {
      asked.push(rowId);
      return resolve(rowId);
    };
    const out = await runTransfer({ rowId: '' }, paste(), adapter, fakeDeps().deps);
    expect(asked).toEqual(['']);
    expect(out).toEqual({ kind: 'done' });
    expect(log.commits[0].target).toEqual({ sectionName: '' });
  });
});

describe('a move back into the section it came from', () => {
  it('a cut pasted there is a no-op that spends the cut', async () => {
    setClipboard([item('A', 'design'), item('B', 'design')], 'cut', HERE);
    const { adapter, log } = fakeAdapter({ section: 'design' });
    const { deps, calls } = fakeDeps();
    const out = await runTransfer(ROW, paste(), adapter, deps);
    expect(out).toEqual({ kind: 'noop' });
    expect(log.commits).toEqual([]);
    expect(log.validated).toBe(0);
    expect(calls).toEqual([]);
    expect(getClipboard()).toBeNull();
    expect(broadcasts).toBe(1);
  });

  it('a drop there is the same no-op, decided by the host as well as by the webview', async () => {
    setDrag(HERE, [item('A', 'design')]);
    const { adapter, log } = fakeAdapter({ section: 'design' });
    const out = await runTransfer(ROW, drop('move'), adapter, fakeDeps().deps);
    expect(out).toEqual({ kind: 'noop' });
    expect(log.commits).toEqual([]);
    expect(getDrag()).toBeNull();
  });

  it('a COPY pasted there is not a no-op: it duplicates', async () => {
    setClipboard([item('A', 'design')], 'copy', HERE);
    const { adapter, log } = fakeAdapter({ section: 'design' });
    const out = await runTransfer(ROW, paste(), adapter, fakeDeps().deps);
    expect(out).toEqual({ kind: 'done' });
    expect(log.commits).toHaveLength(1);
    expect(log.commits[0].removeFirst).toEqual([]);
    expect(getClipboard()?.mode, 'a copy stays for another paste').toBe('copy');
  });

  it('with an item from another section it is a real move, of every item', async () => {
    setClipboard([item('A', 'design'), item('B', 'other')], 'cut', HERE);
    const { adapter, log } = fakeAdapter({ section: 'design' });
    await runTransfer(ROW, paste(), adapter, fakeDeps().deps);
    expect(log.commits).toHaveLength(1);
    expect(log.commits[0].removeFirst.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('is the rule isNoopMove states', () => {
    const contents = { items: [item('A', ''), item('B', '')], sourceDocUri: HERE, move: true };
    expect(isNoopMove(contents, HERE, '')).toBe(true);
    expect(isNoopMove({ ...contents, move: false }, HERE, '')).toBe(false);
    expect(isNoopMove(contents, THERE, '')).toBe(false);
    expect(isNoopMove(contents, HERE, 'design')).toBe(false);
  });
});

describe('a same-document move', () => {
  it('asks for ONE edit that removes the sources first, and never deletes from a source', async () => {
    setDrag(HERE, [item('A', 'design'), item('B', 'design', 'uB')]);
    const { adapter, log } = fakeAdapter({ section: 'other' });
    const { deps, calls } = fakeDeps();
    const out = await runTransfer(ROW, drop('move'), adapter, deps);
    expect(out).toEqual({ kind: 'done' });
    expect(log.commits).toHaveLength(1);
    expect(log.commits[0].removeFirst).toEqual([
      { name: 'A', uuid: 'u-A' },
      { name: 'B', uuid: 'uB' },
    ]);
    expect(log.commits[0].payloads.map((p) => p.name)).toEqual(['A', 'B']);
    expect(calls).toEqual([]);
  });

  it('a nameless payload names nothing to remove', async () => {
    setClipboard([{ ...item('A', 'design'), payload: { value: 1 } }, item('B', 'design')], 'cut', HERE);
    const { adapter, log } = fakeAdapter({ section: 'other' });
    await runTransfer(ROW, paste(), adapter, fakeDeps().deps);
    expect(log.commits[0].removeFirst.map((s) => s.name)).toEqual(['B']);
    expect(log.commits[0].payloads).toHaveLength(2);
  });

  it('is refused, untouched, by a document that never takes removeFirst', async () => {
    setClipboard([item('A', 'design')], 'cut', HERE);
    const { adapter, log } = fakeAdapter({ section: 'other', takesRemoveFirst: false });
    const out = await runTransfer(ROW, paste(), adapter, fakeDeps().deps);
    expect(out.kind).toBe('refused');
    expect(log.commits).toEqual([]);
    expect(log.reports).toEqual(['Cannot move entries within here.sldd.']);
    expect(getClipboard()?.mode).toBe('cut');
  });

  it('spends the cut once it has landed', async () => {
    setClipboard([item('A', 'design')], 'cut', HERE);
    const { adapter } = fakeAdapter({ section: 'other' });
    await runTransfer(ROW, paste(), adapter, fakeDeps().deps);
    expect(getClipboard()).toBeNull();
    expect(broadcasts).toBe(1);
  });
});

describe('a cross-document move', () => {
  it("hands the source's deleter each item's origin token with its selector, where the item has one", async () => {
    // A MAT-file's variable has a name and no uuid; its document gives each one it lets go of a
    // token, which comes back to its own deleter and to nothing else.
    const token = {};
    setClipboard([{ ...item('x', ''), payload: { name: 'x', metadata: null, value: 1 }, origin: token }, item('B', 'design')], 'cut', THERE);
    const { deps, calls } = fakeDeps();
    await runTransfer(ROW, paste(), fakeAdapter().adapter, deps);
    expect(calls).toHaveLength(1);
    expect(calls[0].selectors).toEqual([{ name: 'x', origin: token }, { name: 'B', uuid: 'u-B' }]);
    expect((calls[0].selectors[0] as any).origin, 'the very token, not a copy').toBe(token);
  });

  it('pastes here, THEN deletes from the source by selector', async () => {
    setClipboard([item('A', 'design'), item('B', 'arch')], 'cut', THERE);
    const order: string[] = [];
    const { adapter, log } = fakeAdapter({ commit: () => void order.push('commit') });
    const { deps, calls } = fakeDeps();
    const wrapped: TransferDeps = {
      deleteFromSource: (uri, s) => {
        order.push('delete');
        return deps.deleteFromSource(uri, s);
      },
    };
    const out = await runTransfer(ROW, paste(), adapter, wrapped);
    expect(out).toEqual({ kind: 'done' });
    expect(order).toEqual(['commit', 'delete']);
    expect(log.commits[0].removeFirst, 'the source is not this document').toEqual([]);
    expect(calls).toEqual([{ uri: THERE, selectors: [{ name: 'A', uuid: 'u-A' }, { name: 'B', uuid: 'u-B' }] }]);
    expect(getClipboard()).toBeNull();
  });

  it('clears the cut BEFORE the source delete is awaited, and tells the tables after it', async () => {
    setClipboard([item('A', 'design')], 'cut', THERE);
    let duringDelete: unknown = 'not reached';
    let broadcastsDuringDelete = -1;
    const { adapter } = fakeAdapter();
    await runTransfer(ROW, paste(), adapter, {
      deleteFromSource: async () => {
        duringDelete = getClipboard();
        broadcastsDuringDelete = broadcasts;
        return { removed: true };
      },
    });
    expect(duringDelete, 'a second Paste meanwhile finds nothing to paste').toBeNull();
    expect(broadcastsDuringDelete, 'the source row is not un-dimmed before it goes').toBe(0);
    expect(broadcasts).toBe(1);
  });

  it('a drop in move mode deletes from the source too', async () => {
    setDrag(THERE, [item('A', 'design')]);
    const { adapter } = fakeAdapter();
    const { deps, calls } = fakeDeps();
    await runTransfer(ROW, drop('move'), adapter, deps);
    expect(calls.map((c) => c.uri)).toEqual([THERE]);
    expect(getDrag()).toBeNull();
  });
});

describe('a copy', () => {
  it('never deletes, from a paste or a drop, and keeps the clipboard', async () => {
    const { deps, calls } = fakeDeps();
    setClipboard([item('A', 'design')], 'copy', THERE);
    await runTransfer(ROW, paste(), fakeAdapter().adapter, deps);
    setDrag(THERE, [item('A', 'design')]);
    await runTransfer(ROW, drop('copy'), fakeAdapter().adapter, deps);
    expect(calls).toEqual([]);
    expect(getClipboard()?.mode).toBe('copy');
    expect(broadcasts, 'only the drop end is broadcast').toBe(1);
  });
});

describe('a refusal that changed nothing', () => {
  for (const where of ['validate', 'commit'] as const) {
    it(`from ${where}: a message, no repair, no delete, and the cut is kept`, async () => {
      setClipboard([item('A', 'design')], 'cut', THERE);
      const held = getClipboard();
      const refuse = () => {
        throw new TransferRefused('Cannot paste "A" into "here.sldd": no. Nothing was pasted.');
      };
      const { adapter, log } = fakeAdapter(where === 'validate' ? { validate: refuse } : { commit: refuse });
      const { deps, calls } = fakeDeps();
      const out = await runTransfer(ROW, paste(), adapter, deps);
      expect(out.kind).toBe('refused');
      expect(log.reports).toEqual(['Cannot paste "A" into "here.sldd": no. Nothing was pasted.']);
      expect(log.failures).toEqual([]);
      expect(calls).toEqual([]);
      expect(getClipboard()).toBe(held);
      expect(broadcasts).toBe(0);
    });
  }

  it('validate is asked with the payloads, after the target is known', async () => {
    setClipboard([item('A', 'design'), item('B', 'design')], 'copy', THERE);
    const seen: string[] = [];
    const { adapter } = fakeAdapter({ validate: (p) => void seen.push(...p.map((x) => String(x.name))) });
    await runTransfer(ROW, paste(), adapter, fakeDeps().deps);
    expect(seen).toEqual(['A', 'B']);
  });
});

describe('any other throw before the edit landed', () => {
  it('is the adapter’s to repair; the cut is kept and nothing is deleted', async () => {
    setClipboard([item('A', 'design')], 'cut', THERE);
    const boom = new Error('the document rejected the edit');
    const { adapter, log } = fakeAdapter({
      commit: async () => {
        throw boom;
      },
    });
    const { deps, calls } = fakeDeps();
    const out = await runTransfer(ROW, paste(), adapter, deps);
    expect(out).toEqual({ kind: 'failed', error: boom });
    expect(log.failures).toEqual([boom]);
    expect(log.reports, 'the adapter reports its own failure').toEqual([]);
    expect(calls).toEqual([]);
    expect(getClipboard()?.mode).toBe('cut');
  });

  it('ends a drop anyway', async () => {
    setDrag(THERE, [item('A', 'design')]);
    const { adapter, log } = fakeAdapter({
      commit: () => {
        throw new Error('no');
      },
    });
    await runTransfer(ROW, drop('move'), adapter, fakeDeps().deps);
    expect(log.failures).toHaveLength(1);
    expect(getDrag()).toBeNull();
    expect(broadcasts).toBe(1);
  });
});

describe('a source delete that fails AFTER the paste landed', () => {
  const cases: [string, SourceDeleteResult | Error, string][] = [
    [
      'reports it did not remove',
      { removed: false, reason: 'its table is no longer open' },
      'Pasted here, but the original in my other.sldd could not be removed: its table is no longer open. Remove it there by hand.',
    ],
    [
      'throws',
      new Error('applyEdit failed.'),
      'Pasted here, but the original in my other.sldd could not be removed: applyEdit failed. Remove it there by hand.',
    ],
    [
      // The original is no longer there (deleted, its name given to another entry): nothing is
      // asked of the user, since removing what holds the name now would lose that one.
      'answers its original is gone',
      { removed: false, gone: true, reason: 'the "A" it holds now is another variable, which was left as it is' },
      'Pasted here; the original in my other.sldd is no longer there to remove: the "A" it holds now is another variable, which was left as it is.',
    ],
  ];
  for (const [name, result, message] of cases) {
    it(`${name}: says exactly that, repairs nothing, and the cut is spent`, async () => {
      setClipboard([item('A', 'design')], 'cut', THERE);
      const { adapter, log } = fakeAdapter();
      const { deps, warnings } = fakeDeps(result);
      const out = await runTransfer(ROW, paste(), adapter, deps);
      expect(out).toEqual({ kind: 'done', sourceKept: message });
      expect(log.reports).toEqual([message]);
      expect(warnings, 'and where it stays until dismissed, not only in a banner a repaint clears').toEqual([message]);
      expect(log.failures).toEqual([]);
      expect(log.commits).toHaveLength(1);
      expect(getClipboard()).toBeNull();
      expect(broadcasts).toBe(1);
    });
  }

  it('a drop that left its original warns too', async () => {
    setDrag(THERE, [item('A', 'design')]);
    const { deps, warnings } = fakeDeps({ removed: false, reason: 'its table is no longer open' });
    await runTransfer(ROW, drop('move'), fakeAdapter().adapter, deps);
    expect(warnings).toEqual([
      'Moved here, but the original in my other.sldd could not be removed: its table is no longer open. Remove it there by hand.',
    ]);
  });

  it('nothing else warns: not a landed move, a copy, a refusal or a failure', async () => {
    const { deps, warnings } = fakeDeps();
    setClipboard([item('A', 'design')], 'cut', THERE);
    await runTransfer(ROW, paste(), fakeAdapter().adapter, deps);
    setClipboard([item('A', 'design')], 'copy', THERE);
    await runTransfer(ROW, paste(), fakeAdapter().adapter, deps);
    setClipboard([item('A', 'design')], 'cut', THERE);
    await runTransfer(ROW, paste(), fakeAdapter({ validate: () => { throw new TransferRefused('No.'); } }).adapter, deps);
    await runTransfer(ROW, paste(), fakeAdapter({ commit: () => { throw new Error('boom'); } }).adapter, deps);
    expect(warnings).toEqual([]);
  });

  it('a deps without warn still reports in the view', async () => {
    setClipboard([item('A', 'design')], 'cut', THERE);
    const { adapter, log } = fakeAdapter();
    const out = await runTransfer(ROW, paste(), adapter, {
      deleteFromSource: async () => ({ removed: false, reason: 'no' }),
    });
    expect(out.kind).toBe('done');
    expect(log.reports).toHaveLength(1);
  });

  it('a drop says Moved, and counts the originals', () => {
    expect(sourceKeptMessage(false, THERE, 2, 'it has invalid JSON')).toBe(
      'Moved here, but the originals in my other.sldd could not be removed: it has invalid JSON. Remove them there by hand.',
    );
  });

  it('names the file by its decoded name', () => {
    expect(fileNameOf('file:///a/b/my%20params.sldd')).toBe('my params.sldd');
    expect(fileNameOf('file:///a/b/odd%ZZ.sldd')).toBe('odd%ZZ.sldd');
  });
});

describe('a register is let go of only while it holds what this transfer read', () => {
  it('a copy made while the paste was awaiting its write survives the paste', async () => {
    setClipboard([item('A', 'design')], 'cut', THERE);
    const newer = [item('Z', 'other')];
    const { adapter } = fakeAdapter({
      commit: async () => {
        setClipboard(newer, 'copy', HERE);
      },
    });
    await runTransfer(ROW, paste(), adapter, fakeDeps().deps);
    expect(getClipboard()?.items).toBe(newer);
  });

  it('a drag started while the drop was finishing survives the drop', async () => {
    setDrag(THERE, [item('A', 'design')]);
    const register = drop('move');
    setDrag(HERE, [item('Z', 'other')]);
    const newer = getDrag();
    // The drop reads what was dragged when its message arrived, not the newer drag.
    const { adapter, log } = fakeAdapter();
    await runTransfer(ROW, register, adapter, fakeDeps().deps);
    expect(log.commits[0].payloads.map((p) => p.name)).toEqual(['A']);
    expect(getDrag()).toBe(newer);
  });

  it('the drop register is captured when the drop arrives, not when it runs', async () => {
    setDrag(THERE, [item('A', 'design')]);
    const register = drop('copy');
    clearDrag(); // the source's dragEnd, arriving while the drop waited in a queue
    const { adapter, log } = fakeAdapter();
    const out = await runTransfer(ROW, register, adapter, fakeDeps().deps);
    expect(out).toEqual({ kind: 'done' });
    expect(log.commits).toHaveLength(1);
  });
});

describe('labels', () => {
  it('a paste is Paste, a drop is Move or Copy', async () => {
    setClipboard([item('A', 'design')], 'cut', THERE);
    const p = fakeAdapter();
    await runTransfer(ROW, paste(), p.adapter, fakeDeps().deps);
    setDrag(THERE, [item('A', 'design')]);
    const m = fakeAdapter();
    await runTransfer(ROW, drop('move'), m.adapter, fakeDeps().deps);
    setDrag(THERE, [item('A', 'design')]);
    const c = fakeAdapter();
    await runTransfer(ROW, drop('copy'), c.adapter, fakeDeps().deps);
    expect([p, m, c].map((x) => x.log.commits[0].label)).toEqual(['Paste', 'Move', 'Copy']);
  });
});

describe('a MAT-file shaped document', () => {
  // One section named '', items taken from it carry sourceSection ''. A same-file move is then
  // always the no-op, so such a document can decline removeFirst outright.
  it('a same-file cut is a no-op, a same-file copy duplicates, a move in from elsewhere deletes there', async () => {
    const mat = (o = {}) => fakeAdapter({ docUri: HERE, section: '', takesRemoveFirst: false, ...o });
    setClipboard([item('x', ''), item('y', '')], 'cut', HERE);
    const cut = mat();
    expect((await runTransfer(ROW, paste(), cut.adapter, fakeDeps().deps)).kind).toBe('noop');

    setClipboard([item('x', '')], 'copy', HERE);
    const copy = mat();
    expect((await runTransfer(ROW, paste(), copy.adapter, fakeDeps().deps)).kind).toBe('done');
    expect(copy.log.commits[0].removeFirst).toEqual([]);

    setDrag(THERE, [item('Kp', 'design')]);
    const moved = mat();
    const { deps, calls } = fakeDeps();
    expect((await runTransfer(ROW, drop('move'), moved.adapter, deps)).kind).toBe('done');
    expect(calls.map((c) => c.uri)).toEqual([THERE]);
  });
});

// A move takes its originals out by selector, and an entry whose selector its document does
// not tell apart (a MAT-file variable of a name the file holds twice) carries `sharedName`. A
// move of one is refused before anything changes; a copy of one, and a same-section move of
// one (the no-op), are what they always were.
describe('an entry whose name its document holds twice', () => {
  const MAT = 'file:///work/gains.mat';
  const shared = (name: string): ClipboardItem => ({ ...item(name, ''), payload: { name, metadata: null, value: 1 }, sharedName: true });

  it('is not moved by a drop, and nothing is asked of either document', async () => {
    setDrag(MAT, [item('A', ''), shared('x')]);
    const { adapter, log } = fakeAdapter({ docUri: HERE });
    const { deps, calls } = fakeDeps();
    const out = await runTransfer(ROW, drop('move'), adapter, deps);
    const message = 'Cannot move "x": gains.mat holds more than one "x", and a move takes its original out by name. Copy it instead.';
    expect(out).toEqual({ kind: 'refused', message });
    expect(log.reports).toEqual([message]);
    expect(log.commits).toEqual([]);
    expect(log.validated).toBe(0);
    expect(calls).toEqual([]);
    expect(getDrag(), 'a drop ends the drag whatever became of it').toBeNull();
  });

  it('is pasted by a drop in copy mode, and by a paste of a copy', async () => {
    setDrag(MAT, [shared('x')]);
    const dropped = fakeAdapter({ docUri: HERE });
    expect((await runTransfer(ROW, drop('copy'), dropped.adapter, fakeDeps().deps)).kind).toBe('done');
    expect(dropped.log.commits.map((c) => c.payloads.map((p) => p.name))).toEqual([['x']]);

    setClipboard([shared('x')], 'copy', MAT);
    const pasted = fakeAdapter({ docUri: HERE });
    expect((await runTransfer(ROW, paste(), pasted.adapter, fakeDeps().deps)).kind).toBe('done');
    expect(getClipboard(), 'a copy stays on the clipboard').not.toBeNull();
  });

  it('moved back into the section it came from is the no-op, not a refusal', async () => {
    setDrag(MAT, [shared('x')]);
    const { adapter, log } = fakeAdapter({ docUri: MAT, section: '' });
    expect(await runTransfer(ROW, drop('move'), adapter, fakeDeps().deps)).toEqual({ kind: 'noop' });
    expect(log.reports).toEqual([]);
  });

  it('on the clipboard as a cut (an older host let one through), keeps the cut', async () => {
    setClipboard([shared('x')], 'cut', MAT);
    const { adapter, log } = fakeAdapter({ docUri: HERE });
    const out = await runTransfer(ROW, paste(), adapter, fakeDeps().deps);
    expect(out.kind).toBe('refused');
    expect(log.reports[0]).toMatch(/^Cannot cut "x": gains\.mat holds more than one "x"/);
    expect(getClipboard()?.mode).toBe('cut');
  });

  it('says which file, decoded, or that it was its own when no document is named', () => {
    expect(sharedNameRefusal('cut', 'k', 'file:///w/my%20gains.mat')).toBe(
      'Cannot cut "k": my gains.mat holds more than one "k", and a move takes its original out by name. Copy it instead.',
    );
    expect(sharedNameRefusal('move', 'k', undefined)).toMatch(/^Cannot move "k": its file holds more than one "k"/);
  });
});

// The fake register is enough for the policy; this one pins that the policy never reads a
// register twice, which is what makes "the same object it read" meaningful.
describe('the register is read once', () => {
  it('per transfer', async () => {
    let reads = 0;
    const register: TransferRegister = {
      kind: 'clipboard',
      read: () => {
        reads++;
        return { items: [item('A', 'design')], sourceDocUri: THERE, move: true };
      },
      clear: () => {},
      broadcast: () => {},
    };
    await runTransfer(ROW, register, fakeAdapter().adapter, fakeDeps().deps);
    expect(reads).toBe(1);
  });
});
