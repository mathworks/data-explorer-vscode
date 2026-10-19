// Copyright 2026 The MathWorks, Inc.
// `activate` follows content changes on disk through `followContentChanges`, on its watcher over
// every supported file.
//
// When a file's content changes on disk, the handler in src/host/workspaceChange.ts forgets the
// shared source cache's entries for it if the write left the file's mtime and size where they
// were, then drops the file's table model, re-indexes its names and rebuilds the tree.
// test-integration/suite/forgetOnDiskChange.test.ts drives that handler end to end, on a real
// watcher over a real file. But `activate` returns no API and no command exposes the extension's
// own name index, so that test cannot reach the extension's watcher: it attaches the handler
// itself, to a watcher made by the same call `activate` makes. Whether `activate` attaches it at
// all is what no test saw. Deleting the one line in extension.ts that does left every test green,
// and then a file changed on disk with no editor open on it rebuilt neither the tree nor its names
// in the index.
//
// So this file pins the wiring in the source, parsed rather than matched as text, so comments
// and formatting do not count:
// - extension.ts imports `followContentChanges` from ./host/workspaceChange.js;
// - `activate` makes a const watcher with `vscode.workspace.createFileSystemWatcher(SUPPORTED_GLOB)`,
//   SUPPORTED_GLOB being the shared glob from ./common/fileTypes.js;
// - one statement of `activate`'s own body, `context.subscriptions.push(...)`, passes it
//   `followContentChanges(<that watcher>, refreshAll)`, so it is attached on every activation and
//   disposed with the extension, and the rebuild it asks for is the one for what changed on disk;
// - nothing else in `activate` listens to that watcher's change event. The integration test covers
//   the handler it attaches, so a second listener written here would be one no test reaches.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const EXTENSION = join(import.meta.dirname, '..', 'src', 'extension.ts');

interface Wiring {
  /** `followContentChanges` is imported from ./host/workspaceChange.js. */
  imported: boolean;
  /** The const `activate` makes with `vscode.workspace.createFileSystemWatcher(SUPPORTED_GLOB)`. */
  watcher: string | undefined;
  /** Each `followContentChanges(...)` handed to `context.subscriptions.push` in `activate`'s body. */
  subscribed: string[];
  /** Every `followContentChanges(...)` call in the file, wherever it is. */
  calls: string[];
  /** Every `<watcher>.onDidChange` in `activate`, as `line: text`. */
  otherChangeListeners: string[];
}

function each<T extends ts.Node>(root: ts.Node, guard: (n: ts.Node) => n is T): T[] {
  const out: T[] = [];
  const visit = (n: ts.Node): void => {
    if (guard(n)) out.push(n);
    ts.forEachChild(n, visit);
  };
  visit(root);
  return out;
}

function importsFrom(sf: ts.SourceFile, specifier: string, name: string): boolean {
  return sf.statements.some(
    (s) =>
      ts.isImportDeclaration(s) &&
      ts.isStringLiteral(s.moduleSpecifier) &&
      s.moduleSpecifier.text === specifier &&
      !!s.importClause?.namedBindings &&
      ts.isNamedImports(s.importClause.namedBindings) &&
      s.importClause.namedBindings.elements.some((e) => e.name.text === name && !e.propertyName),
  );
}

