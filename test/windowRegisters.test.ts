// Copyright 2026 The MathWorks, Inc.
//
// The window's registers (windowRegisters.ts): ONE createRegisters() per extension host, which the
// three documents (matDocument.ts, binaryDocument.ts, jsonDocument.ts) are given. A register made
// per document would give each its own clipboard, and a cut in one would find nothing to paste in
// another. The documents import `vscode`, so which registers they are given is read from their
// sources; what sharing one instance does is run on view's engines themselves: a copy in a MAT-file's
// table is the paste in a dictionary's, and a broadcast reaches every engine's table.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSession } from 'data-explorer-core';
import { buildSectionRowId, type TableChange } from 'data-explorer-view/model';
import { BinaryEngine, EditStack, EditStackIndex, MatEngine } from 'data-explorer-view/host';
import { registers } from '../src/host/windowRegisters.js';
import { blankCommentsAndKeepLines } from './tools/moduleGraph.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const code = (rel: string): string => blankCommentsAndKeepLines(readFileSync(join(ROOT, rel), 'utf8'));

beforeEach(() => {
  registers.clearClipboard();
  registers.clearDrag();
});

/** The files under `dir` (from the repository root) whose name ends in `ext`. */
const files = (dir: string, ext: string): string[] =>
  readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(`${dir}/${e.name}`, ext) : e.name.endsWith(ext) ? [`${dir}/${e.name}`] : [],
  );

/**
 * View's own factories that make registers when they are not handed any: the window would then hold
 * a second clipboard. Each is read off view's built code (below), so a new one is noticed.
 */
const VIEW_REGISTER_MAKERS: Record<string, string[]> = {
  // createWorkspace({ registers }) defaults to a createRegisters() of its own.
  'model/source/workspace.js': ['createWorkspace'],
};

describe("the window's registers", () => {
  it('are made once, in windowRegisters.ts, and nowhere else in the extension', () => {
    const makers = files('src', '.ts').filter((f) => /\bcreateRegisters\(/.test(code(f)));
    expect(makers).toEqual(['src/host/windowRegisters.ts']);
  });

  it("are not made behind the extension's back by one of view's factories that defaults its own", () => {
    // Which of view's built files make registers of their own, besides createRegisters itself: each
    // is listed above with the factories it exports, so a factory view adds is not missed.
    const VIEW = 'node_modules/data-explorer-view/dist';
    const defaulting = files(VIEW, '.js')
      .map((f) => f.slice(VIEW.length + 1))
      .filter((f) => f !== 'model/edit/registers.js' && /\bcreateRegisters\(\)/.test(readFileSync(join(ROOT, VIEW, f), 'utf8')));
    expect(defaulting.sort()).toEqual(Object.keys(VIEW_REGISTER_MAKERS).sort());
    // No file of the extension calls one. One that must would hand it the window's `registers`, and
    // then this is where that is allowed.
    for (const factory of Object.values(VIEW_REGISTER_MAKERS).flat()) {
      const callers = files('src', '.ts').filter((f) => new RegExp(`\\b${factory}\\(`).test(code(f)));
      expect(callers, `${factory} would give its documents a clipboard of their own`).toEqual([]);
    }
  });

  for (const doc of ['matDocument.ts', 'binaryDocument.ts', 'jsonDocument.ts']) {
    it(`are the registers ${doc} gives its engine`, () => {
      const source = code(`src/host/${doc}`);
      expect(source).toContain("import { registers } from './windowRegisters.js';");
      expect(source).toMatch(/^\s+registers,$/m);
    });
  }

  it("make a copy in one engine's table the paste in another's, and reach every engine's table with the broadcast", async () => {
    // Each document's own edit stack, as VS Code keeps one per editor.
    const sinkOf = () => {
      const stack = new EditStack();
      const pushed: string[] = [];
      return { pushed, push: (e: any) => (pushed.push(e.label), stack.push(e)), undo: () => stack.undo(), redo: () => stack.redo() };
    };
    const matSink = sinkOf();
    const dictionarySink = sinkOf();
    const mat = new MatEngine({
      session: createSession(),
      uri: 'file:///w/cases.mat',
      name: 'cases.mat',
      bytes: new Uint8Array(readFileSync(join(ROOT, 'test-integration', 'fixtures', 'mat', 'cases.mat'))).slice().buffer,
      sink: matSink,
      index: new EditStackIndex(),
      registers,
    });
    const dictionary = new BinaryEngine({
      session: createSession(),
      uri: 'file:///w/params.sldd',
      name: 'params.sldd',
      bytes: new Uint8Array(readFileSync(join(ROOT, 'test', 'parity', 'artifacts', 'binary', 'params.sldd'))),
      sink: dictionarySink,
      index: new EditStackIndex(),
      registers,
    });
    const matTable = mat.view();
    const dictionaryTable = dictionary.view();
    const heard: Record<string, string[]> = { mat: [], dictionary: [] };
    matTable.subscribe((c: TableChange) => void heard.mat.push(c.kind));
    dictionaryTable.subscribe((c: TableChange) => void heard.dictionary.push(c.kind));
    try {
      const matRows = (await matTable.open()).rows;
      matTable.opened?.();
      await dictionaryTable.open();
      dictionaryTable.opened?.();
      const variable = matRows.find((r: any) => r.parent === null && (r.Name?.label ?? r.Name) === 'scalarD') as any;
      expect(variable, 'the MAT-file has the variable scalarD').toBeTruthy();
      heard.mat.length = 0;
      heard.dictionary.length = 0;
      matTable.copy?.([variable.ID]);
      expect(registers.getClipboard()?.sourceDocUri).toBe('file:///w/cases.mat');
      expect(heard.mat, "the copy's broadcast reached the table it was made in").toContain('clipboard');
      expect(heard.dictionary, 'and the other engine’s table').toContain('clipboard');
      // The dictionary's paste reads the clipboard the MAT-file's copy filled: the window's one.
      dictionaryTable.paste?.(buildSectionRowId('design'));
      for (let i = 0; i < 50 && dictionarySink.pushed.length === 0; i++) await new Promise((r) => setTimeout(r, 0));
      expect(dictionarySink.pushed, 'the dictionary took the paste as one edit').toHaveLength(1);
      expect(matSink.pushed, 'and the copy changed nothing in the MAT-file').toEqual([]);
    } finally {
      matTable.dispose();
      dictionaryTable.dispose();
      mat.dispose();
      dictionary.dispose();
    }
  });
});
