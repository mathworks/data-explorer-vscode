// Copyright 2026 The MathWorks, Inc.
//
// The seams between the paths a multi-row action travels, over a REAL model.
//
// One selection is resolved twice: by the webview, to label and enable a menu
// (webview/operands.ts), and by the host, to perform the edit (host/deletionPlan.ts +
// structuralEdit's owningEntriesOf). Two answers to "which rows does this act on" is the
// recurring defect in this repo, and it is invisible when it drifts: the menu says
// "Delete 3 Items" and two disappear. So the resolutions are asserted against each other
// here, per selection shape, rather than each against its own expectations.
//
// The rows are the REAL rows (rowBuilder.buildRows), so the capability flags and the
// parent chain are the ones the table actually gets — a synthetic row is exactly where a
// parity test stops proving anything.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel, findNode, invalidate } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';
import { sectionRules } from '../src/host/sectionRules.js';
import { dropFactsOf } from '../src/host/dropFacts.js';
import { buildClipboardSnapshot, buildDragSnapshot } from '../src/host/structuralEdit.js';
import { planDeletion } from '../src/host/deletionPlan.js';
import { resolveOperands } from '../src/webview/operands.js';
import { buildContextMenuItems, type MenuRow } from '../src/webview/menuItems.js';
import { dropDecision } from '../src/webview/dropDecision.js';
import { buildSectionRowId } from '../src/common/sectionRowId.js';
import { blankCommentsAndKeepLines } from './tools/moduleGraph.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const archText = readFileSync(fileURLToPath(new URL('./fixtures/arch.sldd', import.meta.url)), 'utf8');

// The fixture holds ten derived entries in `arch` and an EMPTY `design`, and a selection
// has to be able to SPAN sections. The two sections share one namespace — the split is
// purely `isderived` — so flipping the first entry's flag moves `AliasType` into design.
// String.replace with a string pattern replaces one occurrence, which is exactly one
// entry. In memory only: the fixture file is untouched.
const mixedText = archText.replace('"isderived": "1"', '"isderived": "0"');

function harness(uri: string) {
  invalidate(uri);
  const model = getModel(uri, 'arch.sldd', mixedText);
  const rows = buildRows(model) as MenuRow[];
  return {
    model,
    rows,
    rules: sectionRules(model),
    find: (rowId: string) => findNode(uri, rowId),
    // A node id is a name-path rooted at the document, so a row id is spelled, not
    // searched for — `Element` is a child of three different buses in this fixture.
    id: (...path: string[]) => [uri, ...path].join('/'),
  };
}

const h = harness('test://invariants.sldd');
const ARCH = buildSectionRowId('arch');
const DESIGN = buildSectionRowId('design');
const E = (...path: string[]) => h.id('arch', ...path);
const D = (...path: string[]) => h.id('design', ...path);

// The shapes §3 distinguishes, each spelled as a selection. `Ctrl+A` is included because
// it is the one users actually reach for, and it is every other shape at once.
const SELECTIONS: { name: string; sel: string[] }[] = [
  { name: 'one entry', sel: [E('DataInterface')] },
  { name: 'one child', sel: [E('DataInterface', 'Element')] },
  { name: 'two children of one entry', sel: [E('DataInterface', 'Element'), E('DataInterface', 'Element1')] },
  { name: 'an entry and its own child', sel: [E('DataInterface'), E('DataInterface', 'Element')] },
  { name: 'a child listed before its entry', sel: [E('DataInterface', 'Element'), E('DataInterface')] },
  { name: 'two entries', sel: [E('DataInterface'), E('StructType')] },
  { name: 'children of two entries', sel: [E('DataInterface', 'Element'), E('StructType', 'Element')] },
  { name: 'across sections', sel: [D('AliasType'), E('DataInterface')] },
  { name: 'a section header among data rows', sel: [ARCH, E('DataInterface')] },
  { name: 'headers only', sel: [ARCH, DESIGN] },
  { name: 'a stale id', sel: [E('DataInterface'), E('WasDeletedLastEdit')] },
  { name: 'the same row twice', sel: [E('StructType'), E('StructType')] },
  { name: 'everything (Ctrl+A)', sel: h.rows.map((r) => r.ID) },
  { name: 'nothing', sel: [] },
];

