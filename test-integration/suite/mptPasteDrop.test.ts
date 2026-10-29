// Copyright 2026 The MathWorks, Inc.
// A paste or a drop of an mpt entry, through the real providers (C-180).
//
// The ruling: a paste or a drop of an mpt.Parameter or mpt.Signal entry the dictionary already
// holds is admitted into Design Data, while creating one from scratch stays refused. Core answers
// admission with SectionNode.allowsType, which the host's paste asks. The table predicts the same
// answer locally from the `sectionRules` the provider posts: the drop cursor through dropDecision,
// and the Paste item through buildContextMenuItems. Those rules held the creation list,
// getAllowedTypes, which names no mpt class. So the table refused an entry the host would accept,
// and Ctrl+V, which goes through the menu's decision, never reached the host.
//
// So each case reads what a real provider puts on the wire: the `sectionRules` of the first paint,
// the `clipboardState` a copy broadcasts, and the `dragState` a drag broadcasts. It asks the
// table's own functions what they would show over a Design Data row and an Architectural Data row.
// Then it sends the paste and the drop, and reads the file.
//
// Both .sldd formats, because the JSON provider and the binary one are separate editors. The
// dictionary is params.sldd in both, with gravity re-classed as an mpt.Parameter and sig1 as an
// mpt.Signal. MyBus is moved into Architectural Data by its derived flag, so that section has a
// row to paste over (the two sections share one namespace, so the flag is the whole split).
import * as assert from 'assert';
import * as vscode from 'vscode';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { SlddTextEditorProvider } from '../../src/host/SlddTextEditorProvider';
import { BinarySlddEditorProvider } from '../../src/host/BinarySlddEditorProvider';
import { clearClipboard } from '../../src/host/clipboard';
import { clearDrag } from '../../src/host/dragState';
import { dropDecision } from 'data-explorer-view/model/actions/dropDecision.js';
import { buildContextMenuItems } from 'data-explorer-view/widgets/tree-table/menuItems.js';
import { chunkOf, ctx, fakePanel, isEntryRow, nameOf, quiet, token, waitFor, ws, wsUri } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PARAM = 'gravity';
const SIGNAL = 'sig1';
const ARCH_ENTRY = 'MyBus';
const REFUSED_IN_ARCH = 'Simulink Parameter cannot be in Architectural Data';

/** `text` with the first `from` after `marker` replaced by `to`. */
function replaceAfter(text: string, marker: string, from: string, to: string): string {
  const at = text.indexOf(marker);
  assert.ok(at >= 0, `the fixture spells ${marker}`);
  const hit = text.indexOf(from, at);
  assert.ok(hit >= 0, `the fixture spells ${from} after ${marker}`);
  return text.slice(0, hit) + to + text.slice(hit + from.length);
}

const rowOf = (rows: any[], name: string): any => {
  const row = rows.find((r) => isEntryRow(r) && nameOf(r) === name);
  assert.ok(row, `the table has an entry row for "${name}"`);
  return row;
};

const errorsIn = (posts: any[]): string[] => posts.filter((m) => m.type === 'error').map((m) => String(m.message));

interface Tab {
  view: ReturnType<typeof fakePanel>;
  rows: any[];
  /** The `sectionRules` message of the first paint. */
  painted: any;
  /** What the document holds now: the file's text, or the binary chunk. */
  snapshot: () => string;
  /** `name class isderived` for each mpt entry the document holds, sorted. */
  mpt: () => string[];
}

const ruleOf = (tab: Tab, sectionName: string): any => {
  const rule = (tab.painted.rules as any[]).find((r) => r.sectionName === sectionName);
  assert.ok(rule, `the dictionary has a ${sectionName} section`);
  return rule;
};

/** The Paste item the table would show over `row`: table-main's menuFor, on the posted facts. */
function pasteItemOver(tab: Tab, clip: any, row: any, sectionName: string): any {
  const rule = ruleOf(tab, sectionName);
  const items = buildContextMenuItems({
    rows: tab.rows,
    selectedRowIds: [row.ID],
    anchorRowId: row.ID,
    clipboard: { canPaste: clip.canPaste, mode: clip.mode, items: clip.items },
    editable: true,
    hasTextView: true,
    pasteTarget: { sectionLabel: rule.sectionLabel, isDerived: rule.isDerived, allowedTypes: rule.allowedTypes },
  });
  const paste = items.find((i) => i.id === 'paste');
  assert.ok(paste, 'the menu has a Paste item');
  return paste;
}

/** Send `msg`, and wait for the host to refuse it or to change the document. */
async function answered(tab: Tab, msg: any): Promise<void> {
  const before = tab.snapshot();
  tab.view.posts.length = 0;
  tab.view.send(msg);
  await waitFor(`an answer to ${msg.type}`, () => errorsIn(tab.view.posts).length > 0 || tab.snapshot() !== before);
  await quiet(100, `a second answer to ${msg.type}: an error after the write, or a write after the refusal`);
}

