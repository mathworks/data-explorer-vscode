// Copyright 2026 The MathWorks, Inc.
//
// Opening a read-only `.sldd` tab reads the file ONCE — counted at the file system, through
// the shipped provider.
//
// `resolveCustomEditor` has to read a whole `.sldd` before it can decide which editor the file
// belongs in: `workspace.fs` has no partial read, so telling an editable JSON dictionary from a
// zip, and either from one too large for VS Code to sync, means looking at the bytes. It then
// dropped them, and `post` read the same file again to build the tree. The redirects are what
// makes that expensive rather than merely wasteful — a file only STAYS in this view because it
// was rejected as too large for the editable routes, so the duplicate read was reserved for
// the largest files the extension opens. `seededRead` hands the classification's bytes to the
// first post instead.
//
// Nothing in the unit suite can count this: the decision is in a module that imports `vscode`,
// and the number being asserted is a count of `workspace.fs.readFile` calls the provider makes
// for itself. So the file is served by a FileSystemProvider registered on a scheme of this
// test's own, which is a real read through the real API and is also the only way to be sure
// nothing else in the window contributes to the count — the Usage annotation reads the
// workspace's own files, and they are not on this scheme.
//
// The document is built here rather than checked in because it has to be over VS Code's 50 MB
// TextDocument sync limit — that is the one shape of `.sldd` that is valid, editable JSON and
// still stays in this read-only view (see slddFormat.ts), and the `notice` asserted below is
// how this test proves it took that branch instead of quietly redirecting.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { BinaryEditorProvider } from '../../src/host/BinaryEditorProvider';
import { TEXT_SYNC_LIMIT } from '../../src/host/slddFormat';
import { ctx, fakePanel, token, waitFor } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SCHEME = 'dex-readonce';
const NAME = 'oversize.sldd';
const ENTRY = 'BigGain';

// A JSON dictionary in the on-disk shape (`__MW_TEXT_PARTS__` → `data/chunk0`), padded past the
// sync limit by one long string. An unknown sibling key is ignored by the parser, so the entry
// below is the whole table and the padding costs one `JSON.parse` of a single string rather
// than the tens of thousands of entries it would take to reach 50 MB honestly.
function oversizeDictionary(): Uint8Array {
  const doc: any = {
    __MW_TEXT_COREPROPERTIES__: { release: 'R2026b' },
    __MW_TEXT_PARTS__: {
      '__MW_TEXT_PART__/data/chunk0': {
        __MW_TEXT_content: {
          entries: [
            {
              name: ENTRY,
              metadata: { uuid: 'readonce-uuid-BigGain', isderived: '0' },
              value: 4,
            },
          ],
          AllowAccessBWS: '0',
        },
      },
    },
  };
  doc.__MW_TEXT_PAD__ = 'x'.repeat(TEXT_SYNC_LIMIT);
  const padded = new TextEncoder().encode(JSON.stringify(doc));
  // Checked rather than trusted: one byte short of the limit and this file redirects to the
  // editable table view, and the test would be counting the reads of a tab that never opened.
  assert.ok(padded.byteLength > TEXT_SYNC_LIMIT, 'the document is over the sync limit');
  return padded;
}

/** Serves one document on its own scheme and counts what was asked of it. */
class CountingFs implements vscode.FileSystemProvider {
  public reads = 0;
  private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  public readonly onDidChangeFile = this.emitter.event;

  constructor(private readonly bytes: Uint8Array) {}

  watch(): vscode.Disposable {
    // The provider registers a FileSystemWatcher over the containing folder for its
    // refresh-on-save; on this scheme nothing ever changes, so there is nothing to report.
    return new vscode.Disposable(() => {});
  }

  stat(): vscode.FileStat {
    return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: this.bytes.byteLength };
  }

  readFile(): Uint8Array {
    this.reads++;
    return this.bytes;
  }

  readDirectory(): [string, vscode.FileType][] {
    return [[NAME, vscode.FileType.File]];
  }

  createDirectory(): void {}
  writeFile(): void {
    throw vscode.FileSystemError.NoPermissions();
  }
  delete(): void {
    throw vscode.FileSystemError.NoPermissions();
  }
  rename(): void {
    throw vscode.FileSystemError.NoPermissions();
  }
}

const setRows = (posts: any[]): any[] => posts.filter((p) => p.type === 'setRows');

// A parse failure posts an `error` instead of rows. Surfacing it turns a 20-second timeout
// about rows into the message the provider actually reported.
function noError(posts: any[]): void {
  const failed = posts.find((p) => p.type === 'error');
  assert.ok(!failed, `the tab posted an error: ${failed?.message}`);
}

suite('a read-only dictionary tab reads its file once', () => {
  let fs: CountingFs;
  let registration: vscode.Disposable;
  const uri = vscode.Uri.parse(`${SCHEME}:/${NAME}`);

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  setup(() => {
    fs = new CountingFs(oversizeDictionary());
    registration = vscode.workspace.registerFileSystemProvider(SCHEME, fs, { isReadonly: true });
  });

  teardown(() => registration.dispose());

  test('opens on the bytes it classified, and reads again only when reposted', async () => {
    const provider = new BinaryEditorProvider(ctx());
    const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
    const view = fakePanel();
    try {
      // Classification: one read, whatever else it decides.
      await provider.resolveCustomEditor(doc, view.panel, token());
      assert.strictEqual(fs.reads, 1, 'classifying the file read it');

      // The first post, driven the way the webview drives it.
      view.send({ type: 'ready' });
      await waitFor('the first post', () => view.posts.length > 0);
      noError(view.posts);
      assert.strictEqual(setRows(view.posts).length, 1, 'the tab posted its table');

      // THE assertion. Before the handoff this was 2: the classification read, then `post`
      // reading the same file again to build the tree it is about to show.
      assert.strictEqual(fs.reads, 1, 'the tree was built from the bytes classification read');

      const first = setRows(view.posts)[0];
      // Proof this is the tab under test and not a redirect: only a file that STAYED here
      // carries the over-the-limit read-only notice, and only a tab that built its tree from
      // the handed-over bytes has the dictionary's entry in it.
      assert.match(String(first.notice), /^Read-only: this dictionary is \d+ MB/);
      assert.ok(
        (first.rows ?? []).some((r: any) => (r?.Name?.label ?? '') === ENTRY),
        'the table shows the dictionary’s entry',
      );

      // The other half of "at most once": a repost is triggered by the file having changed, so
      // it must go to the file. A holder that answered twice would leave a table that visibly
      // refreshed and did not change.
      view.send({ type: 'ready' });
      await waitFor('the reposted rows', () => setRows(view.posts).length === 2);
      noError(view.posts);
      assert.strictEqual(fs.reads, 2, 'the repost read the file rather than reusing the seed');
      assert.strictEqual(setRows(view.posts)[1].rows.length, first.rows.length, 'and posted the same table');
    } finally {
      view.close();
    }
  }).timeout(60000);
});
