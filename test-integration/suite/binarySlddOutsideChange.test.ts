// Copyright 2026 The MathWorks, Inc.
//
// The writable binary .sldd view, and a file that another program changes while it is open
// (V-071). MATLAB saving the same dictionary is the case that matters.
//
// Until this suite, the view never noticed. It kept showing what it had read, and its next
// save zipped that stale copy over the other program's write, silently. The ruling is
// "follow VS Code", meaning what VS Code does for a text file, and so what the JSON .sldd
// view already does through its TextDocument:
//
//   - no unsaved edits: reload from disk, silently;
//   - unsaved edits: nothing happens at the change, and the edits stay;
//   - save after an outside change: refused, with VS Code's prompt (Overwrite / Revert);
//   - the view's own saves are not outside changes;
//   - `files.saveConflictResolution: overwriteFileOnDisk` turns the check off.
//
// The pure rules are unit-tested (test/diskConflict.test.ts). This suite needs the real host
// for everything around them: a real FileSystemWatcher event on a real write, and the save
// that VS Code's `stat` and `writeFile` sit on either side of.
//
// Every file here is a copy of the workspace fixture placed in tmpdir, outside the workspace
// folder, as forgetOnDiskChange.test.ts does. That keeps `findFiles`, and the tree and index
// assertions elsewhere, from seeing it. It also shows that the watcher follows a file
// outside every workspace folder, which a workspace-wide watcher would miss.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { unzipSync, zipSync } from 'fflate';
import { BinarySlddEditorProvider } from '../../src/host/BinarySlddEditorProvider';
import { ctx, fakePanel, nameOf, settle, token, waitFor, wsUri } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

const CHUNK = 'data/chunk0.xml';

/** The fixture's bytes, read once: `binary.sldd`, whose first entry is `Kp`. */
let FIXTURE: Uint8Array;

const decode = (b: Uint8Array) => new TextDecoder().decode(b);
const chunkOfBytes = (bytes: Uint8Array): string => decode(unzipSync(bytes)[CHUNK]);
const chunkOnDisk = (path: string): string => chunkOfBytes(new Uint8Array(readFileSync(path)));

/** The fixture with one entry renamed: a write by another program. */
function renamedTo(name: string): Uint8Array {
  const zip = unzipSync(FIXTURE);
  const xml = decode(zip[CHUNK]);
  assert.ok(xml.includes('>Kp<'), 'the fixture spells the entry this suite renames');
  zip[CHUNK] = new TextEncoder().encode(xml.replace('>Kp<', `>${name}<`));
  return zipSync(zip, { level: 6 });
}

/**
 * Write the file as another program would: new bytes, and an mtime later than any the view
 * has seen. The mtime is set explicitly because two writes in the same millisecond would
 * otherwise share one, and then the check would turn on whether the sizes happen to differ.
 */
function writeOutside(path: string, bytes: Uint8Array): void {
  const before = statSync(path).mtimeMs;
  writeFileSync(path, bytes);
  const later = new Date(Math.max(Date.now(), before) + 2000);
  utimesSync(path, later, later);
}

const chunk = (doc: unknown): string => (doc as { chunkXml: string }).chunkXml;

const rowsOf = (posts: any[]): any[] => {
  const last = [...posts].reverse().find((p) => p.type === 'setRows');
  return (last?.rows ?? []) as any[];
};
const shows = (posts: any[], name: string): boolean => rowsOf(posts).some((r) => nameOf(r) === name);

/** Set a `files.*` setting for the whole profile, and wait until this host reads it back. */
async function setFiles(key: string, value: string | undefined, uri: vscode.Uri): Promise<void> {
  await vscode.workspace.getConfiguration('files').update(key, value, vscode.ConfigurationTarget.Global);
  await waitFor(`files.${key} to read back`, () => vscode.workspace.getConfiguration('files', uri).inspect(key)?.globalValue === value);
}

const isCancellation = (err: unknown): boolean => err instanceof vscode.CancellationError;

