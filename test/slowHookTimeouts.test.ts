// Copyright 2026 The MathWorks, Inc.
// The unit tests that are slow on purpose say so, each with its own ceiling, rather than
// running under vitest's defaults (5 s for a test, 10 s for a hook).
//
// Two kinds are slow by design:
// - rowBuilder's "builds every row instead of overflowing the argument limit" builds 200,000
//   rows, because that is what overflowed. It takes ~250 ms on an idle machine and timed out
//   at 5,683 ms and 5,252 ms on loaded ones (2026-10-03 and 10-04).
// - every `beforeAll` that imports a whole webview entry (`../src/webview/<name>-main.js`) to
//   drive the shipped listeners. A cold import of one is ~330 ms idle, and the import is the
//   part of the suite that a loaded worker pool stretches.
// A default ceiling is sized for an idle machine, so these failed under load with nothing
// wrong. Raising the global default instead was rejected: it would hide a real slowdown in
// every other test.
//
// No run can make the timeout happen on demand, since the repro is a loaded machine. So this
// file checks the test sources: every such hook, and the 200,000-row test, passes an explicit
// timeout. The hooks are found by what they do, so a new file that copies the pattern is
// held to it too.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const TEST_DIR = import.meta.dirname;
// vitest's own defaults, which these tests have to stand clear of.
const DEFAULT_TEST_TIMEOUT = 5_000;
const DEFAULT_HOOK_TIMEOUT = 10_000;
const WEBVIEW_ENTRY = /^\.\.\/src\/webview\/[\w-]+-main\.js$/;

// Every test file vitest runs (vitest.config.ts includes test/**/*.test.ts).
function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return d.name === 'node_modules' ? [] : testFiles(p);
    return d.name.endsWith('.test.ts') ? [p] : [];
  });
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
}

function callsNamed(sf: ts.SourceFile, name: string): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) out.push(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

// The string specifiers of every `import(...)` inside a node.
function dynamicImports(node: ts.Node): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [arg] = n.arguments;
      if (arg && ts.isStringLiteralLike(arg)) out.push(arg.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

// The timeout a vitest call passes as its argument at `index`, if it is a number literal.
function timeoutArg(call: ts.CallExpression, index: number): number | undefined {
  const arg = call.arguments[index];
  return arg && ts.isNumericLiteral(arg) ? Number(arg.text.replace(/_/g, '')) : undefined;
}

function where(sf: ts.SourceFile, node: ts.Node): string {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return `${relative(TEST_DIR, sf.fileName)}:${line + 1}`;
}

interface Hook {
  at: string;
  imports: string[];
  timeout: number | undefined;
}

function webviewEntryHooks(): Hook[] {
  return testFiles(TEST_DIR).flatMap((file) => {
    const sf = parse(file);
    return callsNamed(sf, 'beforeAll').flatMap((call) => {
      const imports = dynamicImports(call.arguments[0] ?? call).filter((s) => WEBVIEW_ENTRY.test(s));
      return imports.length ? [{ at: where(sf, call), imports, timeout: timeoutArg(call, 1) }] : [];
    });
  });
}

describe('a beforeAll that imports a whole webview entry passes its own timeout', () => {
  const hooks = webviewEntryHooks();

  it('finds the hooks it is about', () => {
    // The witness that the scan sees the pattern at all: these files each import an entry in
    // their beforeAll today, and a scan that matched none of them would pass vacuously.
    const files = hooks.map((h) => h.at.replace(/:\d+$/, ''));
    for (const f of [
      'addEntryWiring.test.ts',
      'linkRoute.test.ts',
      'nameSelectTarget.test.ts',
      'pasteOneSectionWiring.test.ts',
      'readonlyEditorGate.test.ts',
      'tableMainChildRows.test.ts',
      'piMainVariableEditor.test.ts',
      'projectMain.test.ts',
      'msp.test.ts',
    ]) {
      expect(files, f).toContain(f);
    }
  });

  it('above the default hook timeout', () => {
    const short = hooks
      .filter((h) => !(h.timeout !== undefined && h.timeout > DEFAULT_HOOK_TIMEOUT))
      .map((h) => `${h.at}: imports ${h.imports.join(', ')} with ${h.timeout ?? 'no'} timeout`);
    expect(short).toEqual([]);
  });
});

describe('the 200,000-row test passes its own timeout', () => {
  it('above the default test timeout', () => {
    const sf = parse(join(TEST_DIR, 'rowBuilder.test.ts'));
    const title = 'builds every row instead of overflowing the argument limit';
    const [test] = callsNamed(sf, 'it').filter((c) => {
      const [name] = c.arguments;
      return name !== undefined && ts.isStringLiteralLike(name) && name.text === title;
    });
    expect(test, 'the test is still in rowBuilder.test.ts under its title').toBeDefined();
    // And it is still the one that builds 200,000 rows, which is why it gets the ceiling.
    expect(test!.getText(sf)).toContain('const count = 200000;');
    const timeout = timeoutArg(test!, 2);
    expect(timeout ?? 0, `${where(sf, test!)}: passes ${timeout ?? 'no'} timeout`).toBeGreaterThan(
      DEFAULT_TEST_TIMEOUT,
    );
  });
});
