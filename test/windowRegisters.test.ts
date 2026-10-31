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

describe("the window's registers", () => {
  it('are made once, in windowRegisters.ts, and nowhere else in the extension', () => {
    const files = (dir: string): string[] =>
      readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? files(`${dir}/${e.name}`) : e.name.endsWith('.ts') ? [`${dir}/${e.name}`] : [],
      );
    const makers = files('src').filter((f) => /\bcreateRegisters\(/.test(code(f)));
    expect(makers).toEqual(['src/host/windowRegisters.ts']);
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
