// Copyright 2026 The MathWorks, Inc.
//
// End-to-end drop flows, modeling exactly what SlddTextEditorProvider.applyDrop
// does with the pure transforms — the host handler is thin glue over these, so
// exercising the same sequence proves the drag-and-drop behavior without a live
// VS Code webview. Each case mirrors one user gesture:
//   • cross-section MOVE within a doc: delete sources, then paste into target;
//   • cross-section COPY: paste only, sources stay;
//   • cross-DOCUMENT move: paste into target text, delete from source text;
//   • the predicted decision (dropDecision) agrees with what the flow does.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel, findNode, invalidate } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';
import { pasteEntries, deleteEntriesByName, resolveSectionForPaste } from '../src/host/structuralEdit.js';
import { sectionRules } from '../src/host/sectionRules.js';
import { dropDecision, type DragItem } from '../src/webview/dropDecision.js';

const archText = readFileSync(fileURLToPath(new URL('./fixtures/arch.sldd', import.meta.url)), 'utf8');

function model(uri: string, text = archText) {
  invalidate(uri);
  return getModel(uri, 'arch.sldd', text);
}
function entry(uri: string, m: any, name: string) {
  const id = buildRows(m).find((r: any) => r.Name?.label === name && !String(r.ID).startsWith('section:')).ID;
  return findNode(uri, id);
}
function sectionOf(m: any, name: string) {
  return m.children.find((s: any) => s.name === name);
}
// Build the DragItem the webview would see for a live node (mirrors applyDragStart).
function dragItemOf(node: any): DragItem {
  const payload = node.serialize() as any;
  const arrayClass = (payload.value && typeof payload.value === 'object' && payload.value._array_class) || '';
  return {
    className: node.className ?? '',
    arrayClass,
    kind: node.kind ?? '',
    isMatlabVariable: !arrayClass,
  };
}

describe('drop end-to-end — cross-section MOVE within one document', () => {
  it('moves an arch Data Interface into Design Data: gone from arch, a genuine design entry keeping its name', () => {
    const uri = 'test://e2e-move.sldd';
    const m = model(uri);
    const src = entry(uri, m, 'DataInterface');
    const payload = src.serialize() as Record<string, unknown>;

    // Predict first — the webview would show "Convert Data Interface to Bus".
    const rules = sectionRules(m);
    const designRule = rules.find((r) => r.sectionName === 'design')!;
    const decision = dropDecision(
      { docUri: uri, sectionName: 'arch', sectionLabel: 'Architectural Data', isDerived: true, items: [dragItemOf(src)] },
      { docUri: uri, ...designRule },
      'move',
    );
    expect(decision.canDrop).toBe(true);
    expect(decision.tooltip).toBe('Convert Data Interface to Bus');

    // Perform: same-doc move = delete source, then paste into target text.
    let text = deleteEntriesByName(archText, ['DataInterface']);
    invalidate(uri);
    const m2 = getModel(uri, 'arch.sldd', text);
    const design = sectionOf(m2, 'design');
    const { newText } = pasteEntries(text, design, [payload]);
    text = newText;

    invalidate(uri);
    const m3 = getModel(uri, 'arch.sldd', text);
    const archNames = sectionOf(m3, 'arch').children.map((c: any) => c.name);
    const designSection = sectionOf(m3, 'design');
    const moved = designSection.children.find((c: any) => c.name === 'DataInterface');
    expect(archNames).not.toContain('DataInterface'); // left arch
    expect(moved).toBeTruthy(); // arrived in design
    expect(moved.isDerived).toBe(false); // now a genuine design entry (isderived rewritten)
    // A MOVE frees the source name, so the paste keeps it ("DataInterface"),
    // matching cut+paste — the same entity keeps a stable name. The document's
    // SystemComposer catalog is keyed by NAME and this editor only rewrites the
    // entries array (never the interfaceDictionary), so that kept name is still
    // classified as a Data Interface. Shedding the classification is what a COPY
    // (below) does for free by uniquifying the name to "DataInterface1".
    expect(moved.className).toBe('Simulink.Bus'); // the underlying class is unchanged by the move
    expect(moved.kind).toBe('Data Interface'); // name-keyed catalog still classifies it
  });
});

