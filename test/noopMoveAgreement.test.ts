// Copyright 2026 The MathWorks, Inc.
//
// "A move back into the section every item came from does nothing" is asked twice: by the
// webview's drop predictor and the menu's Paste of a cut (dropDecision.isNoopMove), and by the
// host when the transfer runs (transfer.isNoopMove). If they disagreed, a drop the table showed
// as a no-op would move entries, or one it offered would be silently dropped. Here both are
// asked every combination of mode, source document, item sections and target section, built
// from one description so the two cannot be handed different facts.
//
// The one place their answers differ is a transfer of no items, which the host's rule calls a
// no-op and the webview's does not; the host never asks it of none (runTransfer answers
// "Nothing to paste" first), and that ordering is pinned here too.
import { describe, it, expect } from 'vitest';
import { isNoopMove as webviewNoop, type DragItem } from 'data-explorer-view/model';
import { isNoopMove as hostNoop, runTransfer, type TransferAdapter } from '../src/host/transfer.js';

const HERE = 'file:///w/here.sldd';
const THERE = 'file:///w/there.sldd';

const facts = (sectionName: string): DragItem => ({
  className: 'Simulink.Parameter',
  arrayClass: 'Simulink.Parameter',
  kind: 'Simulink Parameter',
  isMatlabVariable: false,
  isScalarNumeric: false,
  sectionName,
});

describe('the webview and the host answer the no-op move alike', () => {
  const sources = [HERE, THERE];
  const sectionSets = [['design'], ['design', 'design'], ['design', 'arch'], ['arch'], [''], ['', '']];
  const targets = ['design', 'arch', ''];
  for (const move of [true, false]) {
    for (const from of sources) {
      for (const sections of sectionSets) {
        for (const to of targets) {
          it(`${move ? 'move' : 'copy'} of [${sections.map((s) => s || "''").join(', ')}] from ${from === HERE ? 'here' : 'there'} onto ${to || "''"}`, () => {
            const webview = webviewNoop(
              { docUri: from, items: sections.map(facts) },
              { docUri: HERE, sectionName: to, sectionLabel: to, isDerived: false, allowedTypes: [] },
              move ? 'move' : 'copy',
            );
            const host = hostNoop(
              { items: sections.map((s) => ({ payload: { name: 'x' }, sourceSection: s })), sourceDocUri: from, move },
              HERE,
              to,
            );
            expect(webview).toBe(host);
          });
        }
      }
    }
  }

  it('a drag with no items, or none listed, is never a no-op to the webview', () => {
    const target = { docUri: HERE, sectionName: 'design', sectionLabel: 'Design', isDerived: false, allowedTypes: [] };
    expect(webviewNoop({ docUri: HERE, items: [] }, target, 'move')).toBe(false);
    expect(webviewNoop({ docUri: HERE, items: undefined as unknown as DragItem[] }, target, 'move')).toBe(false);
  });

  it('the host’s rule calls no items a no-op, and so a transfer of none never reaches it', async () => {
    expect(hostNoop({ items: [], sourceDocUri: HERE, move: true }, HERE, 'design')).toBe(true);
    const reports: string[] = [];
    let resolved = 0;
    const adapter: TransferAdapter = {
      docUri: HERE,
      resolveTarget: () => (resolved++, { sectionName: 'design' }),
      commit: () => undefined,
      onFailure: () => undefined,
      report: (m) => void reports.push(m),
    };
    let cleared = 0;
    const register = {
      kind: 'clipboard' as const,
      read: () => ({ items: [], sourceDocUri: HERE, move: true }),
      clear: () => void cleared++,
      broadcast: () => undefined,
    };
    const out = await runTransfer({ rowId: 'r' }, register, adapter, { deleteFromSource: async () => ({ removed: true }) });
    expect(out).toEqual({ kind: 'empty' });
    expect(resolved).toBe(0);
    expect(cleared).toBe(0);
    expect(reports).toEqual(['Nothing to paste — the clipboard is empty.']);
  });
});
