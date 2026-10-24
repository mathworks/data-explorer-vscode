// Copyright 2026 The MathWorks, Inc.
//
// A save of a compressed-binary .sldd over the user's own file, inside real VS Code: what the
// MAT-file editor's save already does (matEdit.test.ts), held here for the dictionary.
//
//   - the save replaces the file whole (src/host/safeWrite.ts) rather than cutting it to nothing
//     and writing it again, and the stamp it records is the one its write left;
//   - a document restored from a hot-exit backup holds the stamp of the file its edits were made
//     over (src/host/backupId.ts), so its first save asks before writing over a file another
//     program changed since;
//   - Save As onto the file itself, by its own name or another link to it, is a save, and moves
//     the stamp and the dirty flag as one does;
//   - a revert that cannot read the file (gone, or a zip with no dictionary in it) fails, and
//     puts the document back to the file as it last read or wrote it, since VS Code shows it
//     clean whatever the revert does.
//
// Every file here is a copy of the workspace fixture in a fresh tmpdir, as in
// binarySlddOutsideChange.test.ts, so a listing of the directory is a listing of what the save
// left there.
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  chmodSync,
  closeSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { unzipSync, zipSync } from 'fflate';
import { DataModel } from 'data-explorer-core';
import { BinarySlddEditorProvider } from '../../src/host/BinarySlddEditorProvider';
import { ctx, fakePanel, quiet, token, waitFor, wsUri } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

const CHUNK = 'data/chunk0.xml';

/** The fixture's bytes, read once: `binary.sldd`, whose first entry is `Kp`. */
let FIXTURE: Uint8Array;

const decode = (b: Uint8Array) => new TextDecoder().decode(b);
const chunkOnDisk = (path: string): string => decode(unzipSync(new Uint8Array(readFileSync(path)))[CHUNK]);
const chunk = (doc: unknown): string => (doc as { chunkXml: string }).chunkXml;
const posix = process.platform !== 'win32';
/** Byte-equal, said as one boolean: a failing deepStrictEqual of two whole files prints every byte. */
const same = (a: Uint8Array, b: Uint8Array): boolean => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
const isCancellation = (err: unknown): boolean => err instanceof vscode.CancellationError;

/** The fixture with one entry renamed: a write by another program. */
function renamedTo(name: string): Uint8Array {
  const zip = unzipSync(FIXTURE);
  const xml = decode(zip[CHUNK]);
  assert.ok(xml.includes('>Kp<'), 'the fixture spells the entry this suite renames');
  zip[CHUNK] = new TextEncoder().encode(xml.replace('>Kp<', `>${name}<`));
  return zipSync(zip, { level: 6 });
}

/** Write the file as another program would, with an mtime later than any the view has seen. */
function writeOutside(at: string, bytes: Uint8Array): void {
  const before = statSync(at).mtimeMs;
  writeFileSync(at, bytes);
  const later = new Date(Math.max(Date.now(), before) + 2000);
  utimesSync(at, later, later);
}