describe('drop end-to-end — cross-section COPY leaves the source', () => {
  it('copies an arch Data Interface into design: still in arch, duplicated in design', () => {
    const uri = 'test://e2e-copy.sldd';
    const m = model(uri);
    const src = entry(uri, m, 'DataInterface');
    const payload = src.serialize() as Record<string, unknown>;
    const design = sectionOf(m, 'design');

    // Copy = paste only, no source delete.
    const { newText } = pasteEntries(archText, design, [payload]);

    invalidate(uri);
    const m2 = getModel(uri, 'arch.sldd', newText);
    expect(sectionOf(m2, 'arch').children.map((c: any) => c.name)).toContain('DataInterface');
    const copy = sectionOf(m2, 'design').children.find((c: any) => c.name === 'DataInterface1');
    expect(copy).toBeTruthy();
    // The source still holds "DataInterface", so the copy is uniquified to
    // "DataInterface1" — a name the SystemComposer catalog doesn't classify. With
    // no name-keyed classification, the Kind falls back to the class: a Bus. This
    // is the exact contrast with the MOVE case, where the freed name is retained.
    expect(copy.className).toBe('Simulink.Bus');
    expect(copy.kind).toBe('Bus');
  });
});

describe('drop end-to-end — cross-DOCUMENT move', () => {
  it('moves an entry from doc A into doc B: removed from A, present in B', () => {
    const uriA = 'test://e2e-A.sldd';
    const uriB = 'test://e2e-B.sldd';
    const mA = model(uriA);
    const src = entry(uriA, mA, 'DataInterface');
    const payload = src.serialize() as Record<string, unknown>;

    // Target doc B is a second copy of the fixture; paste into its design.
    const textB = archText;
    invalidate(uriB);
    const mB = getModel(uriB, 'arch.sldd', textB);
    const designB = sectionOf(mB, 'design');
    const { newText: newB } = pasteEntries(textB, designB, [payload]);

    // Source doc A: delete the moved entry (its own edit, cross-doc).
    const newA = deleteEntriesByName(archText, ['DataInterface']);

    invalidate(uriA);
    invalidate(uriB);
    const mA2 = getModel(uriA, 'arch.sldd', newA);
    const mB2 = getModel(uriB, 'arch.sldd', newB);
    expect(sectionOf(mA2, 'arch').children.map((c: any) => c.name)).not.toContain('DataInterface');
    expect(sectionOf(mB2, 'design').children.map((c: any) => c.name)).toContain('DataInterface1');
  });
});

describe('drop end-to-end — same-section move is a no-op', () => {
  it('dropDecision refuses a same-doc same-section move (no delete/re-add)', () => {
    const uri = 'test://e2e-noop.sldd';
    const m = model(uri);
    const src = entry(uri, m, 'DataInterface');
    const rules = sectionRules(m);
    const archRule = rules.find((r) => r.sectionName === 'arch')!;
    const decision = dropDecision(
      { docUri: uri, sectionName: 'arch', sectionLabel: 'Architectural Data', isDerived: true, items: [dragItemOf(src)] },
      { docUri: uri, ...archRule },
      'move',
    );
    expect(decision.noop).toBe(true);
    expect(decision.canDrop).toBe(false);
  });
});

describe('drop end-to-end — rejected drop is predicted and never performed', () => {
  it('a ServiceInterface dropped into design is rejected, and pasteEntries would throw', () => {
    const uri = 'test://e2e-reject.sldd';
    const m = model(uri);
    const svc = entry(uri, m, 'ServiceInterface');
    const rules = sectionRules(m);
    const designRule = rules.find((r) => r.sectionName === 'design')!;
    const decision = dropDecision(
      { docUri: uri, sectionName: 'arch', sectionLabel: 'Architectural Data', isDerived: true, items: [dragItemOf(svc)] },
      { docUri: uri, ...designRule },
      'copy',
    );
    expect(decision.canDrop).toBe(false);
    expect(decision.tooltip).toBe('Service Interface cannot be in Design Data');

    // And the host transform agrees: it would refuse the paste.
    const design = sectionOf(m, 'design');
    expect(() => pasteEntries(archText, design, [svc.serialize() as Record<string, unknown>])).toThrow();
  });
});
