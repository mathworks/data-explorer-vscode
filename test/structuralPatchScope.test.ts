// Copyright 2026 The MathWorks, Inc.
//
// What a structural edit actually CHANGES about the document text — one region of it.
//
// Every transform in structuralEdit.ts already produces its new text by splicing a single
// region: delete drops an element, add-child and delete-child rewrite the owning element,
// paste inserts one. Only the region was never reported, so the host wrote the whole
// document back to say it — a 47.8 MB WorkspaceEdit for a 1 KB change, which is what makes
// a delete (and its undo, which VS Code stores as the inverse of what it was handed) cost
// seconds on a real dictionary.
//
// So each result now carries the `patch` that produced it, and what this file pins is that
// the two cannot disagree: applying the patch to the input text must yield exactly the
// `newText` the same call returned, for every transform and every entry of a real fixture.
// That equality is the whole safety argument for writing the narrow edit instead of the
// wide one — the document ends up byte-for-byte what it would have been.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel, findNode, invalidate } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';
import { findEntrySpan } from '../src/host/entrySplice.js';
import {
  addChild,
  applyTextPatch,
  deleteChild,
  deleteEntry,
  pasteEntries,
  pasteEntry,
  type StructuralResult,
} from '../src/host/structuralEdit.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fixtureText = readFileSync(
  fileURLToPath(new URL('../test-integration/fixtures/workspace/data.sldd', import.meta.url)),
  'utf8',
);

function freshModel(uri: string) {
  invalidate(uri);
  return getModel(uri, 'data.sldd', fixtureText);
}

/** Every top-level entry node of the fixture, in document order. */
function entryNodes(uri: string): any[] {
  const model = freshModel(uri);
  return (model.children ?? []).flatMap((s: any) => s.children ?? []);
}

function nodeNamed(uri: string, name: string): any {
  const model = freshModel(uri);
  const row = buildRows(model).find((r: any) => r.Name?.label === name && !String(r.ID).startsWith('section:'));
  expect(row, `the fixture has a row named "${name}"`).toBeTruthy();
  return findNode(uri, row.ID);
}

/**
 * The patch and the text it claims to produce say the same thing.
 *
 * The one assertion every case below shares, because it is the one the host relies on: it
 * applies the patch and never looks at newText, so anything the two disagree about is a
 * document written wrong.
 */
function patchProducesNewText(text: string, result: StructuralResult, label: string): void {
  expect(result.patch, `${label} reports the region it changed`).toBeTruthy();
  const patch = result.patch!;
  expect(patch.offset, `${label} patch offset within the text`).toBeGreaterThanOrEqual(0);
  expect(patch.offset + patch.length, `${label} patch end within the text`).toBeLessThanOrEqual(text.length);
  expect(applyTextPatch(text, patch), `${label} patch reproduces newText`).toBe(result.newText);
}

describe('a structural edit reports the one region it changes', () => {
  it('delete: every entry of the fixture, patch for patch', () => {
    const nodes = entryNodes('test://patch-delete.sldd');
    expect(nodes.length).toBeGreaterThan(3);
    for (const node of nodes) {
      patchProducesNewText(fixtureText, deleteEntry(fixtureText, node), `delete "${node.name}"`);
    }
  });

  it('delete leaves the bytes of the entries it did not touch outside the patched region', () => {
    // The point of the narrow write: an untouched entry is not merely re-written
    // identically, it is not written at all.
    const node = nodeNamed('test://patch-delete-scope.sldd', 'Number');
    const { patch } = deleteEntry(fixtureText, node);
    const other = findEntrySpan(fixtureText, 'PI');
    expect(other).toBeTruthy();
    const touched = (from: number, to: number) => from < patch!.offset + patch!.length && to > patch!.offset;
    expect(touched(other!.offset, other!.offset + other!.length)).toBe(false);
  });

  it('add-child: the owning entry’s span and nothing else', () => {
    const node = nodeNamed('test://patch-add-child.sldd', 'Struct');
    const result = addChild(fixtureText, node);
    patchProducesNewText(fixtureText, result, 'addChild Struct');
    const span = findEntrySpan(fixtureText, 'Struct');
    expect(result.patch!.offset).toBe(span!.offset);
    expect(result.patch!.length).toBe(span!.length);
  });

  it('delete-child: the owning entry’s span and nothing else', () => {
    const parent = nodeNamed('test://patch-del-child.sldd', 'Struct');
    expect(parent.children.length).toBeGreaterThan(0);
    const result = deleteChild(fixtureText, parent.children[0]);
    patchProducesNewText(fixtureText, result, 'deleteChild Struct field');
    const span = findEntrySpan(fixtureText, 'Struct');
    expect(result.patch!.offset).toBe(span!.offset);
    expect(result.patch!.length).toBe(span!.length);
  });

  it('paste: a pure insertion, replacing nothing', () => {
    const src = nodeNamed('test://patch-paste.sldd', 'Number');
    const result = pasteEntry(fixtureText, src.parent, src.serialize() as Record<string, unknown>);
    patchProducesNewText(fixtureText, result, 'pasteEntry Number');
    expect(result.patch!.length, 'an insertion overwrites nothing').toBe(0);
  });

  it('paste into an EMPTY entries array reports its insertion too', () => {
    // The empty-array insertion point is a different branch of findEntriesArrayInsertion
    // (just inside the `[`), and it is the one a freshly created dictionary hits.
    const root = JSON.parse(fixtureText);
    root.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries = [];
    const emptyText = JSON.stringify(root, null, 2);
    const uri = 'test://patch-paste-empty.sldd';
    invalidate(uri);
    const empty = getModel(uri, 'data.sldd', emptyText);
    const src = nodeNamed('test://patch-paste-empty-src.sldd', 'Number');

    const result = pasteEntry(emptyText, empty.getSection('design'), src.serialize() as Record<string, unknown>);
    patchProducesNewText(emptyText, result, 'pasteEntry into an empty array');
  });

  it('multi-paste (a drop) folds its inserts into ONE contiguous patch', () => {
    // Each paste inserts after the element the previous one added, so the combined
    // effect is a single insertion at the first insertion point — which is what makes a
    // multi-select drop one narrow write rather than a full-document one.
    const src = nodeNamed('test://patch-multi-paste.sldd', 'Number');
    const other = nodeNamed('test://patch-multi-paste-2.sldd', 'PI');
    const payloads = [src.serialize(), other.serialize()] as Record<string, unknown>[];
    const model = freshModel('test://patch-multi-paste-target.sldd');
    const result = pasteEntries(fixtureText, model.getSection('design'), payloads);

    expect(result.patch, 'the fold reports a patch').toBeTruthy();
    expect(result.patch!.length, 'two insertions still overwrite nothing').toBe(0);
    expect(applyTextPatch(fixtureText, result.patch!)).toBe(result.newText);
  });
});
