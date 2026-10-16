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
// So two watchers drop entries the version key still believes in. `BinaryEditorProvider`'s calls
// `sourceReads.forgetChangedSource` before its repost, on every event. The workspace watcher's
// handler (workspaceChange.ts) calls `sourceReads.forgetUnseenChange`, which forgets only when the
// file's version after the event is one the cache already holds, before it re-indexes the file's
// names and rebuilds the tree. Nothing in the unit suite can reach either: both are in modules that
// import `vscode`, and the trigger is a disk event. Here it is the real thing end to end — a real
// watcher event on a real file whose `stat` is asserted not to have moved, and what the user would
// see read back: the rows the provider posted, and the names the index lists.
//
// The fixture is built in the test rather than checked in, because the point is a PAIR of contents
// that are byte-for-byte the same length: two stored (level 0) zips differing only in a same-length
// block name. For the tab, it lives in tmpdir, outside the workspace folder, for the reason every
// fixture here does — `findFiles` must not return it and the tree/index assertions must not see it.
// The workspace watcher only reports files inside the workspace, so for it the file sits in the
// fixture workspace for the length of one test and is deleted after.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { strToU8, zipSync } from 'fflate';
import { BinaryEditorProvider } from '../../src/host/BinaryEditorProvider';
import { ensureIndex, invalidate as invalidateIndex, listEntries, reindexFile } from '../../src/host/nameIndex';
import { forgetUnseenChange, sourceCache } from '../../src/host/sourceReads';
import { forgetSource } from '../../src/host/sourceCache';
import { followContentChanges } from '../../src/host/workspaceChange';
import { SUPPORTED_GLOB } from '../../src/common/fileTypes';
import { ctx, fakePanel, nameOf, settle, token, waitFor } from './tools/hostHarness';

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

