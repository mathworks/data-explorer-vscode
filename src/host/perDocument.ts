// Copyright 2026 The MathWorks, Inc.
//
// One object per open document, shared by every table of it: made by the first table to open, and
// disposed with the last to close, so the next one to open makes a fresh one. For an editor that
// VS Code hands only a TextDocument per tab (a CustomTextEditorProvider has no document object of
// its own): what was the JSON editor's module-level map of document state by uri (`openDocs`), kept
// across provider instances as that was.
//
// vscode-free, so it is unit-tested (test/perDocument.test.ts).

/** Documents by uri, each with the count of tables open on it. */
export class PerDocument<T extends { dispose(): void }> {
  private readonly held = new Map<string, { value: T; tables: number }>();

  /**
   * A table of the document at `uri` opens: its object, made with `make` if no table holds one, and
   * the table's `close`, which disposes the object once no table is left (once, however often called).
   */
  open(uri: string, make: () => T): { value: T; close(): void } {
    let entry = this.held.get(uri);
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
        if (closed) return;
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
