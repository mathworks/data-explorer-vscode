// Copyright 2026 The MathWorks, Inc.
// This extension reaches data-explorer-view only through the package's designed entries:
// `data-explorer-view/model`, one entry per widget (`/tree-table`, `/property-inspector`, …),
// `/theme.css` and `/icons/<id>.svg`.
//
// View 0.x still exports every module by its path (`data-explorer-view/model/rows/rowBuilder.js`,
// `…/widgets/tree-table/dex-tree-table.js`), and those paths go before view 1.0. An import of
// one compiles and passes today and breaks on the bump that removes them; an import into the
// package's dist/ or src/ by a relative path breaks on any bump that moves a file. Both depend on
// how view lays out its files, which is view's to change. So this reads every import in the
// extension's sources, tests, integration tests and benchmarks, and refuses those.
//
// The entries are read off the installed view's package.json: every `exports` key without a
// wildcard, and its icons folder. The wildcard keys are the 0.x paths.
//
// What a file READS from the installed package (the stylesheet tests read the tokens view ships,
// copy:icons copies its icons/) is not an import, and is not checked here.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();
const DIRS = ['src', 'test', 'test-integration', 'bench'];
const VIEW = 'data-explorer-view';

const exportsOfView: Record<string, unknown> = JSON.parse(
  readFileSync(join(ROOT, 'node_modules', VIEW, 'package.json'), 'utf8'),
).exports;
const ENTRIES = new Set(Object.keys(exportsOfView).filter((key) => !key.includes('*')).map((key) => `${VIEW}${key.slice(1)}`));
const ICON = new RegExp(`^${VIEW}/icons/[\\w-]+\\.svg$`);

function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === 'node_modules' || entry === 'fixtures') return [];
    if (statSync(path).isDirectory()) return filesIn(path);
    return /\.(ts|mts|cts|js|mjs|cjs)$/.test(entry) && !entry.endsWith('.d.ts') ? [path] : [];
  });
}

interface Import {
  file: string;
  line: number;
  specifier: string;
}

// Every module specifier a file names, by the parser rather than a regex: comments here quote
// imports to explain them. Static and dynamic imports, re-exports, `import('…')` types,
// `require`, and the module paths vitest's mocks name.
function importsOf(path: string): Import[] {
  const text = readFileSync(path, 'utf8');
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const found: Import[] = [];
  const add = (node: ts.Node, specifier: string): void => {
    found.push({ file: relative(ROOT, path), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, specifier });
  };
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node, node.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const ref = node.moduleReference.expression;
      if (ts.isStringLiteral(ref)) add(node, ref.text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      add(node, node.argument.literal.text);
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0]!)) {
      const callee = node.expression;
      const named =
        callee.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(callee) && callee.text === 'require') ||
        (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'vi');
      if (named) add(node, (node.arguments[0] as ts.StringLiteralLike).text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const IMPORTS = DIRS.flatMap((dir) => filesIn(join(ROOT, dir))).flatMap(importsOf);
const ofView = IMPORTS.filter(({ specifier }) => specifier === VIEW || specifier.startsWith(`${VIEW}/`) || specifier.includes(`node_modules/${VIEW}/`));

describe('data-explorer-view is imported through its entries only', () => {
  it('reads the entries off the installed package', () => {
    expect([...ENTRIES]).toEqual(expect.arrayContaining([`${VIEW}/model`, `${VIEW}/tree-table`, `${VIEW}/theme.css`]));
    expect([...ENTRIES].filter((entry) => /\/(model|widgets)\/|\/dist\//.test(entry))).toEqual([]);
  });

  it('finds the imports it judges', () => {
    // A walk that read nothing, or a parser that saw no imports, would pass everything.
    expect(IMPORTS.length).toBeGreaterThan(1000);
    expect(ofView.length).toBeGreaterThan(100);
  });

  it('names no module path, nothing in dist/ or src/, and no other subpath', () => {
    const deep = ofView.filter(({ specifier }) => !ENTRIES.has(specifier) && !ICON.test(specifier));
    expect(deep.map(({ file, line, specifier }) => `${file}:${line} ${specifier}`)).toEqual([]);
  });
});