function wiring(text: string): Wiring {
  const sf = ts.createSourceFile('extension.ts', text, ts.ScriptTarget.Latest, true);
  const src = (n: ts.Node): string => n.getText(sf);
  const calls = each(sf, ts.isCallExpression)
    .filter((c) => ts.isIdentifier(c.expression) && c.expression.text === 'followContentChanges')
    .map(src);
  const imported = importsFrom(sf, './host/workspaceChange.js', 'followContentChanges');

  const activate = sf.statements.find(
    (s): s is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(s) &&
      s.name?.text === 'activate' &&
      !!s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword),
  );
  const body = activate?.body;
  const context = activate?.parameters[0]?.name;
  if (!body || !context || !ts.isIdentifier(context)) {
    return { imported, watcher: undefined, subscribed: [], calls, otherChangeListeners: [] };
  }

  // The watcher: a const declared in activate's own body, on the shared glob.
  const globShared = importsFrom(sf, './common/fileTypes.js', 'SUPPORTED_GLOB');
  const watcher = body.statements
    .filter(ts.isVariableStatement)
    .filter((s) => (s.declarationList.flags & ts.NodeFlags.Const) !== 0)
    .flatMap((s) => s.declarationList.declarations)
    .find(
      (d) =>
        ts.isIdentifier(d.name) &&
        !!d.initializer &&
        ts.isCallExpression(d.initializer) &&
        src(d.initializer.expression) === 'vscode.workspace.createFileSystemWatcher' &&
        d.initializer.arguments.length === 1 &&
        globShared &&
        src(d.initializer.arguments[0]) === 'SUPPORTED_GLOB',
    )?.name;
  const watcherName = watcher && ts.isIdentifier(watcher) ? watcher.text : undefined;

  // What one of activate's own statements hands to context.subscriptions.push.
  const pushed = body.statements
    .filter(ts.isExpressionStatement)
    .map((s) => s.expression)
    .filter(
      (e): e is ts.CallExpression =>
        ts.isCallExpression(e) && src(e.expression) === `${context.text}.subscriptions.push`,
    )
    .flatMap((e) => [...e.arguments]);
  const subscribed = pushed
    .filter(
      (a): a is ts.CallExpression =>
        ts.isCallExpression(a) && ts.isIdentifier(a.expression) && a.expression.text === 'followContentChanges',
    )
    .map(src);

  const otherChangeListeners = watcherName
    ? each(body, ts.isPropertyAccessExpression)
        .filter((p) => src(p.expression) === watcherName && p.name.text === 'onDidChange')
        .map((p) => `${sf.getLineAndCharacterOfPosition(p.getStart(sf)).line + 1}: ${src(p.parent)}`)
    : [];

  return { imported, watcher: watcherName, subscribed, calls, otherChangeListeners };
}

describe('activate follows content changes on its SUPPORTED_GLOB watcher', () => {
  const source = readFileSync(EXTENSION, 'utf8');
  const w = wiring(source);

  it('imports the handler the integration test drives', () => {
    expect(w.imported, 'followContentChanges imported from ./host/workspaceChange.js').toBe(true);
  });

  it('makes its watcher on the shared glob', () => {
    expect(w.watcher, 'a const = vscode.workspace.createFileSystemWatcher(SUPPORTED_GLOB) in activate').toBeDefined();
  });

  it('subscribes followContentChanges on that watcher with refreshAll, once, disposed with the extension', () => {
    expect(w.subscribed).toEqual([`followContentChanges(${w.watcher}, refreshAll)`]);
    // And it is not also called somewhere the push does not own.
    expect(w.calls).toEqual(w.subscribed);
  });

  it("listens to that watcher's change event through followContentChanges only", () => {
    expect(w.otherChangeListeners).toEqual([]);
  });
});

describe('the scan sees the wiring go', () => {
  // These drive the same scan over extension.ts as it is, with one edit, so that a scan that
  // stopped finding anything could not pass the tests above by finding nothing. The edits start
  // from the call as extension.ts spells it, which the scan itself reports.
  const source = readFileSync(EXTENSION, 'utf8');
  const { watcher, subscribed } = wiring(source);
  const call = subscribed[0] ?? 'followContentChanges(<not found>)';
  const edited = (replacement: string): Wiring => wiring(source.replace(`${call},`, replacement));

  it('the call it edits is in extension.ts once, as an argument', () => {
    expect(source.split(`${call},`).length - 1).toBe(1);
  });

  it('when the call is removed', () => {
    const w = edited('');
    expect(w.subscribed).toEqual([]);
    expect(w.calls).toEqual([]);
  });

  it('when the handler is attached to another watcher', () => {
    const w = edited('followContentChanges(otherWatcher, refreshAll),');
    expect(w.subscribed).toEqual(['followContentChanges(otherWatcher, refreshAll)']);
  });

  it('when the handler asks for the badge refresh instead of the rebuild', () => {
    const w = edited(`followContentChanges(${watcher}, refreshBadges),`);
    expect(w.subscribed).toEqual([`followContentChanges(${watcher}, refreshBadges)`]);
  });

  it('when the call is made outside the subscriptions', () => {
    const w = wiring(
      source
        .replace(`${call},`, '')
        .replace('context.subscriptions.push(', `void ${call};\n  context.subscriptions.push(`),
    );
    expect(w.subscribed).toEqual([]);
    expect(w.calls).toEqual([call]);
  });

  it('when the watcher is on another glob', () => {
    const w = wiring(source.replace('createFileSystemWatcher(SUPPORTED_GLOB)', "createFileSystemWatcher('**/*.sldd')"));
    expect(w.watcher).toBeUndefined();
  });

  it('when activate listens to the change event itself', () => {
    const w = edited(`${call},\n    ${watcher}.onDidChange(() => refreshAll()),`);
    expect(w.otherChangeListeners).toHaveLength(1);
  });
});
