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
// undoOfTableEdit has since moved to view's JSON engine tests, with no VS Code to wait for.
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
// Those were the members that had flaked. The same shape was everywhere else in the suite: a
// fixed sleep standing for "until the paint has registered", "until the repaint lands", "until
// the tab opens", each a guess at a latency. So every suite file is held to the rule now. A wait
// is one of two things, both in tools/hostHarness.ts:
//
//  - `waitFor('<what>', done)`, which polls the condition itself and fails as "timed out
//    waiting for <what>";
//  - `quiet(ms, '<why>')`, the one fixed wait left, for what cannot be waited for: something
//    that must NOT happen ("no second paint", "no prompt"), given the time it would take to
//    happen, or events with nothing to observe (a disposed watcher letting go). It says why.
//
// No suite file sleeps on its own, or defines its own wait, so neither can drift from those two.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
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
  for (const file of ['typeLinkBinary.test.ts', 'binarySlddEdit.test.ts']) {
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

// --- every suite file ---------------------------------------------------------------------

const HARNESS = join(SUITE, 'tools', 'hostHarness.ts');
const SUITE_FILES = readdirSync(SUITE).filter((f) => f.endsWith('.test.ts')).sort();

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
}

function calls(sf: ts.SourceFile): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) out.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const calleeName = (call: ts.CallExpression): string | undefined =>
  ts.isIdentifier(call.expression) ? call.expression.text : undefined;

const at = (sf: ts.SourceFile, node: ts.Node): string =>
  `${sf.fileName.split('/').pop()}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}: ${node
    .getText(sf)
    .split('\n')[0]
    .trim()}`;

/** A string the reader can read: a literal, or a template with something in it. */
function isText(node: ts.Expression | undefined): boolean {
  if (!node) return false;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text.trim().length > 0;
  return ts.isTemplateExpression(node);
}

// The timers a wait is made of. `settle` and `sleep` are the names the suite's own copies had.
const SLEEPS = new Set(['setTimeout', 'setInterval', 'settle', 'sleep']);
const WAITS = new Set(['waitFor', 'quiet', 'settle', 'sleep', 'pause', 'delay']);

/** Every call in `sf` that sleeps a fixed time of its own. */
function fixedSleepCalls(sf: ts.SourceFile): string[] {
  return calls(sf)
    .filter((c) => SLEEPS.has(calleeName(c) ?? ''))
    .map((c) => at(sf, c));
}

/** A wait the file defines for itself, as a function or a const. */
function ownWaits(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && WAITS.has(node.name.text)) out.push(at(sf, node));
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && WAITS.has(node.name.text)) out.push(at(sf, node));
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * Every `waitFor` that does not say what it waits for, and every `quiet` that does not say why.
 * A helper that is itself handed the name passes it on as `what`, and is held to it by its own
 * callers' literals.
 */
function unnamedWaits(sf: ts.SourceFile): string[] {
  return calls(sf)
    .filter((c) => {
      const name = calleeName(c);
      if (name === 'waitFor') {
        const first = c.arguments[0];
        return !(isText(first) || (first && ts.isIdentifier(first) && first.text === 'what'));
      }
      if (name === 'quiet') return c.arguments.length !== 2 || !isText(c.arguments[1]);
      return false;
    })
    .map((c) => at(sf, c));
}

/** The names `sf` imports from the harness. */
function harnessImports(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (stmt.moduleSpecifier.text !== './tools/hostHarness') continue;
    const bindings = stmt.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) bindings.elements.forEach((e) => names.add(e.name.text));
  }
  return names;
}

describe('every integration suite file waits on a named condition, or is quiet for a stated reason', () => {
  it('reads the whole suite', () => {
    // A glob that matched nothing would pass every check below.
    expect(SUITE_FILES.length).toBeGreaterThan(40);
    expect(SUITE_FILES).toContain('binarySlddEdit.test.ts');
  });

  for (const file of SUITE_FILES) {
    it(`${file} sleeps for no fixed time of its own`, () => {
      const sf = parse(join(SUITE, file));
      expect(fixedSleepCalls(sf), 'a fixed sleep: wait for the condition, or say why with quiet()').toEqual([]);
      expect(ownWaits(sf), 'a wait of its own: use the harness waitFor and quiet').toEqual([]);
      expect(unnamedWaits(sf), 'a wait that does not say what it waits for, or why').toEqual([]);
      // And the two it does use are the harness's, so a wait cannot be redefined by import either.
      const imported = harnessImports(sf);
      for (const name of ['waitFor', 'quiet']) {
        if (calls(sf).some((c) => calleeName(c) === name)) expect(imported.has(name), `${name} from ./tools/hostHarness`).toBe(true);
      }
    });
  }

  it('the harness holds the one timer, under waitFor and quiet, and exports no sleep', () => {
    const sf = parse(HARNESS);
    const timers = calls(sf).filter((c) => calleeName(c) === 'setTimeout');
    expect(timers.map((c) => at(sf, c))).toHaveLength(1);
    const exported = new Set<string>();
    for (const stmt of sf.statements) {
      const isExported = ts.canHaveModifiers(stmt) && ts.getModifiers(stmt)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!isExported) continue;
      if (ts.isFunctionDeclaration(stmt) && stmt.name) exported.add(stmt.name.text);
      if (ts.isVariableStatement(stmt)) {
        stmt.declarationList.declarations.forEach((d) => ts.isIdentifier(d.name) && exported.add(d.name.text));
      }
    }
    expect(exported.has('waitFor')).toBe(true);
    expect(exported.has('quiet')).toBe(true);
    for (const name of ['settle', 'sleep', 'pause', 'delay']) expect(exported.has(name), `exports ${name}`).toBe(false);
  });
});
