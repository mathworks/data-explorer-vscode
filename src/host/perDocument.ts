// Copyright 2026 The MathWorks, Inc.
//
// One object per open document, shared by every table of it: made by the first table to open, and
// disposed with the last to close, so the next one to open makes a fresh one. For an editor that
// VS Code hands only a TextDocument per tab (a CustomTextEditorProvider has no document object of
// its own): what was the JSON editor's module-level map of document state by uri (`openDocs`), kept
// across provider instances as that was.
//
// The object is bound to the TextDocument it was made for (the JSON editor's engine reads and
// writes that document's text), so a table only joins it while it is still that document, open: a
// table that was never closed (a resolve that threw before its panel's dispose was wired) must not
// hand a later tab an engine over a closed document's text, whose edit ranges would then be applied,
// by uri, to the live one. Such a stale object is disposed, and the new table makes a fresh one.
//
// vscode-free, so it is unit-tested (test/perDocument.test.ts).

/** Documents by uri, each with the count of tables open on it. */
export class PerDocument<T extends { dispose(): void }> {
  private readonly held = new Map<string, { value: T; tables: number; gone?: boolean }>();

  /**
   * A table of the document at `uri` opens: its object, made with `make` if no table holds one that
   * `fits` (by default any), and the table's `close`, which disposes the object once no table is
   * left (once, however often called). A held object that does not fit is disposed first, with every
   * table still holding it, whose close then has nothing left to dispose.
   */
  open(uri: string, make: () => T, fits: (held: T) => boolean = () => true): { value: T; close(): void } {
    let entry = this.held.get(uri);
    if (entry && !fits(entry.value)) {
      this.held.delete(uri);
      entry.gone = true;
      entry.value.dispose();
      entry = undefined;
    }
    if (!entry) {
      entry = { value: make(), tables: 0 };
      this.held.set(uri, entry);
    }
    entry.tables++;
    const held = entry;
    let closed = false;
    return {
      value: held.value,
      close: () => {
        if (closed || held.gone) return;
        closed = true;
        if (--held.tables > 0) return;
        if (this.held.get(uri) === held) this.held.delete(uri);
        held.value.dispose();
      },
    };
  }

  /** The object a table of `uri` holds, if any does. */
  peek(uri: string): T | undefined {
    return this.held.get(uri)?.value;
  }
}

/** Whether an object made for `held` still fits a table of `document`: the same document, and still open. */
export function sameOpenDocument<D extends { readonly isClosed: boolean }>(held: { readonly document: D }, document: D): boolean {
  return held.document === document && !document.isClosed;
}

/**
 * `rest`, run with a table just opened; if it throws, the table is closed before the throw goes on,
 * so that nothing is left holding the document for a later table (its close is what a disposed
 * panel would have called, had `rest` lived to wire it).
 */
export function closingOnThrow<T extends { close(): void }, R>(opened: T, rest: (opened: T) => R): R {
  try {
    return rest(opened);
  } catch (err) {
    opened.close();
    throw err;
  }
}
