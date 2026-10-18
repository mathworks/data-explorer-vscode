// Copyright 2026 The MathWorks, Inc.
// The integration tests that flaked under load wait for the thing itself, not for a guess at
// how long it takes.
//
// Each of these slept a fixed time and then asserted something an asynchronous path produces:
// typeLinkBinary and binarySlddEdit, that the webview's 'ready' round trip has registered the
// document as a source (500 ms, and test 1 took 509 ms of it); undoOfTableEdit, that the
// first paint, the edit and the undo have each landed (800 + 1500 + 1500 ms). On a loaded
// machine the sleep runs out first and the test fails as a confusing assertion, and on an idle
// one every run pays the whole sleep. They now wait on a named predicate through `waitFor`
// (test-integration/suite/tools/hostHarness.ts), which fails as "timed out waiting for <what>".
//
// treeRefreshKeepsGraph's second test is the other member, and its cause was a shared file:
// the first test rewrites data.sldd on disk and restores it, and a model of data.sldd that an
// earlier suite left open reloads after that restore. A reload landing under the second test's
// edit bumps the document's version, and the main thread refuses the edit ('the edit applied'
// false, on Linux CI). It now opens and edits a scratch copy of its own, which no other test
// has open.
//
// Neither failure can be produced on demand — the repro is a loaded machine — so what is pinned
// here is the shape of the test source. Comments are blanked first: these files explain the old
// sleeps by quoting them.
//
// The rest of the suite's fixed sleeps are not in this list on purpose: converting every one of
// them is its own, later change.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blankCommentsAndKeepLines } from './tools/moduleGraph.js';

const SUITE = join(import.meta.dirname, '..', 'test-integration', 'suite');

function code(file: string): string {
  return blankCommentsAndKeepLines(readFileSync(join(SUITE, file), 'utf8'));
}

// Every fixed sleep, as `file:line: text`, so a failure names the place.
function fixedSleeps(file: string): string[] {
  const lines = code(file).split('\n');
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (/\bsetTimeout\s*\(|\bsettle\s*\(/.test(line)) out.push(`${file}:${i + 1}: ${line.trim()}`);
  });
  return out;
}

describe('the integration tests that flaked under load wait on a predicate', () => {
  for (const file of ['typeLinkBinary.test.ts', 'binarySlddEdit.test.ts', 'undoOfTableEdit.test.ts']) {
    it(`${file} sleeps for no fixed time`, () => {
      expect(fixedSleeps(file)).toEqual([]);
      // The witness that the file still waits for its asynchronous work at all, rather than
      // having had its wait deleted along with the sleep.
      expect(code(file)).toMatch(/\bawait waitFor\(\s*'[^']+'/);
      // DataModel.getDataSource answers null for a source it does not hold, so a wait on
      // `!== undefined` is over before it starts.
      expect(code(file)).not.toMatch(/getDataSource\(.*\)\s*[!=]==\s*undefined/);
    });
  }
});

describe("treeRefreshKeepsGraph's badge test edits a dictionary no other test has open", () => {
  // The second test, from its title to the end of the file (it is the last one).
  const badgeTest = (): string => {
    const src = code('treeRefreshKeepsGraph.test.ts');
    const at = src.indexOf("test('a refresh() is enough to badge a document that just went dirty'");
    expect(at, 'the badge test is still in the file under its title').toBeGreaterThan(0);
    return src.slice(at);
  };

  it('opens and edits a scratch copy, not data.sldd', () => {
    const body = badgeTest();
    // data.sldd is what the copy is made FROM, and that is the one mention it may have: the
    // first test rewrites it on disk, so any other use puts the race back.
    const copy = "vscode.workspace.fs.copy(wsUri('data.sldd'), uri, { overwrite: true })";
    expect(body.replace(copy, '')).not.toContain("'data.sldd'");
    expect(body).toContain(copy);
    expect(body).toContain("const uri = wsUri('tree_refresh_badge.sldd');");
    expect(body).toContain("k.label === 'tree_refresh_badge.sldd'");
    // And deletes it, or the copy is a root row that sectionsTree's exact list then fails on.
    expect(body).toMatch(/finally \{[^}]*await vscode\.workspace\.fs\.delete\(uri\);/);
  });
});
