// Copyright 2026 The MathWorks, Inc.
//
// One edit made through a dictionary editor's message handler, as the table sends it, on a file
// of its own in a fresh editor, and the file that editor then saves: a JSON .sldd's TextDocument,
// a binary .sldd's own save (its save gate and its zip). And the same edit of the same model saved
// by core's serializeSource instead, to hold the editors' saves to.
import * as vscode from 'vscode';
import { readFileSync } from 'fs';
import { DataModel, createSession, ingest } from 'data-explorer-core';
import { SlddTextEditorProvider } from '../../../src/host/SlddTextEditorProvider';
import { BinarySlddEditorProvider } from '../../../src/host/BinarySlddEditorProvider';
import { peekModel } from 'data-explorer-view/host';
import { addChildToModel, findOwningEntry, removeChildFromModel } from '../../../src/host/structuralEdit';
import { ctx, fakePanel, quiet, token, waitFor } from './hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** An edit at the node whose matlabPath is `path`: `key` is the column a value/prop edit names. */
export interface Edit {
  path: string;
  op: 'value' | 'prop' | 'name' | 'add' | 'delete';
  key?: string;
  text?: string;
}

export interface Answer {
  answer: 'written' | 'refused' | 'error' | 'none' | 'absent' | 'saveRefused';
  reason?: string;
  bytes?: Uint8Array;
}

const isSection = (n: any) => n?.constructor?.name === 'SectionNode';

/** The row node at `path` (a matlabPath), or null. */
export function nodeAt(root: any, path: string): any {
  return (root?.flatten?.() ?? []).find((n: any) => !n.isContainer && !isSection(n) && n.matlabPath === path) ?? null;
}

/** The text a row shows for `key`, which the table seeds its editor with and sends as oldValue. */
function shownText(row: any, key: string): string {
  if (key === 'Name') return String(row?.Name?.label ?? '');
  const cell = row?.[key];
  if (cell && typeof cell === 'object') return String(cell.text ?? '');
  return String(cell ?? '');
}

const columnOf = (edit: Edit): string => (edit.op === 'name' ? 'Name' : (edit.key ?? 'Value'));

/** The message the table sends for `edit` on `node`. */
function messageFor(node: any, edit: Edit): any {
  if (edit.op === 'add') return { type: 'addChild', rowId: node.id };
  if (edit.op === 'delete') return { type: 'delete', rowIds: [node.id] };
  const key = columnOf(edit);
  return { type: 'edit', rowId: node.id, columnId: key, oldValue: shownText(node.toRow(), key), newValue: edit.text ?? '' };
}

function refusalIn(posts: any[]): Answer | null {
  const v = posts.find((p) => p.type === 'validationError');
  if (v) return { answer: 'refused', reason: String(v.reason) };
  const e = posts.find((p) => p.type === 'error');
  if (e) return { answer: 'error', reason: String(e.message) };
  return null;
}

/** `edit` of the JSON dictionary at `file`, in a fresh text-table editor, then its TextDocument saved. */
export async function jsonEditorSave(file: string, edit: Edit): Promise<Answer> {
  const uri = vscode.Uri.file(file);
  const doc = await vscode.workspace.openTextDocument(uri);
  const view = fakePanel();
  try {
    await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, view.panel, token());
    view.send({ type: 'ready' });
    await waitFor('the first rows', () => view.posts.some((m) => m.type === 'setRows' || m.type === 'error'));
    const node = nodeAt(peekModel(uri.toString()), edit.path);
    if (!node) return { answer: 'absent' };
    const version = doc.version;
    const mark = view.posts.length;
    view.send(messageFor(node, edit));
    const after = () => view.posts.slice(mark);
    try {
      await waitFor('the edit answered', () => doc.version !== version || refusalIn(after()) !== null, 5000);
    } catch {
      return { answer: 'none' };
    }
    await quiet(30, 'an error the write may post after the text moved');
    const refused = refusalIn(after());
    if (doc.version === version) return refused ?? { answer: 'none' };
    if (!(await doc.save())) return { answer: 'error', reason: 'TextDocument.save() returned false' };
    const bytes = new Uint8Array(readFileSync(file));
    return refused ? { ...refused, bytes } : { answer: 'written', bytes };
  } finally {
    view.close();
  }
}

/** `edit` of the binary dictionary at `file`, in a fresh binary-table editor, then its own save. */
export async function binaryEditorSave(file: string, edit: Edit): Promise<Answer> {
  const uri = vscode.Uri.file(file);
  const provider = new BinarySlddEditorProvider(ctx());
  const events: unknown[] = [];
  const sub = provider.onDidChangeCustomDocument((e) => events.push(e));
  const doc: any = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
  const view = fakePanel();
  try {
    await provider.resolveCustomEditor(doc, view.panel, token());
    view.send({ type: 'ready' });
    await waitFor('the first rows', () => view.posts.some((m) => m.type === 'setRows' || m.type === 'error'));
    const node = nodeAt(DataModel.getDataSource(doc.srcId), edit.path);
    if (!node) return { answer: 'absent' };
    const mark = view.posts.length;
    // This provider answers an edit, an Add and a Delete synchronously.
    view.send(messageFor(node, edit));
    const refused = refusalIn(view.posts.slice(mark));
    if (events.length === 0) return refused ?? { answer: 'none' };
    try {
      await provider.saveCustomDocument(doc, token());
    } catch (err) {
      return { answer: 'saveRefused', reason: err instanceof Error ? err.message : String(err) };
    }
    const bytes = new Uint8Array(readFileSync(file));
    return refused ? { ...refused, bytes } : { answer: 'written', bytes };
  } finally {
    view.close();
    sub.dispose();
    doc.dispose();
  }
}

/**
 * The same model edit the editors make (the setter inside mutateSubtree, which is the editors'
 * mutateEntry, and the host's own Add and Delete), on a fresh read of `bytes` in a session of its
 * own, saved by core's serializeSource. An entry deleted whole is the one shape this does not make.
 */
export function coreSave(bytes: Uint8Array, filename: string, edit: Edit): Uint8Array {
  const session: any = createSession();
  const root: any = ingest(session, bytes, { filename });
  try {
    const node = nodeAt(root, edit.path);
    if (!node) throw new Error(`no node at ${edit.path}`);
    if (edit.op === 'add') session.mutateSubtree(findOwningEntry(node), () => addChildToModel(node));
    else if (edit.op === 'delete') session.mutateSubtree(findOwningEntry(node), () => removeChildFromModel(node));
    else {
      const result = session.mutateSubtree(findOwningEntry(node), () => node.setProperty(columnOf(edit), edit.text ?? ''));
      if (result !== true) throw new Error(`core refused ${edit.path}: ${JSON.stringify(result)}`);
    }
    const out = session.serializeSource(root.name);
    return out.kind === 'binary' ? out.bytes : new TextEncoder().encode(out.text);
  } finally {
    session.removeDataSource?.(root.name);
  }
}