suite('Binary .sldd view: a file that changes on disk while it is open', () => {
  let dir: string;
  let path: string;
  let uri: vscode.Uri;
  let provider: BinarySlddEditorProvider;
  /** Every message the provider asked the user, and the answer to give next. */
  let asked: string[];
  let answer: string | undefined;
  const open: vscode.CustomDocument[] = [];

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
    FIXTURE = await vscode.workspace.fs.readFile(wsUri('binary.sldd'));
  });

  setup(() => {
    dir = mkdtempSync(join(tmpdir(), 'dex-outside-'));
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

  teardown(() => {
    for (const doc of open.splice(0)) doc.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  async function openDoc(): Promise<any> {
    const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
    open.push(doc);
    return doc;
  }

  /** An unsaved edit, pushed the way the message handler pushes one. Returns its event. */
  function edit(doc: any, to: string, from = 'Kp'): vscode.CustomDocumentEditEvent<vscode.CustomDocument> {
    const events: vscode.CustomDocumentEditEvent<vscode.CustomDocument>[] = [];
    const sub = provider.onDidChangeCustomDocument((e) => events.push(e));
    const before = chunk(doc);
    assert.ok(before.includes(`>${from}<`), `the document spells ${from}, the entry this edit renames`);
    doc.pushEdit('Edit Name', before, before.replace(`>${from}<`, `>${to}<`));
    sub.dispose();
    assert.strictEqual(events.length, 1, 'the edit reached VS Code’s event');
    return events[0];
  }

  /**
   * A second, clean document on the same file. It shows when the watcher has delivered and
   * handled an event, so a test can then assert that ANOTHER document ignored that event
   * without guessing how long to sleep.
   */
  async function witness(): Promise<any> {
    return openDoc();
  }
  const followed = (w: any, name: string) => waitFor('the clean witness to reload', () => chunk(w).includes(`>${name}<`));

  test('with no unsaved edits, the view reloads from disk silently', async () => {
    const doc = await openDoc();
    const view = fakePanel();
    try {
      await provider.resolveCustomEditor(doc, view.panel, token());
      view.send({ type: 'ready' });
      await waitFor('the first rows', () => view.posts.some((p) => p.type === 'setRows'));
      assert.ok(shows(view.posts, 'Kp'), 'the table starts on what was there');

      writeOutside(path, renamedTo('Kp_matlab'));
      await waitFor('the rows to follow the file', () => shows(view.posts, 'Kp_matlab'));
      assert.ok(!shows(view.posts, 'Kp'), 'the old name is gone from the latest rows');
      assert.strictEqual(chunk(doc), chunkOnDisk(path), 'the document holds what is on disk');
      assert.deepStrictEqual(asked, [], 'silently: nothing was asked');

      // The reload took the new stamp with it, so this save writes rather than refusing.
      await provider.saveCustomDocument(doc, token());
      assert.ok(chunkOnDisk(path).includes('>Kp_matlab<'), 'the save wrote the reloaded document');
      assert.deepStrictEqual(asked, []);
    } finally {
      view.close();
    }
  });

  test('with unsaved edits, nothing happens at the change, and the save then refuses instead of overwriting', async () => {
    const doc = await openDoc();
    const control = await witness();
    edit(doc, 'Ki');

    const outside = renamedTo('Kp_matlab');
    writeOutside(path, outside);
    await followed(control, 'Kp_matlab');
    await settle(300);
    assert.ok(chunk(doc).includes('>Ki<'), 'the unsaved edit is still there');
    assert.ok(!chunk(doc).includes('>Kp_matlab<'), 'and the outside change was not loaded over it');

    await assert.rejects(() => provider.saveCustomDocument(doc, token()), isCancellation, 'the save is refused');
    assert.deepStrictEqual(
      new Uint8Array(readFileSync(path)),
      outside,
      'and the other program’s write is still on disk, byte for byte',
    );
    assert.deepStrictEqual(
      asked,
      [
        "Failed to save 'params.sldd': The content of the file is newer. Do you want to overwrite the file with your changes?",
      ],
      'VS Code’s own wording, once',
    );
    assert.ok(chunk(doc).includes('>Ki<'), 'a refused save keeps the edits');
  });

  test('undoing back to the saved state counts as no unsaved edits again', async () => {
    const doc = await openDoc();
    const ev = edit(doc, 'Ki');
    ev.undo();
    writeOutside(path, renamedTo('Kp_matlab'));
    await waitFor('the document to reload', () => chunk(doc).includes('>Kp_matlab<'));
    assert.deepStrictEqual(asked, []);
  });

  test('a prompt that is still open is not shown again by the next save', async () => {
    const doc = await openDoc();
    edit(doc, 'Ki');
    writeOutside(path, renamedTo('Kp_matlab'));
    let close!: (choice: string | undefined) => void;
    provider.askSaveConflict = (message: string) => {
      asked.push(message);
      return new Promise((resolve) => (close = resolve));
    };
    await assert.rejects(() => provider.saveCustomDocument(doc, token()), isCancellation);
    await assert.rejects(() => provider.saveCustomDocument(doc, token()), isCancellation);
    assert.strictEqual(asked.length, 1, 'one prompt, however many saves');
    close(undefined);
  });

  test('with auto-save on, a dismissed prompt is not shown again by later saves; with it off, it is', async () => {
    const doc = await openDoc();
    edit(doc, 'Ki');
    writeOutside(path, renamedTo('Kp_matlab'));
    await setFiles('autoSave', 'afterDelay', uri);
    try {
      await assert.rejects(() => provider.saveCustomDocument(doc, token()), isCancellation);
      await settle(50); // the prompt is answered (dismissed) on its own promise
      assert.strictEqual(asked.length, 1);
      await assert.rejects(() => provider.saveCustomDocument(doc, token()), isCancellation);
      assert.strictEqual(asked.length, 1, 'an automatic save in conflict does not ask again');
    } finally {
      await setFiles('autoSave', undefined, uri);
    }
    await assert.rejects(() => provider.saveCustomDocument(doc, token()), isCancellation);
    assert.strictEqual(asked.length, 2, 'with auto-save off, every save is the user’s, so it asks');
  });

  test('Overwrite writes over the version it was asked about, and a newer one is asked about again', async () => {
    const doc = await openDoc();
    edit(doc, 'Ki');
    writeOutside(path, renamedTo('Kp_matlab'));
    answer = 'Overwrite';
    await assert.rejects(() => provider.saveCustomDocument(doc, token()), isCancellation);
    await settle(50);
    assert.strictEqual(asked.length, 1);

    // Overwrite saves through VS Code, which reaches the provider VS Code registered, not
    // this one. So the save it causes is made here directly.
    await provider.saveCustomDocument(doc, token());
    assert.ok(chunkOnDisk(path).includes('>Ki<'), 'the edit is on disk now');
    assert.strictEqual(asked.length, 1, 'without asking again');

    // The answer was about that version only.
    edit(doc, 'Kd', 'Ki');
    writeOutside(path, renamedTo('Kp_again'));
    answer = undefined;
    await assert.rejects(() => provider.saveCustomDocument(doc, token()), isCancellation);
    assert.strictEqual(asked.length, 2, 'a newer outside write is asked about again');
    assert.ok(chunkOnDisk(path).includes('>Kp_again<'), 'and not overwritten');
  });

  test('a revert reloads from disk and ends the conflict', async () => {
    const doc = await openDoc();
    edit(doc, 'Ki');
    writeOutside(path, renamedTo('Kp_matlab'));
    await assert.rejects(() => provider.saveCustomDocument(doc, token()), isCancellation);

    // What VS Code's revert calls once it has dropped the edits from its own stack.
    await provider.revertCustomDocument(doc, token());
    assert.ok(chunk(doc).includes('>Kp_matlab<'), 'the document holds the outside version');
    assert.ok(!chunk(doc).includes('>Ki<'), 'and the edit is gone');

    // A new edit on the reloaded document, which no longer spells `Kp`.
    edit(doc, 'Kz', 'Kp_matlab');
    await provider.saveCustomDocument(doc, token());
    assert.ok(chunkOnDisk(path).includes('>Kz<'), 'the next save writes without asking');
    assert.strictEqual(asked.length, 1);
  });

  test('the view’s own save is not an outside change, and changes after it are still followed', async () => {
    const doc = await openDoc();
    const control = await witness();
    const repaints: string[] = [];
    doc.views.add({ repaintAll: (from?: string) => repaints.push(from ?? 'chunk'), repaintOps: () => undefined });
    edit(doc, 'Ki');
    await provider.saveCustomDocument(doc, token());
    assert.deepStrictEqual(repaints, ['registered'], 'the save painted once, from what it registered');

    await followed(control, 'Ki');
    await settle(300);
    assert.deepStrictEqual(repaints, ['registered'], 'the watcher’s event for that write reloaded nothing');

    writeOutside(path, renamedTo('Kp_matlab'));
    await waitFor('the document to follow a real outside change', () => chunk(doc).includes('>Kp_matlab<'));
    assert.deepStrictEqual(repaints, ['registered', 'chunk']);
  });

  test('files.saveConflictResolution: overwriteFileOnDisk saves without asking', async () => {
    const doc = await openDoc();
    edit(doc, 'Ki');
    writeOutside(path, renamedTo('Kp_matlab'));
    await setFiles('saveConflictResolution', 'overwriteFileOnDisk', uri);
    try {
      await provider.saveCustomDocument(doc, token());
    } finally {
      await setFiles('saveConflictResolution', undefined, uri);
    }
    assert.ok(chunkOnDisk(path).includes('>Ki<'), 'the edit overwrote the outside change');
    assert.deepStrictEqual(asked, []);
  });

  test('a file deleted under the view is recreated by the next save, as VS Code does', async () => {
    const doc = await openDoc();
    edit(doc, 'Ki');
    unlinkSync(path);
    await settle(300);
    assert.ok(chunk(doc).includes('>Ki<'), 'the view keeps its contents');
    await provider.saveCustomDocument(doc, token());
    assert.ok(chunkOnDisk(path).includes('>Ki<'), 'and the save wrote the file back');
    assert.deepStrictEqual(asked, []);
  });
});