// The plan, flattened to the row ids it will delete — the same vocabulary resolveOperands
// answers in, which is the only way the two can be compared at all.
function planIds(sel: string[]): string[] {
  const plan = planDeletion(sel, h.find);
  return [
    ...plan.entries.map((e: any) => e.id),
    ...plan.childGroups.flatMap((g: any) => g.children.map((c: any) => c.id)),
  ];
}

// Section + name, because a name alone is ambiguous across the two sections and an id is
// not what a clipboard item carries.
function clipKeys(sel: string[]): string[] {
  return buildClipboardSnapshot(sel, h.find).map((i: any) => `${i.sourceSection}/${String(i.payload.name)}`);
}

describe('the menu and the host resolve the same operands', () => {
  it('every selection shape resolves to nodes that exist (the fixture is what it claims)', () => {
    // Guards the whole file: a mistyped path would make each assertion below compare two
    // empty lists and pass.
    for (const { name, sel } of SELECTIONS) {
      if (name === 'nothing' || name === 'a stale id' || name === 'headers only') continue;
      expect(sel.filter((id) => !!h.find(id)).length, `${name} names live rows`).toBeGreaterThan(0);
    }
    expect(h.find(E('WasDeletedLastEdit')), 'the stale id really is stale').toBeFalsy();
    expect(h.find(D('AliasType')), 'design holds the moved entry').toBeTruthy();
  });

  for (const { name, sel } of SELECTIONS) {
    it(`agrees about DELETE operands: ${name}`, () => {
      // Sets, not sequences: the plan groups children by entry, so its order is its own.
      // What must match is WHICH rows go.
      expect([...resolveOperands(sel, h.rows).deleteIds].sort()).toEqual([...planIds(sel)].sort());
    });

    it(`agrees about COPY operands: ${name}`, () => {
      // Order matters here — it is the paste order, and the menu's count comes from the
      // same list.
      const ops = resolveOperands(sel, h.rows);
      const menuKeys = ops.entryIds.map((id) => {
        const node = h.find(id);
        return `${node.parent.name}/${node.name}`;
      });
      expect(menuKeys).toEqual(clipKeys(sel));
    });

    it(`agrees about which SECTIONS are involved: ${name}`, () => {
      // What Paste's ambiguity check is built on: more than one section and there is no
      // single destination to offer.
      //
      // Both sides answer in section ROW ids, and neither side counts a selected section
      // HEADER: resolveOperands drops header rows outright, and the host only ever reaches
      // a section through an entry it is about to touch. So this is set EQUALITY — a
      // one-way containment would let the menu invent an ambiguity the host does not have,
      // which is a Paste refused for a destination that was never in doubt.
      const plan = planDeletion(sel, h.find);
      const fromHost = new Set(
        [...plan.entries, ...plan.childGroups.map((g: any) => g.entry)]
          .map((e: any) => e.parent?.name)
          .filter(Boolean)
          .map((sectionName: string) => buildSectionRowId(sectionName)),
      );
      const fromMenu = new Set(resolveOperands(sel, h.rows).sections);
      expect([...fromMenu].sort()).toEqual([...fromHost].sort());
    });
  }
});

describe('subsumption is idempotent', () => {
  it('adding any subset of an entry’s descendants changes nothing, on both sides', () => {
    // §3: an operand already covered by an ancestor operand contributes nothing. This is
    // the property that makes Ctrl+A safe — without it a bus and its three elements are
    // four reserializations of one entry, three of them stale.
    const entry = E('DataInterface');
    const kids = ['Element', 'Element1', 'a'].map((k) => E('DataInterface', k));
    const base = resolveOperands([entry], h.rows);
    for (let mask = 0; mask < 1 << kids.length; mask++) {
      const subset = kids.filter((_, i) => mask & (1 << i));
      const sel = [entry, ...subset];
      expect(resolveOperands(sel, h.rows), `subset mask ${mask}`).toEqual(base);
      expect(planIds(sel), `subset mask ${mask}, host side`).toEqual([entry]);
    }
  });
});

