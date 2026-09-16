// Copyright 2026 The MathWorks, Inc.
//
// A write that preserves both `mtime` and `size`, through the real provider and a real
// FileSystemWatcher.
//
// The shared source cache keys every entry by `mtime:size` and has no invalidation protocol,
// deliberately: a pass re-versions its candidates, so a file that moved is re-read and one that did
// not is not. This is the write that key cannot see. `tar -xp` and `unzip -o` restore a file with
// its recorded mtime, and restoring the same revision preserves its size; a mount with coarse mtime
// granularity cannot separate two equal-size writes in one tick. Once a model tab's rows came off
// the shared parse (phase 2), such a write left the WHOLE table stale for the life of the window,
// where before it had left only the Usage column stale.
//
// So `BinaryEditorProvider`'s watcher calls `sourceReads.forgetChangedSource` before its repost,
// and that is the ONE call anywhere that drops entries the version key still believes in. Nothing
// in the unit suite can reach it: the decision is in a module that imports `vscode`, and the trigger
// is a disk event. Here it is the real thing end to end — a real watcher event on a real file whose
// `stat` is asserted not to have moved, and rows read back off what the provider actually posted.
//
// The fixture is built in the test rather than checked in, because the point is a PAIR of contents
// that are byte-for-byte the same length: two stored (level 0) zips differing only in a same-length
// block name. It lives in tmpdir, outside the workspace folder, for the reason every fixture here
// does — `findFiles` must not return it and the tree/index assertions must not see it.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { strToU8, zipSync } from 'fflate';
import { BinaryEditorProvider } from '../../src/host/BinaryEditorProvider';
import { ctx, fakePanel, nameOf, token, waitFor } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Two model packages that differ in one block NAME of the same length, so the archives are the same
// size. `level: 0` (stored, no deflate) is what guarantees that: a compressed pair of equal-length
// inputs can still differ by a byte or two.
function modelBytes(block: string): Uint8Array {
  return zipSync(
    {
      'simulink/blockDiagram.json': strToU8(
        JSON.stringify({ BlockDiagram: { ModelUUID: 'uuid-restored', System: { Ref: 'system_root' } } }),
      ),
      'simulink/systems/system_root.xml': strToU8(
        '<?xml version="1.0" encoding="utf-8"?>' +
          `<System><Block BlockType="Gain" Name="${block}" SID="1"><P Name="Gain">K</P></Block></System>`,
      ),
      'metadata/coreProperties.xml': strToU8('<?xml version="1.0" encoding="utf-8"?><cp:coreProperties/>'),
    },
    { level: 0 },
  );
}

const OLD = modelBytes('GainOld');
const NEW = modelBytes('GainNew');

const rowsOf = (posts: any[]): any[] => {
  const last = [...posts].reverse().find((p) => p.type === 'setRows');
  return (last?.rows ?? []) as any[];
};
const shows = (posts: any[], name: string): boolean => rowsOf(posts).some((r) => nameOf(r) === name);

suite('a write no stat can see, on the tab that is looking at it', () => {
  let dir: string;
  let path: string;
  let uri: vscode.Uri;

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  setup(() => {
    dir = mkdtempSync(join(tmpdir(), 'dex-samestat-'));
    path = join(dir, 'restored.slx');
    uri = vscode.Uri.file(path);
    writeFileSync(path, OLD);
  });

  teardown(() => rmSync(dir, { recursive: true, force: true }));

  test('re-reads the model when its bytes change under an unchanged mtime and size', async () => {
    // The two contents have to be indistinguishable to a `stat` for this test to be about anything.
    assert.strictEqual(OLD.byteLength, NEW.byteLength, 'the pair is the same size');

    const provider = new BinaryEditorProvider(ctx());
    const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
    const view = fakePanel();
    try {
      await provider.resolveCustomEditor(doc, view.panel, token());
      view.send({ type: 'ready' });
      await waitFor('the first rows', () => view.posts.some((p) => p.type === 'setRows'));
      assert.ok(shows(view.posts, 'GainOld'), 'the table starts on the bytes that were there');

      // The write, with the stat put back as it was — what a restore from an archive does.
      const seen = async (): Promise<string> => {
        // Through vscode's OWN stat, and formatted the way `scanRead.scanVersion` formats it, because
        // that string IS the cache key: the version is `${stat.mtime}:${stat.size}` in whole
        // milliseconds, so a comparison of `fs.statSync().mtimeMs` would fail on the sub-millisecond
        // digits `utimesSync` truncates — a difference nothing in the extension can see.
        const st = await vscode.workspace.fs.stat(uri);
        return `${st.mtime}:${st.size}`;
      };
      const before = statSync(path);
      const version = await seen();
      writeFileSync(path, NEW);
      utimesSync(path, before.atime, before.mtime);
      assert.strictEqual(await seen(), version, 'the version key the cache would compute did not move');

      // Nothing here tells the extension anything: the watcher event is its own, and the repost it
      // drives is the provider's own. What is asserted is only what the user would see.
      await waitFor('the rows to follow the file', () => shows(view.posts, 'GainNew'));
      assert.ok(!shows(view.posts, 'GainOld'), 'and the old block is gone from the latest rows');
    } finally {
      view.close();
    }
  });
});
