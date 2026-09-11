// Copyright 2026 The MathWorks, Inc.
//
// copyEntriesToClipboard is the copy/cut half of the clipboard, shared by BOTH
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
import { copyEntriesToClipboard } from '../src/host/clipboardAction.js';
import { getClipboard, clearClipboard, setClipboard } from '../src/host/clipboard.js';
import { getModel, findNode, invalidate } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';

const archText = readFileSync(fileURLToPath(new URL('./fixtures/arch.sldd', import.meta.url)), 'utf8');

/**
 * Deps recorder shaped like a provider's. `refresh` + `findNode` mirror what BOTH
 * providers inject: refresh the model from live content ONCE, then resolve each row id.
 */
function harness(uri: string, opts: { text?: string; findNode?: (rowId: string) => any } = {}) {
  const posted: any[] = [];
  let broadcasts = 0;
  let refreshes = 0;
  const deps = {
    // Mirrors what BOTH providers inject: refresh the model from live content once,
    // then resolve each row id against it.
    refresh: () => {
      refreshes++;
      invalidate(uri);
      getModel(uri, 'arch.sldd', opts.text ?? archText);
    },
    findNode: opts.findNode ?? ((rowId: string) => findNode(uri, rowId)),
    post: (m: any) => posted.push(m),
    broadcast: () => broadcasts++,
  };
  return { deps, posted, broadcasts: () => broadcasts, refreshes: () => refreshes };
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

describe('copyEntriesToClipboard — the success path', () => {
  it('snapshots the entry, its section, and the source document, then broadcasts', () => {
    const uri = 'test://clipact-copy.sldd';
    const h = harness(uri);
    expect(copyEntriesToClipboard([rowId(uri, 'DataInterface')], 'copy', uri, h.deps)).toBe(true);

    const clip = getClipboard()!;
    expect(clip.items[0].payload.name).toBe('DataInterface');
    expect(clip.mode).toBe('copy');
    expect(clip.items[0].sourceSection).toBe('arch');
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
    expect(copyEntriesToClipboard([rowId(uri, 'DataInterface')], 'cut', uri, h.deps)).toBe(true);
    expect(getClipboard()!.mode).toBe('cut');
    expect(h.posted).toEqual([]);
  });

  it('resolves a nested child row to its owning ENTRY — the clipboard carries whole entries', () => {
    // Copying a bus ELEMENT copies the BUS: a paste cannot land half an entry.
    const uri = 'test://clipact-child.sldd';
    const h = harness(uri);
    expect(copyEntriesToClipboard([rowId(uri, 'Element')], 'copy', uri, h.deps)).toBe(true);
    expect(getClipboard()!.items[0].payload.name).toBe('DataInterface');
  });

  it('takes an independent snapshot, so a later model mutation cannot alias the payload', () => {
    // The payload is serialize()d at copy time precisely so the pending paste is
    // not a live view of an entry the user may go on to edit or delete.
    const uri = 'test://clipact-snapshot.sldd';
    const h = harness(uri);
    const id = rowId(uri, 'DataInterface');
    copyEntriesToClipboard([id], 'copy', uri, h.deps);
    const payload = getClipboard()!.items[0].payload;

    const node = findNode(uri, id);
    node.name = 'RenamedAfterCopy';
    expect(payload.name).toBe('DataInterface');
  });

  it('copies every selected entry, in selection order', () => {
    const uri = 'test://clipact-many.sldd';
    const h = harness(uri);
    const ids = [rowId(uri, 'DataInterface'), rowId(uri, 'StructType')];
    expect(copyEntriesToClipboard(ids, 'copy', uri, h.deps)).toBe(true);
    expect(getClipboard()!.items.map((i) => i.payload.name)).toEqual(['DataInterface', 'StructType']);
  });

  it('refreshes the model once, not once per row', () => {
    // The JSON provider re-parses the document in `refresh`; on a real customer
    // dictionary that is ~190 ms, so per-row would make a 5-row copy a visible stall.
    const uri = 'test://clipact-refresh.sldd';
    const h = harness(uri);
    copyEntriesToClipboard([rowId(uri, 'DataInterface'), rowId(uri, 'StructType')], 'copy', uri, h.deps);
    expect(h.refreshes()).toBe(1);
  });

  it('dedupes a bus and its own elements down to one entry', () => {
    // The selection is three rows; the copy is one entry. Snapshotting per row is what
    // made a multi-drag paste three copies of one bus.
    const uri = 'test://clipact-dedupe.sldd';
    const h = harness(uri);
    const ids = [rowId(uri, 'DataInterface'), rowId(uri, 'Element')];
    expect(copyEntriesToClipboard(ids, 'copy', uri, h.deps)).toBe(true);
    expect(getClipboard()!.items.map((i) => i.payload.name)).toEqual(['DataInterface']);
  });
});

describe('copyEntriesToClipboard — every failure REPORTS, for copy and for cut alike', () => {
  // This is the divergence the module was extracted to kill. Before the fix the
  // JSON provider posted nothing at all on a failed copy.
  it('names the mode when the row id resolves to nothing', () => {
    const uri = 'test://clipact-norow.sldd';
    for (const mode of ['copy', 'cut'] as const) {
      const h = harness(uri, { findNode: () => null });
      expect(copyEntriesToClipboard(['gone'], mode, uri, h.deps)).toBe(false);
      expect(h.posted).toEqual([
        { type: 'error', message: `Could not ${mode} the selected item.` },
      ]);
    }
  });

  it('pluralizes that failure when the selection was more than one row', () => {
    // The same gesture on a multi-selection: the message has to match what the user
    // did, or it reads as a report about some other row.
    const uri = 'test://clipact-norows.sldd';
    const h = harness(uri, { findNode: () => null });
    expect(copyEntriesToClipboard(['gone', 'alsogone'], 'copy', uri, h.deps)).toBe(false);
    expect(h.posted).toEqual([
      { type: 'error', message: 'Could not copy the selected items.' },
    ]);
  });

  it('reports when the node has no owning entry (a section-header row)', () => {
    // A section header carries no entry, so there is nothing to put on the
    // clipboard. Its `section:*` row id does not resolve at all, so drive the
    // no-owning-entry arm with a detached node — the shape a section node has.
    const uri = 'test://clipact-noentry.sldd';
    const h = harness(uri, { findNode: () => ({ name: 'design', isEntry: false, parent: null }) });
    expect(copyEntriesToClipboard(['section:design'], 'copy', uri, h.deps)).toBe(false);
    expect(h.posted).toEqual([
      { type: 'error', message: 'Could not locate the owning entry in the model.' },
    ]);
  });

  it('reports the parse failure when the live content does not parse', () => {
    // REGRESSION (reachability of the silent path): `refresh` re-reads the LIVE
    // document, so a half-typed edit in the JSON .sldd's plain-text view makes
    // getModel's JSON.parse throw right here. This is ordinary use, not a stub:
    // the table stays open and usable while the text view is mid-edit.
    const uri = 'test://clipact-badjson.sldd';
    const h = harness(uri, { text: '{ "entries": [' });
    expect(copyEntriesToClipboard(['any'], 'copy', uri, h.deps)).toBe(false);
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
      findNode: () => ({
        isEntry: true,
        parent: { name: 'design' },
        serialize: () => {
          throw new Error('boom');
        },
      }),
    });
    expect(copyEntriesToClipboard(['x'], 'cut', uri, h.deps)).toBe(false);
    expect(h.posted).toEqual([{ type: 'error', message: 'Failed to cut: boom' }]);
  });

  it('leaves the PREVIOUS clipboard entry untouched on failure, and does not broadcast', () => {
    // The reason a silent failure was harmful: the clipboard keeps its old
    // content, so the next paste lands the entry the user thought they replaced.
    setClipboard(
      [
        {
          payload: { name: 'Earlier' },
          sourceSection: 'design',
          className: 'Simulink.Parameter',
          arrayClass: '',
          kind: 'Parameter',
          isMatlabVariable: true,
          isScalarNumeric: true,
        },
      ],
      'copy',
      'test://other.sldd',
    );
    const h = harness('test://clipact-keep.sldd', { findNode: () => null });
    expect(copyEntriesToClipboard(['gone'], 'copy', 'test://clipact-keep.sldd', h.deps)).toBe(false);
    expect(getClipboard()!.items[0].payload.name).toBe('Earlier');
    expect(h.broadcasts()).toBe(0);
  });
});

describe('copyEntriesToClipboard — a section with no name', () => {
  it('blanks the source section rather than recording undefined', () => {
    // sourceSection is compared against the resolved paste target to detect a
    // same-section cut (a no-op the paste refuses). `undefined` there would make
    // that comparison silently false and turn the no-op into a delete-and-re-add.
    const uri = 'test://clipact-nosection.sldd';
    const h = harness(uri, {
      findNode: () => ({ isEntry: true, parent: {}, serialize: () => ({ name: 'Loose' }) }),
    });
    expect(copyEntriesToClipboard(['x'], 'copy', uri, h.deps)).toBe(true);
    expect(getClipboard()!.items[0].sourceSection).toBe('');
  });
});
