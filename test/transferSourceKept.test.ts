// Copyright 2026 The MathWorks, Inc.
//
// The one message a move that landed but left its original behind gives (transfer.ts), for the
// ways a source delete can fail that test/transfer.test.ts beside this does not: a cut that
// names no source file, a deleter that throws something other than an Error, and one that says
// it did not remove without saying why. Each must still land the paste, spend the cut, repair
// nothing, and say ONE sentence that names what is left to do.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  runTransfer,
  fileNameOf,
  sourceKeptMessage,
  type SourceDeleteResult,
  type TransferAdapter,
  type TransferCommit,
  type TransferDeps,
  type TransferTarget,
} from '../src/host/transfer.js';
import { clipboardRegister, dragRegister } from '../src/host/transferRegisters.js';
import { setClipboard, getClipboard, clearClipboard, type ClipboardItem } from '../src/host/clipboard.js';
import { setDrag, getDrag, clearDrag } from '../src/host/dragState.js';

const HERE = 'file:///work/here.sldd';
const THERE = 'file:///work/there.sldd';
const ROW = { rowId: 'some-row' };

function item(name: string): ClipboardItem {
  return {
    payload: { name, metadata: { uuid: `u-${name}` }, value: 1 },
    sourceSection: 'design',
    className: 'Simulink.Parameter',
    arrayClass: '',
    kind: 'Parameter',
    isMatlabVariable: true,
    isScalarNumeric: true,
  };
}

function fakeAdapter() {
  const log = { commits: [] as TransferCommit<TransferTarget>[], failures: [] as unknown[], reports: [] as string[] };
  const adapter: TransferAdapter<TransferTarget> = {
    docUri: HERE,
    resolveTarget: () => ({ sectionName: 'design' }),
    commit: (plan) => void log.commits.push(plan),
    onFailure: (err) => void log.failures.push(err),
    report: (message) => void log.reports.push(message),
  };
  return { adapter, log };
}

function fakeDeps(answer: () => Promise<SourceDeleteResult>) {
  const calls: string[] = [];
  const warnings: string[] = [];
  const deps: TransferDeps = {
    deleteFromSource: async (uri) => {
      calls.push(uri);
      return answer();
    },
    warn: (message) => void warnings.push(message),
  };
  return { deps, calls, warnings };
}

beforeEach(() => {
  clearClipboard();
  clearDrag();
});

describe('a move whose source delete cannot be made, or fails oddly', () => {
  it('a cut that names no source file lands, asks no deleter, and says so', async () => {
    setClipboard([item('A')], 'cut', undefined);
    const { adapter, log } = fakeAdapter();
    const { deps, calls, warnings } = fakeDeps(async () => ({ removed: true }));
    const out = await runTransfer(ROW, clipboardRegister(() => undefined), adapter, deps);
    const message =
      'Pasted here, but the original could not be removed: nothing says which file it came from. Remove it there by hand.';
    expect(out).toEqual({ kind: 'done', sourceKept: message });
    expect(calls).toEqual([]);
    expect(log.commits).toHaveLength(1);
    // Not a same-document move: nothing says the source is this document.
    expect(log.commits[0].removeFirst).toEqual([]);
    expect(log.reports).toEqual([message]);
    expect(warnings).toEqual([message]);
    expect(log.failures).toEqual([]);
    expect(getClipboard()).toBeNull();
  });

  it('a deleter that throws a bare value is reported by that value', async () => {
    setDrag(THERE, [item('A'), item('B')]);
    const { adapter, log } = fakeAdapter();
    const { deps, warnings } = fakeDeps(async () => Promise.reject('the source is busy'));
    const out = await runTransfer(ROW, dragRegister('move', () => undefined), adapter, deps);
    expect(out).toEqual({
      kind: 'done',
      sourceKept: 'Moved here, but the originals in there.sldd could not be removed: the source is busy. Remove them there by hand.',
    });
    expect(warnings).toHaveLength(1);
    expect(log.failures).toEqual([]);
    expect(getDrag()).toBeNull();
  });

  it('a deleter that throws an Error with no message is reported by its name', async () => {
    setClipboard([item('A')], 'cut', THERE);
    const { deps } = fakeDeps(async () => Promise.reject(new TypeError('')));
    const out = await runTransfer(ROW, clipboardRegister(() => undefined), fakeAdapter().adapter, deps);
    expect(out).toEqual({
      kind: 'done',
      sourceKept: 'Pasted here, but the original in there.sldd could not be removed: TypeError. Remove it there by hand.',
    });
  });

  it('a deleter that does not say why is reported as not saying', async () => {
    setClipboard([item('A')], 'cut', THERE);
    const { deps } = fakeDeps(async () => ({ removed: false }));
    const out = await runTransfer(ROW, clipboardRegister(() => undefined), fakeAdapter().adapter, deps);
    expect(out).toEqual({
      kind: 'done',
      sourceKept: 'Pasted here, but the original in there.sldd could not be removed: the source did not say why. Remove it there by hand.',
    });
  });
});

describe('sourceKeptMessage is one sentence whatever the reason ends in', () => {
  it('drops the reason’s own closing stops and whitespace', () => {
    for (const reason of ['it is gone', 'it is gone.', 'it is gone...', 'it is gone. \n', 'it is gone .']) {
      expect(sourceKeptMessage(true, THERE, 1, reason)).toBe(
        'Pasted here, but the original in there.sldd could not be removed: it is gone. Remove it there by hand.',
      );
    }
  });

  it('keeps a stop inside the reason', () => {
    expect(sourceKeptMessage(true, THERE, 1, 'v1.2 is read-only')).toContain(': v1.2 is read-only. Remove');
  });
});

describe('fileNameOf', () => {
  it('is the last segment of the uri, decoded where it decodes', () => {
    expect(fileNameOf('file:///a/b/c.sldd')).toBe('c.sldd');
    expect(fileNameOf('vscode-vfs://github/o/r/my%20d.sldd')).toBe('my d.sldd');
    expect(fileNameOf('file:///a/b/100%25.sldd')).toBe('100%.sldd');
  });
});
