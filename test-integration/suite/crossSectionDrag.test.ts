// Copyright 2026 The MathWorks, Inc.
// A drag whose rows come from two sections, through the real providers (V-002).
//
// The reported defect: select an entry in Design Data and one in Architectural Data, drag them onto
// Architectural Data, and the table refuses the drop as a no-op, with no message. Cutting the same
// two rows and pasting them into the same section works. The drag register kept ONE source section,
// the last contributing row's, and dropDecision compared that one value with the target. The
// clipboard already kept a section per item, and its paste rule asks whether EVERY item came from
// the target.
//
// So the test has to see what a real provider puts on the wire. Each case sends `dragStart` with
// both rows, takes the `dragState` descriptor the provider broadcast and the `sectionRules` it
// painted, and asks dropDecision what the table would show: what table-main's predictDrop does with
// the same two messages. Then it sends the `drop` and reads the file: the design entry has moved,
// and the arch entry is still in arch under its own name.
//
// Both .sldd formats, because the JSON provider and the binary one are separate editors and each
// fills the drag register itself. The dictionary is params.sldd in both, with MyBus moved into
// Architectural Data by its derived flag (the two sections share one namespace, so that flag is the
// whole split). The binary one is the real MATLAB-written file: a paste inserts before the chunk's
// trailing `DD.Dictionary` object, which the hand-written binary fixtures do not have (see
// multiPasteSelection.test.ts).
import * as assert from 'assert';
import * as vscode from 'vscode';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { SlddTextEditorProvider } from '../../src/host/SlddTextEditorProvider';
import { BinarySlddEditorProvider } from '../../src/host/BinarySlddEditorProvider';
import { clearDrag } from '../../src/host/dragState';
import { dropDecision } from 'data-explorer-view/model';
import { chunkOf, ctx, fakePanel, isEntryRow, nameOf, quiet, token, waitFor, ws, wsUri } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

const DESIGN_ENTRY = 'MyAlias';
const ARCH_ENTRY = 'MyBus';

/** `text` with the first `from` after `marker` replaced by `to`: one entry's flag, flipped. */
function flipAfter(text: string, marker: string, from: string, to: string): string {
  const at = text.indexOf(marker);
  assert.ok(at >= 0, `the fixture spells ${marker}`);
  const flag = text.indexOf(from, at);
  assert.ok(flag >= 0, `the fixture spells ${from} after ${marker}`);
  return text.slice(0, flag) + to + text.slice(flag + from.length);
}

const rowOf = (rows: any[], name: string): any => {
  const row = rows.find((r) => isEntryRow(r) && nameOf(r) === name);
  assert.ok(row, `the table has an entry row for "${name}"`);
  return row;
};

const errorsIn = (posts: any[]): string[] => posts.filter((m) => m.type === 'error').map((m) => String(m.message));

/**
 * What the table would show for a drop of the in-flight drag onto `sectionName`: the last
 * `dragState` descriptor the provider broadcast, against the `sectionRules` it painted.
 */
function predicted(posts: any[], painted: any, sectionName: string) {
  const drag = posts.filter((m) => m.type === 'dragState').pop();
  assert.ok(drag?.descriptor, 'the provider broadcast a drag descriptor');
  const rule = (painted.rules as any[]).find((r) => r.sectionName === sectionName);
  assert.ok(rule, `the dictionary has a ${sectionName} section`);
  return dropDecision(drag.descriptor, { docUri: painted.docUri, ...rule }, 'move');
}

interface Tab {
  view: ReturnType<typeof fakePanel>;
  rows: any[];
  /** The `sectionRules` message of the first paint. */
  painted: any;
  /** Entry name -> its derived flag, from what the document now holds. */
  derived: () => Map<string, string>;
}

