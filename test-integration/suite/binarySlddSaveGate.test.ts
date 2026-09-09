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
import { BinarySlddEditorProvider } from '../../src/host/BinarySlddEditorProvider';

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

/** A working copy of the fixture, so writing in this suite cannot touch the fixture. */
async function workingCopy(name: string): Promise<vscode.Uri> {
  const dst = wsUri(name);
  await vscode.workspace.fs.copy(wsUri('binary.sldd'), dst, { overwrite: true });
  return dst;
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
});
