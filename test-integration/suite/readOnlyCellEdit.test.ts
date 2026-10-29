// Copyright 2026 The MathWorks, Inc.
//
// An edit of a cell core holds read-only, as each table editor answers it, in real VS Code.
//
// The table offers no editor on such a cell, but an edit message can still name one (a table
// painted before the row turned read-only, a chord on a stale row). Core used to answer the edit of
// a read-only row that writes nothing with `true`, so a host took it for an edit that landed: the
// JSON view wrote the entry's text back unchanged, the binary view pushed an edit with nothing in
// it. It now refuses it with a reason (data-explorer-core#181), and every editor answers that as
// the refusal it is: the reason shown in the cell's validation dialog, the row painted again from
// the model (which is unchanged), and no edit made — the document neither written nor dirty.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DataModel } from 'data-explorer-core';
import { quiet, waitFor } from './tools/hostHarness';
import { closeAll, entryRow, matFixture, openBinary, openJson, openMat, variableRow, type Opened } from './tools/tables';

/* eslint-disable @typescript-eslint/no-explicit-any */

suite('An edit of a read-only cell is refused, with its reason, and changes nothing', () => {
  let dir = '';
  const opened: Opened = [];

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  setup(() => {
    dir = mkdtempSync(join(tmpdir(), 'dex-rocell-'));
  });

  teardown(async () => {
    closeAll(opened);
    await quiet(200, 'the disposed watchers to stop watching before their directory goes');
    rmSync(dir, { recursive: true, force: true });
  });

  /** What a refused edit leaves on the view: the validation dialog, then a repaint of that row. */
  const refusal = (posts: any[]) => {
    const at = posts.findIndex((p) => p.type === 'validationError');
    assert.ok(at >= 0, 'the edit is answered with a validation error');
    return { error: posts[at], after: posts.slice(at + 1) };
  };

  test('in a JSON dictionary: the text is not written', async () => {
    const j = await openJson(opened, dir, 'ro.sldd');
    const row = entryRow(j.view.posts, 'gravity');
    const version = j.doc.version;
    j.view.posts.length = 0;
    j.view.send({ type: 'edit', rowId: row.ID, columnId: 'Kind', oldValue: row.Kind, newValue: 'Numeric Type' });
    await waitFor('the answer', () => j.view.posts.some((p) => p.type === 'validationError'));
    const { error, after } = refusal(j.view.posts);
    assert.match(error.reason, /^Cannot edit "gravity": the Kind of gravity is read-only here\./);
    await waitFor('the row painted again', () => after.length > 0 || j.view.posts.some((p) => p.type === 'updateEntryRows'));
    await quiet(200, 'a write the refusal must not make');
    assert.strictEqual(j.doc.version, version, 'the text was not written');
    assert.strictEqual(j.doc.isDirty, false);
  });

  test('in a binary dictionary: no edit is pushed', async () => {
    const b = await openBinary(opened, dir, 'ro.sldd');
    const row = entryRow(b.view.posts, 'gravity');
    const chunk = b.doc.chunkXml;
    b.view.posts.length = 0;
    b.view.send({ type: 'edit', rowId: row.ID, columnId: 'Kind', oldValue: row.Kind, newValue: 'Numeric Type' });
    const { error } = refusal(b.view.posts);
    assert.match(error.reason, /^Cannot edit "gravity": the Kind of gravity is read-only here\./);
    assert.ok(b.view.posts.some((p) => p.type === 'updateEntryRows'), 'the row painted again');
    assert.strictEqual(b.events.length, 0, 'no edit reached VS Code');
    assert.strictEqual(b.doc.chunkXml, chunk);
    assert.strictEqual(b.doc.edits.dirty, false);
  });

  test('in a MAT-file: no edit is pushed', async () => {
    const m = await openMat(opened, dir, 'ro.mat', matFixture('cases.mat'));
    const row = variableRow(m.view.posts, 'scalarD');
    m.view.posts.length = 0;
    m.view.send({ type: 'edit', rowId: row.ID, columnId: 'Kind', oldValue: row.Kind, newValue: 'Numeric Type' });
    const { error } = refusal(m.view.posts);
    assert.ok(typeof error.reason === 'string' && error.reason.length > 0, `refused with a reason (${error.reason})`);
    assert.ok(!error.reason.includes(m.doc.srcId), 'naming the file, not its srcId');
    assert.ok(m.view.posts.some((p) => p.type === 'updateEntryRows'), 'the row painted again');
    assert.strictEqual(m.events.length, 0, 'no edit reached VS Code');
    assert.strictEqual(m.doc.edits.dirty, false);
    assert.strictEqual((DataModel.getDataSource(m.doc.srcId) as any).children.find((v: any) => v.name === 'scalarD').toRow().Kind, row.Kind);
  });
});
