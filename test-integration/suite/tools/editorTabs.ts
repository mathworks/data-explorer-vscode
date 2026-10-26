// Copyright 2026 The MathWorks, Inc.
// The three table editors behind one shape, for a test that does the same thing in each: open a
// copy of a file, find a row, see whether an edit reached the document, save, and read the saved
// bytes back with core.
import * as assert from 'assert';
import { readFileSync } from 'fs';
import { token } from './hostHarness';
import { entryOf, entryRow, openBinary, openJson, openMat, readMat, readSldd, variableRow, type Opened } from './tables';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** One editor's tab, as these tests drive it. */
export interface EditorTab {
  view: { posts: any[]; send(message: any): void };
  /** The row of the entry or variable of that name, as the table holds it. */
  row(name: string): any;
  /** Whether any edit reached the document since it was opened. */
  edited(): boolean;
  dirty(): boolean;
  /** Save, and answer the bytes now on disk. */
  save(): Promise<Uint8Array>;
}

export interface EditorKind {
  name: string;
  /** A copy of `from` as `as` in `dir`, opened in this editor. */
  open(opened: Opened, dir: string, as: string, from: string): Promise<EditorTab>;
  /** What `read` makes of the entry or variable `name` that core reads from saved bytes. */
  readBack<T>(bytes: Uint8Array, name: string, read: (node: any) => T): T;
}

export const MAT_EDITOR: EditorKind = {
  name: 'a MAT-file',
  open: async (opened, dir, as, from) => {
    const m = await openMat(opened, dir, as, new Uint8Array(readFileSync(from)));
    return {
      view: m.view,
      row: (name) => variableRow(m.view.posts, name),
      edited: () => m.events.length > 0,
      dirty: () => m.doc.edits.dirty,
      save: async () => {
        await m.provider.saveCustomDocument(m.doc, token());
        return new Uint8Array(readFileSync(m.path));
      },
    };
  },
  readBack: (bytes, name, read) => readMat(bytes, (mat) => read((mat.children as any[]).find((v) => v.name === name))),
};

export const TEXT_EDITOR: EditorKind = {
  name: 'a text dictionary',
  open: async (opened, dir, as, from) => {
    const j = await openJson(opened, dir, as, from);
    const version = j.doc.version;
    return {
      view: j.view,
      row: (name) => entryRow(j.view.posts, name),
      edited: () => j.doc.version !== version,
      dirty: () => j.doc.isDirty,
      save: async () => {
        assert.ok(await j.doc.save(), 'the dictionary saved');
        return new Uint8Array(readFileSync(j.path));
      },
    };
  },
  readBack: (bytes, name, read) => readSldd(bytes, (dict) => read(entryOf(dict, name))),
};

export const BINARY_EDITOR: EditorKind = {
  name: 'a binary dictionary',
  open: async (opened, dir, as, from) => {
    const b = await openBinary(opened, dir, as, from);
    return {
      view: b.view,
      row: (name) => entryRow(b.view.posts, name),
      edited: () => b.events.length > 0,
      dirty: () => b.doc.edits.dirty,
      save: async () => {
        await b.provider.saveCustomDocument(b.doc, token());
        return new Uint8Array(readFileSync(b.path));
      },
    };
  },
  readBack: (bytes, name, read) => readSldd(bytes, (dict) => read(entryOf(dict, name))),
};