async function pasteAndDrop(tab: Tab): Promise<void> {
  const param = rowOf(tab.rows, PARAM);
  const signal = rowOf(tab.rows, SIGNAL);
  const archRow = rowOf(tab.rows, ARCH_ENTRY);
  assert.deepStrictEqual(tab.mpt(), [`${PARAM} mpt.Parameter 0`, `${SIGNAL} mpt.Signal 0`], 'the two mpt entries');

  // The rules the provider posted say what a paste admits: the mpt classes into design only.
  for (const cls of ['mpt.Parameter', 'mpt.Signal']) {
    assert.ok(ruleOf(tab, 'design').allowedTypes.includes(cls), `Design Data's posted rule admits ${cls}`);
    assert.ok(!ruleOf(tab, 'arch').allowedTypes.includes(cls), `Architectural Data's posted rule does not admit ${cls}`);
  }

  // Copy both. The Paste item over a design row is offered, and over an arch row it says why not.
  tab.view.posts.length = 0;
  tab.view.send({ type: 'copy', rowIds: [param.ID, signal.ID] });
  await waitFor('the clipboard state', () => tab.view.posts.some((m) => m.type === 'clipboardState' && m.items?.length === 2));
  const clip = tab.view.posts.filter((m) => m.type === 'clipboardState').pop();
  const overDesign = pasteItemOver(tab, clip, param, 'design');
  assert.ok(!overDesign.disabled, `Paste over a design row is offered (reason: ${overDesign.reason})`);
  const overArch = pasteItemOver(tab, clip, archRow, 'arch');
  assert.strictEqual(overArch.disabled, true, 'Paste over an arch row is not offered');
  assert.strictEqual(overArch.reason, REFUSED_IN_ARCH);

  // The paste the menu now offers lands, and each copy keeps its class.
  await answered(tab, { type: 'paste', rowId: param.ID });
  assert.deepStrictEqual(errorsIn(tab.view.posts), [], 'the paste into design is applied');
  const afterPaste = tab.mpt();
  assert.strictEqual(afterPaste.length, 4, `two mpt copies were added: ${afterPaste.join(', ')}`);
  assert.deepStrictEqual(
    afterPaste.map((e) => e.split(' ').slice(1).join(' ')).sort(),
    ['mpt.Parameter 0', 'mpt.Parameter 0', 'mpt.Signal 0', 'mpt.Signal 0'],
    'both copies are in design, with their classes',
  );

  // The host still refuses the same paste over the arch row, which the menu does not offer.
  const beforeArch = tab.snapshot();
  await answered(tab, { type: 'paste', rowId: archRow.ID });
  const refusal = errorsIn(tab.view.posts);
  assert.strictEqual(refusal.length, 1, `one refusal: ${refusal.join(' | ')}`);
  assert.ok(
    refusal[0].includes('A "mpt.Parameter" entry is not allowed in Architectural Data.'),
    `the refusal names the class and the section: ${refusal[0]}`,
  );
  assert.strictEqual(tab.snapshot(), beforeArch, 'and the document is untouched');

  // A drag of the same two rows: the cursor allows a copy onto design, and refuses arch.
  tab.view.posts.length = 0;
  tab.view.send({ type: 'dragStart', rowIds: [param.ID, signal.ID] });
  await waitFor('the drag descriptor', () => tab.view.posts.some((m) => m.type === 'dragState' && m.descriptor));
  const drag = tab.view.posts.filter((m) => m.type === 'dragState').pop().descriptor;
  const ontoDesign = dropDecision(drag, { docUri: tab.painted.docUri, ...ruleOf(tab, 'design') }, 'copy');
  assert.strictEqual(ontoDesign.canDrop, true, `a copy onto design is allowed (${ontoDesign.tooltip})`);
  const ontoArch = dropDecision(drag, { docUri: tab.painted.docUri, ...ruleOf(tab, 'arch') }, 'copy');
  assert.strictEqual(ontoArch.canDrop, false, 'a copy onto arch is refused');
  assert.strictEqual(ontoArch.tooltip, REFUSED_IN_ARCH);

  // And the drop the cursor allows lands too.
  await answered(tab, { type: 'drop', rowId: 'section:design', mode: 'copy' });
  assert.deepStrictEqual(errorsIn(tab.view.posts), [], 'the drop onto design is applied');
  const afterDrop = tab.mpt();
  assert.strictEqual(afterDrop.length, 6, `two more mpt copies were added: ${afterDrop.join(', ')}`);
  assert.ok(afterDrop.every((e) => e.endsWith(' 0')), 'every copy is in design');
}

