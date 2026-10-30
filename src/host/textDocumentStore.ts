// Copyright 2026 The MathWorks, Inc.
//
// A JSON dictionary's TextDocument as view's JSON engine reads and writes its text (data-explorer-view
// /host's TextStore): the engine's rules were the JSON editor's, written against a TextDocument, so
// this hands it that document as the editor used it, call for call.
//
//  - The text, its version and its dirty flag are the document's, read when asked: a change's
//    listener reads them as the editor read them off the event's document, which is this one.
//  - One edit is ONE WorkspaceEdit, a replacement per patch in the order given, every range taken
//    against the text as it stands when asked, then applied; whatever the apply answers (true,
//    false, or a rejection) is the edit's answer. Built before anything is awaited, as the editor
//    built its own, so nothing can move the text between the ranges and the apply.
//  - Every listener is a subscription of its own to the document's changes and saves, filtered by
//    uri, as each tab subscribed: the listeners run in the order they subscribed, after
//    extension.ts's own (its keystroke invalidate), as they did. A change is its replacements as the
//    event lists them, and an undo or a redo says so.
//  - No reload: VS Code reloads a clean TextDocument from its file itself, and the engine hears that
//    as any other change. Save, revert and a hot-exit backup are VS Code's too.
//
// vscode-free, so its rules are pinned in vitest (test/textDocumentStore.test.ts): the VS Code calls
// are handed in (jsonDocument.ts).
import type { TextPatch } from 'data-explorer-core';
import type { TextStore, TextStoreChange } from 'data-explorer-view/host';

/** What this needs of a TextDocument (vscode.TextDocument, whose positions are `P`). */
export interface TextDocumentLike<P> {
  readonly uri: { toString(): string };
  readonly version: number;
  readonly isDirty: boolean;
  getText(): string;
  positionAt(offset: number): P;
}

/** What this needs of a TextDocumentChangeEvent. */
export interface TextDocumentChangeLike {
  readonly document: { readonly uri: { toString(): string } };
  readonly contentChanges: readonly { readonly rangeOffset: number; readonly rangeLength: number; readonly text: string }[];
  readonly reason?: number;
}

/** VS Code's end: the workspace's edit, its document events, its Undo and Redo. */
export interface TextDocumentApi<P> {
  /** One WorkspaceEdit of the document holding these replacements, in this order, applied. */
  applyEdit(replacements: readonly { start: P; end: P; text: string }[]): PromiseLike<boolean>;
  onDidChangeTextDocument(listener: (e: TextDocumentChangeLike) => void): { dispose(): void };
  onDidSaveTextDocument(listener: (document: { readonly uri: { toString(): string } }) => void): { dispose(): void };
  /** The `undo` and `redo` commands. */
  undo(): void;
  redo(): void;
  /** TextDocumentChangeReason's Undo and Redo. */
  readonly reasons: { readonly undo: number; readonly redo: number };
}

/** `document`'s text as a TextStore, through `api`. */
export function textDocumentStore<P>(document: TextDocumentLike<P>, api: TextDocumentApi<P>): TextStore {
  const uri = document.uri.toString();
  const reasonOf = (reason: number | undefined): 'undo' | 'redo' | undefined =>
    reason === api.reasons.undo ? 'undo' : reason === api.reasons.redo ? 'redo' : undefined;
  return {
    get text() {
      return document.getText();
    },
    get version() {
      return document.version;
    },
    get dirty() {
      return document.isDirty;
    },
    apply(patches: readonly TextPatch[]): Promise<boolean> {
      const replacements = patches.map((p) => ({
        start: document.positionAt(p.offset),
        end: document.positionAt(p.offset + p.length),
        text: p.text,
      }));
      return Promise.resolve(api.applyEdit(replacements));
    },
    undo: () => api.undo(),
    redo: () => api.redo(),
    onChange(listener: (change: TextStoreChange) => void): () => void {
      const sub = api.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() !== uri) return;
        const changes = e.contentChanges.map((c) => ({ rangeOffset: c.rangeOffset, rangeLength: c.rangeLength, text: c.text }));
        const reason = reasonOf(e.reason);
        listener(reason ? { changes, reason } : { changes });
      });
      return () => sub.dispose();
    },
    onSave(listener: () => void): () => void {
      const sub = api.onDidSaveTextDocument((saved) => {
        if (saved.uri.toString() === uri) listener();
      });
      return () => sub.dispose();
    },
  };
}