/** Drag the two entries together, check the prediction, then drop them onto Architectural Data. */
async function dragBothOntoArch(tab: Tab): Promise<void> {
  const before = tab.derived();
  assert.strictEqual(before.get(DESIGN_ENTRY), '0', `${DESIGN_ENTRY} starts in Design Data`);
  assert.strictEqual(before.get(ARCH_ENTRY), '1', `${ARCH_ENTRY} starts in Architectural Data`);

  tab.view.posts.length = 0;
  tab.view.send({ type: 'dragStart', rowIds: [rowOf(tab.rows, DESIGN_ENTRY).ID, rowOf(tab.rows, ARCH_ENTRY).ID] });
  await waitFor('the drag descriptor', () => tab.view.posts.some((m) => m.type === 'dragState' && m.descriptor));

  // The prediction, from what the provider sent. Onto arch it was a silent no-op.
  const ontoArch = predicted(tab.view.posts, tab.painted, 'arch');
  assert.strictEqual(ontoArch.noop, false, 'onto arch: not refused as a no-op');
  assert.strictEqual(ontoArch.canDrop, true, 'onto arch: allowed');
  const ontoDesign = predicted(tab.view.posts, tab.painted, 'design');
  assert.strictEqual(ontoDesign.noop, false, 'onto design: not a no-op either');
  assert.strictEqual(ontoDesign.canDrop, true, 'onto design: allowed');

  // The drop the table now lets through.
  tab.view.posts.length = 0;
  tab.view.send({ type: 'drop', rowId: 'section:arch', mode: 'move' });
  await waitFor(
    'the drop to be applied or refused',
    () => errorsIn(tab.view.posts).length > 0 || tab.derived().get(DESIGN_ENTRY) === '1',
  );
  await quiet(100, 'an error reported after the drop landed');
  assert.deepStrictEqual(errorsIn(tab.view.posts), [], 'the drop is applied');

  const after = tab.derived();
  assert.strictEqual(after.get(DESIGN_ENTRY), '1', `${DESIGN_ENTRY} moved into Architectural Data`);
  assert.strictEqual(after.get(ARCH_ENTRY), '1', `${ARCH_ENTRY} is still in Architectural Data`);
  assert.deepStrictEqual(
    [...after.keys()].sort(),
    [...before.keys()].sort(),
    'every entry keeps its own name: nothing renamed, added or lost',
  );
  for (const [name, flag] of before) {
    if (name !== DESIGN_ENTRY) assert.strictEqual(after.get(name), flag, `${name} stays where it was`);
  }
}

suite('A drag across two sections, on a JSON .sldd', () => {
  test('is predicted as a move, and the drop moves the design entry into arch', async () => {
    const original = strFromU8(await vscode.workspace.fs.readFile(wsUri('params.sldd')));
    const text = flipAfter(original, `"name": "${ARCH_ENTRY}"`, '"isderived": "0"', '"isderived": "1"');
    const uri = wsUri('cross_section_drag.sldd');
    await vscode.workspace.fs.writeFile(uri, strToU8(text));
    const view = fakePanel();
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, view.panel, token());
      view.send({ type: 'ready' });
      await waitFor('the first paint', () => view.posts.some((m) => m.type === 'sectionRules'));
      const rows = view.posts.filter((m) => m.type === 'setRows').pop().rows as any[];
      const painted = view.posts.filter((m) => m.type === 'sectionRules').pop();
      const derived = () =>
        new Map<string, string>(
          (chunkOf(doc.getText()).entries as any[]).map((e) => [e.name, String(e.metadata?.isderived)]),
        );
      await dragBothOntoArch({ view, rows, painted, derived });
    } finally {
      view.close();
      clearDrag();
      await vscode.workspace.fs.delete(uri);
    }
  }).timeout(60000);
});

/** Entry name -> IsDerived, from a binary .sldd's data/chunk0.xml. */
function derivedOfXml(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const obj of xml.split('<Object Class="DD.ENTRY">').slice(1)) {
    const name = /<P Name="Name" Class="char">([^<]*)<\/P>/.exec(obj)?.[1];
    const derived = /<P Name="IsDerived" Class="char">([^<]*)<\/P>/.exec(obj)?.[1] ?? '0';
    assert.ok(name, 'every DD.ENTRY spells a Name');
    out.set(name!, derived);
  }
  return out;
}

suite('A drag across two sections, on a compressed-binary .sldd', () => {
  test('is predicted as a move, and the drop moves the design entry into arch', async () => {
    // The chunk is the only part changed, so the zip is otherwise MATLAB's.
    const binary = vscode.Uri.joinPath(ws(), '..', '..', '..', 'test', 'parity', 'artifacts', 'binary', 'params.sldd');
    const parts = unzipSync(await vscode.workspace.fs.readFile(binary));
    parts['data/chunk0.xml'] = strToU8(
      flipAfter(
        strFromU8(parts['data/chunk0.xml']),
        `<P Name="Name" Class="char">${ARCH_ENTRY}</P>`,
        '<P Name="IsDerived" Class="char">0</P>',
        '<P Name="IsDerived" Class="char">1</P>',
      ),
    );
    const uri = vscode.Uri.joinPath(ws(), '..', 'cross_section_drag_bin.sldd');
    await vscode.workspace.fs.writeFile(uri, zipSync(parts));

    const provider = new BinarySlddEditorProvider(ctx());
    const doc: any = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
    const view = fakePanel();
    try {
      await provider.resolveCustomEditor(doc, view.panel, token());
      view.send({ type: 'ready' });
      await waitFor('the first paint', () => view.posts.some((m) => m.type === 'sectionRules'));
      const rows = view.posts.filter((m) => m.type === 'setRows').pop().rows as any[];
      const painted = view.posts.filter((m) => m.type === 'sectionRules').pop();
      const derived = () => derivedOfXml(doc.chunkXml as string);
      await dragBothOntoArch({ view, rows, painted, derived });
    } finally {
      view.close();
      doc.dispose();
      clearDrag();
      await vscode.workspace.fs.delete(uri);
    }
  }).timeout(60000);
});
