// Copyright 2026 The MathWorks, Inc.
// Opening a MAT-file, a JSON .sldd and a compressed-binary .sldd side by side, each through its
// real provider, on scratch copies outside the workspace folder — what a test of the clipboard
// and of drags BETWEEN formats needs before it can say anything about either.
//
// Every opener registers how to close what it opened on the `Opened` list it is handed, and the
// suite's teardown runs them: a view's teardown is where a provider lets go of its hub
// registrations (the source deleter, the clipboard broadcast), which a later test must not find.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { copyFileSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { DataModel, parseBinarySldd } from 'data-explorer-core';
import { MatEditorProvider } from '../../../src/host/MatEditorProvider';
import { SlddTextEditorProvider } from '../../../src/host/SlddTextEditorProvider';
import { BinarySlddEditorProvider } from '../../../src/host/BinarySlddEditorProvider';
import { ctx, entryNames, fakePanel, isEntryRow, nameOf, token, waitFor, ws } from './hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** What a suite's teardown closes, last opened first. */
export type Opened = (() => void)[];

export function closeAll(opened: Opened): void {
  for (const close of opened.splice(0).reverse()) {
    try {
      close();
    } catch {
      /* already gone */
    }
  }
}

/** The path of a file of test-integration/fixtures, e.g. `fixturePath('multiline', 'x.sldd')`. */
export const fixturePath = (...parts: string[]): string => join(ctx().extensionUri.fsPath, 'test-integration', 'fixtures', ...parts);

/** A MATLAB-written MAT-file of test-integration/fixtures/mat. */
export const matFixture = (name: string): Uint8Array => new Uint8Array(readFileSync(fixturePath('mat', name)));

/**
 * The rows a MAT-file's table holds now: the last setRows with every `updateEntryRows` after it
 * spliced over its variable's run, as the webview splices them (rowUpdates.ts).
 */
export function tableOf(posts: any[]): any[] {
  let rows: any[] = [];
  for (const p of posts) {
    if (p.type === 'setRows') rows = p.rows;
    else if (p.type === 'updateEntryRows') {
      const start = rows.findIndex((r) => r.ID === p.entryRowId);
      if (start < 0) continue;
      const subtree = new Set([p.entryRowId]);
      let end = start + 1;
      while (end < rows.length && subtree.has(rows[end].parent)) subtree.add(rows[end++].ID);
      rows = [...rows.slice(0, start), ...p.rows, ...rows.slice(end)];
    }
  }
  return rows;
}

/** A MAT-file's variable row by name, as the table holds it now. */
export function variableRow(posts: any[], name: string): any {
  const row = tableOf(posts).find((r) => r.parent == null && nameOf(r) === name);
  assert.ok(row, `the table has a row for "${name}"`);
  return row;
}

/** A dictionary's entry row by name, from its last whole paint. */
export function entryRow(posts: any[], name: string): any {
  const rows = posts.filter((m) => m.type === 'setRows').pop()?.rows ?? [];
  const row = rows.find((r: any) => isEntryRow(r) && nameOf(r) === name);
  assert.ok(row, `the dictionary has an entry row for "${name}"`);
  return row;
}

export const errorsIn = (posts: any[]): string[] => posts.filter((m) => m.type === 'error').map((m) => String(m.message));

export interface MatTab {
  path: string;
  uri: vscode.Uri;
  name: string;
  provider: MatEditorProvider;
  doc: any;
  view: ReturnType<typeof fakePanel>;
  events: vscode.CustomDocumentEditEvent<vscode.CustomDocument>[];
  /** The names of the variables the document's tree holds, in order. */
  names(): string[];
  /** The tree's variable of that name. */
  variable(name: string): any;
}

/** A copy of `bytes` as `as` in `dir`, opened in the MAT-file editor and painted. */
export async function openMat(opened: Opened, dir: string, as: string, bytes: Uint8Array): Promise<MatTab> {
  const path = join(dir, as);
  writeFileSync(path, bytes);
  const uri = vscode.Uri.file(path);
  const provider = new MatEditorProvider(ctx());
  const doc: any = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
  const view = fakePanel();
  opened.push(() => doc.dispose(), () => view.close());
  const events: vscode.CustomDocumentEditEvent<vscode.CustomDocument>[] = [];
  provider.onDidChangeCustomDocument((e) => {
    if (e.document === doc) events.push(e);
  });
  await provider.resolveCustomEditor(doc, view.panel, token());
  view.send({ type: 'ready' });
  await waitFor(`${as}'s first rows`, () => view.posts.some((p) => p.type === 'setRows' || p.type === 'error'));
  const tree = () => DataModel.getDataSource(doc.srcId) as any;
  return {
    path,
    uri,
    name: as,
    provider,
    doc,
    view,
    events,
    names: () => ((tree()?.children ?? []) as any[]).map((v) => v.name),
    variable: (name) => ((tree()?.children ?? []) as any[]).find((v) => v.name === name),
  };
}