describe('a Paste is offered exactly where a drop would be allowed', () => {
  // dropDecision.ts's own words: "drag-drop matches cut/copy-paste — if you can cut/copy
  // you can drag, and if you can paste you can drop." Asserted rather than commented.
  //
  // The source document is a DIFFERENT uri and the mode is 'copy', which isolates the
  // allow-check: a same-document same-section move is a no-op, and a no-op is a question
  // paste answers at paste time, not in the menu.
  const ENTRIES = ['DataInterface', 'ServiceInterface', 'EnumType', 'Constant', 'ValueType'];

  for (const rule of h.rules) {
    for (const name of ENTRIES) {
      it(`${name} into ${rule.sectionName}`, () => {
        const facts = dropFactsOf(h.find(E(name)));
        const anchor = buildSectionRowId(rule.sectionName);
        const items = buildContextMenuItems({
          rows: h.rows,
          selectedRowIds: [anchor],
          anchorRowId: anchor,
          clipboard: { canPaste: true, mode: 'copy', items: [facts] },
          editable: true,
          hasTextView: true,
          pasteTarget: {
            sectionLabel: rule.sectionLabel,
            isDerived: rule.isDerived,
            allowedTypes: rule.allowedTypes,
          },
        });
        const paste = items.find((i) => i.id === 'paste')!;
        const decision = dropDecision(
          { docUri: 'test://elsewhere.sldd', sectionName: 'arch', sectionLabel: 'Architectural Data', isDerived: true, items: [facts] },
          { docUri: 'test://invariants.sldd', ...rule },
          'copy',
        );
        expect(!!paste.disabled, `${name} -> ${rule.sectionName}`).toBe(!decision.canDrop);
        // And when it refuses, it refuses in the same words: a rejected drop's tooltip IS
        // the reason rejectReason gave, so there is one sentence for both surfaces.
        if (!decision.canDrop) expect(paste.reason).toBe(decision.tooltip);
      });
    }
  }
});

describe('a multi-row gesture keeps each source’s own section', () => {
  it('the clipboard records one per item; the drag register still cannot', () => {
    const sel = [D('AliasType'), E('DataInterface')];
    expect(clipKeys(sel)).toEqual(['design/AliasType', 'arch/DataInterface']);

    // The gap left in place on purpose (spec §11): buildDragSnapshot keeps ONE
    // sourceSection, taken from the last contributing row, while asserting in a comment
    // that a multi-drag is within one section. That single value feeds dropDecision's
    // same-section-move no-op check, so a cross-section multi-DRAG can be refused as a
    // no-op where the same multi-CUT is not. Pinned as it stands so that whoever fixes
    // the drag path has to come here and say so.
    expect(buildDragSnapshot(sel, h.find).sourceSection).toBe('arch');
  });
});

describe('the keyboard cannot disagree with the menu', () => {
  // table-main.ts runs top-level side effects against a live table element, so it is not
  // importable here; what is checkable is that it describes the menu ONCE. The old code
  // computed enablement twice — buildContextMenuItems for the menu, a ternary over
  // _canCopy/_canDelete for the chord — with a comment promising they matched.
  const src = blankCommentsAndKeepLines(
    readFileSync(fileURLToPath(new URL('../src/webview/table-main.ts', import.meta.url)), 'utf8'),
  );

  it('builds the menu in exactly one place', () => {
    expect(src.match(/buildContextMenuItems\(/g) ?? []).toHaveLength(1);
  });

  it('gates every chord on the item that chord would click', () => {
    expect(src).toContain("find((i) => i.id === action)");
    expect(src).toContain("find((i) => i.id === 'locateInText')");
  });

  it('re-derives no capability of its own', () => {
    for (const flag of ['_canCopy', '_canDelete', '_canAddChild']) {
      expect(src, `table-main reads ${flag} again`).not.toContain(flag);
    }
  });

  it('resolves a paste target through operands.ts, never a parent lookup of its own', () => {
    // The other half of "one answer to which rows this acts on": the DESTINATION. A row's
    // section is a whole-chain walk (sectionRowIdOf), mirroring the host's
    // findOwningEntry(node).parent. Reading the row's immediate `parent` instead answered
    // null for a nested bus element, and null reads as "no destination" — so Paste greyed
    // out on a child while the host would have accepted it, with no reason shown.
    expect(src, 'the walk comes from operands.ts').toContain('sectionRowIdOf(');
    expect(src, 'table-main walks to a section itself').not.toMatch(/sectionNameFromRowId\([^)]*parent/);
  });
});
