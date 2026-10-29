// Copyright 2026 The MathWorks, Inc.
//
// A Usage link to a block whose KEY holds an '@' opens that block, through the host's own click
// path (navigate.ts handleNavigate) and view's link grammar, which it now reads links with.
//
// Core names a block by its SID, and by its NAME only in a model written before SIDs existed
// (`blockKey`). A Simulink block name may contain '@', so such a block's links carry one in the
// name half as well as the separator:
//   - a data row's Usage cell, to each block that reads the variable: `blocks:<key>@<model>`
//     (core's usage `linkTarget`, which view prefixes with the `blocks:` channel);
//   - a block row's parameter, when the value comes from a MASK: `blocks:<masked block's key>@<model>`
//     (core's mask origin, the same channel).
// This host's old copy of the grammar split at the LAST '@', which reads both right; a split at the
// first '@' would open `1@file:///w/m.mdl`, which is no file. View splits a block target at the first
// '@' that a uri follows, else at the last — so each answer below is the old host's answer.
//
// The model uri's own '@' is not the case here: VS Code's Uri.toString() writes it as %40.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const found = new Map<string, string>(); // findFiles('**/<name>') answers

vi.mock('vscode', () => {
  class EventEmitter<T> {
    private listeners: ((e: T) => void)[] = [];
    event = (l: (e: T) => void) => {
      this.listeners.push(l);
      return { dispose: () => (this.listeners = this.listeners.filter((x) => x !== l)) };
    };
    fire(e: T) {
      for (const l of this.listeners) l(e);
    }
  }
  const uri = (s: string) => ({ toString: () => s });
  return {
    EventEmitter,
    Uri: { parse: (s: string) => uri(s) },
    workspace: {
      findFiles: async (glob: string) => {
        const hit = found.get(glob.replace(/^\*\*\//, ''));
        return hit ? [uri(hit)] : [];
      },
    },
  };
});

const { handleNavigate, onNavigateSelect } = await import('../src/host/navigate.js');

/** What one click does: the file it opens and the row it asks that file's editor to select. */
async function click(target: string): Promise<{ opened: string[]; selected: { uri: string; name: string }[] }> {
  const opened: string[] = [];
  const selected: { uri: string; name: string }[] = [];
  const sub = onNavigateSelect((e) => selected.push(e));
  try {
    await handleNavigate(target, async (u) => void opened.push(u.toString()));
  } finally {
    sub.dispose();
  }
  return { opened, selected };
}

/** vscode's host grammar before S3 (navTarget.ts, main 7d76fc3): strip the channel, split at the LAST '@'. */
function lastAtRule(target: string): { name: string; source: string } | null {
  let rest = target;
  if (target.startsWith('blocks:')) rest = target.slice('blocks:'.length);
  else if (target.startsWith('workspace:')) rest = target.slice('workspace:'.length);
  const at = rest.lastIndexOf('@');
  if (at < 0) return null;
  const name = rest.slice(0, at);
  const source = rest.slice(at + 1);
  return name && source ? { name, source } : null;
}

beforeEach(() => {
  found.clear();
  found.set('m.mdl', 'file:///w/m.mdl');
});

describe('a Usage link to a block whose key holds an @', () => {
  it('opens the model and selects the block named Gain@1, from a data row', async () => {
    // A pre-SID block named `Gain@1` reading a dictionary variable: the cell links back to it.
    expect(await click('blocks:Gain@1@file:///w/m.mdl')).toEqual({
      opened: ['file:///w/m.mdl'],
      selected: [{ uri: 'file:///w/m.mdl', name: 'Gain@1' }],
    });
  });

  it('opens the model and selects the masked block, from a parameter whose value is a mask’s', async () => {
    // `Gain = g1` where `g1` is a mask parameter of the pre-SID block `Mask@Sub`: the link names
    // the masked block by its key, on the same channel.
    expect(await click('blocks:Mask@Sub@file:///w/m.mdl')).toEqual({
      opened: ['file:///w/m.mdl'],
      selected: [{ uri: 'file:///w/m.mdl', name: 'Mask@Sub' }],
    });
  });

  it('resolves a bare model name after it, and keeps the whole key', async () => {
    // A source no uri spells (a file name as a model recorded it): no remainder is a uri, so the
    // split is the last '@', and the name is looked up in the workspace.
    expect(await click('blocks:Gain@1@m.mdl')).toEqual({
      opened: ['file:///w/m.mdl'],
      selected: [{ uri: 'file:///w/m.mdl', name: 'Gain@1' }],
    });
  });

  it('still opens a block named by its SID', async () => {
    expect(await click('blocks:65@file:///w/m.mdl')).toEqual({
      opened: ['file:///w/m.mdl'],
      selected: [{ uri: 'file:///w/m.mdl', name: '65' }],
    });
  });

  it('answers as the host did before, for every block target this host makes', async () => {
    const targets = [
      'blocks:Gain@1@file:///w/m.mdl',
      'blocks:Mask@Sub@file:///w/m.mdl',
      'blocks:a@b@c@file:///w/m.mdl',
      'blocks:Gain@1@m.mdl',
      'blocks:65@file:///w/m.mdl',
      'blocks:3:12@file:///w/sub%40dir/m.slx',
      'blocks:Gain@1@binedit:file:///w/m.mdl',
    ];
    const { parseNavTarget } = await import('../src/host/navigate.js');
    for (const t of targets) expect(parseNavTarget(t), t).toEqual(lastAtRule(t));
  });
});