suite('a write no stat can see, with no tab open on it', () => {
  // The tree, the name index and the Usage column read the same shared cache as a tab, so the same
  // write left them stale too, and with no tab open nothing forgot it. The workspace watcher's handler
  // now does. `activate` returns no API, so the extension's own watcher cannot be reached from here.
  // The test attaches the extension's handler (`followContentChanges`, which is all that `activate`
  // wires to its watcher) to a watcher made by the same call `activate` makes, over a file in the
  // fixture workspace. The workspace matters: a watcher on a pattern outside it is a different kind
  // of watcher, which on macOS reports each write twice, about 50 ms apart. The name index is the
  // consumer read back: it is this test bundle's instance, over this bundle's cache.
  //
  // Every mtime here is a whole second, as an archive restores one (zip keeps 2 s, ustar 1 s) and as
  // a coarse mount reports one. Measured on macOS: the workspace watcher drops a change whose mtime
  // equals, to the nanosecond, the last one it saw, unless its sub-second part is zero. So a same-size
  // write restored to a sub-second mtime raises no workspace event, and no handler can see it.
  let path: string;
  let uri: vscode.Uri;

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  setup(async () => {
    uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'restored-no-tab.slx');
    // Start each test with nothing held for the file. Both tests use this one uri, and the cache is
    // shared across them: test 1 leaves a parse of NEW held at a whole-second mtime one second past
    // its own setup. A setup that runs in that next second writes OLD with that same mtime and the
    // same size, which is the very write this suite is about, and the index then serves NEW from
    // the start. `invalidateIndex` clears the index, not the cache under it.
    forgetSource(sourceCache, uri.toString());
    path = uri.fsPath;
    writeFileSync(path, OLD);
    const start = new Date(Math.floor(statSync(path).mtimeMs / 1000) * 1000);
    utimesSync(path, start, start);
    invalidateIndex();
    await ensureIndex();
  });

  // Out of the fixture workspace again, so no later suite's tree or index sees it.
  teardown(() => rmSync(path, { force: true }));

  /** The version the cache keys this file by, through vscode's own stat (see the test above). */
  const seen = async (): Promise<string> => {
    const st = await vscode.workspace.fs.stat(uri);
    return `${st.mtime}:${st.size}`;
  };
  const indexed = async (): Promise<string[]> =>
    (await listEntries()).filter((e) => e.sourceUri === uri.toString()).map((e) => e.name);
  /** An ordinary change: the mtime moves on by a whole second. */
  const touch = (): void => {
    const later = new Date(statSync(path).mtimeMs + 1000);
    utimesSync(path, later, later);
  };

  /** The same-size write, with the mtime put back: what a restore from an archive does. */
  async function restoreWrite(): Promise<void> {
    const before = statSync(path);
    const version = await seen();
    writeFileSync(path, NEW);
    utimesSync(path, before.atime, before.mtime);
    assert.strictEqual(await seen(), version, 'the version key the cache would compute did not move');
  }

  test('forgets for a write that keeps the version, and not for one that moves it', async () => {
    assert.strictEqual(OLD.byteLength, NEW.byteLength, 'the pair is the same size');
    // The index reads the file once, which leaves a parse of the old bytes in the cache.
    await reindexFile(uri);
    assert.deepStrictEqual(await indexed(), ['GainOld']);

    // An ordinary change. The version key sees it, so nothing is forgotten and the cache-wide
    // generation does not move.
    touch();
    const generation = sourceCache.generation;
    assert.strictEqual(await forgetUnseenChange(uri), false, 'an ordinary change forgets nothing');
    assert.strictEqual(sourceCache.generation, generation, 'and bumps no generation');
    await reindexFile(uri);
    assert.deepStrictEqual(await indexed(), ['GainOld'], 'the re-read at the new version is the same bytes');

    // The write the version key cannot see.
    await restoreWrite();
    const forgot = await forgetUnseenChange(uri);
    await reindexFile(uri);
    assert.deepStrictEqual(await indexed(), ['GainNew'], 'the index follows the file');
    assert.strictEqual(forgot, true, 'the unmoved version was forgotten');
    assert.strictEqual(sourceCache.generation, generation + 1, 'once');
  });

  test('the workspace watcher re-indexes the new names after such a write', async () => {
    const watcher = vscode.workspace.createFileSystemWatcher(SUPPORTED_GLOB);
    // The cache's generation at each rebuild the handler asks for. It moves on each forget.
    const rebuilds: number[] = [];
    const following = followContentChanges(watcher, () => {
      rebuilds.push(sourceCache.generation);
    });
    try {
      await reindexFile(uri);
      assert.deepStrictEqual(await indexed(), ['GainOld']);

      // A watcher starts asynchronously, and on Linux (inotify) a write made before it is live
      // raises no event at all. So first make ordinary changes, one every 400 ms, until the handler
      // has run once (the same approach as binarySlddOutsideChange.test.ts).
      const deadline = Date.now() + 20000;
      let next = 0;
      while (rebuilds.length === 0) {
        assert.ok(Date.now() < deadline, 'timed out waiting for the watcher to deliver an event');
        if (Date.now() >= next) {
          touch();
          next = Date.now() + 400;
        }
        await settle(20);
      }
      // Let the re-index that event started finish at the version the file has now. It re-read the
      // file, since its version moved, and found the same names.
      const touched = await seen();
      await waitFor('the re-index at the touched version', () => {
        return sourceCache.parsed.get(uri.toString())?.version === touched;
      });
      assert.deepStrictEqual(await indexed(), ['GainOld']);

      // Nothing tells the handler anything: the watcher's event is its own.
      const generation = sourceCache.generation;
      const asked = rebuilds.length;
      await restoreWrite();
      const until = Date.now() + 10000;
      let names = await indexed();
      while (!names.includes('GainNew')) {
        assert.ok(Date.now() < until, `timed out waiting for the index to follow the file: ${JSON.stringify(names)}`);
        await settle(20);
        names = await indexed();
      }
      assert.deepStrictEqual(names, ['GainNew'], 'and the old block is gone from it');
      // The forget came before the rebuild was asked for. A rebuild started earlier reads the old
      // entry, and a forget after it only stops its stores: no further event rebuilds again.
      await waitFor('the handler to ask for a rebuild', () => rebuilds.length > asked);
      assert.ok(
        rebuilds.slice(asked).every((at) => at > generation),
        `the forget came before the rebuild: generation ${generation}, at each rebuild ${rebuilds.slice(asked)}`,
      );
    } finally {
      following.dispose();
      watcher.dispose();
    }
  });
});
