// Copyright 2026 The MathWorks, Inc.
//
// A save of a compressed-binary .sldd over the user's own file, inside real VS Code: what the
// MAT-file editor's save already does (matEdit.test.ts), held here for the dictionary.
//
//   - the save replaces the file whole (src/host/safeWrite.ts) rather than cutting it to nothing
//     and writing it again, and the stamp it records is the one its write left;
//
// Every file here is a copy of the workspace fixture in a fresh tmpdir, as in
// binarySlddOutsideChange.test.ts, so a listing of the directory is a listing of what the save
// left there.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { chmodSync, closeSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { unzipSync } from 'fflate';
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

suite('Binary .sldd: a save over the user’s file', () => {
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

  test('a read-only file is refused, and left as it was', async () => {
    if (!posix || process.getuid?.() === 0) return;
    const doc = await openDoc();
    edit(doc, 'Ki');
    chmodSync(path, 0o444);
    await assert.rejects(save(doc), /read-only/);
    assert.ok(same(new Uint8Array(readFileSync(path)), FIXTURE), 'the file is as it was');
    assert.strictEqual(doc.edits.dirty, true, 'and the edit is still unsaved');
  });
});
