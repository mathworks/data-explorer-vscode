// Copyright 2026 The MathWorks, Inc.
// Renaming a catalogued Architectural Data entry in a compressed-binary .sldd, inside real
// VS Code — because what that rename changes is a part of the zip the editor does not edit.
//
// A `Simulink.Bus` that System Composer models as a struct type says so nowhere in
// `data/chunk0.xml`. It says so in a SECOND zip member, `interfaceDictionary.xml`, which
// lists the definition BY NAME. That member is a pass-through part: the document keeps it in
// `zipMeta` and re-zips it verbatim on every save. So carrying a rename into it is not a text
// edit, it is a member swap — and a member swap is only correct if it survives everything
// VS Code does to a custom document afterwards. That is what only this test host can show:
//
//   save    re-zips zipMeta, so the patched member has to be the one written to disk
//   undo    VS Code calls the closure the provider handed it; the member must come back
//           BYTE-identical (the part is written verbatim, so a rebuilt one would land in the
//           user's file as a reformatting of a part this session never meant to touch)
//   revert  re-reads the file, and used to restore only the chunk — leaving a patched
//           catalog beside a chunk from disk, then writing that pair on the next save
//
// The vitest suite (scRenameCarry.test.ts) covers which sites move and why. A webview cannot
// be driven from the test host (see cutPasteUndo.test.ts), so the edit is performed here the
// way the message handler performs it: mutate the model, splice the chunk, then pushEdit with
// the part patch — the provider's own applyEdit, minus the message that starts it.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { unzipSync } from 'fflate';
import { DataModel, SC_PART_XML, SlddNode, parseBinarySlddParts, serializeEntryToXml } from 'data-explorer-core';
import { BinarySlddEditorProvider } from '../../src/host/BinarySlddEditorProvider';
import { catalogRenameOf, scXmlRenamePatch } from '../../src/host/scRename';
import { mutateEntry } from '../../src/host/entryOps';
import { entrySelectorOf } from '../../src/host/entrySelector';
import { findEntryObjectSpan } from '../../src/host/xmlEntrySplice';

/* eslint-disable @typescript-eslint/no-explicit-any */

function ctx(): vscode.ExtensionContext {
  const ext = vscode.extensions.getExtension('mathworks.simulink-data-explorer');
  assert.ok(ext, 'the extension must be present');
  return { extensionUri: ext!.extensionUri } as unknown as vscode.ExtensionContext;
}

function ws(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'a workspace folder must be open');
  return folder!.uri;
}

