// Copyright 2026 The MathWorks, Inc.
// Writing a compressed-binary .sldd back out: the save gate, and why the hot-exit backup
// does not use it.
//
// Both go through the provider's writeTo, and the difference between them is worth a test
// because it is worth SECONDS. VS Code asks for a hot-exit backup about a second after
// every edit to a dirty custom document; while that ran the save gate, a real 2.6 MB
// dictionary paid ~3.1 s of re-parse plus ~0.7 s of zip on the extension host,
// synchronously — so an undo pressed just after an edit waited behind it, though the undo
// itself is 0.3 ms of entry ops (binarySlddUndo.test.ts). A backup is a scratch copy of
// what the editor already holds; the gate belongs on the path that overwrites the user's
// file, and only there.
//
// This needs the real host: writeTo writes through vscode.workspace.fs, and restoring a
// backup is VS Code's contract, not ours — openCustomDocument reads it back from the
// `backupId` VS Code hands in.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { unzipSync } from 'fflate';
import { DataModel } from 'data-explorer-core';
import { BinarySlddEditorProvider } from '../../src/host/BinarySlddEditorProvider';
import { computeModified } from '../../src/host/slddBaseline';

/** A payload the reader cannot recover, so the gate must refuse it. */
const UNREADABLE = '<Root><unterminated';

function ctx(): vscode.ExtensionContext {
  const ext = vscode.extensions.getExtension('mathworks.simulink-data-explorer');
  assert.ok(ext, 'the extension must be present');
  return { extensionUri: ext!.extensionUri } as unknown as vscode.ExtensionContext;
}

function wsUri(name: string): vscode.Uri {
  const ws = vscode.workspace.workspaceFolders?.[0];
  assert.ok(ws, 'a workspace folder must be open');
  return vscode.Uri.joinPath(ws.uri, name);
}

function token() {
  return new vscode.CancellationTokenSource().token;
}