/** The params.sldd text with the two entries re-classed and MyBus moved into arch. */
function mptJson(original: string): string {
  let text = replaceAfter(original, `"name": "${PARAM}"`, '"Simulink.Parameter"', '"mpt.Parameter"');
  text = replaceAfter(text, `"name": "${SIGNAL}"`, '"Simulink.Signal"', '"mpt.Signal"');
  return replaceAfter(text, `"name": "${ARCH_ENTRY}"`, '"isderived": "0"', '"isderived": "1"');
}

suite('A paste and a drop of an mpt entry, on a JSON .sldd', () => {
  test('are offered and applied in Design Data, and refused in Architectural Data', async () => {
    const original = strFromU8(await vscode.workspace.fs.readFile(wsUri('params.sldd')));
    const uri = wsUri('mpt_paste_drop.sldd');
    await vscode.workspace.fs.writeFile(uri, strToU8(mptJson(original)));
    const view = fakePanel();
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, view.panel, token());
      view.send({ type: 'ready' });
      await waitFor('the first paint', () => view.posts.some((m) => m.type === 'sectionRules'));
      await pasteAndDrop({
        view,
        rows: view.posts.filter((m) => m.type === 'setRows').pop().rows as any[],
        painted: view.posts.filter((m) => m.type === 'sectionRules').pop(),
        snapshot: () => doc.getText(),
        mpt: () =>
          (chunkOf(doc.getText()).entries as any[])
            .filter((e) => String(e.value?._array_class ?? '').startsWith('mpt.'))
            .map((e) => `${e.name} ${e.value._array_class} ${e.metadata?.isderived}`)
            .sort(),
      });
    } finally {
      view.close();
      clearClipboard();
      clearDrag();
      await vscode.workspace.fs.delete(uri);
    }
  }).timeout(60000);
});

/** `name class isderived` for each mpt entry of a binary .sldd's data/chunk0.xml, sorted. */
function mptOfXml(xml: string): string[] {
  const out: string[] = [];
  for (const obj of xml.split('<Object Class="DD.ENTRY">').slice(1)) {
    const name = /<P Name="Name" Class="char">([^<]*)<\/P>/.exec(obj)?.[1];
    const derived = /<P Name="IsDerived" Class="char">([^<]*)<\/P>/.exec(obj)?.[1] ?? '0';
    const cls = /<Element Class="([^"]*)">/.exec(obj)?.[1] ?? '';
    if (cls.startsWith('mpt.')) out.push(`${name} ${cls} ${derived}`);
  }
  return out.sort();
}

suite('A paste and a drop of an mpt entry, on a compressed-binary .sldd', () => {
  test('are offered and applied in Design Data, and refused in Architectural Data', async () => {
    // The real MATLAB-written file, with only the chunk changed: a paste inserts before the
    // chunk's trailing `DD.Dictionary` object, which the hand-written binary fixtures lack.
    const binary = vscode.Uri.joinPath(ws(), '..', '..', '..', 'test', 'parity', 'artifacts', 'binary', 'params.sldd');
    const parts = unzipSync(await vscode.workspace.fs.readFile(binary));
    let xml = strFromU8(parts['data/chunk0.xml']);
    xml = replaceAfter(xml, `<P Name="Name" Class="char">${PARAM}</P>`, '<Element Class="Simulink.Parameter">', '<Element Class="mpt.Parameter">');
    xml = replaceAfter(xml, `<P Name="Name" Class="char">${SIGNAL}</P>`, '<Element Class="Simulink.Signal">', '<Element Class="mpt.Signal">');
    xml = replaceAfter(
      xml,
      `<P Name="Name" Class="char">${ARCH_ENTRY}</P>`,
      '<P Name="IsDerived" Class="char">0</P>',
      '<P Name="IsDerived" Class="char">1</P>',
    );
    parts['data/chunk0.xml'] = strToU8(xml);
    const uri = vscode.Uri.joinPath(ws(), '..', 'mpt_paste_drop_bin.sldd');
    await vscode.workspace.fs.writeFile(uri, zipSync(parts));

    const provider = new BinarySlddEditorProvider(ctx());
    const doc: any = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
    const view = fakePanel();
    try {
      await provider.resolveCustomEditor(doc, view.panel, token());
      view.send({ type: 'ready' });
      await waitFor('the first paint', () => view.posts.some((m) => m.type === 'sectionRules'));
      await pasteAndDrop({
        view,
        rows: view.posts.filter((m) => m.type === 'setRows').pop().rows as any[],
        painted: view.posts.filter((m) => m.type === 'sectionRules').pop(),
        snapshot: () => doc.chunkXml as string,
        mpt: () => mptOfXml(doc.chunkXml as string),
      });
    } finally {
      view.close();
      doc.dispose();
      clearClipboard();
      clearDrag();
      await vscode.workspace.fs.delete(uri);
    }
  }).timeout(60000);
});