export interface JsonTab {
  path: string;
  uri: vscode.Uri;
  doc: vscode.TextDocument;
  view: ReturnType<typeof fakePanel>;
  names(): string[];
}

/**
 * A copy of `from` (the workspace's params.sldd unless said) as `as` in `dir`, opened in the JSON
 * table editor.
 */
export async function openJson(opened: Opened, dir: string, as: string, from = join(ws().fsPath, 'params.sldd')): Promise<JsonTab> {
  const path = join(dir, as);
  copyFileSync(from, path);
  const uri = vscode.Uri.file(path);
  const doc = await vscode.workspace.openTextDocument(uri);
  const view = fakePanel();
  opened.push(() => view.close());
  await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, view.panel, token());
  view.send({ type: 'ready' });
  await waitFor(`${as}'s first rows`, () => view.posts.some((m) => m.type === 'setRows'));
  return { path, uri, doc, view, names: () => entryNames(doc.getText()) };
}

export interface BinaryTab {
  path: string;
  uri: vscode.Uri;
  doc: any;
  provider: BinarySlddEditorProvider;
  view: ReturnType<typeof fakePanel>;
  events: vscode.CustomDocumentEditEvent<vscode.CustomDocument>[];
  /** The entry names the document's chunk holds. */
  names(): string[];
}

/**
 * A copy of `from` (the MATLAB-written binary params.sldd unless said) as `as` in `dir`, opened in
 * the binary table editor.
 */
export async function openBinary(
  opened: Opened,
  dir: string,
  as: string,
  from = join(ws().fsPath, '..', '..', '..', 'test', 'parity', 'artifacts', 'binary', 'params.sldd'),
): Promise<BinaryTab> {
  const path = join(dir, as);
  copyFileSync(from, path);
  const uri = vscode.Uri.file(path);
  const provider = new BinarySlddEditorProvider(ctx());
  const doc: any = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
  const view = fakePanel();
  opened.push(() => doc.dispose(), () => view.close());
  const events: vscode.CustomDocumentEditEvent<vscode.CustomDocument>[] = [];
  provider.onDidChangeCustomDocument((e) => {
    if (e.document === doc) events.push(e);
  });
  await provider.resolveCustomEditor(doc, view.panel, token());
  view.send({ type: 'ready' });
  await waitFor(`${as}'s first rows`, () => view.posts.some((m) => m.type === 'setRows'));
  const names = () => [...String(doc.chunkXml).matchAll(/<Object Class="DD\.ENTRY">\s*<P Name="Name" Class="char">([^<]*)<\/P>/g)].map((m) => m[1]);
  return { path, uri, doc, provider, view, events, names };
}

/**
 * What a table shows of an entry or a variable and everything under it: each row's place under
 * it, and its cells, the text of each (a cell is a string or an editor's `{text}`). The columns
 * that say where or when a row was made, not what it holds, are left out: they differ by format
 * and by time.
 */
export function shownCells(node: any): Record<string, Record<string, string>> {
  const skip = new Set(['ID', 'parent', 'Status', 'lastModified', 'lastModifiedBy', 'storageClass']);
  const out: Record<string, Record<string, string>> = {};
  for (const n of node.flatten()) {
    const row = n.toRow();
    const cells: Record<string, string> = {};
    for (const [key, cell] of Object.entries(row)) {
      if (skip.has(key) || key.startsWith('_')) continue;
      cells[key] = cell && typeof cell === 'object' ? String((cell as any).text ?? (cell as any).label ?? '') : String(cell ?? '');
    }
    out[String(n.id).slice(String(node.id).length) || '.'] = cells;
  }
  return out;
}

/** The tree core reads from `bytes`, a MAT-file, registered for as long as `read` runs. */
export function readMat<T>(bytes: Uint8Array, read: (mat: any) => T): T {
  const srcId = `matclip-readback:${Math.random()}`;
  const mat: any = DataModel.addMatSource(srcId, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, {
    path: 'readback.mat',
  });
  try {
    return read(mat);
  } finally {
    DataModel.removeDataSource(srcId);
  }
}

/** The tree core reads from a dictionary's bytes (either format), registered for as long as `read` runs. */
export function readSldd<T>(bytes: Uint8Array, read: (dict: any) => T): T {
  const srcId = `matclip-readback:${Math.random()}.sldd`;
  const content =
    bytes[0] === 0x7b
      ? JSON.parse(new TextDecoder().decode(bytes))
      : parseBinarySldd(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const dict: any = DataModel.addDataSource(srcId, content, { path: 'readback.sldd' });
  try {
    return read(dict);
  } finally {
    DataModel.removeDataSource(srcId);
  }
}

/** A dictionary's entry of that name, in any section. */
export const entryOf = (dict: any, name: string): any =>
  ((dict?.children ?? []) as any[]).flatMap((s: any) => s.children ?? []).find((e: any) => e.name === name);