function makePanel(): vscode.WebviewPanel {
  return vscode.window.createWebviewPanel('test.binSlddSaveGate', 'test', vscode.ViewColumn.One, {
    enableScripts: true,
  });
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A working copy of the fixture, so writing in this suite cannot touch the fixture. */
async function workingCopy(name: string): Promise<vscode.Uri> {
  const dst = wsUri(name);
  await vscode.workspace.fs.copy(wsUri('binary.sldd'), dst, { overwrite: true });
  return dst;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The first entry of the first non-empty section. */
function firstEntry(root: any): any {
  for (const section of (root?.children ?? []) as any[]) {
    if (section.children.length > 0) return section.children[0];
  }
  return null;
}

suite('Binary .sldd save gate vs hot-exit backup', () => {
  let provider: BinarySlddEditorProvider;

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  setup(() => (provider = new BinarySlddEditorProvider(ctx())));

  test('a save refuses a payload that does not re-parse, and leaves the file alone', async () => {
    const uri = await workingCopy('binary_gate_copy.sldd');
    const onDisk = await vscode.workspace.fs.readFile(uri);
    const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
    (doc as unknown as { chunkXml: string }).chunkXml = UNREADABLE;

    await assert.rejects(
      () => provider.saveCustomDocument(doc, token()),
      /Refusing to save/,
      'the gate refuses the write',
    );
    assert.deepStrictEqual(
      await vscode.workspace.fs.readFile(uri),
      onDisk,
      'and the bytes on disk are untouched — the whole point of refusing',
    );

    doc.dispose();
    await vscode.workspace.fs.delete(uri);
  });

  test('a backup skips the gate, and still restores the payload it snapshotted', async () => {
    const uri = await workingCopy('binary_backup_copy.sldd');
    const destination = wsUri('binary_backup_scratch.sldd');
    const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());

    // An edit, of the kind VS Code then asks for a backup of.
    const before = (doc as unknown as { chunkXml: string }).chunkXml;
    assert.ok(before.includes('>Kp<'), 'the fixture payload spells the entry name');
    const edited = before.replace('>Kp<', '>Ki<');
    (doc as unknown as { chunkXml: string }).chunkXml = edited;

    const backup = await provider.backupCustomDocument(doc, { destination }, token());
    // Restored the way VS Code restores it. The same payload comes back, so compressing a
    // throwaway copy more cheaply cost nothing the user could ever notice.
    const restored = await provider.openCustomDocument(
      uri,
      { backupId: backup.id } as vscode.CustomDocumentOpenContext,
      token(),
    );
    assert.strictEqual(
      (restored as unknown as { chunkXml: string }).chunkXml,
      edited,
      'reopening from the backup id gives the edited payload back',
    );
    restored.dispose();

    // THE point of the separation: a payload the reader cannot recover still backs up — no
    // gate, so no seconds-long re-parse standing between an edit and the user's next
    // keystroke — while saving that same payload is still refused.
    (doc as unknown as { chunkXml: string }).chunkXml = UNREADABLE;
    const second = await provider.backupCustomDocument(doc, { destination }, token());
    assert.ok(second.id, 'the backup was written without the gate');
    await assert.rejects(
      () => provider.saveCustomDocument(doc, token()),
      /Refusing to save/,
      'the gate still stands where it matters',
    );

    await second.delete();
    doc.dispose();
    await vscode.workspace.fs.delete(uri);
  });

  test('a save reads the dictionary once, and paints the tree it read', async () => {
    // The gate, the re-baseline and the repaint each used to read the payload — three
    // trees describing one unchanged chunkXml, ~3.1 s each on a real dictionary (and a
    // fourth per split view, since the repaint is per view).
    const uri = await workingCopy('binary_save_once_copy.sldd');
    const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
    const srcId = (doc as unknown as { srcId: string }).srcId;
    const panel = makePanel();
    await provider.resolveCustomEditor(doc, panel, token());
    await settle(500);
    // Register the model through the live view, then keep the view: the repaint under test
    // is the real post(), not a stub. Asserted, because with no view registered the count
    // below would come out at 1 whether or not the repaint rebuilds.
    (doc as any).repaintAll();
    assert.strictEqual(((doc as any).views as Set<unknown>).size, 1, 'the real view is the one that repaints');

    // Every read of the payload is followed by registering what it read, and
    // `DataModel.addDataSource` is a property lookup on the imported class — so counting it
    // is how many trees this save built. One: the gate's, reused. Before the fix it was two
    // (re-baseline, then the repaint rebuilding what the re-baseline had just registered).
    const realAdd = (DataModel as any).addDataSource;
    let registrations = 0;
    (DataModel as any).addDataSource = (...args: unknown[]) => {
      registrations++;
      return realAdd.apply(DataModel, args);
    };
    try {
      await provider.saveCustomDocument(doc, token());
    } finally {
      (DataModel as any).addDataSource = realAdd;
    }
    assert.strictEqual(registrations, 1, 'a save builds ONE tree, with a real view painting');

    const root: any = DataModel.getDataSource(srcId);
    assert.ok(root, 'the save registered the tree it read');
    assert.strictEqual(firstEntry(root).name, 'Kp', 'built from the payload it wrote');
    assert.deepStrictEqual(
      [...computeModified(uri.toString(), root)],
      [],
      'and baselined that same tree, so the save leaves no row wearing a Modified mark',
    );

    // The same fact said the other way round, because the count alone does not show WHICH
    // tree the views were pointed at: stand-in views (a real panel cannot be asked what it
    // was told), and every one of them is asked for the registered tree.
    const seen: unknown[] = [];
    const views = (doc as any).views as Set<{ repaintAll(from?: unknown): void; repaintOps(a: unknown[]): void }>;
    views.clear();
    for (const _tag of ['a', 'b']) {
      views.add({ repaintAll: (from) => seen.push(from), repaintOps: () => undefined });
    }
    await provider.saveCustomDocument(doc, token());
    assert.deepStrictEqual(
      seen,
      ['registered', 'registered'],
      'every view paints the tree the save registered, instead of parsing the payload again',
    );

    panel.dispose();
    doc.dispose();
    await vscode.workspace.fs.delete(uri);
  });

  test('an edit landing on the save’s write is not overwritten by the gate’s stale read', async () => {
    // Reusing the gate's read is only sound while it is still a read of the document's
    // payload. A save awaits its writeFile, and the webview can deliver an edit on that
    // await — so the reuse is guarded, and this is the case that guard exists for.
    const uri = await workingCopy('binary_save_race_copy.sldd');
    const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
    const srcId = (doc as unknown as { srcId: string }).srcId;
    const gated = (doc as unknown as { chunkXml: string }).chunkXml;
    const raced = gated.replace('>Kp<', '>Kz<');

    // saveCustomDocument runs synchronously as far as its writeFile, so the gate has
    // already read `gated` by the time it hands back a promise. Changing chunkXml here is
    // exactly an edit arriving on that await.
    const saving = provider.saveCustomDocument(doc, token());
    (doc as unknown as { chunkXml: string }).chunkXml = raced;
    await saving;

    const root: any = DataModel.getDataSource(srcId);
    assert.strictEqual(
      firstEntry(root).name,
      'Kz',
      'the registered tree describes the document, not the read the gate happened to have',
    );
    assert.deepStrictEqual(
      [...computeModified(uri.toString(), root)],
      [],
      'and the baseline was captured from that same tree',
    );
    // The file got the text the gate approved, which is the only text this save promised.
    // The edit that landed mid-write is still unsaved — VS Code asks again, and the model
    // it will gate next time is the one showing in the table.
    const zip = unzipSync(await vscode.workspace.fs.readFile(uri));
    assert.strictEqual(new TextDecoder().decode(zip['data/chunk0.xml']), gated, 'the write is of the gated text');

    doc.dispose();
    await vscode.workspace.fs.delete(uri);
  });
});
