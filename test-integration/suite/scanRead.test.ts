// Copyright 2026 The MathWorks, Inc.
// The scan read gate, against a real `vscode.workspace.fs` (the only place `stat` and
// `readFile` exist). The batching half is unit-tested in test/mapLimited.test.ts; what
// needs a real VS Code is the SIZE GATE, and the reason it exists: a folder holding a
// dictionary larger than V8 can decode used to take the extension host to ~2 GB and
// kill the window outright — no error, no dump the user could see, just a closed window.
//
// The oversized file here is SPARSE (ftruncate, no bytes written), so it costs no disk
// and no time to create. That is also what makes the assertion meaningful: reading it
// would still work, slowly, if the gate were gone, so `null` is the whole contract.
//
// `scanVersion` is here for the same reason and is the sharper case: it is the KEY every
// cached file summary is stored under (usagePlan.ts), and it is derived from a real
// `stat`. The fast suite cannot reach that — its reader hands back a constant — so a
// version that silently never repeated would leave every test green while the cache it
// keys missed on every build and re-parsed the folder each time. Two facts pin it: an
// untouched file reports the same version twice, and a touched one does not.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { closeSync, ftruncateSync, openSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MAX_SCAN_BYTES, readForScan, scanVersion } from '../../src/host/scanRead';
import { invalidate, ensureIndex, listEntries } from '../../src/host/nameIndex';

// Outside the fixture workspace on purpose: a half-gigabyte file inside it would join
// every other suite's scans and change what they see.
const sparse = join(tmpdir(), 'dex-oversized-scan.sldd');
const small = join(tmpdir(), 'dex-small-scan.sldd');

suite('workspace scan read gate', () => {
  suiteSetup(() => {
    const fd = openSync(sparse, 'w');
    // One byte past the cap: the gate is `>`, so this is the smallest file it rejects.
    ftruncateSync(fd, MAX_SCAN_BYTES + 1);
    closeSync(fd);
    writeFileSync(small, '{"Header":{},"Sections":[]}');
  });

  suiteTeardown(() => {
    rmSync(sparse, { force: true });
    rmSync(small, { force: true });
  });

  test('a file past the cap is not scanned', async () => {
    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(sparse));
    assert.strictEqual(stat.size, MAX_SCAN_BYTES + 1, 'the sparse file really is oversized');
    assert.strictEqual(await readForScan(vscode.Uri.file(sparse)), null);
  });

  test('a file within the cap is read whole', async () => {
    const bytes = await readForScan(vscode.Uri.file(small));
    assert.ok(bytes, 'a normal file is readable');
    assert.strictEqual(new TextDecoder().decode(bytes), '{"Header":{},"Sections":[]}');
  });

  test('an unreadable file is null, not a thrown scan', async () => {
    // Same answer as oversized, deliberately: a scan that dies on one missing file
    // (deleted between findFiles and the read — a normal race) answers nothing at all.
    const gone = vscode.Uri.file(join(tmpdir(), 'dex-no-such-file.sldd'));
    assert.strictEqual(await readForScan(gone), null);
  });

  test('an unchanged file reports the SAME version twice', async () => {
    // The property the summary cache is built on. If this ever stopped holding — a version
    // carrying the read time, say — nothing would fail; the extension would just re-parse
    // every model on every build again, which is the bug this cache exists to fix.
    const uri = vscode.Uri.file(small);
    const first = await scanVersion(uri);
    assert.ok(first, 'a readable file has a version');
    assert.strictEqual(await scanVersion(uri), first);
  });

  test('a file whose mtime moved reports a DIFFERENT version', async () => {
    // The other half: self-healing. The mtime is set explicitly rather than by rewriting
    // the file, so this tests the mtime leg on its own — a rewrite of different length
    // would move the size too and pass even if mtime were ignored.
    const uri = vscode.Uri.file(small);
    const before = await scanVersion(uri);
    const later = new Date(Date.now() + 60_000);
    utimesSync(small, later, later);
    const after = await scanVersion(uri);
    assert.ok(after, 'still readable');
    assert.notStrictEqual(after, before, 'a touched file is not the file that was cached');
  });

  test('a file past the cap has no version either', async () => {
    // Same refusal as `readForScan`, decided from the same `stat`: a file no scan will read
    // is a file no scan can cache, and answering with a version would put an entry in the
    // cache for content that was never looked at.
    assert.strictEqual(await scanVersion(vscode.Uri.file(sparse)), null);
    assert.strictEqual(await scanVersion(vscode.Uri.file(join(tmpdir(), 'dex-no-such-file.sldd'))), null);
  });

  test('the name index survives an oversized file in the workspace', async () => {
    // The regression itself, at the scan that runs every file's real parser. The file
    // is created inside the workspace and removed again in the same test, so no other
    // suite sees it.
    const ws = vscode.workspace.workspaceFolders?.[0];
    assert.ok(ws, 'a workspace folder must be open');
    const inWorkspace = join(ws.uri.fsPath, 'oversized-guard.sldd');
    const fd = openSync(inWorkspace, 'w');
    ftruncateSync(fd, MAX_SCAN_BYTES + 1);
    closeSync(fd);
    try {
      invalidate();
      await ensureIndex();
      const entries = await listEntries();
      // The point is BOTH halves: the scan completed (the host is still here to answer)
      // and the oversized file contributed nothing rather than failing the build.
      assert.ok(entries.length > 0, 'the rest of the workspace still indexed');
      const fromOversized = entries.filter((e) => e.sourceUri.endsWith('oversized-guard.sldd'));
      assert.deepStrictEqual(fromOversized, [], 'the oversized file yields no names');
    } finally {
      rmSync(inWorkspace, { force: true });
      invalidate();
    }
  });
});
