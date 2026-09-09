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
import * as assert from 'assert';
import * as vscode from 'vscode';
import { closeSync, ftruncateSync, openSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MAX_SCAN_BYTES, readForScan } from '../../src/host/scanRead';
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
