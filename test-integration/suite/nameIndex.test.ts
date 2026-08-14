// Copyright 2026 The MathWorks, Inc.
// Integration tests for the workspace name index, run inside a real VS Code so
// `vscode.workspace.findFiles` and `workspace.fs.readFile` resolve against the
// fixture workspace (binary.sldd, data.sldd, params.sldd, model.slx). The pure
// name-extraction rules are unit-tested in test/nameExtract.test.ts; here we
// prove the end-to-end contract the vitest suite cannot reach:
//   - the index builds a COMPLETE name list from files that are never OPENED
//     (the whole point of eager, standalone indexing);
//   - it spans every format (.sldd JSON, .sldd zip/binary, .slx);
//   - it is DUP-PRESERVING across files (the same name in two sources yields two
//     records, never a collapsed single entry).
import * as assert from 'assert';
import * as vscode from 'vscode';
import { invalidate, ensureIndex, listEntries } from '../../src/host/nameIndex';

suite('workspace name index', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  setup(() => {
    // Start from a clean slate so each test triggers a full, deterministic build
    // off the on-disk fixtures (no leakage from a prior test's edits/reindex).
    invalidate();
  });

  test('builds a complete index from files that are never opened', async () => {
    // No editor is opened here — listEntries() alone drives the eager scan.
    await ensureIndex();
    const entries = await listEntries();
    assert.ok(entries.length > 0, 'the index is non-empty');

    // Every record carries the four fields the search overlay relies on.
    for (const e of entries) {
      assert.ok(e.name, 'a record has a non-empty name');
      assert.ok(e.sourceUri, 'a record has a source URI');
      assert.ok(e.sourceLabel, 'a record has a source label (basename)');
      assert.ok(
        ['sldd', 'mat', 'workspace', 'block'].includes(e.kind),
        `a record has a known kind (got ${e.kind})`,
      );
    }
  });

  test('lists .sldd entry names from an unopened JSON dictionary', async () => {
    const entries = await listEntries();
    const fromData = entries.filter((e) => e.sourceLabel === 'data.sldd');
    const names = fromData.map((e) => e.name);
    // Spot-check a few names that exist in the fixture data.sldd.
    for (const expected of ['PI', 'Number', 'Struct', 'stringArray']) {
      assert.ok(names.includes(expected), `data.sldd contributes "${expected}"`);
    }
    assert.ok(fromData.every((e) => e.kind === 'sldd'), 'all data.sldd records are kind "sldd"');
  });

  test('lists entry names from an unopened compressed-binary (zip) .sldd', async () => {
    // binary.sldd starts with the PK zip magic (0x50 0x4B) — it exercises the
    // parseBinarySldd path, not JSON.parse.
    const entries = await listEntries();
    const fromBinary = entries.filter((e) => e.sourceLabel === 'binary.sldd');
    assert.ok(fromBinary.length > 0, 'the zip .sldd contributes entry names');
    assert.ok(fromBinary.every((e) => e.kind === 'sldd'), 'all binary.sldd records are kind "sldd"');
  });

  test('preserves duplicate names across files (never collapsed)', async () => {
    // "structArray" exists in BOTH data.sldd and params.sldd in the fixture — a
    // complete, dup-preserving index must surface both occurrences as distinct
    // records so search can navigate to either source.
    const entries = await listEntries();
    const structArrays = entries.filter((e) => e.name === 'structArray');
    const labels = structArrays.map((e) => e.sourceLabel).sort();
    assert.ok(labels.includes('data.sldd'), 'the data.sldd occurrence is present');
    assert.ok(labels.includes('params.sldd'), 'the params.sldd occurrence is present');
    assert.ok(
      structArrays.length >= 2,
      `both occurrences are distinct records (got ${structArrays.length})`,
    );
  });

  test('spans multiple .sldd sources (JSON + zip)', async () => {
    const entries = await listEntries();
    const labels = new Set(entries.map((e) => e.sourceLabel));
    // The flat fixture workspace has three .sldd sources that carry entries.
    // (model.slx is a minimal fixture with no model-workspace vars or block→param
    // usages, so it contributes no name records — the .slx extraction path is
    // covered by the vitest unit suite, test/nameExtract.test.ts.)
    for (const f of ['data.sldd', 'params.sldd', 'binary.sldd']) {
      assert.ok(labels.has(f), `the index includes entries from ${f}`);
    }
  });
});