suite('Binary .sldd: a save, a backup and a revert of the user’s file', () => {
  let dir: string;
  let path: string;
  let uri: vscode.Uri;
  let provider: BinarySlddEditorProvider;
  /** Every message the provider asked the user, and the answer to give next. */
  let asked: string[];
  let answer: string | undefined;
  const open: { doc: any; view: ReturnType<typeof fakePanel> }[] = [];

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
    FIXTURE = await vscode.workspace.fs.readFile(wsUri('binary.sldd'));
  });

  setup(() => {
    dir = mkdtempSync(join(tmpdir(), 'dex-binsave-'));
    path = join(dir, 'params.sldd');
    uri = vscode.Uri.file(path);
    writeFileSync(path, FIXTURE);
    provider = new BinarySlddEditorProvider(ctx());
    asked = [];
    answer = undefined;
    provider.askSaveConflict = async (message: string) => {
      asked.push(message);
      return answer;
    };
  });

  teardown(async () => {
    for (const { doc, view } of open.splice(0)) {
      view.close();
      doc.dispose();
    }
    await quiet(200, 'the disposed watchers to stop watching before their directory goes');
    chmodSync(dir, 0o755);
    rmSync(dir, { recursive: true, force: true });
  });

  /** Open `at` (the test's file unless named), with a view of its own, painted. */
  async function openDoc(at: vscode.Uri = uri, openContext = {} as vscode.CustomDocumentOpenContext): Promise<any> {
    const doc: any = await provider.openCustomDocument(at, openContext, token());
    const view = fakePanel();
    open.push({ doc, view });
    await provider.resolveCustomEditor(doc, view.panel, token());
    view.send({ type: 'ready' });
    await waitFor('the first rows', () => view.posts.some((p) => p.type === 'setRows'));
    return doc;
  }

  /** Let go of a document before the test ends: a restore replaces it, as a restart would. */
  function close(doc: any): void {
    const at = open.findIndex((o) => o.doc === doc);
    const [{ view }] = open.splice(at, 1);
    view.close();
    doc.dispose();
  }

  const viewOf = (doc: any) => open.find((o) => o.doc === doc)!.view;

  /** A rename of `from` to `to`, made through the provider's own message handler, as the table makes one. */
  function edit(doc: any, to: string, from = 'Kp'): void {
    const entry = (DataModel.getDataSource(doc.srcId) as any)?.children
      .flatMap((s: any) => s.children)
      .find((e: any) => e.name === from);
    assert.ok(entry, `the document's model holds ${from}`);
    viewOf(doc).send({ type: 'edit', rowId: entry.id, columnId: 'Name', oldValue: from, newValue: to });
    assert.ok(chunk(doc).includes(`>${to}<`), `the edit renamed ${from} to ${to}`);
  }

  const save = (doc: any) => provider.saveCustomDocument(doc, token());

  test('replaces the file whole: what had the old file open still reads it whole, and nothing is left beside it', async () => {
    const doc = await openDoc();
    if (posix) chmodSync(path, 0o600);
    edit(doc, 'Ki');
    // A reader that opened the file before the save: MATLAB, a sync client, a backup tool. A
    // write that cut the file to nothing and wrote it again would change what this reads, and a
    // crash in between would leave the file empty; a replace leaves the old file whole until
    // the new one has its name.
    const reader = openSync(path, 'r');
    try {
      await save(doc);
      assert.ok(same(new Uint8Array(readFileSync(reader)), FIXTURE), 'the old file, whole, under the old handle');
    } finally {
      closeSync(reader);
    }
    assert.ok(chunkOnDisk(path).includes('>Ki<'), 'and the new one under the name');
    if (posix) assert.strictEqual(statSync(path).mode & 0o777, 0o600, 'with the mode the file had');
    assert.deepStrictEqual(readdirSync(dir), ['params.sldd'], 'and no temporary file beside it');
  });

  test('records the stamp its write left, so the next save does not take its own write for an outside one', async () => {
    const doc = await openDoc();
    edit(doc, 'Ki');
    await save(doc);
    const st = statSync(path);
    assert.deepStrictEqual(doc.stamp, { mtime: st.mtime.getTime(), size: st.size }, 'the stamp of the file as written');
    edit(doc, 'Kd', 'Ki');
    await save(doc);
    assert.ok(chunkOnDisk(path).includes('>Kd<'));
    assert.deepStrictEqual(asked, [], 'and nothing was asked');
  });

  test('a file whose folder was deleted under the view is saved, folder and all, as VS Code’s save does', async () => {
    const folder = join(dir, 'project');
    const at = join(folder, 'params.sldd');
    mkdirSync(folder);
    writeFileSync(at, FIXTURE);
    const doc = await openDoc(vscode.Uri.file(at));
    edit(doc, 'Ki');
    rmSync(folder, { recursive: true });
    await save(doc);
    assert.ok(chunkOnDisk(at).includes('>Ki<'), 'the edit is on disk, in the folder made again');
    assert.deepStrictEqual(readdirSync(folder), ['params.sldd'], 'and nothing beside it');
  });

  test('a read-only file is refused, and left as it was', async () => {
    if (!posix || process.getuid?.() === 0) return;
    const doc = await openDoc();
    edit(doc, 'Ki');
    chmodSync(path, 0o444);
    await assert.rejects(save(doc), /read-only/);
    assert.ok(same(new Uint8Array(readFileSync(path)), FIXTURE), 'the file is as it was');
    assert.strictEqual(doc.edits.dirty, true, 'and the edit is still unsaved');
  });

  /** A hot-exit backup of `doc` in this test's directory, as VS Code asks for one. */
  const backUp = (doc: any, name = 'backup.bin') =>
    provider.backupCustomDocument(doc, { destination: vscode.Uri.file(join(dir, name)) } as vscode.CustomDocumentBackupContext, token());

  test('a restored backup asks before writing over a file changed since the backup', async () => {
    const doc = await openDoc();
    edit(doc, 'Ki');
    const backup = await backUp(doc);
    close(doc);
    // Another program writes the file while VS Code is closed.
    const outside = renamedTo('Kp_matlab');
    writeOutside(path, outside);
    const restored = await openDoc(uri, { backupId: backup.id } as vscode.CustomDocumentOpenContext);
    assert.ok(chunk(restored).includes('>Ki<'), 'the restore holds the backed-up edit');
    await assert.rejects(save(restored), isCancellation, 'the save is refused');
    await waitFor('the conflict prompt', () => asked.length === 1);
    assert.ok(same(new Uint8Array(readFileSync(path)), outside), 'the other program’s file is still the file');
    assert.ok(chunk(restored).includes('>Ki<'), 'and the restored edit is still there');
    await backup.delete();
  });

  test('a restored backup of a file nobody changed since saves without asking', async () => {
    const doc = await openDoc();
    edit(doc, 'Ki');
    const backup = await backUp(doc);
    close(doc);
    const restored = await openDoc(uri, { backupId: backup.id } as vscode.CustomDocumentOpenContext);
    assert.strictEqual(restored.edits.dirty, true, 'a restored backup is unsaved');
    await save(restored);
    assert.ok(chunkOnDisk(path).includes('>Ki<'), 'the restored edit is on disk');
    assert.deepStrictEqual(asked, []);
    await backup.delete();
  });

  test('a backup id from before the id carried a stamp (a bare uri) still restores the edits', async () => {
    const doc = await openDoc();
    edit(doc, 'Ki');
    const destination = vscode.Uri.file(join(dir, 'backup.bin'));
    const backup = await backUp(doc);
    close(doc);
    const restored = await openDoc(uri, { backupId: destination.toString() } as vscode.CustomDocumentOpenContext);
    assert.ok(chunk(restored).includes('>Ki<'), 'the restore holds the backed-up edit');
    await save(restored);
    assert.ok(chunkOnDisk(path).includes('>Ki<'));
    await backup.delete();
  });

  const saveAs = (doc: any, dest: vscode.Uri) => provider.saveCustomDocumentAs(doc, dest, token());

  test('Save As onto the file itself is a save', async () => {
    const doc = await openDoc();
    edit(doc, 'Ki');
    await saveAs(doc, uri);
    assert.ok(chunkOnDisk(path).includes('>Ki<'), 'the edit is on disk');
    assert.strictEqual(doc.edits.dirty, false, 'and the document is clean, as a save leaves it');
    // The stamp moved with the write, so the next save does not take that write for an outside one.
    edit(doc, 'Kd', 'Ki');
    await save(doc);
    assert.ok(chunkOnDisk(path).includes('>Kd<'));
    assert.deepStrictEqual(asked, []);
  });

  test('Save As onto another name of the same file (a hard link) is a save too, and keeps the link', async () => {
    if (!posix) return;
    const alias = join(dir, 'alias.sldd');
    linkSync(path, alias);
    const doc = await openDoc();
    edit(doc, 'Ki');
    await saveAs(doc, vscode.Uri.file(alias));
    assert.strictEqual(doc.edits.dirty, false, 'clean, as a save leaves it');
    assert.strictEqual(statSync(path).ino, statSync(alias).ino, 'the two names are still one file');
    assert.ok(chunkOnDisk(path).includes('>Ki<'), 'which holds the edit');
    edit(doc, 'Kd', 'Ki');
    await save(doc);
    assert.deepStrictEqual(asked, [], 'and the next save does not ask');
  });

  test('Save As onto another file writes that file, and leaves this one and its stamp alone', async () => {
    const doc = await openDoc();
    edit(doc, 'Ki');
    const stamp = doc.stamp;
    const other = join(dir, 'other.sldd');
    await saveAs(doc, vscode.Uri.file(other));
    assert.ok(chunkOnDisk(other).includes('>Ki<'), 'the copy holds the edit');
    assert.ok(same(new Uint8Array(readFileSync(path)), FIXTURE), 'the document’s own file is as it was');
    assert.deepStrictEqual(doc.stamp, stamp, 'and so is the stamp it is held to');
  });

  const revert = (doc: any) => provider.revertCustomDocument(doc, token());
  /** The names the latest paint of `doc`'s view shows. */
  const shown = (doc: any): string[] => {
    const paint = [...viewOf(doc).posts].reverse().find((p) => p.type === 'setRows');
    return ((paint?.rows ?? []) as any[]).filter((r) => String(r.parent ?? '').startsWith('section:')).map((r) => r.Name?.label);
  };

  test('a revert that cannot read the disk fails, and puts the document back to the file as last saved', async () => {
    const doc = await openDoc();
    edit(doc, 'Ki');
    await save(doc);
    edit(doc, 'Kd', 'Ki');
    rmSync(path);
    await assert.rejects(revert(doc));
    // VS Code shows the document clean, so it must hold no edit the revert dropped.
    assert.strictEqual(doc.edits.dirty, false);
    assert.ok(chunk(doc).includes('>Ki<') && !chunk(doc).includes('>Kd<'), 'the document is the file as saved');
    assert.ok(shown(doc).includes('Ki') && !shown(doc).includes('Kd'), 'and so is the table');
  });

  test('a revert onto a zip with no dictionary in it is refused, and puts the document back to the file as last read', async () => {
    const doc = await openDoc();
    const read = chunk(doc);
    edit(doc, 'Ki');
    const stamp = doc.stamp;
    const zip = unzipSync(FIXTURE);
    delete zip[CHUNK];
    writeOutside(path, zipSync(zip));
    await assert.rejects(revert(doc), /data\/chunk0\.xml/, 'refused, naming what is missing');
    assert.strictEqual(doc.edits.dirty, false);
    assert.strictEqual(chunk(doc), read, 'the document is the file as it was read');
    assert.ok(shown(doc).includes('Kp') && !shown(doc).includes('Ki'), 'and so is the table');
    assert.deepStrictEqual(doc.stamp, stamp, 'still held to the version it read, so a save asks about this one');
    await assert.rejects(save(doc), isCancellation, 'and a save is refused rather than writing over it');
  });
});
