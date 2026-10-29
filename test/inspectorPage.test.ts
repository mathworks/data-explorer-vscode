// Copyright 2026 The MathWorks, Inc.
//
// The Property Inspector's page (src/view/model/inspector/inspectorPage.ts): what it is sent, on which `ready`,
// and when a node handed to it again is not sent at all.
//
// The binary .sldd and MAT-file editors hand the inspector its node again whenever the document's
// tree changes (inspectorSelection.ts), the binary one at every edit, undo and redo, and a
// `showProps` closes an open Variable Editor. So the page is sent a node only when that changes
// what it shows: its rows, or the cells its open Variable Editor was sent. The nodes here are
// real ones, read by the same reader the JSON view uses, re-read under the same id after an edit
// as an editor re-reads them; PropertiesViewProvider's wiring of this is in
// test-integration/suite/propertiesView.test.ts.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel, invalidate } from '../src/view/model/workspace/SlddModel.js';
import { InspectorPage } from '../src/view/model/inspector/inspectorPage.js';

const URI = 'pi://numeric_json.sldd';
const FIXTURE = readFileSync(fileURLToPath(new URL('./fixtures/numeric_json.sldd', import.meta.url)), 'utf8');

/** A 10x10 double whose cells are 0..99, with cell (row, col) set to `at` if given. */
function matrix(at?: { row: number; col: number; value: string }): string {
  const rows = Array.from({ length: 10 }, (_, i) =>
    '[' + Array.from({ length: 10 }, (_, j) => (at && at.row === i && at.col === j ? at.value : String(i * 10 + j))).join(', ') + ']',
  );
  return 'Matrix(10,10)\n' + rows.join('\n');
}

/**
 * The fixture's tree, read again under one uri as an editor re-reads it after an edit: `Matrix`
 * as `matrix`, and `Number` as `number`.
 */
function tree(edit: { matrix?: string; number?: number } = {}): { entry: (name: string) => any } {
  const doc = JSON.parse(FIXTURE);
  const entries = doc.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries as any[];
  entries.find((e) => e.name === 'Matrix').value._value = edit.matrix ?? matrix();
  if (edit.number !== undefined) entries.find((e) => e.name === 'Number').value = edit.number;
  invalidate(URI);
  const root = getModel(URI, 'numeric_json.sldd', JSON.stringify(doc));
  return {
    entry: (name) => {
      const found = (root.children as any[]).flatMap((s) => s.children as any[]).find((e) => e.name === name);
      expect(found, name).toBeTruthy();
      return found;
    },
  };
}

const valueOf = (message: any): string | undefined =>
  message.groups?.flatMap((g: any) => g.properties).find((p: any) => p.name === 'Value')?.value;

describe('InspectorPage', () => {
  let posted: any[];
  let page: InspectorPage;

  beforeEach(() => {
    posted = [];
    page = new InspectorPage((m) => void posted.push(m));
    page.opened();
  });

  describe('which ready is sent what', () => {
    it('holds a node shown before the page is ready, and sends it on ready', () => {
      page.show(tree().entry('Number'));
      expect(posted).toEqual([]);
      page.loaded();
      expect(posted.map((m) => m.type)).toEqual(['showProps']);
    });

    it('sends every later ready what it holds then: a page hidden and shown again reloads empty', () => {
      page.loaded();
      page.show(tree().entry('Number'));
      page.clear();
      page.show(tree({ number: 2 }).entry('Number'));
      const before = posted.length;
      page.loaded();
      expect(posted.slice(before).map(valueOf)).toEqual(['2']);
    });

    it('sends a ready nothing when it holds nothing, and a closed view takes what it held', () => {
      page.show(tree().entry('Number'));
      page.closed();
      page.opened();
      page.loaded();
      expect(posted).toEqual([]);
      expect(page.node).toBeNull();
    });
  });

  describe('a node shown again', () => {
    beforeEach(() => page.loaded());

    it('is not sent when an edit elsewhere left its rows as they were, though it is the node kept', () => {
      const before = tree().entry('Matrix');
      page.show(before, URI);
      const after = tree({ number: 2 }).entry('Matrix');
      expect(after).not.toBe(before);
      page.show(after, URI);
      expect(posted.map((m) => m.type)).toEqual(['showProps']);
      // A Variable Editor opened now is answered from the tree as it is.
      expect(page.node).toBe(after);
    });

    it('is sent when the edit changed what its rows say', () => {
      page.show(tree().entry('Number'), URI);
      page.show(tree({ number: 2 }).entry('Number'), URI);
      expect(posted.map(valueOf)).toEqual(['1', '2']);
    });

    it('is sent when the edit changed a cell its open Variable Editor shows, behind rows that read the same', () => {
      page.show(tree().entry('Matrix'), URI);
      page.answerMatrix(page.node.id);
      expect(posted.map((m) => m.type)).toEqual(['showProps', 'matrixCells']);
      const edited = tree({ matrix: matrix({ row: 3, col: 4, value: '-1' }) }).entry('Matrix');
      page.show(edited, URI);
      expect(posted.map((m) => m.type)).toEqual(['showProps', 'matrixCells', 'showProps']);
      // The rows did read the same: it is the cells that differ.
      expect(posted[2].groups).toEqual(posted[0].groups);
    });

    it('is not sent for its cells when its Variable Editor was opened and an edit elsewhere left them', () => {
      page.show(tree().entry('Matrix'), URI);
      page.answerMatrix(page.node.id);
      page.show(tree({ number: 2 }).entry('Matrix'), URI);
      expect(posted.map((m) => m.type)).toEqual(['showProps', 'matrixCells']);
    });

    it('is not sent for a changed cell no Variable Editor on the page shows', () => {
      // Never opened, or closed by a `showProps` or a reload since: the cells are on no page.
      page.show(tree().entry('Matrix'), URI);
      page.show(tree({ matrix: matrix({ row: 0, col: 0, value: '5' }) }).entry('Matrix'), URI);
      page.answerMatrix(page.node.id);
      page.loaded();
      const before = posted.length;
      page.show(tree({ matrix: matrix({ row: 0, col: 0, value: '6' }) }).entry('Matrix'), URI);
      expect(posted.length).toBe(before);
    });

    it('is sent after a clear, whatever it was before', () => {
      const node = tree().entry('Number');
      page.show(node);
      page.clear();
      page.show(node);
      expect(posted.map((m) => m.type)).toEqual(['showProps', 'empty', 'showProps']);
    });
  });

  it('answers a matrix request for the node on display only', () => {
    page.loaded();
    page.show(tree().entry('Matrix'), URI);
    page.answerMatrix('pi://numeric_json.sldd/design/Other');
    expect(posted[1]).toMatchObject({ type: 'matrixCells', nodeId: 'pi://numeric_json.sldd/design/Other' });
    expect(posted[1].matrix).toBeUndefined();
    page.answerMatrix(page.node.id);
    expect(posted[2].matrix.dims).toEqual([10, 10]);
  });
});
