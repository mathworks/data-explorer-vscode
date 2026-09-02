// Copyright 2026 The MathWorks, Inc.
//
// copyEntryToClipboard is the copy/cut half of the clipboard, shared by BOTH
// table providers. It exists because the two providers had two inline copies and
// those copies had DIVERGED: the JSON one returned a bare boolean and posted
// nothing, so only its cut caller surfaced a message and a failed COPY was
// completely silent, while the same gesture on a binary .sldd named the problem.
//
// Reporting is the whole point of the module. Copy/cut makes no document edit —
// no repaint, no dirty marker — so a failure the host swallows is invisible: the
// user sees Ctrl+C do nothing and the clipboard still holds the PREVIOUS entry,
// which the next paste then lands. Every test below therefore asserts what the
// webview is told, not just the return value.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { copyEntryToClipboard } from '../src/host/clipboardAction.js';
import { getClipboard, clearClipboard, setClipboard } from '../src/host/clipboard.js';
import { getModel, findNode, invalidate } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';

const archText = readFileSync(fileURLToPath(new URL('./fixtures/arch.sldd', import.meta.url)), 'utf8');

/**
 * Deps recorder shaped like a provider's. `resolveNode` mirrors what BOTH
 * providers inject: refresh the model from live content, then resolve the row id.
 */
function harness(uri: string, opts: { text?: string; resolveNode?: (rowId: string) => any } = {}) {
  const posted: any[] = [];
  let broadcasts = 0;
  const deps = {
    resolveNode:
      opts.resolveNode ??
      ((rowId: string) => {
        invalidate(uri);
        getModel(uri, 'arch.sldd', opts.text ?? archText);
        return findNode(uri, rowId);
      }),
    post: (m: any) => posted.push(m),
    broadcast: () => broadcasts++,
  };
  return { deps, posted, broadcasts: () => broadcasts };
}

/** Row id of an entry (or nested child) by its Name label. */
function rowId(uri: string, name: string): string {
  invalidate(uri);
  const model = getModel(uri, 'arch.sldd', archText);
  const row = buildRows(model).find((r: any) => r.Name?.label === name);
  if (!row) throw new Error(`no row for "${name}"`);
  return row.ID;
}

beforeEach(() => clearClipboard());

describe('copyEntryToClipboard — the success path', () => {
  it('snapshots the entry, its section, and the source document, then broadcasts', () => {
    const uri = 'test://clipact-copy.sldd';
    const h = harness(uri);
    expect(copyEntryToClipboard(rowId(uri, 'DataInterface'), 'copy', uri, h.deps)).toBe(true);

    const clip = getClipboard()!;
    expect(clip.payload.name).toBe('DataInterface');
    expect(clip.mode).toBe('copy');
    expect(clip.sourceSection).toBe('arch');
    // The source document is recorded because a CUT is lazy: the source delete is
    // deferred to paste time and the paste may land in a different .sldd tab, so
    // the clipboard is the only thing that still knows where to delete from.
    expect(clip.sourceDocUri).toBe(uri);
    // A successful copy says nothing to the webview; only the broadcast (which
    // enables Paste and repaints the affordance everywhere) is observable.
    expect(h.posted).toEqual([]);
    expect(h.broadcasts()).toBe(1);
  });

  it('records cut mode, which is what makes the source row show its dimmed affordance', () => {
    const uri = 'test://clipact-cut.sldd';
    const h = harness(uri);
    expect(copyEntryToClipboard(rowId(uri, 'DataInterface'), 'cut', uri, h.deps)).toBe(true);
    expect(getClipboard()!.mode).toBe('cut');
    expect(h.posted).toEqual([]);
  });

  it('resolves a nested child row to its owning ENTRY — the clipboard carries whole entries', () => {
    // Copying a bus ELEMENT copies the BUS: a paste cannot land half an entry.
    const uri = 'test://clipact-child.sldd';
    const h = harness(uri);
    expect(copyEntryToClipboard(rowId(uri, 'Element'), 'copy', uri, h.deps)).toBe(true);
    expect(getClipboard()!.payload.name).toBe('DataInterface');
  });

  it('takes an independent snapshot, so a later model mutation cannot alias the payload', () => {
    // The payload is serialize()d at copy time precisely so the pending paste is
    // not a live view of an entry the user may go on to edit or delete.
    const uri = 'test://clipact-snapshot.sldd';
    const h = harness(uri);
    const id = rowId(uri, 'DataInterface');
    copyEntryToClipboard(id, 'copy', uri, h.deps);
    const payload = getClipboard()!.payload;

    const node = findNode(uri, id);
    node.name = 'RenamedAfterCopy';
    expect(payload.name).toBe('DataInterface');
  });
});

