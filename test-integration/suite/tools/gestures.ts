// Copyright 2026 The MathWorks, Inc.
//
// A gesture through an editor, as the table makes it: the editor open in its format (tables.ts), a
// message sent, and the answer waited for (an edit counted, or the words the provider posted). Shared by
// the gesture sweep and the JSON undo/redo round trip.
import * as vscode from 'vscode';
import { readFileSync } from 'fs';
import { DataModel } from 'data-explorer-core';
import { peekModel } from 'data-explorer-view/host';
import { getClipboard } from '../../../src/host/clipboard';
import { quiet, token, waitFor } from './hostHarness';
import { openBinary, openJson, openMat, type Opened } from './tables';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** An open editor, whatever its format: its view, its model, how far its edits have got, its save. */
export interface Tab {
  view: { posts: any[]; send(msg: any): void };
  model(): any;
  edits(): number;
  save(): Promise<void>;
  path: string;
  events?: any[];
  doc?: vscode.TextDocument;
}

export const EXT: Record<string, string> = { json: 'sldd', bin: 'sldd', mat27: 'mat' };

/** A copy of `from` as `as` in `dir`, open in its format's editor. */
export async function openTab(format: string, opened: Opened, dir: string, as: string, from: string): Promise<Tab> {
  if (format === 'json') {
    const t = await openJson(opened, dir, as, from);
    return { view: t.view, model: () => peekModel(t.uri.toString()), edits: () => t.doc.version, save: async () => void (await t.doc.save()), path: t.path, doc: t.doc };
  }
  const t = format === 'bin' ? await openBinary(opened, dir, as, from) : await openMat(opened, dir, as, new Uint8Array(readFileSync(from)));
  const provider: any = t.provider;
  return { view: t.view, model: () => DataModel.getDataSource(t.doc.srcId), edits: () => t.events.length, save: () => provider.saveCustomDocument(t.doc, token()), path: t.path, events: t.events };
}

/** The words a provider posted about a gesture it did not make: a refusal or an error. */
export function refusalIn(posts: any[]): { answer: string; reason: string } | null {
  const v = posts.find((p) => p.type === 'validationError');
  if (v) return { answer: 'refused', reason: String(v.reason) };
  const e = posts.find((p) => p.type === 'error');
  if (e) return { answer: 'error', reason: String(e.message) };
  return null;
}

/** The entry `name` of section `section` ('' for a MAT-file's variables) under `root`. */
export const entryIn = (root: any, section: string, name: string): any =>
  ((section === '' ? root : (root?.children ?? []).find((s: any) => s.name === section))?.children ?? []).find((e: any) => e.name === name) ?? null;

/** Send `msg` and wait for it to be answered: an edit counted, or a word posted. A word wins, as in editorSaves. */
export async function answered(tab: Tab, msg: any): Promise<{ answer: string; reason?: string; edited: boolean }> {
  const before = tab.edits();
  const mark = tab.view.posts.length;
  tab.view.send(msg);
  try {
    await waitFor('the gesture answered', () => tab.edits() > before || refusalIn(tab.view.posts.slice(mark)) !== null, 5000);
  } catch {
    return { answer: 'none', edited: false };
  }
  await quiet(30, 'a word the edit may post after it was counted');
  const edited = tab.edits() > before;
  return { ...(refusalIn(tab.view.posts.slice(mark)) ?? { answer: edited ? 'written' : 'none' }), edited };
}

/** Copy or cut an entry: null once the register holds it, or the word the copy posted. */
export async function take(tab: Tab, section: string, name: string, mode: 'copy' | 'cut'): Promise<{ answer: string; reason?: string } | null> {
  const node = entryIn(tab.model(), section, name);
  if (!node) return { answer: 'absent' };
  const mark = tab.view.posts.length;
  tab.view.send({ type: mode, rowIds: [node.id] });
  try {
    await waitFor('the copy taken', () => getClipboard() !== null || refusalIn(tab.view.posts.slice(mark)) !== null, 5000);
  } catch {
    return { answer: 'none', reason: `the ${mode} filled no register` };
  }
  return getClipboard() !== null ? null : refusalIn(tab.view.posts.slice(mark));
}
