// Copyright 2026 The MathWorks, Inc.
//
// resolveOperands is the ONE answer both the context menu and the keyboard use for
// "which rows does this action act on". These cases are the shapes a real selection
// takes; the menu/keyboard agreement itself is pinned in multiSelectInvariants.test.ts.
import { describe, it, expect } from 'vitest';
import { resolveOperands, sectionRowIdOf, type OperandRow } from '../src/webview/operands.js';

// A minimal two-section table: Design Data holds Bus A (children x, y) and plain V;
// Architectural Data holds Bus B (child z).
const ROWS: OperandRow[] = [
  { ID: 'section:design', parent: null },
  { ID: 'A', parent: 'section:design', _canCopy: true, _canDelete: true, _canAddChild: true },
  { ID: 'A/x', parent: 'A', _canCopy: true, _canDelete: true },
  { ID: 'A/y', parent: 'A', _canCopy: true, _canDelete: true },
  { ID: 'V', parent: 'section:design', _canCopy: true, _canDelete: true },
  { ID: 'section:arch', parent: null },
  { ID: 'B', parent: 'section:arch', _canCopy: true, _canDelete: true, _canAddChild: true },
  { ID: 'B/z', parent: 'B', _canCopy: true, _canDelete: false },
];

describe('resolveOperands', () => {
  it('resolves a single entry row to itself', () => {
    expect(resolveOperands(['A'], ROWS)).toEqual({
      deleteIds: ['A'],
      entryIds: ['A'],
      sections: ['section:design'],
    });
  });

  it('resolves a child row: delete acts on the child, copy on the owning entry', () => {
    expect(resolveOperands(['A/x'], ROWS)).toEqual({
      deleteIds: ['A/x'],
      entryIds: ['A'],
      sections: ['section:design'],
    });
  });

  it('drops section header rows — they are never a row-action operand', () => {
    expect(resolveOperands(['section:design'], ROWS)).toEqual({
      deleteIds: [],
      entryIds: [],
      sections: [],
    });
  });

  it('subsumes a child whose ancestor is also selected', () => {
    expect(resolveOperands(['A', 'A/x'], ROWS)).toEqual({
      deleteIds: ['A'],
      entryIds: ['A'],
      sections: ['section:design'],
    });
  });

  // Invariant 5: subsumption is idempotent.
  it('yields the same operands for an entry plus any subset of its descendants', () => {
    const alone = resolveOperands(['A'], ROWS);
    expect(resolveOperands(['A', 'A/x'], ROWS)).toEqual(alone);
    expect(resolveOperands(['A', 'A/x', 'A/y'], ROWS)).toEqual(alone);
    expect(resolveOperands(['A/x', 'A', 'A/y'], ROWS)).toEqual(alone);
  });

  it('dedupes two children of one entry down to one copy operand', () => {
    expect(resolveOperands(['A/x', 'A/y'], ROWS)).toEqual({
      deleteIds: ['A/x', 'A/y'],
      entryIds: ['A'],
      sections: ['section:design'],
    });
  });

  // The spec's worked example (§3): A, A/x, B/z -> copy A and B; delete A and z.
  it('resolves the mixed cross-section example', () => {
    expect(resolveOperands(['A', 'A/x', 'B/z'], ROWS)).toEqual({
      deleteIds: ['A', 'B/z'],
      entryIds: ['A', 'B'],
      sections: ['section:design', 'section:arch'],
    });
  });

  it('reports every touched section once, in first-seen order', () => {
    expect(resolveOperands(['B', 'V', 'A'], ROWS).sections).toEqual(['section:arch', 'section:design']);
  });

  it('ignores a selection that mixes headers with data rows, keeping only the data', () => {
    expect(resolveOperands(['section:design', 'A', 'section:arch'], ROWS)).toEqual({
      deleteIds: ['A'],
      entryIds: ['A'],
      sections: ['section:design'],
    });
  });

  it('preserves selection order and dedupes a repeated id', () => {
    expect(resolveOperands(['V', 'A', 'V'], ROWS).deleteIds).toEqual(['V', 'A']);
  });

  it('contributes nothing for a stale id no row answers to', () => {
    expect(resolveOperands(['GoneAway'], ROWS)).toEqual({ deleteIds: [], entryIds: [], sections: [] });
  });

  it('treats a Ctrl+A selection of everything as the entries alone', () => {
    const all = ROWS.map((r) => r.ID);
    expect(resolveOperands(all, ROWS)).toEqual({
      deleteIds: ['A', 'V', 'B'],
      entryIds: ['A', 'V', 'B'],
      sections: ['section:design', 'section:arch'],
    });
  });

  it('returns empty operands for an empty selection', () => {
    expect(resolveOperands([], ROWS)).toEqual({ deleteIds: [], entryIds: [], sections: [] });
  });

  it('survives a row whose parent chain does not terminate at a section', () => {
    const orphan: OperandRow[] = [{ ID: 'lone', parent: 'missing' }];
    expect(resolveOperands(['lone'], orphan)).toEqual({
      deleteIds: ['lone'],
      entryIds: ['lone'],
      sections: [],
    });
  });
});

// The destination half of the same walk: what section a row would paste into. It is the
// menu's paste target, and the host answers the identical question with
// findOwningEntry(node).parent — so the two must agree at every depth.
describe('sectionRowIdOf', () => {
  it('answers a section header with itself', () => {
    // The only paste target an empty section has.
    expect(sectionRowIdOf('section:design', ROWS)).toBe('section:design');
  });

  it('answers a top-level entry with its section', () => {
    expect(sectionRowIdOf('A', ROWS)).toBe('section:design');
  });

  it('answers a NESTED CHILD with its section, not with nothing', () => {
    // The regression this exists for: a child's immediate parent is its entry, not a
    // header, so a one-level lookup answered null — and a null paste target reads as
    // "no destination", greying out a Paste on a bus element that the host accepts.
    expect(sectionRowIdOf('A/x', ROWS)).toBe('section:design');
    expect(sectionRowIdOf('B/z', ROWS)).toBe('section:arch');
  });

  it('answers null for a row the table does not hold, or a chain that leaves it', () => {
    expect(sectionRowIdOf('WasDeletedLastEdit', ROWS)).toBeNull();
    expect(sectionRowIdOf('lone', [{ ID: 'lone', parent: 'missing' }])).toBeNull();
  });
});
