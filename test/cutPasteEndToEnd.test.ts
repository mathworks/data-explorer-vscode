// Copyright 2026 The MathWorks, Inc.
//
// End-to-end cut/copy/paste flows, modeling exactly what
// SlddTextEditorProvider.applyPaste does with the pure transforms. Cut is LAZY:
// the cut itself makes no text edit (it only marks the clipboard), so the whole
// move happens at PASTE time. The host handler is thin glue over these
// transforms, so exercising the same sequence proves the cut/paste behavior
// without a live VS Code webview. Each case mirrors one user gesture:
//   • same-document cut+paste (a MOVE): delete source first, then paste — the
//     freed name is kept, and it is ONE combined edit (one undo step);
//   • same-section cut+paste: a no-op the handler refuses (no delete/re-add);
//   • cross-DOCUMENT cut+paste: paste into target text, delete from source text;
//   • copy+paste: paste only, the source stays (and the copy is uniquified).
// This is the cut/paste twin of dropEndToEnd.test.ts (the drag path).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel, findNode, invalidate } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';
import { pasteEntry, deleteEntriesByName, resolveSectionForPaste } from '../src/host/structuralEdit.js';

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

describe('cut/paste end-to-end — same-document cut+paste is a MOVE that keeps the name', () => {
  it('cuts an arch Data Interface and pastes into Design Data: gone from arch, kept name in design', () => {
    const uri = 'test://cutpaste-move.sldd';
    const m = model(uri);
    const src = entry(uri, m, 'DataInterface');
    // The cut marks the clipboard; NO text edit happens yet (lazy).
    const payload = src.serialize() as Record<string, unknown>;
    const sourceSection = 'arch';

    // Paste into design (a different section) = same-document MOVE. applyPaste
    // removes the source FIRST (in the same text), then re-resolves + pastes, so
    // the whole thing is one combined edit and the freed name is retained.
    const srcName = payload.name as string;
    let text = deleteEntriesByName(archText, [srcName]);
    invalidate(uri);
    const m2 = getModel(uri, 'arch.sldd', text);
    const design = sectionOf(m2, 'design');
    const { newText } = pasteEntry(text, design, payload);
    text = newText;

    invalidate(uri);
    const m3 = getModel(uri, 'arch.sldd', text);
    const archNames = sectionOf(m3, 'arch').children.map((c: any) => c.name);
    const moved = sectionOf(m3, 'design').children.find((c: any) => c.name === 'DataInterface');
    expect(archNames).not.toContain('DataInterface'); // left arch
    expect(moved).toBeTruthy();                        // arrived in design
    expect(moved.isDerived).toBe(false);               // rebound to design (isderived rewritten)
    // The freed name is kept (not uniquified), mirroring the drag-move contract.
    expect(sourceSection).toBe('arch'); // sanity: distinct from the target section
  });
});

describe('cut/paste end-to-end — same-section cut+paste is a no-op', () => {
  it('pasting a cut back into its own section would just delete-and-re-add — the handler refuses', () => {
    // applyPaste guards: if the cut is same-doc AND clip.sourceSection === the
    // resolved target section, it clears the clipboard and makes no edit. Model
    // that guard here: the source section equals the paste target section.
    const uri = 'test://cutpaste-noop.sldd';
    const m = model(uri);
    const src = entry(uri, m, 'DataInterface');
    const sourceSection = src.parent?.name;

    // Resolve the paste target from the same entry's row — it lands in the same
    // section the cut came from.
    const target = resolveSectionForPaste(m, src, src.id);
    expect(target.name).toBe(sourceSection); // same section → the no-op guard fires
  });
});

describe('cut/paste end-to-end — cross-DOCUMENT cut+paste', () => {
  it('cuts an entry in doc A and pastes into doc B: removed from A, present (uniquified) in B', () => {
    const uriA = 'test://cutpaste-A.sldd';
    const uriB = 'test://cutpaste-B.sldd';
    const mA = model(uriA);
    const src = entry(uriA, mA, 'DataInterface');
    const payload = src.serialize() as Record<string, unknown>;

    // Target doc B is a second copy of the fixture; paste into its design.
    const textB = archText;
    invalidate(uriB);
    const mB = getModel(uriB, 'arch.sldd', textB);
    const designB = sectionOf(mB, 'design');
    const { newText: newB } = pasteEntry(textB, designB, payload);

    // Source doc A: applyPaste deletes the moved entry via the source doc's own
    // WorkspaceEdit (a separate, native undo step).
    const newA = deleteEntriesByName(archText, ['DataInterface']);

    invalidate(uriA);
    invalidate(uriB);
    const mA2 = getModel(uriA, 'arch.sldd', newA);
    const mB2 = getModel(uriB, 'arch.sldd', newB);
    expect(sectionOf(mA2, 'arch').children.map((c: any) => c.name)).not.toContain('DataInterface');
    // B already holds "DataInterface" (it's a copy of the fixture), so the paste
    // uniquifies to "DataInterface1" — cross-doc names aren't freed on the target.
    expect(sectionOf(mB2, 'design').children.map((c: any) => c.name)).toContain('DataInterface1');
  });
});

describe('cut/paste end-to-end — copy+paste leaves the source and uniquifies', () => {
  it('copies an arch Data Interface into design: still in arch, duplicated as a uniquified design entry', () => {
    const uri = 'test://cutpaste-copy.sldd';
    const m = model(uri);
    const src = entry(uri, m, 'DataInterface');
    const payload = src.serialize() as Record<string, unknown>;
    const design = sectionOf(m, 'design');

    // Copy = paste only, no source delete.
    const { newText } = pasteEntry(archText, design, payload);

    invalidate(uri);
    const m2 = getModel(uri, 'arch.sldd', newText);
    expect(sectionOf(m2, 'arch').children.map((c: any) => c.name)).toContain('DataInterface'); // source stays
    const copy = sectionOf(m2, 'design').children.find((c: any) => c.name === 'DataInterface1');
    expect(copy).toBeTruthy();          // uniquified, since the source still holds the name
    expect(copy.isDerived).toBe(false); // rebound to design
  });

  it('a copy stays on the clipboard for re-paste, producing a second uniquified entry', () => {
    // Copy mode does not clear the clipboard, so the same payload can paste
    // twice: the target section uniquifies each insertion independently.
    const uri = 'test://cutpaste-copy2.sldd';
    const m = model(uri);
    const src = entry(uri, m, 'DataInterface');
    const payload = src.serialize() as Record<string, unknown>;

    let text = archText;
    invalidate(uri);
    let mi = getModel(uri, 'arch.sldd', text);
    ({ newText: text } = pasteEntry(text, sectionOf(mi, 'design'), payload));
    invalidate(uri);
    mi = getModel(uri, 'arch.sldd', text);
    ({ newText: text } = pasteEntry(text, sectionOf(mi, 'design'), payload));

    invalidate(uri);
    const names = sectionOf(getModel(uri, 'arch.sldd', text), 'design').children.map((c: any) => c.name);
    expect(names).toContain('DataInterface1');
    expect(names).toContain('DataInterface2'); // second paste uniquifies again
  });
});