describe('copyEntryToClipboard — every failure REPORTS, for copy and for cut alike', () => {
  // This is the divergence the module was extracted to kill. Before the fix the
  // JSON provider posted nothing at all on a failed copy.
  it('names the mode when the row id resolves to nothing', () => {
    const uri = 'test://clipact-norow.sldd';
    for (const mode of ['copy', 'cut'] as const) {
      const h = harness(uri, { resolveNode: () => null });
      expect(copyEntryToClipboard('gone', mode, uri, h.deps)).toBe(false);
      expect(h.posted).toEqual([
        { type: 'error', message: `Could not ${mode} the selected item.` },
      ]);
    }
  });

  it('reports when the node has no owning entry (a section-header row)', () => {
    // A section header carries no entry, so there is nothing to put on the
    // clipboard. Its `section:*` row id does not resolve at all, so drive the
    // no-owning-entry arm with a detached node — the shape a section node has.
    const uri = 'test://clipact-noentry.sldd';
    const h = harness(uri, { resolveNode: () => ({ name: 'design', isEntry: false, parent: null }) });
    expect(copyEntryToClipboard('section:design', 'copy', uri, h.deps)).toBe(false);
    expect(h.posted).toEqual([
      { type: 'error', message: 'Could not locate the owning entry in the model.' },
    ]);
  });

  it('reports the parse failure when the live content does not parse', () => {
    // REGRESSION (reachability of the silent path): resolveNode re-reads the LIVE
    // document, so a half-typed edit in the JSON .sldd's plain-text view makes
    // getModel's JSON.parse throw right here. This is ordinary use, not a stub:
    // the table stays open and usable while the text view is mid-edit.
    const uri = 'test://clipact-badjson.sldd';
    const h = harness(uri, { text: '{ "entries": [' });
    expect(copyEntryToClipboard('any', 'copy', uri, h.deps)).toBe(false);
    expect(h.posted).toHaveLength(1);
    expect(h.posted[0].type).toBe('error');
    expect(h.posted[0].message).toMatch(/^Failed to copy: /);
  });

  it('reports a throwing serialize() rather than letting it escape the message handler', () => {
    // serialize() comes from the separately versioned data-explorer-core. A throw
    // that escaped here would be an unhandled rejection in the extension host,
    // which the user only ever sees as a copy that did nothing.
    const uri = 'test://clipact-throw.sldd';
    const h = harness(uri, {
      resolveNode: () => ({
        isEntry: true,
        parent: { name: 'design' },
        serialize: () => {
          throw new Error('boom');
        },
      }),
    });
    expect(copyEntryToClipboard('x', 'cut', uri, h.deps)).toBe(false);
    expect(h.posted).toEqual([{ type: 'error', message: 'Failed to cut: boom' }]);
  });

  it('leaves the PREVIOUS clipboard entry untouched on failure, and does not broadcast', () => {
    // The reason a silent failure was harmful: the clipboard keeps its old
    // content, so the next paste lands the entry the user thought they replaced.
    setClipboard({ name: 'Earlier' }, 'copy', 'design', 'test://other.sldd');
    const h = harness('test://clipact-keep.sldd', { resolveNode: () => null });
    expect(copyEntryToClipboard('gone', 'copy', 'test://clipact-keep.sldd', h.deps)).toBe(false);
    expect(getClipboard()!.payload.name).toBe('Earlier');
    expect(h.broadcasts()).toBe(0);
  });
});

describe('copyEntryToClipboard — a section with no name', () => {
  it('blanks the source section rather than recording undefined', () => {
    // sourceSection is compared against the resolved paste target to detect a
    // same-section cut (a no-op the paste refuses). `undefined` there would make
    // that comparison silently false and turn the no-op into a delete-and-re-add.
    const uri = 'test://clipact-nosection.sldd';
    const h = harness(uri, {
      resolveNode: () => ({ isEntry: true, parent: {}, serialize: () => ({ name: 'Loose' }) }),
    });
    expect(copyEntryToClipboard('x', 'copy', uri, h.deps)).toBe(true);
    expect(getClipboard()!.sourceSection).toBe('');
  });
});