function token() {
  return new vscode.CancellationTokenSource().token;
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A working copy of the vitest suite's architectural fixture.
 *
 * Sourced from `test/fixtures` rather than duplicated here, so the dictionary this asks
 * about is the same one the unit tests ask about; and written OUTSIDE the workspace folder,
 * whose exact file set two other suites assert.
 */
async function workingCopy(name: string): Promise<vscode.Uri> {
  const src = vscode.Uri.joinPath(ws(), '..', '..', '..', 'test', 'fixtures', 'arch_binary.sldd');
  const dst = vscode.Uri.joinPath(ws(), '..', name);
  await vscode.workspace.fs.copy(src, dst, { overwrite: true });
  return dst;
}

/** The parts of a `.sldd` on disk, read as a file rather than as this session's document. */
async function partsOnDisk(uri: vscode.Uri): Promise<{ chunkXml: string; zipMeta: Record<string, Uint8Array> }> {
  const zip = unzipSync(await vscode.workspace.fs.readFile(uri));
  const zipMeta: Record<string, Uint8Array> = {};
  for (const [member, data] of Object.entries(zip)) if (member !== 'data/chunk0.xml') zipMeta[member] = data;
  return { chunkXml: new TextDecoder().decode(zip['data/chunk0.xml']), zipMeta };
}

function kindsOnDisk(parts: { chunkXml: string; zipMeta: Record<string, Uint8Array> }): Record<string, string> {
  const sldd = SlddNode.parse(parseBinarySlddParts(parts.chunkXml, parts.zipMeta), 'arch_binary.sldd');
  const out: Record<string, string> = {};
  sldd.children.forEach((section) => {
    section.children.forEach((entry) => {
      out[entry.name] = (entry as unknown as { kind: string }).kind;
    });
  });
  return out;
}

/** Open the document and register its model, the way resolving an editor does. */
async function open(provider: BinarySlddEditorProvider, uri: vscode.Uri) {
  const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
  const panel = vscode.window.createWebviewPanel('test.archRename', 'test', vscode.ViewColumn.One, {
    enableScripts: true,
  });
  await provider.resolveCustomEditor(doc, panel, token());
  await settle(500);
  // The model is registered by a repaint, which the webview asks for with `ready`. Trigger
  // one here rather than waiting on the webview's timing, then close the view so a late
  // `ready` cannot rebuild the tree under the assertions.
  (doc as any).repaintAll();
  panel.dispose();
  const root: any = DataModel.getDataSource((doc as unknown as { srcId: string }).srcId);
  assert.ok(root, 'resolving the editor registered the document’s model');
  return { doc, root };
}

const entryNamed = (root: any, name: string): any =>
  (root.children as any[]).flatMap((s: any) => s.children as any[]).find((e: any) => e.name === name);

/** applyEdit's rename, minus the webview message that starts it. */
function renameEntry(doc: any, root: any, name: string, newName: string) {
  const entry = entryNamed(root, name);
  assert.ok(entry, `the fixture has an entry named ${name}`);
  const selector = entrySelectorOf(entry);
  const catalogRename = catalogRenameOf('Name', newName, entry, entry);
  assert.ok(catalogRename, 'a top-level rename is a rename the catalog can carry');

  assert.strictEqual(mutateEntry(entry, () => entry.setProperty('Name', newName)), true);

  const before = doc.chunkXml as string;
  const span = findEntryObjectSpan(before, selector);
  assert.ok(span, 'the entry’s XML object is locatable');
  const frag = serializeEntryToXml(entry).replace(/\n$/, '');
  const after = before.slice(0, span!.offset) + frag + before.slice(span!.offset + span!.length);
  const part = scXmlRenamePatch(doc.zipMeta, catalogRename!.oldName, catalogRename!.newName);
  assert.ok(part, 'the catalog names this entry, so the rename has a part to carry');

  doc.pushEdit('Edit Name', before, after, undefined, part);
  return { before, after, part: part! };
}

suite('Architectural rename carries into the System Composer catalog', () => {
  let provider: BinarySlddEditorProvider;

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  setup(() => (provider = new BinarySlddEditorProvider(ctx())));

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('a save writes the renamed entry with the catalog that still classifies it', async () => {
    const uri = await workingCopy('arch_rename_save.sldd');
    const original = await partsOnDisk(uri);
    assert.strictEqual(kindsOnDisk(original).StructType, 'Struct Type', 'the fixture starts classified');

    const { doc } = await open(provider, uri);
    const { part } = renameEntry(doc, DataModel.getDataSource((doc as any).srcId), 'StructType', 'Wheel');

    assert.deepStrictEqual(
      (doc as any).zipMeta[SC_PART_XML],
      part.after,
      'the edit swapped the catalog member on the document',
    );
    await provider.saveCustomDocument(doc, token());

    const saved = await partsOnDisk(uri);
    assert.ok(saved.chunkXml.includes('>Wheel<'), 'the saved chunk spells the new name');
    assert.strictEqual(
      kindsOnDisk(saved).Wheel,
      'Struct Type',
      'and the saved catalog still models it as a struct type — without the carry it re-reads as a Data Interface',
    );

    doc.dispose();
    await vscode.workspace.fs.delete(uri);
  });

  test('undo restores the catalog member byte for byte, and a save writes that back', async () => {
    const uri = await workingCopy('arch_rename_undo.sldd');
    const original = await partsOnDisk(uri);

    const { doc } = await open(provider, uri);
    const edits: vscode.CustomDocumentEditEvent<vscode.CustomDocument>[] = [];
    const sub = provider.onDidChangeCustomDocument((e) => edits.push(e));
    const { before, part } = renameEntry(doc, DataModel.getDataSource((doc as any).srcId), 'StructType', 'Wheel');
    assert.strictEqual(edits.length, 1, 'the document edit reached the provider’s event');

    edits[0].undo();
    assert.strictEqual((doc as any).chunkXml, before, 'undo restored the chunk');
    assert.deepStrictEqual(
      (doc as any).zipMeta[SC_PART_XML],
      original.zipMeta[SC_PART_XML],
      'and the catalog member, byte for byte',
    );

    edits[0].redo();
    assert.deepStrictEqual((doc as any).zipMeta[SC_PART_XML], part.after, 'redo swapped it back');

    // What undo leaves behind is what a save writes — both surfaces or neither.
    edits[0].undo();
    await provider.saveCustomDocument(doc, token());
    const saved = await partsOnDisk(uri);
    assert.strictEqual(saved.chunkXml, original.chunkXml, 'the saved chunk is the undone one');
    assert.deepStrictEqual(saved.zipMeta[SC_PART_XML], original.zipMeta[SC_PART_XML], 'and so is the saved catalog');

    sub.dispose();
    doc.dispose();
    await vscode.workspace.fs.delete(uri);
  });

  test('a revert brings the catalog back from disk too, not just the chunk', async () => {
    // The half of a revert that is easy to miss: it re-reads the file, and a revert that
    // restored only `data/chunk0.xml` would leave the patched catalog in place — a file whose
    // entry is called StructType and whose catalog defines Wheel, written out on the next save.
    const uri = await workingCopy('arch_rename_revert.sldd');
    const original = await partsOnDisk(uri);

    const { doc } = await open(provider, uri);
    renameEntry(doc, DataModel.getDataSource((doc as any).srcId), 'StructType', 'Wheel');

    await provider.revertCustomDocument(doc, token());
    assert.strictEqual((doc as any).chunkXml, original.chunkXml, 'the revert re-read the chunk');
    assert.deepStrictEqual(
      (doc as any).zipMeta[SC_PART_XML],
      original.zipMeta[SC_PART_XML],
      'and the pass-through catalog with it',
    );

    await provider.saveCustomDocument(doc, token());
    const saved = await partsOnDisk(uri);
    assert.strictEqual(kindsOnDisk(saved).StructType, 'Struct Type', 'so the reverted file is the file it was');

    doc.dispose();
    await vscode.workspace.fs.delete(uri);
  });
});
